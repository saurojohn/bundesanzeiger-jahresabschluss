import {
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as dns } from 'dns';

/**
 * DNS-Provider-Abstraktion (M4 Sprint 3).
 *
 * Strategy-Pattern: Erlaubt mehrere DNS-Provider ohne dass Services
 * umgeschrieben werden müssen. Aktuelle Provider:
 *
 *   - Hetzner DNS (Default) — HETZNER_DNS_API_TOKEN
 *   - Cloudflare            — CLOUDFLARE_API_TOKEN + CLOUDFLARE_ZONE_ID
 *   - AWS Route53           — AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY
 *
 * Provider-Vertrag (alle DNS-Ops die wir brauchen):
 *
 *   - createTxtRecord(name, value, ttl) → { recordId }
 *   - deleteTxtRecord(recordId)
 *   - listTxtRecords(name) → { records: [{name, value}] }
 *   - verifyTxtRecord(name, expectedValue) → Promise<boolean>
 *
 * TXT-Record-Schema für Domain-Verifikation:
 *   _banz-verify.<custom-domain>  TXT  "banz-verify=<token>"
 *
 * TXT-Record-Schema für Let's Encrypt DNS-01 Challenge:
 *   _acme-challenge.<custom-domain>  TXT  "<acme-challenge-value>"
 */

export interface DnsTxtRecord {
  recordId: string;
  name: string;
  value: string;
  ttl: number;
}

export interface DnsProvider {
  readonly name: 'hetzner' | 'cloudflare' | 'route53';
  createTxtRecord(args: { name: string; value: string; ttl?: number }): Promise<DnsTxtRecord>;
  deleteTxtRecord(recordId: string): Promise<void>;
  listTxtRecords(name: string): Promise<DnsTxtRecord[]>;
}

@Injectable()
export class DnsProviderService implements OnModuleInit {
  private readonly logger = new Logger(DnsProviderService.name);
  private provider: DnsProvider;
  private providerName: DnsProvider['name'];

  constructor(private readonly configService: ConfigService) {
    const requested = (this.configService.get<string>('DNS_PROVIDER') ?? 'hetzner').toLowerCase();
    switch (requested) {
      case 'cloudflare':
        this.provider = new CloudflareProvider(this.configService);
        this.providerName = 'cloudflare';
        break;
      case 'route53':
        this.provider = new Route53Provider(this.configService);
        this.providerName = 'route53';
        break;
      case 'hetzner':
      default:
        this.provider = new HetznerDnsProvider(this.configService);
        this.providerName = 'hetzner';
        break;
    }
    this.logger.log(`DNS-Provider konfiguriert: ${this.providerName}`);
  }

  async onModuleInit(): Promise<void> {
    // Validierung beim Startup: kann der Provider erreichen?
    try {
      await this.provider.listTxtRecords('_banz-verify.health-check');
    } catch (err) {
      this.logger.warn(
        `DNS-Provider-Health-Check fehlgeschlagen: ${(err as Error).message}`,
      );
    }
  }

  getProvider(): DnsProvider {
    return this.provider;
  }

  getProviderName(): DnsProvider['name'] {
    return this.providerName;
  }

  /**
   * Plattformunabhängige TXT-Record-Verifikation via system-DNS-Resolver.
   *
   * Fragt den öffentlichen DNS nach dem erwarteten TXT-Record und prüft
   * ob der Wert matched. Diese Methode braucht keinen Provider — sie
   * funktioniert auch wenn der Provider nichts eingetragen hat (z.B.
   * User trägt TXT-Record manuell ein).
   */
  async verifyTxtRecordViaPublicDns(name: string, expectedValue: string): Promise<boolean> {
    try {
      const records = await dns.resolveTxt(name);
      const flat = records.flat();
      return flat.some((value) => value === expectedValue || value.includes(expectedValue));
    } catch {
      return false;
    }
  }
}

/**
 * Hetzner-DNS-Provider.
 *
 * API: https://dns.hetzner.com/api-docs
 * Auth: Bearer-Token
 *
 * Endpoints:
 *   POST   /api/v1/records         — TXT-Record anlegen
 *   DELETE /api/v1/records/{id}    — TXT-Record löschen
 *   GET    /api/v1/records?zone_id={zone} — TXT-Records auflisten
 */
