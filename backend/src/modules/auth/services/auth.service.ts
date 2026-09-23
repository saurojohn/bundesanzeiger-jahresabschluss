import {
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/services/audit.service';
import { LoginDto } from '../dto/login.dto';
import { RefreshTokenDto } from '../dto/refresh-token.dto';
import {
  AuthMandantDto,
  AuthResponseDto,
  AuthUserDto,
} from '../dto/auth-response.dto';
import type { AuthUser } from '../types/auth-user.types';
import type { JwtAccessPayload } from '../types/auth-user.types';
import { asGlobalRole, asMandantRole } from '../utils/role-cast';
import { TotpService } from './totp.service';

export interface LoginContext {
  ip?: string | null;
  userAgent?: string | null;
}

export interface AuthenticatedContext {
  ip?: string | null;
  userAgent?: string | null;
}

const REFRESH_TOKEN_BYTES = 48;
const REFRESH_TOKEN_HASH_ALGO = 'sha256';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly accessTokenTtlSeconds: number;
  private readonly refreshTokenTtlSeconds: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly totpService: TotpService,
    private readonly auditService: AuditService,
  ) {
    this.accessTokenTtlSeconds = this.parseTtl(
      this.configService.get<string>('JWT_ACCESS_TOKEN_TTL', '15m'),
      15 * 60,
    );
    this.refreshTokenTtlSeconds = this.parseTtl(
      this.configService.get<string>('JWT_REFRESH_TOKEN_TTL', '7d'),
      7 * 24 * 60 * 60,
    );
  }

  /**
   * Login.
   *
   * Ablauf:
   *   1. User nach Email + isActive suchen.
   *   2. bcrypt.compare(password).
   *   3. Wenn totpEnabled → otplib.verify(code).
   *   4. Refresh-Token erzeugen, hashen, in UserSession speichern.
   *   5. Access-JWT signieren.
   *   6. AuditLog(LOGIN) protokollieren.
   */
  async login(
    dto: LoginDto,
    context: LoginContext,
  ): Promise<AuthResponseDto> {
    const user = await this.prisma.user.findFirst({
      where: { email: dto.email.toLowerCase(), isActive: true },
      include: {
        mandantRoles: {
          where: { revokedAt: null },
          include: { mandant: { select: { id: true, firmenname: true } } },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('Ungültige Anmeldedaten');
    }

    const passwordOk = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordOk) {
      void this.auditService.record({
        userId: user.id,
        kanzleiId: user.kanzleiId,
        action: 'LOGIN',
        entityType: 'User',
        entityId: user.id,
        newState: { reason: 'wrong-password' },
        ipAddress: context.ip ?? null,
        userAgent: context.userAgent ?? null,
      });
      throw new UnauthorizedException('Ungültige Anmeldedaten');
    }

    if (user.totpEnabled) {
      if (!dto.totpCode || !user.totpSecret) {
        throw new UnauthorizedException('TOTP-Code erforderlich');
      }
      const totpOk = this.totpService.verify(user.totpSecret, dto.totpCode);
      if (!totpOk) {
        throw new UnauthorizedException('TOTP-Code ungültig');
      }
    }

    const session = await this.createSession(user.id, context);

    const mandantenForToken = user.mandantRoles.map((r) => ({
      id: r.mandant.id,
      firmenname: r.mandant.firmenname,
      rolle: asMandantRole(r.rolle),
    }));
    const accessToken = this.signAccessToken({
      sub: user.id,
      email: user.email,
      globalRole: asGlobalRole(user.globalRole),
      mandanten: mandantenForToken,
    });

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), lastLoginIp: context.ip ?? null },
    });

    void this.auditService.record({
      userId: user.id,
      kanzleiId: user.kanzleiId,
      action: 'LOGIN',
      entityType: 'User',
      entityId: user.id,
      newState: { success: true, sessionId: session.id },
      ipAddress: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    return {
      accessToken,
      refreshToken: session.refreshTokenRaw,
      expiresIn: this.accessTokenTtlSeconds,
      tokenType: 'Bearer',
      user: this.toAuthUserDto(
        user.id,
        user.email,
        user.vorname,
        user.nachname,
        asGlobalRole(user.globalRole),
        user.totpEnabled,
        mandantenForToken,
      ),
    };
  }

  /**
   * Refresh Access-Token gegen ein gültiges Refresh-Token.
   */
  async refresh(
    dto: RefreshTokenDto,
    context: AuthenticatedContext,
  ): Promise<AuthResponseDto> {
    const refreshTokenHash = this.hashToken(dto.refreshToken);
    const session = await this.prisma.userSession.findUnique({
      where: { refreshTokenHash },
      include: {
        user: {
          include: {
            mandantRoles: {
              where: { revokedAt: null },
              include: { mandant: { select: { id: true, firmenname: true } } },
            },
          },
        },
      },
    });
    if (!session) {
      throw new UnauthorizedException('Refresh-Token ungültig');
    }
    if (session.revokedAt) {
      throw new UnauthorizedException('Refresh-Token widerrufen');
    }
    if (session.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Refresh-Token abgelaufen');
    }
    if (!session.user.isActive) {
      throw new UnauthorizedException('User inaktiv');
    }

    const mandantenForToken = session.user.mandantRoles.map((r) => ({
      id: r.mandant.id,
      firmenname: r.mandant.firmenname,
      rolle: asMandantRole(r.rolle),
    }));
    const accessToken = this.signAccessToken({
      sub: session.user.id,
      email: session.user.email,
      globalRole: asGlobalRole(session.user.globalRole),
      mandanten: mandantenForToken,
    });

    void this.auditService.record({
      userId: session.userId,
      kanzleiId: session.user.kanzleiId,
      action: 'LOGIN',
      entityType: 'User',
      entityId: session.userId,
      newState: { reason: 'token-refresh', sessionId: session.id },
      ipAddress: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    return {
      accessToken,
      refreshToken: dto.refreshToken,
      expiresIn: this.accessTokenTtlSeconds,
      tokenType: 'Bearer',
      user: this.toAuthUserDto(
        session.user.id,
        session.user.email,
        session.user.vorname,
        session.user.nachname,
        asGlobalRole(session.user.globalRole),
        session.user.totpEnabled,
        mandantenForToken,
      ),
    };
  }

  /**
   * Logout — widerruft die aktuelle Session.
   */
  async logout(userId: string, sessionId?: string): Promise<void> {
    if (sessionId) {
      await this.prisma.userSession.update({
        where: { id: sessionId },
        data: { revokedAt: new Date() },
      });
    } else {
      await this.prisma.userSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    void this.auditService.record({
      userId,
      action: 'LOGOUT',
      entityType: 'User',
      entityId: userId,
    });
  }

  /**
   * Lädt den vollständigen User-Datensatz für /auth/me.
   */
  async me(userId: string): Promise<AuthUserDto | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        mandantRoles: {
          where: { revokedAt: null },
          include: { mandant: { select: { id: true, firmenname: true } } },
        },
      },
    });
    if (!user) return null;
    return this.toAuthUserDto(
      user.id,
      user.email,
      user.vorname,
      user.nachname,
      asGlobalRole(user.globalRole),
      user.totpEnabled,
      user.mandantRoles.map((r) => ({
        id: r.mandant.id,
        firmenname: r.mandant.firmenname,
        rolle: asMandantRole(r.rolle),
      })),
    );
  }

  async getMandantenAccessibleByUser(userId: string): Promise<AuthMandantDto[]> {
    const roles = await this.prisma.userMandantRole.findMany({
      where: { userId, revokedAt: null },
      include: { mandant: { select: { id: true, firmenname: true } } },
    });
    return roles.map((r) => ({
      id: r.mandant.id,
      firmenname: r.mandant.firmenname,
      rolle: asMandantRole(r.rolle),
    }));
  }

  /**
   * Erlaubt dem JwtStrategy.validate-Aufrufer einen User-Hydrate mit echten
   * Mandant-Rollen durchzuführen. Wird vom Strategy selbst nicht gebraucht
   * (das Token trägt die Rollen), aber von Endpoints mit Bedarf an
   * Live-Daten.
   */
  async resolveAuthUser(userId: string): Promise<AuthUser | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        mandantRoles: {
          where: { revokedAt: null },
          include: { mandant: { select: { id: true, firmenname: true } } },
        },
      },
    });
    if (!user) return null;
    return {
      id: user.id,
      email: user.email,
      vorname: user.vorname,
      nachname: user.nachname,
      globalRole: asGlobalRole(user.globalRole),
      mandanten: user.mandantRoles.map((r) => ({
        id: r.mandant.id,
        firmenname: r.mandant.firmenname,
        rolle: asMandantRole(r.rolle),
      })),
    };
  }

  // ===========================================================================
  // Private helpers
  // ===========================================================================

  private signAccessToken(
    payload: Omit<JwtAccessPayload, 'iat' | 'exp'>,
  ): string {
    return this.jwtService.sign(payload, {
      expiresIn: this.accessTokenTtlSeconds,
    });
  }

  private async createSession(
    userId: string,
    context: LoginContext,
  ): Promise<{ id: string; refreshTokenRaw: string }> {
    const refreshTokenRaw = randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
    const refreshTokenHash = this.hashToken(refreshTokenRaw);
    const expiresAt = new Date(Date.now() + this.refreshTokenTtlSeconds * 1000);
    const session = await this.prisma.userSession.create({
      data: {
        userId,
        refreshTokenHash,
        ipAddress: context.ip ?? null,
        userAgent: context.userAgent ?? null,
        expiresAt,
      },
    });
    return { id: session.id, refreshTokenRaw };
  }

  private hashToken(token: string): string {
    return createHash(REFRESH_TOKEN_HASH_ALGO).update(token).digest('hex');
  }

  private toAuthUserDto(
    id: string,
    email: string,
    vorname: string,
    nachname: string,
    globalRole: AuthUser['globalRole'],
    totpEnabled: boolean,
    mandanten: AuthMandantDto[],
  ): AuthUserDto {
    return {
      id,
      email,
      vorname,
      nachname,
      globalRole,
      mandanten,
      totpEnabled,
    };
  }

  private parseTtl(value: string, fallbackSeconds: number): number {
    if (!value) return fallbackSeconds;
    const match = /^(\d+)([smhd])$/.exec(value);
    if (!match) return fallbackSeconds;
    const n = Number.parseInt(match[1] ?? '0', 10);
    const unit = match[2];
    switch (unit) {
      case 's':
        return n;
      case 'm':
        return n * 60;
      case 'h':
        return n * 60 * 60;
      case 'd':
        return n * 24 * 60 * 60;
      default:
        return fallbackSeconds;
    }
  }
}
