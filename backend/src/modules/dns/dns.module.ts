import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CommonRepositoriesModule } from '../../common/repositories/common-repositories.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { DnsProviderService } from './services/dns-provider.service';
import { DomainVerificationService } from './services/domain-verification.service';
import { CertManagerService } from './services/cert-manager.service';
import { DnsController } from './controllers/dns.controller';

/**
 * DNS-Modul (M4 Sprint 3).
 *
 * Verantwortlich für:
 *   - DNS-Provider-Abstraktion (Hetzner DNS, Cloudflare, AWS Route53)
 *   - Custom-Domain-Verifikation (TXT-Record-Check)
 *   - Cert-Challenge-Setup (DNS-01 für Let's Encrypt)
 *
 * Strategie:
 *   - DNS_PROVIDER env var wählt Provider (hetzner|cloudflare|route53)
 *   - Wenn nicht gesetzt → Hetzner DNS als Default (passt zu Cloud-Strategie)
 *
 * Setup pro Provider:
 *   Hetzner:    HETZNER_DNS_API_TOKEN + HETZNER_DNS_ZONE_ID
 *   Cloudflare: CLOUDFLARE_API_TOKEN + CLOUDFLARE_ZONE_ID
 *   Route53:    AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY + AWS_ROUTE53_ZONE_ID
 *
 * Mandant-Trennung: Alle DNS-Operationen sind kanzlei-scoped — jede
 * Kanzlei hat höchstens 1 customDomain, die über ihre ID zugeordnet wird.
 */
@Module({
  imports: [ConfigModule, CommonRepositoriesModule, PrismaModule],
  controllers: [DnsController],
  providers: [DnsProviderService, DomainVerificationService, CertManagerService],
  exports: [DnsProviderService, DomainVerificationService, CertManagerService],
})
export class DnsModule {}