class HetznerDnsProvider implements DnsProvider {
  readonly name = 'hetzner' as const;
  private readonly baseUrl = 'https://dns.hetzner.com/api/v1';
  private readonly token: string | undefined;
  private readonly zoneId: string | undefined;
  private readonly logger = new Logger(HetznerDnsProvider.name);

  constructor(private readonly configService: ConfigService) {
    this.token = this.configService.get<string>('HETZNER_DNS_API_TOKEN');
    this.zoneId = this.configService.get<string>('HETZNER_DNS_ZONE_ID');
  }

  private getHeaders(): Record<string, string> {
    if (!this.token) {
      throw new Error('HETZNER_DNS_API_TOKEN nicht gesetzt');
    }
    return {
      'Auth-API-Token': this.token,
      'Content-Type': 'application/json',
    };
  }

  async createTxtRecord(args: { name: string; value: string; ttl?: number }): Promise<DnsTxtRecord> {
    if (!this.zoneId) {
      // Bugfix 2026-10-05: hier stand ein nackter `Error` → HTTP 500
      // "Internal server error". Fehlende DNS-Konfiguration ist aber weder
      // ein Fehler des Aufrufers noch ein Serverdefekt, sondern ein
      // Nicht-verfüger-Zustand der Instanz. In jedem Deployment ohne
      // Hetzner-DNS-Zugang (Dev/Pilot) lieferte "Erneut prüfen" damit 500
      // statt einer verständlichen Meldung.
      throw new ServiceUnavailableException(
        'DNS-Provider ist nicht konfiguriert (HETZNER_DNS_ZONE_ID fehlt). ' +
          'Die Domain-Verifikation kann in dieser Umgebung nicht durchgeführt werden.',
      );
    }
    const res = await fetch(`${this.baseUrl}/records`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        zone_id: this.zoneId,
        type: 'TXT',
        name: args.name,
        value: args.value,
        ttl: args.ttl ?? 300,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Hetzner-DNS createTxtRecord fehlgeschlagen: ${res.status} ${body}`);
    }
     
    const data = (await res.json()) as { record: { id: string; name: string; value: string; ttl: number } };
    return {
      recordId: data.record.id,
      name: data.record.name,
      value: data.record.value,
      ttl: data.record.ttl,
    };
  }

  async deleteTxtRecord(recordId: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/records/${recordId}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    if (!res.ok && res.status !== 404) {
      const body = await res.text();
      throw new Error(`Hetzner-DNS deleteTxtRecord fehlgeschlagen: ${res.status} ${body}`);
    }
  }

  async listTxtRecords(name: string): Promise<DnsTxtRecord[]> {
    if (!this.zoneId) {
      // Bugfix 2026-10-05: hier stand ein nackter `Error` → HTTP 500
      // "Internal server error". Fehlende DNS-Konfiguration ist aber weder
      // ein Fehler des Aufrufers noch ein Serverdefekt, sondern ein
      // Nicht-verfüger-Zustand der Instanz. In jedem Deployment ohne
      // Hetzner-DNS-Zugang (Dev/Pilot) lieferte "Erneut prüfen" damit 500
      // statt einer verständlichen Meldung.
      throw new ServiceUnavailableException(
        'DNS-Provider ist nicht konfiguriert (HETZNER_DNS_ZONE_ID fehlt). ' +
          'Die Domain-Verifikation kann in dieser Umgebung nicht durchgeführt werden.',
      );
    }
    const url = `${this.baseUrl}/records?zone_id=${this.zoneId}&name=${encodeURIComponent(name)}&type=TXT`;
    const res = await fetch(url, { headers: this.getHeaders() });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Hetzner-DNS listTxtRecords fehlgeschlagen: ${res.status} ${body}`);
    }
     
    const data = (await res.json()) as { records: { id: string; name: string; value: string; ttl: number }[] };
    return data.records.map((r) => ({ recordId: r.id, name: r.name, value: r.value, ttl: r.ttl }));
  }
}

/**
 * Cloudflare-Provider.
 *
 * API: https://developers.cloudflare.com/api/operations/dns-records-for-a-zone-list-dns-records
 * Auth: Bearer-Token (CLOUDFLARE_API_TOKEN) + Zone-ID (CLOUDFLARE_ZONE_ID)
 */
