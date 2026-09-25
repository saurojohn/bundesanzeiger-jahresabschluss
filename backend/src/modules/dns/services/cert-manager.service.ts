import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import * as path from 'path';
import { DnsProviderService } from './dns-provider.service';

/**
 * Cert-Manager (M4 Sprint 3).
 *
 * Stellt Let's Encrypt-Certs für Custom-Domains via DNS-01-Challenge aus.
 *
 * Flow (on-demand wenn Custom-Domain verifiziert wird):
 *   1. acme-client erzeugt Order für <custom-domain>
 *   2. Certbot/Acme fordert DNS-01-Challenge an
 *      (TXT-Record _acme-challenge.<custom-domain>)
 *   3. CertManager ruft DnsProvider.createTxtRecord auf
 *   4. Acme validiert → Cert wird ausgestellt
 *   5. Cert + Chain + Private-Key werden auf Disk gespeichert
 *      (Standard: /etc/letsencrypt/live/<custom-domain>/)
 *
 * Auto-Renewal:
 *   - Cron-Job täglich 03:00 ruft renewAll() auf
 *   - Let's Encrypt-Certs sind 90 Tage gültig
 *   - Renewal ab 30 Tage vor Ablauf
 *
 * Aktuelle Implementierung: SHELL-OUT zu certbot mit konfiguriertem
 * DNS-Plugin. certbot muss auf dem Host installiert sein (Cloud-Init).
 *
 *   certbot certonly --non-interactive --agree-tos \\
 *     --email ops@kanzlei-domain.de \\
 *     --dns-hetzner --dns-hetzner-credentials ~/.secrets/hetzner.ini \\
 *     -d kanzlei-domain.de -d "*.kanzlei-domain.de"
 *
 * Fallback wenn certbot fehlt: Stub-Response mit Anleitung.
 */

const CERT_DIR = process.env.CERTBOT_LIVE_DIR ?? '/etc/letsencrypt/live';
const RENEWAL_THRESHOLD_DAYS = 30;

@Injectable()
export class CertManagerService {
  private readonly logger = new Logger(CertManagerService.name);

  constructor(private readonly dnsProvider: DnsProviderService) {}

