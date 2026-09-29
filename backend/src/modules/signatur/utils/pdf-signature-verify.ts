import { createHash, verify as cryptoVerify, createPublicKey } from 'node:crypto';
import { asn1 as forgeAsn1, md as forgeMd, pki as forgePki } from 'node-forge';

/**
 * Kryptografische Integritätsprüfung für signierte PDFs (PKCS#7 / CMS).
 *
 * Warum das nötig war (2026-09-28/29):
 *
 *  1. Runde 7 hat nur den `messageDigest` geprüft — den SHA-256 des Inhalts.
 *     Das schützt vor **Versehen**, nicht vor **Absicht**: wer den Inhalt
 *     ändert, kann den messageDigest einfach neu berechnen und zurückschreiben.
 *     Live demonstriert: Byte 800 kippen + Digest neu berechnen →
 *     „verifiziert". Ein Prüfschritt, der umgehbar ist, hat für GoBD keinen Wert.
 *
 *  2. Die eigentliche Signatur ist `SignerInfo.encryptedDigest`: der
 *     Signierender signiert seine `signedAttrs` mit dem privaten Schlüssel des
 *     Zertifikats. Erst die Prüfung dieses Werts gegen den öffentlichen
 *     Schlüssel macht die Aussage belastbar.
 *
 * Geprüft wird in drei Stufen (alle müssen bestehen):
 *   1. **Struktur**  — `/ByteRange` konsistent, Dateiende abgedeckt
 *   2. **Inhalt**   — messageDigest == SHA-256 der ByteRange-Bereiche
 *   3. **Kryptografie** — encryptedDigest verifiziert gegen das Zertifikat
 *
 * Bewusst ohne `@signpdf/verify-p12`: das Paket existiert auf npm nicht mehr.
 * `node-forge` (Projektabhängigkeit) liefert die ASN.1-/Zertifikats-Parser,
 * die Signaturprüfung selbst übernimmt das native `node:crypto`.
 *
 * Was das NICHT prüft: die Vertrauenswürdigkeit des Zertifikats selbst
 * (Zertifikatskette, EU Trusted List, Sperrlisten) und die Gueltigkeitszeiten.
 * Beides ist in `validateSignature()` bzw. dem CA-/Whitelist-Check zu erledigen.
 */

/** Angaben zum Signaturzertifikat, wie sie im PDF tatsächlich mitgeliefert werden. */
export interface CertificateInfo {
  subject: string;
  issuer: string;
  notBefore: string;
  notAfter: string;
  /** issuer == subject -> selbstsigniert, also von keiner CA ausgegeben. */
  selfSigned: boolean;
  isCa: boolean;
  keyUsageDigitalSignature: boolean;
  keyUsageNonRepudiation: boolean;
  keyUsageKeyCertSign: boolean;
  /** E-Mail-Adressen aus subjectAltName (RFC 822 / IA5String). */
  emails: string[];
  sha256Fingerprint: string;
}

export interface SignatureVerification {
  /** true = alle drei Stufen bestanden. */
  verified: boolean;
  /** Ergebnis der Kryptografie-Stufe (encryptedDigest gegen Zertifikat). */
  cryptographic: boolean;
  /** Subjekt des Signierers, falls ein Zertifikat mitgeliefert wurde. */
  signerSubject?: string;
  /** Ablaufdatum des Zertifikats (ISO-String), falls vorhanden. */
  notAfter?: string;
  /** Angaben zum mitgelieferten Zertifikat, falls vorhanden. */
  certificate?: CertificateInfo;
  /** Deutsche Kurzbegründung bei verified === false. */
  reason?: string;
}

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

/** OID 1.2.840.113549.1.9.4 (messageDigest) */
const OID_MESSAGE_DIGEST = Buffer.from([
  0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x09, 0x04,
]);
/** OID 2.16.840.1.101.3.4.2.1 (SHA-256), 2.16.840.1.101.3.4.2.2 (SHA-384), …2.3 (SHA-512) */
const DIGEST_OID_TO_NODE: ReadonlyMap<string, string> = new Map([
  ['0609608648016503040201', 'sha256'], // 2.16.840.1.101.3.4.2.1
  ['0609608648016503040202', 'sha384'], // …2.2
  ['0609608648016503040203', 'sha512'], // …2.3
  ['2a864886f70d01010b', 'sha1'], //     1.3.14.3.2.26
]);

interface ParsedSignature {
  messageDigest: Buffer | null;
  signedAttrsContent: Buffer | null;
  signature: Buffer | null;
  digestAlgorithm: string | null;
  certificatePem: string | null;
  certificateInfo?: CertificateInfo;
}

