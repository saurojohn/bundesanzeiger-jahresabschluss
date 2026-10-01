import { createHash } from 'node:crypto';
import forge from 'node-forge';

/**
 * RFC-3161-TimeStampResp-Parser (M4 Sprint 6).
 *
 * WARUM DIESE DATEI EXISTIERT:
 *   Bis 2026-10-01 hat `TsaClientService` den Zeitstempelzeitpunkt als
 *   `new Date()` (die lokale Uhrzeit), den TSA-Namen aus dem URL-Hostnamen und
 *   die Seriennummer als SHA-256-Hash der Antwortbytes geliefert. Keiner dieser
 *   drei Werte stammte aus dem Token. Damit war der Zeitstempel nicht
 *   nachprüfbar — und die Werte in der Signatur-Datenbank sahen belastbar aus,
 *   waren es aber nicht.
 *
 * WAS HIER PASSIERT:
 *   Der DER-codierte TimeStampResp wird bis zum TSTInfo dekodiert. Daraus werden
 *   die Felder gelesen, die für die Beweiskette zählen:
 *     - genTime            Zeitpunkt, zu dem die TSA den Hash bestätigt hat
 *     - serialNumber       Seriennummer des Zeitstempels
 *     - messageImprint     Hash, den die TSA bestätigt hat
 *     - tsaCertificate     das Zertifikat der TSA (CN + Gültigkeit)
 *
 * WAS HIER BEWUSST NICHT PASSIERT:
 *   Die kryptografische Prüfung der TSA-Signatur über `tstInfo.signature`
 *   (RPKCS1/PKCS#1-v1_5 über das certEncapsulatedContentInfo) ist NICHT Teil
 *   dieser Datei. Ohne das Vertrauenszertifikat der TSA kann man die Signatur
 *   nicht bewerten — ein Token, dessen Signatur nicht geprüft wurde, belegt
 *   nichts über den Absender. `signatur.service.ts` weist das deshalb als
 *   `legalValidity: 'OHNE_ZEITSTEMPEL'` aus, auch wenn dieses Parsing erfolgreich
 *   war. Wer das ändern will, braucht einen Trust-Store für die TSA-Zertifikate.
 */

export interface ParsedTimestamp {
  /** Zeitpunkt laut genTime im Token (UTC). */
  genTime: Date | null;
  /** Seriennummer des Zeitstempels, wie von der TSA vergeben. */
  serialNumber: string | null;
  /** Algorithmus-OID, mit dem die TSA den Hash gebildet hat (z. B. 2.16.840.1.101.3.4.2.1 = SHA-256). */
  hashAlgorithmOid: string | null;
  /** Der von der TSA bestätigte Hash, hex. */
  messageImprintHex: string | null;
  /** Common Name des TSA-Zertifikats. */
  tsaCommonName: string | null;
  /** notBefore des TSA-Zertifikats (UTC). */
  tsaNotBefore: Date | null;
  /** notAfter des TSA-Zertifikats (UTC). */
  tsaNotAfter: Date | null;
  /** War das Token strukturell lesbar? */
  parsed: boolean;
  /** Grund bei `parsed === false`. */
  reason?: string;
}

/** ASN.1 OIDs, die für die Prüfung eine Rolle spielen. */
const OID_SIGNED_DATA = '1.2.840.113549.1.7.2';
const OID_CT_TST_INFO = '1.2.840.113549.1.9.16.1.4';

/** Bekannte Hash-OIDs → lesbarer Name. Für die Plausibilitätsprüfung. */
const KNOWN_HASH_OIDS = new Set([
  '2.16.840.1.101.3.4.2.1', // SHA-256
  '2.16.840.1.101.3.4.2.2', // SHA-384
  '2.16.840.1.101.3.4.2.3', // SHA-512
  '1.3.14.3.2.26', // SHA-1
]);

/**
 * Parst einen DER-codierten RFC-3161-TimeStampResp.
 *
 * @param tokenBytes Rohe Antwortbytes der TSA (Content-Type application/timestamp-reply)
 * @returns Ausgewertete Felder; `parsed: false` wenn das Token nicht lesbar ist
 */