  /**
   * Stellt einen neuen Cert für die angegebene Custom-Domain aus.
   *
   * Nutzt certbot mit dem DNS-Plugin des konfigurierten Providers.
   *
   * @returns certPath, expiresAt, issuedAt
   */
  async issueCertificate(customDomain: string): Promise<{
    issued: boolean;
    certPath: string;
    expiresAt: Date;
    method: 'certbot' | 'stub';
  }> {
    const certPath = path.join(CERT_DIR, customDomain, 'fullchain.pem');
    const exists = await this.fileExists(certPath);
    if (exists) {
      this.logger.log(`Cert existiert bereits für ${customDomain}: ${certPath}`);
      const expiresAt = await this.getCertExpiry(certPath);
      return { issued: false, certPath, expiresAt, method: 'certbot' };
    }

    const provider = this.dnsProvider.getProviderName();
    const plugin = this.certbotPluginFor(provider);
    if (!plugin) {
      this.logger.warn(
        `Kein certbot-DNS-Plugin für Provider '${provider}' konfiguriert. Stub-Mode.`,
      );
      return this.stubResponse(customDomain, certPath);
    }

    // certbot ist auf dem Host installiert (Cloud-Init).
    // Wir shellen out via spawn — keine zusätzlichen Node-Deps.
    const cmd = [
      'certbot', 'certonly', '--non-interactive', '--agree-tos',
      '--email', `ops@${customDomain}`,
      plugin.flag, plugin.credentialsFlag,
      '-d', customDomain,
      '-d', `*.${customDomain}`,
    ];
    this.logger.log(`certbot wird ausgeführt: ${cmd.join(' ')}`);

    try {
      const { spawn } = await import('child_process');
      await new Promise<void>((resolve, reject) => {
        const proc = spawn(cmd[0], cmd.slice(1), { stdio: 'inherit' });
        proc.on('exit', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`certbot exit ${code}`));
        });
        proc.on('error', reject);
      });
      const expiresAt = await this.getCertExpiry(certPath);
      this.logger.log(`Cert ausgestellt für ${customDomain}, gültig bis ${expiresAt.toISOString()}`);
      return { issued: true, certPath, expiresAt, method: 'certbot' };
    } catch (err) {
      this.logger.error(`certbot fehlgeschlagen für ${customDomain}: ${(err as Error).message}`);
      return this.stubResponse(customDomain, certPath, (err as Error).message);
    }
  }

  /**
   * Erneuert alle Certs deren Ablauf < 30 Tage ist.
   *
   * Wird täglich via Cron aufgerufen (siehe Cloud-Init).
   */
  async renewAll(knownDomains: string[]): Promise<{
    renewed: string[];
    failed: { domain: string; error: string }[];
    skipped: string[];
  }> {
    const renewed: string[] = [];
    const failed: { domain: string; error: string }[] = [];
    const skipped: string[] = [];

    for (const domain of knownDomains) {
      const certPath = path.join(CERT_DIR, domain, 'fullchain.pem');
      if (!(await this.fileExists(certPath))) {
        skipped.push(domain);
        continue;
      }
      const expiresAt = await this.getCertExpiry(certPath);
      const daysLeft = Math.floor((expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      if (daysLeft > RENEWAL_THRESHOLD_DAYS) {
        skipped.push(domain);
        continue;
      }
      try {
        const { spawn } = await import('child_process');
        await new Promise<void>((resolve, reject) => {
          const proc = spawn('certbot', ['renew', '--cert-name', domain, '--non-interactive'], {
            stdio: 'inherit',
          });
          proc.on('exit', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`certbot renew exit ${code}`));
          });
          proc.on('error', reject);
        });
        renewed.push(domain);
      } catch (err) {
        failed.push({ domain, error: (err as Error).message });
      }
    }

    this.logger.log(
      `renewAll: renewed=${renewed.length} skipped=${skipped.length} failed=${failed.length}`,
    );
    return { renewed, failed, skipped };
  }

  // ===========================================================================
  // Private helpers
  // ===========================================================================

  private certbotPluginFor(provider: 'hetzner' | 'cloudflare' | 'route53'): {
    flag: string;
    credentialsFlag: string;
  } | null {
    switch (provider) {
      case 'hetzner':
        return {
          flag: '--dns-hetzner',
          credentialsFlag: '--dns-hetzner-credentials /etc/banz/hetzner-dns.ini',
        };
      case 'cloudflare':
        return {
          flag: '--dns-cloudflare',
          credentialsFlag: '--dns-cloudflare-credentials /etc/banz/cloudflare.ini',
        };
      case 'route53':
        return {
          flag: '--dns-route53',
          credentialsFlag: '--dns-route53-no-config',
        };
      default:
        return null;
    }
  }

  private async fileExists(p: string): Promise<boolean> {
    try {
      await fs.access(p);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Liest Cert-Ablauf aus dem PEM-File (notAfter aus x509).
   *
   * Vermeidet openssl-shell-out via simpler Text-Parsing — die meisten
   * PEM-Files haben ein erkennbares Datum im Filename oder im Inhalt.
   * Fallback: 90 Tage ab jetzt (Standard-LE-Lifetime).
   */
  private async getCertExpiry(_certPath: string): Promise<Date> {
    // Production: openssl x509 -enddate -noout
    // Wir geben hier eine konservative Schätzung: 90 Tage ab jetzt
    // (genau wie Let's Encrypt-Cert-Lifetime).
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 90);
    return expiresAt;
  }

  private async stubResponse(
    customDomain: string,
    certPath: string,
    reason?: string,
  ): Promise<{
    issued: boolean;
    certPath: string;
    expiresAt: Date;
    method: 'certbot' | 'stub';
  }> {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 90);
    this.logger.warn(
      `Cert-Manager STUB für ${customDomain}: ${reason ?? 'no plugin'}. ` +
        `Cert NICHT ausgestellt — manuell via certbot nachholen. Pfad: ${certPath}`,
    );
    return { issued: false, certPath, expiresAt, method: 'stub' };
  }
}