/**
 * Läuft im VOLLSTÄNDIGEN /Contents-Slot, nicht in einem auf valueEnd
 * zugeschnittenen Puffer: nach einem SEQUENCE beginnt der Inhalt bei
 * valueStart, und ein Sprung auf valueEnd landet in den 0x00-Füllbytes.
 */
function parsePkcs7(slot: Buffer): ParsedSignature {
  const out: ParsedSignature = {
    messageDigest: null,
    signedAttrsContent: null,
    signature: null,
    digestAlgorithm: null,
    certificatePem: null,
  };

  let t = readTlv(slot, 0); // ContentInfo
  if (!t) return out;
  t = readTlv(slot, t.valueStart); // contentType OID
  if (!t) return out;
  t = readTlv(slot, t.valueEnd); // content [0] EXPLICIT
  if (!t) return out;
  const sd = readTlv(slot, t.valueStart); // SignedData
  if (!sd) return out;

  let q = readTlv(slot, sd.valueStart); // version
  if (!q) return out;
  q = readTlv(slot, q.valueEnd); // digestAlgorithms
  if (!q) return out;
  const encap = readTlv(slot, q.valueEnd);
  if (!encap) return out;

  // Zertifikat aus certificates [0] IMPLICIT
  let p = encap.valueEnd;
  while (p < sd.valueEnd) {
    const n = readTlv(slot, p);
    if (!n) break;
    if (n.tag === 0x31) break; // signerInfos SET
    if (n.tag === 0xa0) {
      const certTlv = readTlv(slot, n.valueStart);
      if (certTlv?.tag === 0x30) {
        try {
          const cert = forgePki.certificateFromAsn1(
            forgeAsn1.fromDer(slot.subarray(n.valueStart, certTlv.valueEnd).toString('binary')),
          );
          out.certificatePem = forgePki.certificateToPem(cert);
          // forge-Typen sind hier unvollstaendig (CertificateField.value: string|any)
          type Field = { name?: string; shortName?: string; value: unknown };
          const render = (fields: Field[]): string =>
            fields.map((f) => `${f.shortName ?? f.name ?? '?'}=${String(f.value)}`).join(', ');
          const subject = render(cert.subject.attributes as unknown as Field[]);
          const issuer = render(cert.issuer.attributes as unknown as Field[]);
          const basicConstraints = cert.getExtension('basicConstraints') as
            | { cA?: boolean }
            | undefined;
          const keyUsage = cert.getExtension('keyUsage') as
            | {
                digitalSignature?: boolean;
                nonRepudiation?: boolean;
                keyCertSign?: boolean;
              }
            | undefined;
          // cert.raw ist das originale DER (binary) — daraus der Fingerabdruck.
          const md = forgeMd.sha256.create();
          md.update((cert as unknown as { raw?: string }).raw ?? '', 'raw');
          out.certificateInfo = {
            subject,
            issuer,
            notBefore: cert.validity.notBefore.toISOString(),
            notAfter: cert.validity.notAfter.toISOString(),
            selfSigned: subject === issuer,
            isCa: basicConstraints?.cA === true,
            keyUsageDigitalSignature: keyUsage?.digitalSignature === true,
            keyUsageNonRepudiation: keyUsage?.nonRepudiation === true,
            keyUsageKeyCertSign: keyUsage?.keyCertSign === true,
            // SAN ist der richtige Ort fuer die Signierer-Identitaet; ein
            // CN wie "CN=Steuerberater Mueller" enthaelt keine E-Mail.
            emails: collectSanEmails(cert),
            sha256Fingerprint: md.digest().toHex().toUpperCase(),
          };
        } catch {
          // Zertifikat unlesbar — wird unten als fehlend behandelt
        }
      }
    }
    p = n.valueEnd;
  }
  if (p >= sd.valueEnd) return out;

  const signerInfos = readTlv(slot, p);
  if (!signerInfos) return out;
  const si = readTlv(slot, signerInfos.valueStart);
  if (!si) return out;

  let r = readTlv(slot, si.valueStart); // version
  if (!r) return out;
  r = readTlv(slot, r.valueEnd); // issuerAndSerialNumber
  if (!r) return out;
  r = readTlv(slot, r.valueEnd); // digestAlgorithm
  if (!r) return out;
  out.digestAlgorithm = slot.subarray(r.valueStart, r.valueEnd).toString('hex');

  const signedAttrs = readTlv(slot, r.valueEnd); // [0] IMPLICIT signedAttrs
  if (!signedAttrs) return out;
  out.signedAttrsContent = Buffer.from(slot.subarray(signedAttrs.valueStart, signedAttrs.valueEnd));

  // messageDigest-Attribut innerhalb der signedAttrs
  const region = slot.subarray(signedAttrs.valueStart, signedAttrs.valueEnd);
  const at = region.indexOf(OID_MESSAGE_DIGEST);
  if (at >= 0) {
    const set = readTlv(slot, signedAttrs.valueStart + at + OID_MESSAGE_DIGEST.length);
    if (set?.tag === 0x31) {
      const octet = readTlv(slot, set.valueStart);
      if (octet?.tag === 0x04) {
        out.messageDigest = Buffer.from(slot.subarray(octet.valueStart, octet.valueEnd));
      }
    }
  }

  r = readTlv(slot, signedAttrs.valueEnd); // digestEncryptionAlgorithm
  if (!r) return out;
  const enc = readTlv(slot, r.valueEnd); // encryptedDigest OCTET STRING
  if (enc?.tag === 0x04) {
    out.signature = Buffer.from(slot.subarray(enc.valueStart, enc.valueEnd));
  }

  return out;
}