export function parseTimestampToken(tokenBytes: Buffer): ParsedTimestamp {
  const empty: ParsedTimestamp = {
    genTime: null,
    serialNumber: null,
    hashAlgorithmOid: null,
    messageImprintHex: null,
    tsaCommonName: null,
    tsaNotBefore: null,
    tsaNotAfter: null,
    parsed: false,
  };

  if (!tokenBytes || tokenBytes.length < 16) {
    return { ...empty, reason: 'Token zu kurz für einen TimeStampResp' };
  }

  let asn1: forge.asn1.Asn1;
  try {
    asn1 = forge.asn1.fromDer(tokenBytes.toString('binary'));
  } catch (err) {
    return { ...empty, reason: `DER-Dekodierung fehlgeschlagen: ${(err as Error).message}` };
  }

  // TimeStampResp ::= SEQUENCE { status PKIStatusInfo, timeStampToken ContentInfo OPTIONAL }
  //
  // `forge.asn1.fromDer` gibt den obersten Knoten zurück — hier also bereits
  // die TimeStampResp-SEQUENCE, nicht ein Wrapping. Ihre Kinder sind
  // PKIStatusInfo und ContentInfo.
  const respSeq = node(asn1);
  if (!respSeq) return { ...empty, reason: 'TimeStampResp ohne Inhalt' };

  // PKIStatusInfo ::= SEQUENCE { status INTEGER, statusString OPTIONAL, failInfo OPTIONAL }
  //
  // Achtung zur Tiefe: RFC 3161 kodiert `status` als implizit getaggtes [0],
  // innerhalb von PKIStatusInfo also drei Ebenen bis zum INTEGER. Welche
  // Elemente forge als Knoten zurückgibt, hängt von der Kodierungsvariante
  // ab — deshalb wird hier der INTEGER strukturell gesucht statt über feste
  // Indizes gegangen. Feste Indizes wären hier ein stiller Fehler gewesen:
  // der Test hätte "PKIStatus undefined" gemeldet und ein echtes Token wäre
  // als Ablehnung durchgegangen.
  const statusInfo = findDescendantOfType(node(children(respSeq)[0]), SEQUENCE);
  if (!statusInfo) return { ...empty, reason: 'PKIStatusInfo fehlt' };

  // granted(0)/grantedWithMods(1) heißen Erfolg; alles andere ist Ablehnung.
  const rawStatus = findDescendantValueOfType(statusInfo, INTEGER);
  const statusValue = normalizeAsn1Integer(rawStatus);
  if (statusValue !== 0 && statusValue !== 1) {
    return { ...empty, reason: `TSA meldet Ablehnung (PKIStatus ${String(rawStatus)})` };
  }

  // timeStampToken: ContentInfo ::= SEQUENCE { contentType OID, content [0] EXPLICIT ANY }
  const tokenInfo = node(children(respSeq)[1]);
  if (!tokenInfo) return { ...empty, reason: 'TimeStampToken fehlt in der Antwort' };

  const tokenInfoChildren = children(tokenInfo);
  const contentTypeOid = node(tokenInfoChildren[0])?.value;
  if (contentTypeOid !== OID_SIGNED_DATA) {
    return { ...empty, reason: `Unerwarteter contentType ${String(contentTypeOid)}` };
  }

  // content [0] EXPLICIT → SignedData
  const explicitContent = node(tokenInfoChildren[1]);
  const signedData = node(children(explicitContent)[0]);
  if (!signedData) return { ...empty, reason: 'SignedData nicht lesbar' };

  // SignedData ::= SEQUENCE { version, digestAlgorithms, encapContentInfo, ... }
  const signedDataChildren = children(signedData);
  const encap = node(signedDataChildren[2]);
  if (!encap) return { ...empty, reason: 'encapContentInfo fehlt' };

  // encapContentInfo ::= SEQUENCE { eContentType OID, eContent [0] EXPLICIT OCTET STRING }
  const encapChildren = children(encap);
  const eContentType = node(encapChildren[0])?.value;
  if (eContentType !== OID_CT_TST_INFO) {
    return { ...empty, reason: 'eContent ist kein TSTInfo' };
  }
  const eContentWrapper = node(encapChildren[1]);
  const eContentOctets = node(children(eContentWrapper)[0]);
  const eContentValue = eContentOctets?.value;
  if (typeof eContentValue !== 'string' || eContentValue.length === 0) {
    return { ...empty, reason: 'TSTInfo-Bytes fehlen' };
  }

  let tstInfoAsn1: forge.asn1.Asn1;
  try {
    tstInfoAsn1 = forge.asn1.fromDer(eContentValue);
  } catch (err) {
    return { ...empty, reason: `TSTInfo nicht dekodierbar: ${(err as Error).message}` };
  }

  // TSTInfo ::= SEQUENCE { version, policy, messageImprint, serialNumber, genTime, ... }
  // `fromDer` liefert die SEQUENCE selbst — ihre Kinder sind die Felder.
  const tstFields = children(node(tstInfoAsn1));
  if (tstFields.length < 5) return { ...empty, reason: 'TSTInfo-Struktur unerwartet' };

  const messageImprint = node(tstFields[2]);
  const serialValue = node(tstFields[3])?.value;
  const genTimeNode = node(tstFields[4]);

  // MessageImprint ::= SEQUENCE { hashAlgorithm AlgorithmIdentifier, hashedMessage OCTET STRING }
  const imprintChildren = children(messageImprint);
  const hashAlgOid = node(children(imprintChildren[0])[0])?.value;
  const hashedMessageOctets = imprintChildren[1]?.value;
  const messageImprintHex =
    typeof hashedMessageOctets === 'string'
      ? Buffer.from(hashedMessageOctets, 'binary').toString('hex')
      : null;

  const serialNumber =
    serialValue === undefined || serialValue === null ? null : String(serialValue);

  // forge liefert UTCTime/GeneralizedTime als String.
  const genTime = readAsn1TimeNode(genTimeNode);

  // TSA-Zertifikat: SignedData.certificates [0] IMPLICIT SET OF Certificate
  let tsaCommonName: string | null = null;
  let tsaNotBefore: Date | null = null;
  let tsaNotAfter: Date | null = null;
  for (const child of signedDataChildren) {
    // certificates ist [0] IMPLICIT → forge: tagClass CONTEXT_SPECIFIC, type 0.
    // Die übrigen Felder (version, digestAlgorithms, …) sind UNIVERSAL.
    const c = node(child);
    if (c?.tagClass === CONTEXT_SPECIFIC && c.type === 0) {
      const first = node(children(c)[0]);
      if (first) {
        const certInfo = readCertificateValidity(first);
        tsaCommonName = certInfo.cn;
        tsaNotBefore = certInfo.notBefore;
        tsaNotAfter = certInfo.notAfter;
      }
      break;
    }
  }

  return {
    genTime,
    serialNumber,
    hashAlgorithmOid: typeof hashAlgOid === 'string' ? hashAlgOid : null,
    messageImprintHex,
    tsaCommonName,
    tsaNotAfter,
    tsaNotBefore,
    parsed: true,
    ...(typeof hashAlgOid === 'string' && !KNOWN_HASH_OIDS.has(hashAlgOid)
      ? { reason: `Ungewöhnlicher Hash-Algorithmus ${hashAlgOid}` }
      : {}),
  };
}

