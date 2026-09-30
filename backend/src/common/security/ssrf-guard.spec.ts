import { describe, expect, it } from 'vitest';
import { isPrivateAddress, parseAndAssertPublicUrl } from './ssrf-guard';

/**
 * SSRF-Schutz — Regressionstests.
 *
 * Der Grund für diesen Satz: Die erste Fassung von `isPrivateV6()` suchte
 * IPv4-mapped-Adressen per Regex auf **Punkt-Syntax**
 * (`^::ffff:(\d+\.\d+\.\d+\.\d+)$`). Die WHATWG-URL-API normalisiert
 * IPv6-Literale aber immer auf Hex — `http://[::ffff:127.0.0.1]/` wird zu
 * `[::ffff:7f00:1]`. Der Regex matchte also **nie**, jedes eingebettete IPv4
 * galt als "öffentlich". Live belegt waren daraufhin HTTP 201 für
 * `http://[::ffff:127.0.0.1]:5432/` und eine echte TCP-Verbindung zu
 * PostgreSQL. Jeder Fall unten ist also eine Regression, kein Wunschdenken.
 *
 * Diese Tests laufen durch dieselbe `parseAndAssertPublicUrl`, die der
 * Webhook-Controller benutzt — also inklusive der URL-Normalisierung.
 */

/** Adressen, die NIEMALS als Webhook-Ziel taugen dürfen. */
const MUST_BLOCK: ReadonlyArray<[string, string]> = [
  ['127.0.0.1', 'Loopback v4'],
  ['0.0.0.0', 'This-Network'],
  ['10.0.0.1', 'RFC1918 10/8'],
  ['172.16.0.1', 'RFC1918 172.16/12'],
  ['192.168.1.1', 'RFC1918 192.168/16'],
  ['100.64.0.1', 'CGNAT 100.64/10'],
  ['169.254.169.254', 'Link-Local / Cloud-Metadaten'],
  ['224.0.0.1', 'Multicast'],
  ['240.0.0.1', 'Reserviert'],
  ['::1', 'Loopback v6'],
  ['::', 'Unspecified v6'],
  ['fe80::1', 'Link-Local v6'],
  ['fc00::1', 'Unique-Local fc00::/7'],
  ['fd12:3456::1', 'Unique-Local fd00::/7'],
  ['ff02::1', 'Multicast v6'],
  // --- Die Bypass-Familie, die das Audit gefunden hat ---
  ['::ffff:127.0.0.1', 'IPv4-mapped Loopback'],
  ['::ffff:169.254.169.254', 'IPv4-mapped Metadaten'],
  ['::ffff:10.0.0.1', 'IPv4-mapped RFC1918'],
  ['::7f00:1', 'IPv4-kompatibel (Hex)'],
  ['::127.0.0.1', 'IPv4-kompatibel (Punkt)'],
  ['64:ff9b::7f00:1', 'NAT64 → Loopback'],
  ['2002:7f00:1::', '6to4 → Loopback'],
  ['::ffff:0:0', 'IPv4-mapped 0.0.0.0'],
];

/** Öffentliche Adressen, die durchgelangen MÜSSEN (sonst ist der Guard nutzlos). */
const MUST_PASS: ReadonlyArray<[string, string]> = [
  ['8.8.8.8', 'Google DNS'],
  ['1.1.1.1', 'Cloudflare DNS'],
  ['93.184.216.34', 'Öffentlicher Web-Host'],
  ['2606:4700:4700::1111', 'Cloudflare DNS v6'],
];

describe('isPrivateAddress', () => {
  for (const [ip, why] of MUST_BLOCK) {
    it(`blockiert ${ip} (${why})`, () => {
      expect(isPrivateAddress(ip), `${ip} muss als intern gelten`).toBe(true);
    });
  }

  for (const [ip, why] of MUST_PASS) {
    it(`lässt ${ip} durch (${why})`, () => {
      expect(isPrivateAddress(ip), `${ip} darf nicht blockiert werden`).toBe(false);
    });
  }

  it('behandelt unlesbare Eingaben fail-closed', () => {
    expect(isPrivateAddress('keine-ip')).toBe(true);
    expect(isPrivateAddress('')).toBe(true);
    expect(isPrivateAddress('999.999.999.999')).toBe(true);
  });
});

describe('parseAndAssertPublicUrl (so wie der Controller es aufruft)', () => {
  for (const [ip, why] of MUST_BLOCK) {
    it(`weist http://${ip}/ ab (${why})`, () => {
      expect(() => parseAndAssertPublicUrl(`http://${ip}/`)).toThrow();
    });
  }

  it('weist die konkret nachgewiesenen Bypass-URLs ab', () => {
    const bypasses = [
      'http://[::ffff:169.254.169.254]/latest/meta-data/',
      'http://[::ffff:127.0.0.1]:5432/',
      'http://[::7f00:1]/',
      'http://[64:ff9b::7f00:1]/',
      'http://[2002:7f00:1::]/',
    ];
    for (const url of bypasses) {
      expect(
        () => parseAndAssertPublicUrl(url),
        `${url} muss abgewiesen werden`,
      ).toThrow();
    }
  });

  it('lässt ein normales öffentliches Ziel durch', () => {
    const { url, hostname } = parseAndAssertPublicUrl(
      'https://datev.example.com/webhooks/banz',
    );
    expect(url.protocol).toBe('https:');
    expect(hostname).toBe('datev.example.com');
  });

  it('weist andere Schemata als http/https ab', () => {
    for (const url of ['file:///etc/passwd', 'gopher://x/', 'ftp://x/', 'javascript:alert(1)']) {
      expect(() => parseAndAssertPublicUrl(url)).toThrow();
    }
  });

  it('weist syntaktisch ungültige URLs ab', () => {
    for (const url of ['nicht-a-url', '', 'http://', 'ht!tp://x']) {
      expect(() => parseAndAssertPublicUrl(url)).toThrow();
    }
  });
});

describe('DNS-Auflösung (Schicht 2)', () => {
  it('localhost als Hostname löst nicht auf, daher fail-closed', async () => {
    // `localhost` ist keine IP — die URL-Prüfung kann ihn nicht fassen.
    // Deshalb MUSS die zweite Stufe (DNS) existieren; dieser Test
    // dokumentiert die Lücke, damit sie nicht als „erledigt" gilt.
    const { isPrivateAddress: check } = await import('./ssrf-guard');
    expect(check('localhost')).toBe(true); // kein IP-Format -> abgewiesen
  });
});