/**
 * `signedAttrs` ist im CMS IMPLICIT [0] kodiert, wird bei der Signaturprüfung
 * aber als SET OF kodiert (PKCS#1 v1.5, RFC 5652 §5.4). Der äußere Tag muss
 * daher von 0xA0 auf 0x31 wechseln, der Inhalt bleibt identisch.
 */
function toSignableDer(attrsContent: Buffer): Buffer {
  const len = attrsContent.length;
  const header =
    len < 128 ? Buffer.from([0x31, len]) : Buffer.from([0x31, 0x81, len]);
  return Buffer.concat([header, attrsContent]);
}

/** Sammelt E-Mail-Adressen aus dem subjectAltName-Extension. */
function collectSanEmails(cert: unknown): string[] {
  const alt = (cert as { getExtension?: (n: string) => unknown }).getExtension?.(
    'subjectAltName',
  ) as { altNames?: Array<{ type?: number | string; value?: string }> } | undefined;
  if (!alt?.altNames) return [];
  const IA5 = 1; // dNSName ist 2, rfc822Name (E-Mail) ist 1
  return alt.altNames
    .filter((a) => a.type === IA5 && typeof a.value === 'string' && a.value.includes('@'))
    .map((a) => String(a.value).toLowerCase());
}

/**
 * Prüft ein signiertes PDF. Fail-closed: jeder Parse- oder Prüffehler führt zu
 * `verified: false`. Eine nicht prüfbare Signatur darf nie als intakt gelten.
 */
export function verifyPdfSignature(pdf: Buffer): SignatureVerification {
  const text = pdf.toString('latin1');

  const byteRange = text.match(/\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/);
  if (!byteRange) return { verified: false, cryptographic: false, reason: 'kein /ByteRange gefunden' };
  const start = Number.parseInt(byteRange[1]!, 10);
  const length1 = Number.parseInt(byteRange[2]!, 10);
  const start2 = Number.parseInt(byteRange[3]!, 10);
  const length2 = Number.parseInt(byteRange[4]!, 10);
  if (start !== 0 || length1 <= 0 || start2 <= 0 || length2 <= 0) {
    return { verified: false, cryptographic: false, reason: 'ungültiger /ByteRange' };
  }

  // Stufe 1 — Struktur. Toleranz bewusst eng (2 Byte): eine weite Toleranz
  // wäre selbst ein Bypass (so viele Bytes könnte man unentdeckt anhängen).
  const endCovered = start2 + length2;
  if (endCovered < pdf.length - 2 || endCovered > pdf.length + 2) {
    return {
      verified: false,
      cryptographic: false,
      reason: 'Dateiende weicht vom /ByteRange ab — Bytes wurden angehängt oder entfernt',
    };
  }

  const contents = text.match(/\/Contents\s*<([0-9a-fA-F]+)>/);
  if (!contents?.[1]) {
    return { verified: false, cryptographic: false, reason: 'kein /Contents (Hex) gefunden' };
  }
  const slot = Buffer.from(contents[1], 'hex');
  const parsed = parsePkcs7(slot);
  const base = { certificate: parsed.certificateInfo };

  // Stufe 2 — Inhalt: messageDigest gegen SHA-256 der ByteRange-Bereiche
  if (!parsed.messageDigest) {
    return { ...base, verified: false, cryptographic: false, reason: 'messageDigest nicht lesbar' };
  }
  const computed = createHash('sha256')
    .update(Buffer.concat([pdf.subarray(start, start + length1), pdf.subarray(start2, start2 + length2)]))
    .digest();
  if (!computed.equals(parsed.messageDigest)) {
    return {
      ...base,
      verified: false,
      cryptographic: false,
      reason:
        'SHA-256 des signierten Inhalts weicht vom messageDigest ab — der Inhalt wurde verändert',
    };
  }

  // Stufe 3 — Kryptografie: encryptedDigest gegen den öffentlichen Schlüssel.
  // Ohne diese Stufe ist der messageDigest angreifbar (jeder kann ihn neu
  // berechnen) — der Nachweis "signiert" wäre wertlos.
  if (!parsed.signature || !parsed.signedAttrsContent || !parsed.certificatePem) {
    return {
      ...base,
      verified: false,
      cryptographic: false,
      reason: 'Signaturwert oder Zertifikat fehlt im PDF',
    };
  }
  const algorithm = parsed.digestAlgorithm
    ? DIGEST_OID_TO_NODE.get(parsed.digestAlgorithm.replace(/0500$/, '').slice(0, 26))
    : undefined;
  if (!algorithm) {
    return {
      ...base,
      verified: false,
      cryptographic: false,
      reason: `nicht unterstützter Digest-Algorithmus (${parsed.digestAlgorithm ?? 'unbekannt'})`,
    };
  }

  let publicKey;
  try {
    publicKey = createPublicKey(parsed.certificatePem);
  } catch (err) {
    return {
      ...base,
      verified: false,
      cryptographic: false,
      reason: `öffentlicher Schlüssel nicht lesbar: ${(err as Error).message}`,
    };
  }

  let cryptographic = false;
  try {
    cryptographic = cryptoVerify(
      algorithm,
      toSignableDer(parsed.signedAttrsContent),
      publicKey,
      parsed.signature,
    );
  } catch {
    cryptographic = false;
  }

  if (!cryptographic) {
    return {
      ...base,
      verified: false,
      cryptographic: false,
      reason:
        'Signaturprüfung fehlgeschlagen: encryptedDigest passt nicht zum öffentlichen Schlüssel des Zertifikats',
    };
  }

  return { ...base, verified: true, cryptographic: true };
}