/**
 * Vergleicht den von der TSA bestätigten Hash mit einem lokal berechneten Hash.
 *
 * Das ist die eigentliche kryptografische Bindung: die TSA bestätigt genau
 * diesen Hash. Stimmt er nicht mit dem Dokument überein, wurde ein anderes
 * Dokument zeitgestempelt.
 */
export function verifyMessageImprint(
  token: ParsedTimestamp,
  documentBytes: Buffer,
  expectedOid?: string | null,
): { matches: boolean; reason?: string } {
  if (!token.parsed) {
    return { matches: false, reason: token.reason ?? 'Token nicht lesbar' };
  }
  if (!token.messageImprintHex) {
    return { matches: false, reason: 'Token enthält kein messageImprint' };
  }
  if (expectedOid && token.hashAlgorithmOid && expectedOid !== token.hashAlgorithmOid) {
    return {
      matches: false,
      reason: `Algorithmus im Token (${token.hashAlgorithmOid}) weicht vom Dokument ab (${expectedOid})`,
    };
  }

  const algorithm = hashFunctionForOid(token.hashAlgorithmOid);
  if (!algorithm) {
    return {
      matches: false,
      reason: `Hash-Algorithmus ${String(token.hashAlgorithmOid)} wird nicht unterstützt`,
    };
  }
  const local = createHash(algorithm).update(documentBytes).digest('hex');
  const tokenHex = token.messageImprintHex.toLowerCase();
  if (local !== tokenHex) {
    return {
      matches: false,
      reason: `messageImprint stimmt nicht: Token ${tokenHex.slice(0, 16)}… vs. Dokument ${local.slice(0, 16)}…`,
    };
  }
  return { matches: true };
}

/**
 * Plausibilitätsprüfung des genTime.
 *
 * Ein Zeitstempel ist wertlos, wenn er in der Zukunft liegt (Uhrendrift oder
 * manipuliertes Token) oder älter als das Dokument selbst ist (der Zeitstempel
 * muss NACH der Signatur liegen).
 */
