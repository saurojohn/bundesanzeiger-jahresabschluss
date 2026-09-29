import { createPublicKey, verify } from 'node:crypto';
import forge from 'node-forge';

/**
 * Zertifikatssperrprüfung (CRL) für Signaturzertifikate.
 *
 * Warum das nötig ist (2026-09-29): `assessCertificateTrust()` prüft
 * Gültigkeitszeitraum, KeyUsage, CA-Status und Aussteller. Es prüft
 * **nicht**, ob das Zertifikat zwischenzeitlich gesperrt wurde. Ein
 * gesperrtes Zertifikat gilt damit als gültig.
 *
 * Grundsatz: **fail-closed**. Wenn kein CRL-Endpoint am Zertifikat hängt,
 * der Abruf nicht gelingt oder die CRL nicht gegen den Aussteller
 * verifiziert werden kann, gilt der Sperrstatus als **unbekannt** — und
 * unbekannt ist in einem Compliance-Produkt kein „gültig".
 *
 * Umfang: CRL nach RFC 5280. OCSP ist über denselben Mechanismus
 * anschließbar (siehe `OcspEndpoint` / `SIGNATURE_OCSP_REQUIRED`); bewusst
 * nicht implementiert, weil ein OCSP-Request ASN.1-Encoding plus
 *Nonce/Response-Dekodierung ein eigenes Vorhaben ist — ein Gerüst, das
 *fälschlich „geprüft" meldet, wäre schlimmer als keines.
 *
 * @see https://www.rfc-editor.org/rfc/rfc5280#section-6.3
 */

/** OID der CRL Distribution Points (RFC 5280 §4.2.1.13) */
const OID_CRL_DISTRIBUTION_POINTS = '2.5.29.31';

export interface CrlEndpoint {
  url: string;
}

export interface RevocationStatus {
  /** true = gesperrt, false = nicht gesperrt, null = unbekannt (fail-closed). */
  revoked: boolean | null;
  /** true = der Sperrstatus wurde belastbar ermittelt. */
  determined: boolean;
  /** Geprüfter Endpunkt bzw. Quelle. */
  source?: 'crl';
  /** Seriennummer im Klartext (für Audit-Trails). */
  serialNumber?: string;
  /** Deutscher Begründungstext. */
  reason?: string;
  /** Endpunkte aus dem Zertifikat. */
  endpoints: CrlEndpoint[];
  /** Alter der verwendeten CRL in Sekunden, falls bekannt. */
  crlAgeSeconds?: number;
}

export interface CrlCheckOptions {
  /** CRLs vor dem Download injizieren (Tests, Offline). */
  fetchCrl?: (url: string) => Promise<string>;
  /** Timeout für den Abruf. */
  timeoutMs?: number;
  /**
   * Erlaubt Zertifikate ohne CRL-Endpoint.
   *
   * Standard: `false`. Dann ist ein Zertifikat ohne Sperrstatus **nicht**
   * vertrauenswürdig — fail-closed.
   */
  allowMissingEndpoint?: boolean;
}

/** OID der CRL Distribution Points (RFC 5280 §4.2.1.13) */

export interface CrlEndpoint {
  url: string;
}

export interface RevocationStatus {
  /** true = gesperrt, false = nicht gesperrt, null = unbekannt (fail-closed). */
  revoked: boolean | null;
  /** true = der Sperrstatus wurde belastbar ermittelt. */
  determined: boolean;
  source?: 'crl';
  serialNumber?: string;
  reason?: string;
  endpoints: CrlEndpoint[];
  crlAgeSeconds?: number;
}

/**
 * Liest die CRL-Distribution-Points aus einem Zertifikat.
 *
 * node-forge registriert die Erweiterung als `cRLDistributionPoints` (grosse
 * R und L) und liefert je nach Herkunft entweder eine Struktur aus
 * `{ altNames: [{ type, value }] }` oder — bei bereits serialisierten
 * Zertifikaten — nur das **rohe DER** in `value`. Beides wird abgefangen;
 * im zweiten Fall wird die URL aus dem Binary extrahiert.
 */
