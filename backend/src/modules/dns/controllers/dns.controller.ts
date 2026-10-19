import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { DomainVerificationService } from '../services/domain-verification.service';
import type { AuthUser } from '../../auth/types/auth-user.types';

/**
 * DNS-Controller (M4 Sprint 3).
 *
 * Endpoints:
 *   - POST /api/dns/:kanzleiId/start-verification  — Verifikation starten
 *   - POST /api/dns/:kanzleiId/verify             — TXT-Record prüfen
 *
 * Beide erfordern KANZLEI_ADMIN oder SYSTEM_ADMIN.
 *
 * BEFUND 2026-10-19 (Nachtrag 54, TODO-8.16): **Diese Zusage stand hier,
 * ohne dass sie hier eingeloest war.** Der Controller traegt weder
 * `@Roles` noch `@RequireMandant`; der globale `RolesGuard` laesst eine
 * Route ohne `@Roles` durch. Die Autorisierung liegt ausschliesslich im
 * Service (`assertKanzleiAdminAccess` in
 * `domain-verification.service.ts`).
 *
 * Gemessen (Nachtrag 44) — die Sperre **haelt**, auch kanzleiuebergreifend:
 *
 *   POST /dns/<kanzleiId>/start-verification als STEUERBERATER -> 403
 *   POST /dns/<kanzleiId>/verify             als STEUERBERATER -> 403
 *   dasselbe gegen eine fremde Kanzlei                           -> 403
 *
 * Der Kommentar wurde trotzdem richtiggestellt: Eine Zusage, die erst
 * 60 Zeilen tiefer im Service eingeloest ist, ist eine Wartungsfalle —
 * wer den Service umbaut, merkt nicht, dass dort etwas fehlen muss. Und
 * beim Route-Vergleich (wie in Nachtrag 46 beim Billing-Webhook) faellt
 * ein solcher Kommentar sofort als Verdacht auf — der Reader kann nicht
 * unterscheiden, ob er stimmt.
 *
 * **Warum die Sperre nicht hierher gehoert:** `@Roles('KANZLEI_ADMIN')`
 * auf dem Controller wuerde die Pruefung **zusaetzlich** zur
 * Service-Pruefung setzen. Das waere im Ergebnis gleich, aber es
 * verteilt die Regel auf zwei Orte — und die Mandantenzugehoerigkeit
 * (diese Kanzlei, nicht eine andere) kann ein Rollen-Dekorator gar nicht
 * ausdruecken. Der Service bleibt die richtige Stelle; der Kommentar
 * benennt das jetzt.
 */
@Controller('dns')
export class DnsController {
  constructor(private readonly verification: DomainVerificationService) {}

  @Post(':kanzleiId/start-verification')
  @HttpCode(HttpStatus.OK)
  async startVerification(
    @Param('kanzleiId', new ParseUUIDPipe()) kanzleiId: string,
    @Body() body: { customDomain: string } | undefined,
    @Req() req: Request,
  ): Promise<{
    verificationToken: string;
    txtRecordName: string;
    txtRecordValue: string;
    manualInstructions: string;
    autoCreated: boolean;
  }> {
    return this.verification.startVerification(
      kanzleiId,
      body?.customDomain ?? '',
      req.user as AuthUser,
      { ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined },
    );
  }

  @Post(':kanzleiId/verify')
  @HttpCode(HttpStatus.OK)
  async verify(
    @Param('kanzleiId', new ParseUUIDPipe()) kanzleiId: string,
    @Req() req: Request,
  ): Promise<{ verified: boolean; reason?: string; checkedAt: Date }> {
    return this.verification.verifyVerification(kanzleiId, req.user as AuthUser, {
      ip: req.ip,
      userAgent: req.headers['user-agent'] as string | undefined,
    });
  }
}