export function checkTimestampPlausibility(args: {
  genTime: Date | null;
  signedAt?: Date | null;
  tsaNotAfter?: Date | null;
  tsaNotBefore?: Date | null;
  now?: Date;
}): { plausible: boolean; reason?: string } {
  const now = args.now ?? new Date();
  if (!args.genTime) {
    return { plausible: false, reason: 'Token enthält keinen genTime' };
  }
  // Toleranz für Uhrenendrift zwischen Client und TSA.
  const futureToleranceMs = 5 * 60 * 1000;
  if (args.genTime.getTime() > now.getTime() + futureToleranceMs) {
    return { plausible: false, reason: 'genTime liegt in der Zukunft' };
  }
  if (args.signedAt && args.genTime.getTime() < args.signedAt.getTime() - futureToleranceMs) {
    return { plausible: false, reason: 'genTime liegt vor der Signatur' };
  }
  if (args.tsaNotAfter && args.genTime.getTime() > args.tsaNotAfter.getTime()) {
    return { plausible: false, reason: 'genTime liegt nach Ablauf des TSA-Zertifikats' };
  }
  if (args.tsaNotBefore && args.genTime.getTime() < args.tsaNotBefore.getTime()) {
    return { plausible: false, reason: 'genTime liegt vor Beginn der TSA-Zertifikatsgültigkeit' };
  }
  return { plausible: true };
}

function hashFunctionForOid(oid: string | null): string | null {
  switch (oid) {
    case '2.16.840.1.101.3.4.2.1':
      return 'sha256';
    case '2.16.840.1.101.3.4.2.2':
      return 'sha384';
    case '2.16.840.1.101.3.4.2.3':
      return 'sha512';
    case '1.3.14.3.2.26':
      return 'sha1';
    default:
      return null;
  }
}

/**
 * Kanonische Typ-Form.
 *
 * `node-forge` speichert nach `fromDer()` die Felder `tagClass`, `type`,
 * `constructed`, `composed` und `value` — NICHT `class`/`tag`. Die
 * @types-Definition ist zudem so schmal, dass die Struktur-Navigation
 * (`value[0]`) nicht abbildbar ist. Für das Parsen brauchen wir genau diese
 * Felder, also lokal eine Arbeitsdefinition, bewusst auf diese Datei begrenzt.
 */
type Asn1Node = {
  tagClass?: number;
  type?: number;
  constructed?: boolean;
  composed?: boolean;
  value?: unknown;
};

/** forge.asn1.Type.SEQUENCE */
const SEQUENCE = 16;
/** forge.asn1.Type.INTEGER */
const INTEGER = 2;

/**
 * Sucht den ersten Nachfahren (inklusive sich selbst) mit gegebener
 * Tag-Art. Beschränkt auf Universal-Tags, damit ein gleich nummerierter
 * Context-Tag nicht versehentlich getroffen wird.
 */
function findDescendantOfType(start: Asn1Node | null, type: number, depth = 0): Asn1Node | null {
  if (!start || depth > 12) return null;
  if (start.tagClass === UNIVERSAL && start.type === type) return start;
  for (const child of children(start)) {
    const found = findDescendantOfType(child, type, depth + 1);
    if (found) return found;
  }
  return null;
}

/** Wie `findDescendantOfType`, liefert aber direkt den Wert. */
function findDescendantValueOfType(start: Asn1Node | null, type: number): unknown {
  return findDescendantOfType(start, type)?.value;
}

/** forge.asn1.Class.UNIVERSAL */
const UNIVERSAL = 0;
/** forge.asn1.Class.CONTEXT_SPECIFIC */
const CONTEXT_SPECIFIC = 128;

function node(raw: unknown): Asn1Node | null {
  return raw !== null && typeof raw === 'object' ? (raw as Asn1Node) : null;
}

function children(raw: Asn1Node | null | undefined): Asn1Node[] {
  return Array.isArray(raw?.value) ? (raw.value as Asn1Node[]) : [];
}

/**
 * Normalisiert einen von forge gelieferten INTEGER-Wert zu einer Zahl.
 *
 * forge gibt INTEGER je nach Kontext als typisierten Buffer (Binärstring
 * mit High-Bit im ersten Byte), als Array von Bytewerten oder bereits als
 * Zahl zurück. Ohne Normalisierung würde `status === 0` nie greifen.
 */