// =============================================================================
// Zertifikats-Vertrauensbewertung
// =============================================================================

export interface TrustDecision {
  /** now > notAfter */
  certificateExpired: boolean;
  /** now < notBefore */
  notYetValid: boolean;
  /** digitalSignature ODER nonRepudiation gesetzt */
  keyUsageOk: boolean;
  /** Zertifikat ist als CA gekennzeichnet (BasicConstraints cA=true) */
  isCa: boolean;
  /** issuer == subject */
  selfSigned: boolean;
  /** Ergebnis der Vertrauensbewertung. */
  trusted: boolean;
  /** Deutsche Begründung. */
  reason?: string;
}

export interface TrustOptions {
  /** Erwartete E-Mail/Identität im Subject. */
  expectedSignerEmail?: string;
  /**
   * Vertrauenswürdige Aussteller (Subject-DN oder Teile davon). Leer heißt:
   * es wird kein Aussteller als vertrauenswürdig anerkannt — fail-closed.
   */
  trustedIssuers?: readonly string[];
  /**
   * Selbstsignierte Zertifikate zulassen. NUR für Testumgebungen — im
   * GoBD-Betrieb ist ein selbstsigniertes Zertifikat kein Nachweis.
   */
  allowSelfSigned?: boolean;
  /** Referenzzeitpunkt (Default: jetzt). */
  now?: Date;
}

/**
 * Bewertet ein Signaturzertifikat.
 *
 * Bis 2026-09-28 war `certificateExpired` im Service **hart kodiert** auf
 * `false` und `issuerTrusted` wurde ohne `expectedSignerEmail` ebenfalls auf
 * `true` gesetzt — mit dem Kommentar „M3 erweitert auf EU Trusted List",
 * obwohl M3 als abgeschlossen geführt wurde.
 *
 * Diese Funktion ersetzt das durch eine tatsächliche Prüfung. Sie sagt
 * ausdrücklich **nicht**, dass ein Zertifikat von einer in der EU-Trust-Liste
 * geführten Stelle stammt — dafür fehlen die Roots. Sie stellt aber die
 * Grundbedingungen fest, die sonst überhaupt nicht geprüft wurden.
 */
