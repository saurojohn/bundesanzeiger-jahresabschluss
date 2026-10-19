import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import type { Request } from 'express';
import { createHash } from 'node:crypto';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { Public } from '../decorators/public.decorator';
import { CurrentUser } from '../decorators/current-user.decorator';
import { AuthService } from '../services/auth.service';
import { TotpService } from '../services/totp.service';
import { LoginDto } from '../dto/login.dto';
import { RefreshTokenDto } from '../dto/refresh-token.dto';
import {
  TotpDisableRequestDto,
  TotpEnableRequestDto,
} from '../dto/totp.dto';
import type { AuthUser } from '../types/auth-user.types';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Auth-Controller.
 *
 * Routen:
 *   POST   /api/auth/login           — öffentlich, TOTP optional
 *   POST   /api/auth/refresh         — öffentlich
 *   POST   /api/auth/logout          — geschützt
 *   GET    /api/auth/me              — geschützt
 *   POST   /api/auth/totp/setup      — geschützt: liefert Secret + QR
 *   POST   /api/auth/totp/enable     — geschützt: verifiziert + speichert
 *   POST   /api/auth/totp/disable    — geschützt: 2FA deaktivieren (Passwort + Code)
 */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly totpService: TotpService,
    private readonly prisma: PrismaService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(
    @Body() dto: LoginDto,
    @Req() req: Request,
  ): ReturnType<AuthService['login']> {
    return this.authService.login(dto, {
      ip: req.ip ?? null,
      userAgent: this.userAgent(req),
    });
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(
    @Body() dto: RefreshTokenDto,
    @Req() req: Request,
  ): ReturnType<AuthService['refresh']> {
    return this.authService.refresh(dto, {
      ip: req.ip ?? null,
      userAgent: this.userAgent(req),
    });
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @CurrentUser() user: AuthUser,
    @Body() body: { refreshToken?: string } | undefined,
  ): Promise<void> {
    let sessionId: string | undefined;
    const gezieltAngefordert = Boolean(body?.refreshToken);
    if (body?.refreshToken) {
      const refreshTokenHash = createHash('sha256')
        .update(body.refreshToken as string)
        .digest('hex');
      const session = await this.prisma.userSession.findUnique({
        where: { refreshTokenHash },
        // BEFUND 2026-10-11: `userId` war nicht Teil der Auswahl. Wer den
        // Refresh-Token eines fremden Users mitbrachte, lieferte dessen
        // Session-ID — und `logout()` widerrief sie ohne Besitzerpruefung.
        // Im Audit stand dann der aufrufende User bei einer fremden
        // Abmeldung. Die Sperrbedingung sitzt jetzt auch hier.
        select: { id: true, userId: true },
      });
      sessionId = session?.userId === user.id ? session.id : undefined;
    }
    await this.authService.logout(user.id, sessionId, gezieltAngefordert);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@CurrentUser() user: AuthUser): ReturnType<AuthService['me']> {
    const dto = await this.authService.me(user.id);
    if (!dto) throw new UnauthorizedException('User nicht gefunden');
    return dto;
  }

  /**
   * Liefert ein neues TOTP-Secret + QR-Code. Persistiert nichts —
   * der Client muss /auth/totp/enable mit dem erhaltenen Secret
   * aufrufen, um TOTP zu aktivieren.
   */
  @UseGuards(JwtAuthGuard)
  @Post('totp/setup')
  @HttpCode(HttpStatus.OK)
  async totpSetup(
    @CurrentUser() user: AuthUser,
  ): Promise<{
    secret: string;
    otpauthUrl: string;
    qrCodeDataUrl: string;
  }> {
    const secret = this.totpService.generateSecret();
    const otpauthUrl =
      `otpauth://totp/Bundesanzeiger-Jahresabschluss:${encodeURIComponent(user.email)}` +
      `?secret=${secret}&issuer=Bundesanzeiger-Jahresabschluss`;
    const qrCodeDataUrl = await this.totpService.generateQrCodeDataUrl(
      secret,
      user.email,
    );
    return { secret, otpauthUrl, qrCodeDataUrl };
  }

  /**
   * Aktiviert TOTP für den aktuellen User.
   * Body: { secret, code } — secret stammt aus /totp/setup.
   */
  @UseGuards(JwtAuthGuard)
  @Post('totp/enable')
  @HttpCode(HttpStatus.OK)
  async totpEnable(
    @CurrentUser() user: AuthUser,
    // BEFUND 2026-10-19 (Nachtrag 48): Der Typ war
    // `TotpEnableRequestDto & { secret: string }`. **Ein Kreuzungstyp ist zur
    // Laufzeit `Object`** — Nests `design:paramtypes` kann den DTO nicht
    // mehr erkennen, und der globale `ValidationPipe` validiert gegen einen
    // untypisierten Body **gar nichts**.
    //
    // Gemessen: ein Aufruf ohne `password` (im DTO Pflichtfeld) lief in
    // `bcrypt.compare(undefined, hash)` und endete mit **HTTP 500** statt
    // 400. Damit war diese Route die **einzige im Projekt ohne
    // Eingabevalidierung** — `secret` und `code`同样 ungeprueft.
    //
    // Der Kreuzungstyp war ueberfluessig: `TotpEnableRequestDto` enthaelt
    // `secret` und `code` bereits. Der Typ wird hier nur noch auf den DTO
    // zurueckgesetzt — damit haengt die Validierung wieder an der Route.
    @Body() body: TotpEnableRequestDto,
  ): Promise<{ success: true }> {
    // BEFUND 2026-10-19 (Nachtrag 48): Erneute Authentifizierung.
    // Das Deaktivieren verlangt Passwort + Code, das Aktivieren bisher
    // nur ein gueltiges JWT. Wer nur ein JWT hat, konnte so das MFA des
    // Opfers mit dem eigenen Secret uebernehmen und das Opfer dauerhaft
    // aussperren. Siehe die Messung im Kommentar der DTO.
    // Defensive: `bcrypt.compare(undefined, hash)` wirft und endet als
    // HTTP 500. Die Validierung deckt das ab — aber ein 500 auf einem
    // Auth-Pfad ist eine schlechte Fehlermeldung, wenn sich das DTO
    // einmal aendert.
    if (!body.password) {
      throw new BadRequestException('password erforderlich');
    }
    const dbUser = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { passwordHash: true },
    });
    if (!dbUser) throw new UnauthorizedException('User nicht gefunden');
    const passwordOk = await bcrypt.compare(body.password, dbUser.passwordHash);
    if (!passwordOk) {
      throw new UnauthorizedException(
        'Passwort falsch — MFA kann nur mit erneuter Authentifizierung aktiviert werden.',
      );
    }

    const encrypted = this.totpService.enableTotp(body.secret, body.code);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { totpSecret: encrypted, totpEnabled: true },
    });
    return { success: true };
  }

  /**
   * Deaktiviert TOTP — verlangt Passwort + aktuellen Code.
   */
  @UseGuards(JwtAuthGuard)
  @Post('totp/disable')
  @HttpCode(HttpStatus.OK)
  async totpDisable(
    @CurrentUser() user: AuthUser,
    @Body() body: TotpDisableRequestDto,
  ): Promise<{ success: true }> {
    if (body.email.toLowerCase() !== user.email.toLowerCase()) {
      throw new UnauthorizedException('E-Mail stimmt nicht');
    }
    const dbUser = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { passwordHash: true, totpSecret: true, totpEnabled: true },
    });
    if (!dbUser) throw new UnauthorizedException('User nicht gefunden');
    if (!dbUser.totpEnabled || !dbUser.totpSecret) {
      throw new UnauthorizedException('TOTP nicht aktiv');
    }
    const passwordOk = await bcrypt.compare(body.password, dbUser.passwordHash);
    if (!passwordOk) throw new UnauthorizedException('Passwort falsch');
    if (!this.totpService.verify(dbUser.totpSecret, body.code)) {
      throw new UnauthorizedException('TOTP-Code ungültig');
    }
    await this.prisma.user.update({
      where: { id: user.id },
      data: { totpEnabled: false, totpSecret: null },
    });
    return { success: true };
  }

  private userAgent(req: Request): string | null {
    const ua = req.headers['user-agent'];
    return typeof ua === 'string' ? ua : null;
  }
}