function normalizeAsn1Integer(raw: unknown): number | null {
  if (typeof raw === 'number') return raw;
  const toNumber = (bytes: Buffer): number | null => {
    if (bytes.length === 0) return null;
    // Ein-/Zwei-Byte-INTEGER kommen häufig vor (Status 0/1). Deshalb wird
    // abhängig von der Länge gelesen statt fix 4 Bytes zu erwarten.
    if (bytes.length >= 4) return bytes.readUInt32BE(0);
    if (bytes.length === 3) return (bytes[0]! << 16) | (bytes[1]! << 8) | bytes[2]!;
    if (bytes.length === 2) return (bytes[0]! << 8) | bytes[1]!;
    return bytes[0]!;
  };
  if (typeof raw === 'string') {
    return toNumber(Buffer.from(raw, 'binary'));
  }
  if (Array.isArray(raw)) {
    const bytes = raw.filter((b): b is number => typeof b === 'number');
    if (bytes.length === 0) return null;
    // Byte-Array → Big-Endian-Integer
    return bytes.reduce((acc, b) => acc * 256 + b, 0);
  }
  if (raw && typeof raw === 'object' && 'byteLength' in raw) {
    // forge.util.ByteBuffer
    const buf = raw as unknown as { bytes: string };
    return toNumber(Buffer.from(buf.bytes, 'binary'));
  }
  return null;
}

/**
 * Liest CN und Gültigkeit aus einem DER-kodierten X.509-Zertifikat.
 *
 * Bewusst tolerant: ein Zertifikat, das wir nicht lesen, liefert `cn: null`
 * statt einen Absturz — der Aufrufer entscheidet dann fail-closed.
 *
 * Hier wird `forge.pki.certificateFromPem` über einen DER→PEM-Umbau genutzt
 * statt die ASN.1-Struktur von Hand zu navigieren. Die Hand-Navigation war
 * fehleranfällig (forge legt beim Parsen zusätzliche [0]-Ebenen an) und ist
 * an zwei Stellen schon still gescheitert — `certFromAsn1` ist die
 * unterstützte API und liefert validity/subject direkt.
 */
function readCertificateValidity(certAsn1: Asn1Node): {
  cn: string | null;
  notBefore: Date | null;
  notAfter: Date | null;
} {
  const result = {
    cn: null as string | null,
    notBefore: null as Date | null,
    notAfter: null as Date | null,
  };
  try {
    const der = Buffer.from(
      forge.asn1.toDer(certAsn1 as unknown as forge.asn1.Asn1).getBytes(),
      'binary',
    );
    const pem = der.toString('base64');
    const cert = forge.pki.certificateFromPem(
      `-----BEGIN CERTIFICATE-----\n${
        pem.match(/.{1,64}/g)?.join('\n') ?? pem
      }\n-----END CERTIFICATE-----\n`,
    );
    result.notBefore = cert.validity.notBefore ?? null;
    result.notAfter = cert.validity.notAfter ?? null;
    const attrs = cert.subject?.getField('CN') ?? cert.subject?.attributes[0];
    if (attrs && typeof attrs.value === 'string') result.cn = attrs.value;
  } catch {
    // tolerant: Felder bleiben null
  }
  return result;
}

function readAsn1TimeNode(raw: Asn1Node | null): Date | null {
  const value = raw?.value;
  if (typeof value !== 'string' || value.length === 0) return null;
  return parseAsn1Time(value);
}

/**
 * UTCTime (YYMMDDHHMMSSZ) und GeneralizedTime (YYYYMMDDHHMMSS[.fff]Z) → Date.
 */
function parseAsn1Time(raw: string): Date | null {
  try {
    const isGeneralized = raw.length > 13 || raw.startsWith('20');
    const body = raw.replace(/Z$/, '');
    const year = isGeneralized
      ? Number.parseInt(body.slice(0, 4), 10)
      : 2000 + Number.parseInt(body.slice(0, 2), 10);
    const month = Number.parseInt(body.slice(isGeneralized ? 4 : 2, isGeneralized ? 6 : 4), 10);
    const day = Number.parseInt(body.slice(isGeneralized ? 6 : 4, isGeneralized ? 8 : 6), 10);
    const hour = Number.parseInt(body.slice(isGeneralized ? 8 : 6, isGeneralized ? 10 : 8), 10);
    const minute = Number.parseInt(body.slice(isGeneralized ? 10 : 8, isGeneralized ? 12 : 10), 10);
    const second = Number.parseInt(body.slice(isGeneralized ? 12 : 10, isGeneralized ? 14 : 12), 10);
    if ([year, month, day, hour, minute, second].some((n) => Number.isNaN(n))) return null;
    return new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  } catch {
    return null;
  }
}