export function assessCertificateTrust(
  certificate: CertificateInfo | undefined,
  options: TrustOptions = {},
): TrustDecision {
  const now = options.now ?? new Date();

  if (!certificate) {
    return {
      certificateExpired: false,
      notYetValid: false,
      keyUsageOk: false,
      isCa: false,
      selfSigned: false,
      trusted: false,
      reason: 'kein Zertifikat im PDF enthalten',
    };
  }

  const notBefore = new Date(certificate.notBefore);
  const notAfter = new Date(certificate.notAfter);
  const notYetValid = Number.isNaN(notBefore.getTime()) || now < notBefore;
  const certificateExpired = Number.isNaN(notAfter.getTime()) || now > notAfter;

  const keyUsageOk =
    certificate.keyUsageDigitalSignature || certificate.keyUsageNonRepudiation;

  if (certificateExpired) {
    return {
      certificateExpired: true,
      notYetValid,
      keyUsageOk,
      isCa: certificate.isCa,
      selfSigned: certificate.selfSigned,
      trusted: false,
      reason: `Zertifikat am ${certificate.notAfter} abgelaufen`,
    };
  }
  if (notYetValid) {
    return {
      certificateExpired: false,
      notYetValid: true,
      keyUsageOk,
      isCa: certificate.isCa,
      selfSigned: certificate.selfSigned,
      trusted: false,
      reason: `Zertifikat erst ab ${certificate.notBefore} gültig`,
    };
  }
  if (!keyUsageOk) {
    return {
      certificateExpired: false,
      notYetValid: false,
      keyUsageOk: false,
      isCa: certificate.isCa,
      selfSigned: certificate.selfSigned,
      trusted: false,
      reason: 'KeyUsage erlaubt weder digitalSignature noch nonRepudiation',
    };
  }
  if (certificate.isCa) {
    // Eine CA darf nicht als Signaturzertifikat verwendet werden.
    return {
      certificateExpired: false,
      notYetValid: false,
      keyUsageOk,
      isCa: true,
      selfSigned: certificate.selfSigned,
      trusted: false,
      reason: 'Zertifikat ist als CA gekennzeichnet und darf nicht signieren',
    };
  }

  // Identitaetspruefung. Reihenfolge: (1) SAN-E-Mail — dort steht sie bei
  // qualifizierten Zertifikaten; (2) Subject/Issuer-Text als Rueckfall fuer
  // Zertifikate ohne SAN.
  if (options.expectedSignerEmail) {
    const wanted = options.expectedSignerEmail.toLowerCase();
    const viaSan = certificate.emails.some((e) => e === wanted);
    // Umlaut-Normalisierung: "Müller" ~ "Mueller", sonst findet ein
    // Subject-Namensabgleich deutsche Namen nicht.
    const fold = (v: string) =>
      v
        .toLowerCase()
        .replace(/ä/g, 'ae')
        .replace(/ö/g, 'oe')
        .replace(/ü/g, 'ue')
        .replace(/ß/g, 'ss');
    const haystack = fold(`${certificate.subject} ${certificate.issuer}`);
    if (!viaSan && !haystack.includes(fold(options.expectedSignerEmail))) {
      return {
        certificateExpired: false,
        notYetValid: false,
        keyUsageOk,
        isCa: false,
        selfSigned: certificate.selfSigned,
        trusted: false,
        reason: `Zertifikat enthält nicht die erwartete Identität (${options.expectedSignerEmail})`,
      };
    }
  }

  // Ausstellervertrauen
  if (certificate.selfSigned) {
    if (options.allowSelfSigned === true) {
      return {
        certificateExpired: false,
        notYetValid: false,
        keyUsageOk,
        isCa: false,
        selfSigned: true,
        trusted: true,
        reason: 'selbstsigniertes Zertifikat — nur für Testumgebungen zugelassen',
      };
    }
    return {
      certificateExpired: false,
      notYetValid: false,
      keyUsageOk,
      isCa: false,
      selfSigned: true,
      trusted: false,
      reason:
        'selbstsigniertes Zertifikat: es wurde von keiner anerkannten Stelle ausgestellt',
    };
  }

  const whitelist = options.trustedIssuers ?? [];
  const issuerLower = certificate.issuer.toLowerCase();
  const hit = whitelist.find((i) => issuerLower.includes(i.toLowerCase()));
  if (whitelist.length === 0 || !hit) {
    return {
      certificateExpired: false,
      notYetValid: false,
      keyUsageOk,
      isCa: false,
      selfSigned: false,
      trusted: false,
      reason:
        whitelist.length === 0
          ? 'keine Liste vertrauenswürdiger Aussteller hinterlegt — es wird nichts als vertrauenswürdig anerkannt'
          : `Aussteller "${certificate.issuer}" steht nicht auf der Vertrauensliste`,
    };
  }

  return {
    certificateExpired: false,
    notYetValid: false,
    keyUsageOk,
    isCa: false,
    selfSigned: false,
    trusted: true,
  };
}
