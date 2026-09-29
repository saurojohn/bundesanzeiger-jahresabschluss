import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

/**
 * SSRF-Schutz fuer ausgehende HTTP-Aufrufe (Webhook-Zustellung).
 *
 * Hintergrund (Audit 2026-09-28/29): `@IsUrl` ist eine SYNTAX-Pruefung. Sie
 * akzeptierte `http://169.254.169.254/latest/meta-data/` (Cloud-Metadaten),
 * `http://127.0.0.1:5432/` (Datenbank) und alle RFC1918-Adressen. Da die
 * Zustellung die Antwort in `WebhookDelivery.responseBody` speichert und ueber
 * `GET /api/webhook-subscriptions/:id/deliveries` ausgibt, war das ein
 * vollstaendiges SSRF-Primitive MIT Reading: ein angemeldeter Kanzlei-Admin
 * konnte interne Dienste abfragen und Statuscode + Antwortkoerper auslesen.
 *
 * Zwei Schichten, weil eine einzelne nicht reicht:
 *   1. `assertPublicHttpUrl` — beim Speichern (schnell, faengt Literal-IPs)
 *   2. `assertResolvesToPublicAddress` — direkt VOR dem Request, nach der
 *      DNS-Aufloesung. Eine Pruefung nur beim Speichern greift NICHT bei
 *      DNS-Rebinding: `evil.example` kann spaeter auf 127.0.0.1 zeigen.
 */

/** IPv4-Bereiche, die nie als Webhook-Ziel taugen. */
const BLOCKED_V4_CIDRS: ReadonlyArray<[string, number]> = [
  ['0.0.0.0', 8], //        "this network"
  ['10.0.0.0', 8], //       RFC1918 private
  ['100.64.0.0', 10], //     RFC6598 CGNAT
  ['127.0.0.0', 8], //       Loopback
  ['169.254.0.0', 16], //    Link-Local (inkl. 169.254.169.254 Metadaten)
  ['172.16.0.0', 12], //     RFC1918 private
  ['192.0.0.0', 24], //      IETF protocol assignments
  ['192.0.2.0', 24], //      TEST-NET-1
  ['192.168.0.0', 16], //    RFC1918 private
  ['198.18.0.0', 15], //     Benchmark
  ['198.51.100.0', 24], //   TEST-NET-2
  ['203.0.113.0', 24], //    TEST-NET-3
  ['224.0.0.0', 4], //       Multicast
  ['240.0.0.0', 4], //       reserviert
];

function v4ToInt(ip: string): number {
  const parts = ip.split('.').map((p) => Number.parseInt(p, 10));
  return ((parts[0]! << 24) >>> 0) + (parts[1]! << 16) + (parts[2]! << 8) + parts[3]!;
}

function isPrivateV4(ip: string): boolean {
  const value = v4ToInt(ip);
  return BLOCKED_V4_CIDRS.some(([net, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (value & mask) === (v4ToInt(net) & mask);
  });
}

function isPrivateV6(ip: string): boolean {
  const norm = ip.toLowerCase().split('%')[0]!;
  // IPv4-mapped (::ffff:127.0.0.1) auf IPv4 zurueckprojizieren
  const mapped = norm.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped?.[1]) return isPrivateV4(mapped[1]);
  if (norm === '::' || norm === '::1') return true;              // unspecified / loopback
  if (norm.startsWith('fe80')) return true;                      // link-local
  if (/^f[cd]/.test(norm)) return true;                          // fc00::/7 unique-local
  if (norm.startsWith('ff')) return true;                        // multicast
  return false;
}

/** Prueft eine IP-Adresse (v4 oder v6) auf Belegung interner Bereiche. */
export function isPrivateAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isPrivateV4(ip);
  if (family === 6) return isPrivateV6(ip);
  return true; // kein IP-Format -> grundsatzweise ablehnen
}

export interface ParsedTarget {
  url: URL;
  hostname: string;
}

/**
 * Schicht 1: URL-Syntax + Literal-IP-Pruefung. Ohne DNS.
 *
 * @throws BadRequestException bei ungueltigem oder internem Ziel
 */
export function parseAndAssertPublicUrl(raw: string): ParsedTarget {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BadRequestException('url muss eine gültige URL sein');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BadRequestException('url muss http oder https verwenden');
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const family = isIP(hostname);
  if (family !== 0 && isPrivateAddress(hostname)) {
    throw new BadRequestException(
      'url darf nicht auf eine interne oder reservierte Adresse zeigen',
    );
  }
  return { url, hostname };
}

/**
 * Schicht 2: DNS-Aufloesung + Pruefung ALLER A-Records.
 *
 * Aufrufe unmittelbar vor dem Request. Faengt DNS-Rebinding und Hosts, die
 * erst zur Zustellzeit auf eine interne IP zeigen.
 *
 * @throws ServiceUnavailableException wenn das Ziel nicht auflaesbar ist
 * @throws BadRequestException wenn ein Record auf einen internen Bereich zeigt
 */
export async function assertResolvesToPublicAddress(raw: string): Promise<ParsedTarget> {
  const { url, hostname } = parseAndAssertPublicUrl(raw);

  if (isIP(hostname) !== 0) {
    return { url, hostname }; // Literal-IP wurde bereits in Schicht 1 geprueft
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new ServiceUnavailableException(
      `Webhook-Ziel "${hostname}" ist nicht auflösbar`,
    );
  }
  if (addresses.length === 0) {
    throw new ServiceUnavailableException(
      `Webhook-Ziel "${hostname}" hat keine A-Records`,
    );
  }

  for (const { address } of addresses) {
    if (isPrivateAddress(address)) {
      // Absichtlich ohne IP-Nennung in der Fehlermeldung: sonst liefert die
      // API dem Aufrufer die interne Aufloesung zurueck.
      throw new BadRequestException(
        'url loest auf eine interne oder reservierte Adresse auf',
      );
    }
  }
  return { url, hostname };
}
