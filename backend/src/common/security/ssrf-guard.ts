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

/**
 * Zerlegt eine IPv6-Adresse in ihre 8 x 16-Bit-Gruppen.
 * Gibt null zurueck, wenn die Schreibweise kein reines IPv6-Literal ist.
 */
function expandIpv6(ip: string): number[] | null {
  const norm = ip.toLowerCase().split('%')[0]!;
  if (!/^[0-9a-f:.]+$/.test(norm)) return null;

  // eingebettetes Punkt-Format (::ffff:127.0.0.1) in Hex umrechnen
  const withV4 = norm.replace(
    /(\d+)\.(\d+)\.(\d+)\.(\d+)$/,
    (_m, a, b, c, d) =>
      `${((+a << 8) | +b).toString(16)}:${((+c << 8) | +d).toString(16)}`,
  );
  if (withV4.includes('.')) return null;

  const halves = withV4.split('::');
  if (halves.length > 2) return null;

  const toGroups = (part: string | undefined): string[] =>
    part === undefined || part === '' ? [] : part.split(':');

  if (halves.length === 1) {
    const g = toGroups(halves[0]);
    return g.length === 8 && g.every((x) => /^[0-9a-f]{1,4}$/.test(x))
      ? g.map((x) => Number.parseInt(x, 16))
      : null;
  }

  const left = toGroups(halves[0]);
  const right = toGroups(halves[1]);
  const fill = 8 - left.length - right.length;
  if (fill < 0) return null;
  const all = [
    ...left,
    ...new Array<string>(fill).fill('0'),
    ...right,
  ];
  return all.every((x) => /^[0-9a-f]{1,4}$/.test(x))
    ? all.map((x) => Number.parseInt(x, 16))
    : null;
}

function ipv4FromGroups(groups: number[], at: number): string | null {
  if (groups.length < at + 2) return null;
  const hi = groups[at]!;
  const lo = groups[at + 1]!;
  return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
}

/**
 * Prueft, ob eine IPv6-Adresse ein IPv4 in einem Ueberfuehrungsformat einbettet.
 *
 * HINWEIS (Audit-Befund, eigenes Gut): Die WHATWG-URL-API normalisiert
 * IPv6-Literale **immer auf Hex** — `http://[::ffff:127.0.0.1]/` wird zu
 * `[::ffff:7f00:1]`. Ein Regex auf Punkt-Syntax wie
 * `^::ffff:(\d+\.\d+\.\d+\.\d+)$` matcht daher NIE und hat jede
 * IPv4-mapped-Adresse als "oeffentlich" durchgewunken (live belegt: HTTP 201
 * fuer http://[::ffff:127.0.0.1]:5432/). Deshalb wird in Gruppen gerechnet.
 */
function embeddedIpv4(groups: number[]): string | null {
  const zero = (from: number, to: number): boolean =>
    groups.slice(from, to).every((g) => g === 0);

  // ::ffff:a.b.c.d  — IPv4-mapped (RFC 4291)
  if (zero(0, 5) && groups[5] === 0xffff) return ipv4FromGroups(groups, 6);
  // ::a.b.c.d  — IPv4-compatible (veraltet, RFC 4291 §2.5.5.1)
  if (zero(0, 6) && groups[6] !== 0) return ipv4FromGroups(groups, 6);
  // 64:ff9b::a.b.c.d  — NAT64 (RFC 6052)
  if (groups[0] === 0x64 && groups[1] === 0xff9b && zero(2, 6)) {
    return ipv4FromGroups(groups, 6);
  }
  // 2002:a.b.c.d::/16  — 6to4 (RFC 3056), IPv4 in Gruppe 2/3
  if (groups[0] === 0x2002) return ipv4FromGroups([0, 0, ...groups.slice(2, 4)], 2);
  return null;
}

/**
 * true = die Adresse liegt in einem internen/reservierten Bereich.
 *
 * Fail-closed: eine Hostangabe, die weder als IPv4 noch als IPv6 lesbar ist,
 * wird als privat gewertet.
 */
function isPrivateV6(ip: string): boolean {
  const groups = expandIpv6(ip);
  if (!groups) return true;

  const embedded = embeddedIpv4(groups);
  if (embedded) return isPrivateV4(embedded);

  const zero = (g: number): boolean => g === 0;
  if (groups.every(zero)) return true;                                  // :: unspecified
  if (groups.slice(0, 7).every(zero) && groups[7] === 1) return true;  // ::1 loopback
  if ((groups[0]! & 0xfe00) === 0xfc00) return true;                   // fc00::/7 ULA
  if ((groups[0]! & 0xffc0) === 0xfe80) return true;                   // fe80::/10 link-local
  if ((groups[0]! & 0xff00) === 0xff00) return true;                   // ff00::/8 multicast
  if (groups.slice(0, 4).every(zero) && groups[4] === 0x100) return true; // 100::/64 discard
  if (groups[0] === 0x2001 && groups[1] === 0x0000) return true;       // 2001::/32 Teredo
  if (groups[0] === 0x2001 && groups[1] === 0x0db8) return true;       // 2001:db8::/32 Doku
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