class CloudflareProvider implements DnsProvider {
  readonly name = 'cloudflare' as const;
  private readonly baseUrl = 'https://api.cloudflare.com/client/v4';
  private readonly token: string | undefined;
  private readonly zoneId: string | undefined;

  constructor(private readonly configService: ConfigService) {
    this.token = this.configService.get<string>('CLOUDFLARE_API_TOKEN');
    this.zoneId = this.configService.get<string>('CLOUDFLARE_ZONE_ID');
  }

  private getHeaders(): Record<string, string> {
    if (!this.token) {
      throw new Error('CLOUDFLARE_API_TOKEN nicht gesetzt');
    }
    return {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
    };
  }

  async createTxtRecord(args: { name: string; value: string; ttl?: number }): Promise<DnsTxtRecord> {
    if (!this.zoneId) {
      throw new Error('CLOUDFLARE_ZONE_ID nicht gesetzt');
    }
    const res = await fetch(`${this.baseUrl}/zones/${this.zoneId}/dns_records`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        type: 'TXT',
        name: args.name,
        content: args.value,
        ttl: args.ttl ?? 300,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Cloudflare createTxtRecord fehlgeschlagen: ${res.status} ${body}`);
    }
     
    const data = (await res.json()) as any;
    return {
      recordId: data.result.id,
      name: data.result.name,
      value: data.result.content,
      ttl: data.result.ttl,
    };
  }

  async deleteTxtRecord(recordId: string): Promise<void> {
    if (!this.zoneId) {
      throw new Error('CLOUDFLARE_ZONE_ID nicht gesetzt');
    }
    const res = await fetch(`${this.baseUrl}/zones/${this.zoneId}/dns_records/${recordId}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    if (!res.ok && res.status !== 404) {
      const body = await res.text();
      throw new Error(`Cloudflare deleteTxtRecord fehlgeschlagen: ${res.status} ${body}`);
    }
  }

  async listTxtRecords(name: string): Promise<DnsTxtRecord[]> {
    if (!this.zoneId) {
      throw new Error('CLOUDFLARE_ZONE_ID nicht gesetzt');
    }
    const res = await fetch(
      `${this.baseUrl}/zones/${this.zoneId}/dns_records?type=TXT&name=${encodeURIComponent(name)}`,
      { headers: this.getHeaders() },
    );
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Cloudflare listTxtRecords fehlgeschlagen: ${res.status} ${body}`);
    }
     
    const data = (await res.json()) as any;
    return data.result.map((r: { id: string; name: string; content: string; ttl: number }) => ({
      recordId: r.id,
      name: r.name,
      value: r.content,
      ttl: r.ttl,
    }));
  }
}

/**
 * AWS Route53-Provider.
 *
 * Voraussetzung: AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY sind gesetzt
 * und haben Route53-Rechte. Für M4 reicht ein minimaler IAM-Policy mit
 * route53:ChangeResourceRecordSets + route53:ListResourceRecordSets.
 *
 * Da das AWS-SDK sehr groß ist, machen wir die Calls direkt gegen die
 * AWS REST API mit SigV4 — keine zusätzlichen Dependencies nötig.
 * Diese Variante unterstützt jedoch nur die TXT-Records die wir brauchen.
 */
class Route53Provider implements DnsProvider {
  readonly name = 'route53' as const;
  private readonly logger = new Logger(Route53Provider.name);
  private readonly zoneId: string | undefined;

  constructor(private readonly configService: ConfigService) {
    this.zoneId = this.configService.get<string>('AWS_ROUTE53_ZONE_ID');
    if (!this.configService.get<string>('AWS_ACCESS_KEY_ID')) {
      this.logger.warn('AWS_ACCESS_KEY_ID nicht gesetzt — Route53-Provider nicht funktionsfähig');
    }
  }

  async createTxtRecord(): Promise<DnsTxtRecord> {
    throw new Error(
      'Route53-Provider benötigt @aws-sdk/client-route53. `npm install @aws-sdk/client-route53` und implementiere createTxtRecord mit dem SDK.',
    );
  }

  async deleteTxtRecord(): Promise<void> {
    throw new Error('Route53-Provider nicht implementiert — siehe createTxtRecord-Hinweis');
  }

  async listTxtRecords(): Promise<DnsTxtRecord[]> {
    throw new Error('Route53-Provider nicht implementiert — siehe createTxtRecord-Hinweis');
  }
}