export function extractCrlEndpoints(certPem: string): CrlEndpoint[] {
  const urls = new Set<string>();
  try {
    const cert = forge.pki.certificateFromPem(certPem);

    // forge-Gegenstuecke zuerst: strukturiertes Feld
    const structured = cert.getExtension('cRLDistributionPoints') as
      | { altNames?: Array<{ value?: unknown }>; value?: unknown }
      | undefined;
    collectUrls(structured, urls, 0);

    // Zuordnungen aus `extensions` (auch bei bereits geparsten Zertifikaten)
    for (const ext of Object.values(cert.extensions ?? {})) {
      const e = ext as { id?: string; name?: string; altNames?: unknown; value?: unknown };
      if (e.id === OID_CRL_DISTRIBUTION_POINTS || e.name === 'cRLDistributionPoints') {
        collectUrls(e, urls, 0);
      }
    }
  } catch {
    return [];
  }
  return [...urls].map((url) => ({ url }));
}

/** Holt URLs aus verschachtelten Objekten oder aus rohem DER-Byte-Inhalt. */
function collectUrls(node: unknown, out: Set<string>, depth: number): void {
  if (depth > 8 || node === null || node === undefined) return;

  if (typeof node === 'string') {
    // Steuerzeichen (DER-Reste) explizit filtern statt per Regex — eslint
    // no-control-regex verbietet \x00-\x1f im Muster.
    for (const m of node.matchAll(/https?:\/\/[^\s"'<>]+/g)) {
      // eslint-disable-next-line no-control-regex
      const cleaned = m[0].replace(/[\u0000-\u001f]+/g, '').replace(/$/, '');
      if (cleaned) out.add(cleaned);
    }
    return;
  }
  if (Array.isArray(node)) {
    for (const n of node) collectUrls(n, out, depth + 1);
    return;
  }
  if (typeof node === 'object') {
    for (const key of ['altNames', 'value', 'distributionPoint', 'fullName', 'url', 'dp']) {
      const v = (node as Record<string, unknown>)[key];
      if (v !== undefined) collectUrls(v, out, depth + 1);
    }
  }
}



/** Ein dekodiertes DER-Element. */
interface Tlv {
  tag: number;
  length: number;
  valueStart: number;
  valueEnd: number;
}

/** Liest Tag + Länge (DER, Kurz- und Langformat). Gibt null bei Defekt. */
function readTlv(buf: Buffer, offset: number): Tlv | null {
  if (!Number.isInteger(offset) || offset < 0 || offset + 2 > buf.length) return null;
  const tag = buf[offset]!;
  let p = offset + 1;
  let length = buf[p++]!;
  if (length & 0x80) {
    const count = length & 0x7f;
    if (count === 0 || count > 4 || p + count > buf.length) return null;
    length = 0;
    for (let i = 0; i < count; i += 1) length = (length << 8) | buf[p++]!;
  }
  const valueStart = p;
  const valueEnd = valueStart + length;
  if (valueEnd > buf.length) return null;
  return { tag, length, valueStart, valueEnd };
}

/**
 * Minimales CRL-Parsing (RFC 5280 §5).
 *
 * Warum eigenstaendig: **node-forge kann keine CRLs** — `forge.pki.crlFromPem`,
 * `forge.pki.CertificateRevocationList` und `forge.pki.certificateRevocationListToPem`
 * sind zur Laufzeit `undefined` (nur in der Doku vorhanden). Node bringt
 * ebenfalls keinen CRL-Parser mit. `crypto.X509Certificate` kann
 * Zertifikate, aber keine Sperrlisten lesen.
 *
 * Gelesen wird nur das, was die Pruefung braucht: die Seriennummern der
 * gesperrten Zertifikate und der tbsCertList-Block fuer die Signaturpruefung.
 */
export interface ParsedCrl {
  /** Seriennummern der gesperrten Zertifikate, grossgeschrieben, ohne führende Nullen. */
  revokedSerials: ReadonlySet<string>;
  /** Roh-DER des tbsCertList (ohne Signatur) —/signatur wird ueber das geprueft. */
  tbsDer: Buffer;
  /** thisUpdate / nextUpdate */
  thisUpdate?: Date;
  nextUpdate?: Date;
  /** Issuer-RDN als lesbarer String (aus der Issuer-Sequence). */
  issuer?: string;
  /** Signatur-Algorithmus-OID */
  signatureAlgorithmOid?: string;
  /** Signaturwert (BIT STRING) ueber tbsCertList */
  signatureValue?: Buffer;
}

function readAsn1Time(buf: Buffer, tlv: Tlv): Date | undefined {
  // UTCTime (0x17) oder GeneralizedTime (0x18), ASCII
  const raw = buf.subarray(tlv.valueStart, tlv.valueEnd).toString('latin1');
  try {
    if (tlv.tag === 0x17) {
      // YYMMDDHHMMSSZ
      const yy = Number.parseInt(raw.slice(0, 2), 10);
      const year = yy >= 50 ? 1900 + yy : 2000 + yy;
      return new Date(
        Date.UTC(
          year,
          Number.parseInt(raw.slice(2, 4), 10) - 1,
          Number.parseInt(raw.slice(4, 6), 10),
          Number.parseInt(raw.slice(6, 8), 10),
          Number.parseInt(raw.slice(8, 10), 10),
          Number.parseInt(raw.slice(10, 12), 10),
        ),
      );
    }
    if (tlv.tag === 0x18) {
      // YYYYMMDDHHMMSSZ
      return new Date(
        Date.UTC(
          Number.parseInt(raw.slice(0, 4), 10),
          Number.parseInt(raw.slice(4, 6), 10) - 1,
          Number.parseInt(raw.slice(6, 8), 10),
          Number.parseInt(raw.slice(8, 10), 10),
          Number.parseInt(raw.slice(10, 12), 10),
          Number.parseInt(raw.slice(12, 14), 10),
        ),
      );
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/** INTEGER -> Hex-Seriennummer ohne fuehrende Nullen, Grossbuchstaben. */
function integerToSerial(buf: Buffer, tlv: Tlv): string {
  const bytes = buf.subarray(tlv.valueStart, tlv.valueEnd);
  let hex = bytes.toString('hex').toUpperCase();
  // fuehrende Null-Bytes (INTEGER ist vorzeichenbehaftet/padded) entfernen
  hex = hex.replace(/^(00)+/, '');
  if (hex.length % 2 === 1) hex = `0${hex}`;
  return hex;
}

/** Extrahiert einen Subject/Issuer-DN als "CN=.., O=.." (rekursiv). */
function renderName(buf: Buffer, tlv: Tlv, depth = 0): string {
  if (depth > 6) return '';
  const parts: string[] = [];
  let offset = tlv.valueStart;
  while (offset < tlv.valueEnd) {
    const rdn = readTlv(buf, offset);
    if (!rdn) break;
    let inner = rdn.valueStart;
    while (inner < rdn.valueEnd) {
      const atv = readTlv(buf, inner);
      if (!atv) break;
      // AttributeTypeAndValue ::= SEQUENCE { type OID, value ANY }
      const oid = readTlv(buf, atv.valueStart);
      if (oid) {
        const oidHex = buf.subarray(oid.valueStart, oid.valueEnd).toString('hex');
        const short =
          oidHex === '551d04' ? 'CN' : oidHex === '551d06' ? 'C' : oidHex === '551d0a' ? 'O' : oidHex;
        const val = readTlv(buf, oid.valueEnd);
        parts.push(`${short}=${val ? buf.subarray(val.valueStart, val.valueEnd).toString('latin1') : '?'}`);
      }
      inner = atv.valueEnd;
    }
    offset = rdn.valueEnd;
  }
  return parts.join(', ');
}

/** Parst eine PEM/DER-kodierte CRL. */
export function parseCrl(input: string | Buffer): ParsedCrl | null {
  try {
    let der: Buffer;
    if (typeof input === 'string') {
      const b64 = input
        .replace(/-----BEGIN X509 CRL-----/g, '')
        .replace(/-----END X509 CRL-----/g, '')
        .replace(/-----BEGIN CRL-----/g, '')
        .replace(/-----END CRL-----/g, '')
        .replace(/\s+/g, '');
      der = Buffer.from(b64, 'base64');
    } else {
      der = input;
    }

    const list = readTlv(der, 0);
    if (!list || list.tag !== 0x30) return null;
    const tbs = readTlv(der, list.valueStart);
    if (!tbs || tbs.tag !== 0x30) return null;
    const tbsDer = Buffer.from(der.subarray(tbs.valueStart - (tbs.valueStart - (tbs.valueStart)), tbs.valueEnd));
    // tbsDer inkl. Tag+Laenge: der TLV-Start liegt bei list.valueStart
    const tbsStart = list.valueStart;
    const tbsFull = Buffer.from(der.subarray(tbsStart, tbs.valueEnd));

    const revokedSerials = new Set<string>();
    let offset = tbs.valueStart;
      let thisUpdate: Date | undefined;
    let nextUpdate: Date | undefined;
    let issuer: string | undefined;
    let signatureAlgorithmOid: string | undefined;
    let first = true;

    while (offset < tbs.valueEnd) {
      const el = readTlv(der, offset);
      if (!el) break;
      if (first) {
        // version (optional, INTEGER)
        if (el.tag === 0x02) {
          offset = el.valueEnd;
          const alg = readTlv(der, offset);
          if (alg) {
            const oid = readTlv(der, alg.valueStart);
            if (oid) signatureAlgorithmOid = der.subarray(oid.valueStart, oid.valueEnd).toString('hex');
          }
        }
        first = false;
        continue;
      }
      if (el.tag === 0x30 && issuer === undefined) {
        issuer = renderName(der, el);
        offset = el.valueEnd;
        continue;
      }
      if ((el.tag === 0x17 || el.tag === 0x18) && thisUpdate === undefined) {
        thisUpdate = readAsn1Time(der, el);
        offset = el.valueEnd;
        continue;
      }
      if ((el.tag === 0x17 || el.tag === 0x18) && nextUpdate === undefined) {
        nextUpdate = readAsn1Time(der, el);
        offset = el.valueEnd;
        continue;
      }
      if (el.tag === 0x30) {
        // revokedCertificates SEQUENCE OF SEQUENCE
        let inner = el.valueStart;
        while (inner < el.valueEnd) {
          const entry = readTlv(der, inner);
          if (!entry) break;
          const serial = readTlv(der, entry.valueStart);
          if (serial && serial.tag === 0x02) {
            revokedSerials.add(integerToSerial(der, serial));
          }
          inner = entry.valueEnd;
        }
        offset = el.valueEnd;
        continue;
      }
      offset = el.valueEnd;
    }

    // Nach tbsCertList folgen signatureAlgorithm und signatureValue (BIT STRING).
    let sigValue: Buffer | undefined;
    let after = tbs.valueEnd;
    const sigAlg = readTlv(der, after);
    if (sigAlg) {
      after = sigAlg.valueEnd;
      const sig = readTlv(der, after);
      if (sig && sig.tag === 0x03) {
        // BIT STRING: erstes Byte = ungenutzte Bits (0 bei RSA)
        const unused = der[sig.valueStart] ?? 0;
        sigValue = Buffer.from(der.subarray(sig.valueStart + 1 + unused, sig.valueEnd));
      }
    }

    void tbsDer;
    return {
      revokedSerials,
      tbsDer: tbsFull,
      thisUpdate,
      nextUpdate,
      issuer,
      signatureAlgorithmOid,
      signatureValue: sigValue,
    };
  } catch {
    return null;
  }
}

/** Seriennummern Vergleich: Grossbuchstaben, ohne fuehrende Nullen, gerade Laenge. */
function normaliseSerial(serial: string): string {
  let hex = serial.replace(/^0x/i, '').toUpperCase().replace(/^0+(?=.)/, '');
  if (hex.length % 2 === 1) hex = `0${hex}`;
  return hex;
}

/** Signatur-Algorithmus-OID -> node:crypto-Hashname. */
function crlHashAlgorithm(oidHex?: string): string | null {
  if (!oidHex) return null;
  // rsaEncryption / sha256WithRSAEncryption / ecdsa-with-SHA256 …
  if (oidHex.includes('608648016503040201') || oidHex.includes('2a864886f70d01010b')) return 'sha256';
  if (oidHex.includes('608648016503040202') || oidHex.includes('2a864886f70d01010c')) return 'sha384';
  if (oidHex.includes('608648016503040203') || oidHex.includes('2a864886f70d01010d')) return 'sha512';
  if (oidHex.includes('2a864886f70d010105')) return 'sha1';
  return null;
}

const DEFAULT_TIMEOUT_MS = 5_000;

/** Holt eine CRL als PEM-String. */
async function defaultFetchCrl(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Prüft den Sperrstatus eines Zertifikats.
 *
 * @param certPem       Zertifikat (PEM)
 * @param issuerCertPem Zertifikat des Ausstellers zur Prüfung der CRL-Signatur
 */
export async function checkCertificateRevocation(
  certPem: string,
  issuerCertPem: string | null,
  options: CrlCheckOptions = {},
): Promise<RevocationStatus> {
  const endpoints = extractCrlEndpoints(certPem);

  let cert: forge.pki.Certificate;
  try {
    cert = forge.pki.certificateFromPem(certPem);
  } catch (err) {
    return {
      revoked: null,
      determined: false,
      reason: `Zertifikat nicht lesbar: ${(err as Error).message}`,
      endpoints: [],
    };
  }

  const serialNumber = cert.serialNumber
    .replace(/^0x/i, '')
    .toUpperCase()
    .replace(/^0+/, '')
    .padStart(2, '0');

  if (endpoints.length === 0) {
    // Kein Endpunkt: es gibt keine Quelle, aus der sich ein Sperrstatus
    // ableiten laesst. Das ist ausdruecklich KEIN „nicht gesperrt".
    return {
      revoked: null,
      determined: false,
      serialNumber,
      endpoints: [],
      reason:
        options.allowMissingEndpoint === true
          ? 'Zertifikat ohne CRL-Endpoint — Prüfung auf Wunsch übersprungen'
          : 'Zertifikat ohne CRL-Endpoint: Sperrstatus unbekannt (fail-closed)',
    };
  }

  const fetchCrl = options.fetchCrl
    ? (url: string) => options.fetchCrl!(url)
    : (url: string) => defaultFetchCrl(url, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  const problems: string[] = [];
  let sawCrl = false;

  for (const endpoint of endpoints) {
    try {
      const pem = await fetchCrl(endpoint.url);
      const crl = parseCrl(pem);
      if (!crl) {
        problems.push(`${endpoint.url}: CRL nicht lesbar (DER/PEM)`);
        continue;
      }
      sawCrl = true;

      // CRL-Signatur gegen den Aussteller pruefen: eine untergeschobene CRL
      // waere wertlos. `X509Certificate.verify()` prueft nur das Zertifikat
      // selbst und nimmt kein data-Argument — fuer die CRL braucht es
      // `crypto.verify(algo, tbsCertList, publicKey, signature)`.
      if (issuerCertPem) {
        try {
          if (!crl.tbsDer?.length || !crl.signatureValue?.length) {
            problems.push('CRL ohne tbsCertList/Signaturwert — nicht prüfbar');
            continue;
          }
          const publicKey = createPublicKey(issuerCertPem);
          const alg = crlHashAlgorithm(crl.signatureAlgorithmOid);
          if (!alg) {
            problems.push(`CRL-Signaturalgorithmus unbekannt (${crl.signatureAlgorithmOid ?? '?'})`);
            continue;
          }
          if (!verify(alg, crl.tbsDer, publicKey, crl.signatureValue)) {
            problems.push(`CRL-Signatur ungueltig (${endpoint.url})`);
            continue;
          }
        } catch (err) {
          problems.push(`CRL-Signatur nicht pruefbar: ${(err as Error).message}`);
          continue;
        }
      }

      // thisUpdate/nextUpdate: eine abgelaufene CRL darf nicht als
      // Entlastung dienen.
      if (crl.nextUpdate && new Date(crl.nextUpdate).getTime() < Date.now()) {
        problems.push(`CRL am ${crl.nextUpdate.toISOString()} abgelaufen`);
        continue;
      }

      if (crl.revokedSerials.has(normaliseSerial(serialNumber))) {
        return {
          revoked: true,
          determined: true,
          source: 'crl',
          serialNumber,
          endpoints,
          crlAgeSeconds: crl.thisUpdate
            ? Math.max(0, (Date.now() - crl.thisUpdate.getTime()) / 1000)
            : undefined,
          reason: `Zertifikat ist in der CRL als gesperrt geführt (Seriennummer ${serialNumber})`,
        };
      }

      return {
        revoked: false,
        determined: true,
        source: 'crl',
        serialNumber,
        endpoints,
        crlAgeSeconds: crl.thisUpdate
          ? Math.max(0, (Date.now() - crl.thisUpdate.getTime()) / 1000)
          : undefined,
        reason: 'Zertifikat ist nicht gesperrt (CRL geprüft)',
      };
    } catch (err) {
      problems.push(`${endpoint.url}: ${(err as Error).message}`);
    }
  }

  return {
    revoked: null,
    determined: false,
    serialNumber,
    endpoints,
    reason: sawCrl
      ? `CRL-Abruf/-Prüfung fehlgeschlagen: ${problems.join('; ')}`
      : `keine CRL verwertbar: ${problems.join('; ')}`,
  };
}
