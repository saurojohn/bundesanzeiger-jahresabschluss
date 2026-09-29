import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { MandantGuard } from '../../auth/guards/mandant.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RequireMandant } from '../../auth/decorators/require-mandant.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthUser } from '../../auth/types/auth-user.types';
import { SignaturService } from '../services/signatur.service';
import { P12Service } from '../services/p12.service';
import { SignPdfDto } from '../dto/sign-pdf.dto';
import { ValidateSignatureDto } from '../dto/validate-signature.dto';
import { InspectP12Dto } from '../dto/inspect-p12.dto';
import type { SignatureResultDto } from '../dto/sign-pdf-response.dto';
import type {
  P12Metadata,
  SignatureResult,
  ValidationResult,
} from '../interfaces/signature.types';

/**
 * Controller für qualifizierte elektronische Signaturen (qeS).
 *
 * Sicherheits-Hinweise:
 *   - P12-Passwort verlässt NIE den Request-Scope (nur im Buffer
 *     gehalten, nach Signatur gc).
 *   - `signedPdfBytes` wird im DTO als String transportiert (Base64),
 *     nicht persistiert.
 *
 * Endpoints:
 *   - POST /api/signatur/sign-bilanz     — WIRTSCHAFTSPRUEFER / STEUERBERATER
 *   - POST /api/signatur/sign-guv        — analog
 *   - POST /api/signatur/sign-anhang     — analog
 *   - POST /api/signatur/sign-abschluss  — WIRTSCHAFTSPRUEFER
 *   - POST /api/signatur/validate        — alle authentifiziert
 *   - POST /api/signatur/inspect-p12     — WIRTSCHAFTSPRUEFER / STEUERBERATER
 */
