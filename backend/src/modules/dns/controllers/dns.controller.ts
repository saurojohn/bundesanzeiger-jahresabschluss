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
 */
@Controller('dns')
export class DnsController {
  constructor(private readonly verification: DomainVerificationService) {}

  @Post(':kanzleiId/start-verification')
  @HttpCode(HttpStatus.OK)
  async startVerification(
    @Param('kanzleiId', new ParseUUIDPipe()) kanzleiId: string,
    @Body() body: { customDomain: string },
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
      body.customDomain,
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