@Controller('signatur')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SignaturController {
  constructor(
    private readonly signaturService: SignaturService,
    private readonly p12Service: P12Service,
  ) {}

  // ===========================================================================
  // Signatur-Endpoints (PDF-spezifisch)
  // ===========================================================================

  /**
   * POST /api/signatur/sign-bilanz
   *
   * Body: SignPdfDto (bilanzId, mandantId, p12Base64, p12Password,
   *                  signatureType?, includeTimestamp?)
   * Response: SignatureResultDto (signedPdfBase64 statt Buffer)
   */
  @Post('sign-bilanz')
  // Signieren ist eine Umwandlung (PDF -> signiertes PDF), keine
  // Ressourcen-Erstellung im API-Vertragssinn: 200 statt 201. Deckt sich
  // mit den uebrigen POST-Operationen (validate, pdf/generate).
  @HttpCode(HttpStatus.OK)
  @RequireMandant()
  @UseGuards(MandantGuard)
  @Roles('WIRTSCHAFTSPRUEFER', 'STEUERBERATER')
  async signBilanz(
    @Body() dto: SignPdfDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<SignatureResultDto> {
    const result = await this.signaturService.signBilanz(
      dto,
      user,
      this.extractContext(req),
    );
    return this.toResponseDto(result);
  }

  /**
   * POST /api/signatur/sign-guv
   */
  @Post('sign-guv')
  // Signieren ist eine Umwandlung (PDF -> signiertes PDF), keine
  // Ressourcen-Erstellung im API-Vertragssinn: 200 statt 201. Deckt sich
  // mit den uebrigen POST-Operationen (validate, pdf/generate).
  @HttpCode(HttpStatus.OK)
  @RequireMandant()
  @UseGuards(MandantGuard)
  @Roles('WIRTSCHAFTSPRUEFER', 'STEUERBERATER')
  async signGuV(
    @Body() dto: SignPdfDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<SignatureResultDto> {
    const result = await this.signaturService.signGuV(
      dto,
      user,
      this.extractContext(req),
    );
    return this.toResponseDto(result);
  }

  /**
   * POST /api/signatur/sign-anhang
   */
  @Post('sign-anhang')
  // Signieren ist eine Umwandlung (PDF -> signiertes PDF), keine
  // Ressourcen-Erstellung im API-Vertragssinn: 200 statt 201. Deckt sich
  // mit den uebrigen POST-Operationen (validate, pdf/generate).
  @HttpCode(HttpStatus.OK)
  @RequireMandant()
  @UseGuards(MandantGuard)
  @Roles('WIRTSCHAFTSPRUEFER', 'STEUERBERATER')
  async signAnhang(
    @Body() dto: SignPdfDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<SignatureResultDto> {
    const result = await this.signaturService.signAnhang(
      dto,
      user,
      this.extractContext(req),
    );
    return this.toResponseDto(result);
  }

  /**
   * POST /api/signatur/sign-abschluss
   *
   * Signiert den KOMPLETTEN Jahresabschluss (Bilanz + GuV + Anhang).
   * Nur WIRTSCHAFTSPRUEFER (Endabnahme).
   */
  @Post('sign-abschluss')
  // Signieren ist eine Umwandlung (PDF -> signiertes PDF), keine
  // Ressourcen-Erstellung im API-Vertragssinn: 200 statt 201. Deckt sich
  // mit den uebrigen POST-Operationen (validate, pdf/generate).
  @HttpCode(HttpStatus.OK)
  @RequireMandant()
  @UseGuards(MandantGuard)
  @Roles('WIRTSCHAFTSPRUEFER')
  async signAbschluss(
    @Body() dto: SignPdfDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<SignatureResultDto> {
    const result = await this.signaturService.signAbschluss(
      dto,
      user,
      this.extractContext(req),
    );
    return this.toResponseDto(result);
  }

  // ===========================================================================
  // Validation
  // ===========================================================================

  /**
   * POST /api/signatur/validate
   *
   * Validiert ein signiertes PDF. Body: { signedPdfBase64,
   * expectedSignerEmail? }. Response: ValidationResult.
   */
  @Post('validate')
  // Validierung ist eine read-only Auswertung, keine Resource-Erstellung:
  // Nest wuerde fuer @Post sonst 201 Created zurueckgeben. Der API-Vertrag
  // (und die e2e-Specs) erwarten 200 OK.
  @HttpCode(HttpStatus.OK)
  @RequireMandant()
  @UseGuards(MandantGuard)
  async validateSignature(
    @Body() dto: ValidateSignatureDto,
  ): Promise<ValidationResult> {
    const signedPdfBytes = Buffer.from(dto.signedPdfBase64, 'base64');
    return this.signaturService.validateSignature({
      signedPdfBytes,
      expectedSignerEmail: dto.expectedSignerEmail,
    });
  }

  // ===========================================================================
  // P12-Inspection
  // ===========================================================================

  /**
   * POST /api/signatur/inspect-p12
   *
   * Liefert P12-Metadaten (Subject, Issuer, Gültigkeit), OHNE den
   * Private-Key zu extrahieren. Passwort wird nur zur Validierung
   * genutzt, danach gc.
   */
  @Post('inspect-p12')
  // Signieren ist eine Umwandlung (PDF -> signiertes PDF), keine
  // Ressourcen-Erstellung im API-Vertragssinn: 200 statt 201. Deckt sich
  // mit den uebrigen POST-Operationen (validate, pdf/generate).
  @HttpCode(HttpStatus.OK)
  @Roles('WIRTSCHAFTSPRUEFER', 'STEUERBERATER')
  async inspectP12(@Body() dto: InspectP12Dto): Promise<P12Metadata> {
    const p12Buffer = Buffer.from(dto.p12Base64, 'base64');
    return this.p12Service.readP12Metadata(p12Buffer, dto.p12Password);
  }

  // ===========================================================================
  // Private helpers
  // ===========================================================================

  private extractContext(req: Request): {
    ipAddress: string | null;
    userAgent: string | null;
  } {
    const ua = req.headers['user-agent'];
    return {
      ipAddress: req.ip ?? null,
      userAgent: typeof ua === 'string' ? ua : null,
    };
  }

  private toResponseDto(result: SignatureResult): SignatureResultDto {
    return {
      signatureId: result.signatureId,
      signedPdfBase64: result.signedPdfBytes.toString('base64'),
      signedPdfWormKey: result.signedPdfWormKey,
      certificateMetadata: result.certificateMetadata,
      timestampAuthority: result.timestampAuthority,
      timestamp: result.timestamp,
      hashBefore: result.hashBefore,
      hashAfter: result.hashAfter,
      isValid: result.isValid,
      warnings: result.warnings,
    };
  }
}