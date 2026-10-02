import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, sign as cryptoSign } from 'node:crypto';
import forge from 'node-forge';
import {
  parseTimestampToken,
  checkTimestampPlausibility,
  verifyMessageImprint,
  verifyTimestampSignature,
  type ParsedTimestamp,
} from './timestamp-token.parser';

/**
 * Tests für den RFC-3161-Token-Parser (M4 Sprint 6).
 *
 * Wichtig: Es gibt KEINE echten TSA-Antworten im Test — die würden einen
 * externen Dienst brauchen. Stattdessen wird hier ein Token vollständig
 * synthetisch aufgebaut (TSTInfo + SignedData + Zertifikat). Damit ist der
 * Pfad "Bytes → ausgewertete Felder" real getestet, nicht nur die
 * Fehlerbehandlung.
 *
 * Die kryptografische Signatur des Tokens wird bewusst NICHT erzeugt — sie
 * wird ohnehin nicht geprüft (siehe `parseTimestampToken`-Doku).
 */

const OID_SHA256 = '2.16.840.1.101.3.4.2.1';
const OID_SIGNED_DATA = '1.2.840.113549.1.7.2';
const OID_CT_TST_INFO = '1.2.840.113549.1.9.16.1.4';

/**
 * `forge.asn1.Type` kennt im @types-Paket kein OBJECT_IDENTIFIER, und
 * `forge.asn1.create` verlangt für den Wert `string | Asn1[]`, während
 * `forge.util.hexToBytes` einen ByteStringBuffer liefert. Beides wird hier
 * bewusst über einen schmalen Cast gelöst — der Test baut Testdaten, keine
 * produktiven Eingaben.
 */
const T_OID = 6;
type ForgeCreate = (
  cls: number,
  type: number,
  constructed: boolean,
  value: unknown,
) => forge.asn1.Asn1;
const createAsn1 = forge.asn1.create as unknown as ForgeCreate;

/**
 * Baut ein ASN.1-INTEGER mit korrekter DER-Kodierung.
 *
 * Wichtig: DER-INTEGER 0 ist das BYTE 0x00, nicht der ASCII-String "0"
 * (0x30). `forge.util.createBuffer('0')` erzeugt 0x30 und damit per
 * Zufall einen anderen Wert — deshalb hier explizit.
 */
function intNode(value: number): forge.asn1.Asn1 {
  return createAsn1(
    forge.asn1.Class.UNIVERSAL,
    forge.asn1.Type.INTEGER,
    false,
    String.fromCharCode(value),
  );
}

/** Baut ein selbstsigniertes Zertifikat mit CN und Gültigkeit. */
function buildSelfSignedCert(opts: {
  commonName: string;
  notBefore: Date;
  notAfter: Date;
}): { der: string; publicKey: forge.pki.rsa.PublicKey } {
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = opts.notBefore;
  cert.validity.notAfter = opts.notAfter;
  const attrs = [{ name: 'commonName', value: opts.commonName }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return {
    der: forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes(),
    publicKey: keys.publicKey,
  };
}

/** Baut ein syntaktisch vollständiges, aber nicht kryptografisch signiertes TimeStampResp. */
function buildTimeStampResp(opts: {
  messageImprintHex: string;
  serialNumber: string;
  genTime: Date;
  tsaCertDer: string;
  status?: number;
}): Buffer {
  const genTimeStr =
    `${String(opts.genTime.getUTCFullYear()).padStart(4, '0')}` +
    `${String(opts.genTime.getUTCMonth() + 1).padStart(2, '0')}` +
    `${String(opts.genTime.getUTCDate()).padStart(2, '0')}` +
    `${String(opts.genTime.getUTCHours()).padStart(2, '0')}` +
    `${String(opts.genTime.getUTCMinutes()).padStart(2, '0')}` +
    `${String(opts.genTime.getUTCSeconds()).padStart(2, '0')}Z`;

  // TSTInfo
  const tstInfo = createAsn1(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
    createAsn1(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.INTEGER, false, forge.util.createBuffer('1')),
    createAsn1(forge.asn1.Class.UNIVERSAL, T_OID, false, OID_CT_TST_INFO),
    // messageImprint
    createAsn1(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
      createAsn1(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
        createAsn1(forge.asn1.Class.UNIVERSAL, T_OID, false, OID_SHA256),
        createAsn1(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.NULL, false, ''),
      ]),
      createAsn1(
        forge.asn1.Class.UNIVERSAL,
        forge.asn1.Type.OCTETSTRING,
        false,
        Buffer.from(opts.messageImprintHex, 'hex').toString('binary'),
      ),
    ]),
    // serialNumber (INTEGER)
    createAsn1(
      forge.asn1.Class.UNIVERSAL,
      forge.asn1.Type.INTEGER,
      false,
      String.fromCharCode(...Buffer.from(opts.serialNumber, 'utf8')),
    ),
    // genTime (GeneralizedTime)
    createAsn1(
      forge.asn1.Class.UNIVERSAL,
      forge.asn1.Type.GENERALIZEDTIME,
      false,
      genTimeStr,
    ),
  ]);
  const tstInfoDer = forge.asn1.toDer(tstInfo).getBytes();

  // SignedData (ohne echte Signatur — der Parser prüft sie ohnehin nicht)
  const signedData = createAsn1(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
    createAsn1(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.INTEGER, false, forge.util.createBuffer('3')),
    // digestAlgorithms
    createAsn1(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, [
      createAsn1(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
        createAsn1(forge.asn1.Class.UNIVERSAL, T_OID, false, OID_SHA256),
        createAsn1(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.NULL, false, ''),
      ]),
    ]),
    // encapContentInfo
    createAsn1(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
      createAsn1(forge.asn1.Class.UNIVERSAL, T_OID, false, OID_CT_TST_INFO),
      createAsn1(forge.asn1.Class.CONTEXT_SPECIFIC, 0, true, [
        createAsn1(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.OCTETSTRING, false, tstInfoDer),
      ]),
    ]),
    // certificates [0] IMPLICIT
    createAsn1(forge.asn1.Class.CONTEXT_SPECIFIC, 0, true, [
      forge.asn1.fromDer(forge.util.createBuffer(opts.tsaCertDer)),
    ]),
    // signerInfos
    createAsn1(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, []),
  ]);

  // ContentInfo
  const contentInfo = createAsn1(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
    createAsn1(forge.asn1.Class.UNIVERSAL, T_OID, false, OID_SIGNED_DATA),
    createAsn1(forge.asn1.Class.CONTEXT_SPECIFIC, 0, true, [signedData]),
  ]);

  // TimeStampResp
  const statusValue = opts.status ?? 0;
  const resp = createAsn1(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
    createAsn1(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
      createAsn1(forge.asn1.Class.CONTEXT_SPECIFIC, 0, true, [
        intNode(statusValue),
      ]),
    ]),
    contentInfo,
  ]);

  return Buffer.from(forge.asn1.toDer(resp).getBytes(), 'binary');
}

describe('parseTimestampToken', () => {
  const cert = buildSelfSignedCert({
    commonName: 'Test-TSA DigiStamp',
    notBefore: new Date('2020-01-01T00:00:00Z'),
    notAfter: new Date('2030-01-01T00:00:00Z'),
  });

  it('liest genTime, serialNumber, Hash-OID und messageImprint aus einem Token', () => {
    const docHash = createHash('sha256').update('Jahresabschluss 2025').digest('hex');
    const genTime = new Date('2026-03-15T10:30:00Z');
    const token = buildTimeStampResp({
      messageImprintHex: docHash,
      serialNumber: '4711',
      genTime,
      tsaCertDer: cert.der,
    });

    const parsed = parseTimestampToken(token);

    expect(parsed.parsed, `REASON: ${String(parsed.reason)}`).toBe(true);
    expect(parsed.genTime?.toISOString()).toBe(genTime.toISOString());
    expect(parsed.serialNumber).toBe('4711');
    expect(parsed.hashAlgorithmOid).toBe(OID_SHA256);
    expect(parsed.messageImprintHex).toBe(docHash);
  });

  it('liest den Common Name aus dem TSA-Zertifikat, NICHT aus der URL', () => {
    const token = buildTimeStampResp({
      messageImprintHex: 'ab'.repeat(32),
      serialNumber: '1',
      genTime: new Date('2026-01-01T00:00:00Z'),
      tsaCertDer: cert.der,
    });

    const parsed = parseTimestampToken(token);

    expect(parsed.tsaCommonName).toBe('Test-TSA DigiStamp');
  });

  it('liest die Gültigkeit des TSA-Zertifikats', () => {
    const token = buildTimeStampResp({
      messageImprintHex: 'cd'.repeat(32),
      serialNumber: '1',
      genTime: new Date('2026-01-01T00:00:00Z'),
      tsaCertDer: cert.der,
    });

    const parsed = parseTimestampToken(token);

    expect(parsed.tsaNotBefore?.getUTCFullYear()).toBe(2020);
    expect(parsed.tsaNotAfter?.getUTCFullYear()).toBe(2030);
  });

  it('meldet eine Ablehnung der TSA statt Werte zu liefern', () => {
    const token = buildTimeStampResp({
      messageImprintHex: 'ef'.repeat(32),
      serialNumber: '1',
      genTime: new Date('2026-01-01T00:00:00Z'),
      tsaCertDer: cert.der,
      status: 2, // rejection
    });

    const parsed = parseTimestampToken(token);

    expect(parsed.parsed).toBe(false);
    expect(parsed.reason).toMatch(/Ablehnung/);
    expect(parsed.genTime).toBeNull();
  });

  it('lehnt zu kurze Eingaben ab, ohne zu werfen', () => {
    const parsed = parseTimestampToken(Buffer.alloc(4));
    expect(parsed.parsed).toBe(false);
    expect(parsed.reason).toBeTruthy();
  });

  it('lehnt beliebige Bytes ab, ohne zu werfen', () => {
    const parsed = parseTimestampToken(Buffer.from('kein DER', 'utf8'));
    expect(parsed.parsed).toBe(false);
    expect(parsed.reason).toBeTruthy();
  });
});

describe('verifyMessageImprint', () => {
  const base: ParsedTimestamp = {
    genTime: new Date(),
    serialNumber: '1',
    hashAlgorithmOid: OID_SHA256,
    messageImprintHex: null,
    tsaCommonName: null,
    tsaNotBefore: null,
    tsaNotAfter: null,
    parsed: true,
  };

  it('bestätigt, wenn der Token-Hash zum Dokument passt', () => {
    const doc = Buffer.from('Jahresabschluss');
    const hash = createHash('sha256').update(doc).digest('hex');
    const result = verifyMessageImprint({ ...base, messageImprintHex: hash }, doc);
    expect(result.matches).toBe(true);
  });

  it('weist ein anderes Dokument zurück', () => {
    const signed = Buffer.from('Jahresabschluss 2025');
    const other = Buffer.from('Jahresabschluss 2024');
    const hash = createHash('sha256').update(signed).digest('hex');
    const result = verifyMessageImprint({ ...base, messageImprintHex: hash }, other);
    expect(result.matches).toBe(false);
    expect(result.reason).toMatch(/messageImprint stimmt nicht/);
  });

  it('weist einen unbekannten Hash-Algorithmus zurück', () => {
    const doc = Buffer.from('x');
    const result = verifyMessageImprint(
      { ...base, hashAlgorithmOid: '1.2.3.4', messageImprintHex: 'ab'.repeat(32) },
      doc,
    );
    expect(result.matches).toBe(false);
    expect(result.reason).toMatch(/nicht unterstützt/);
  });

  it('weist einen unlesbaren Token zurück', () => {
    const result = verifyMessageImprint({ ...base, parsed: false }, Buffer.from('x'));
    expect(result.matches).toBe(false);
  });
});

describe('checkTimestampPlausibility', () => {
  it('akzeptiert einen plausiblen Zeitpunkt', () => {
    const result = checkTimestampPlausibility({ genTime: new Date('2026-01-01T12:00:00Z') });
    expect(result.plausible).toBe(true);
  });

  it('weist einen Zeitpunkt in der Zukunft ab', () => {
    const future = new Date(Date.now() + 60 * 60 * 1000);
    const result = checkTimestampPlausibility({ genTime: future });
    expect(result.plausible).toBe(false);
    expect(result.reason).toMatch(/Zukunft/);
  });

  it('weist einen Zeitpunkt vor der Signatur ab', () => {
    const result = checkTimestampPlausibility({
      genTime: new Date('2026-01-01T10:00:00Z'),
      signedAt: new Date('2026-01-01T11:00:00Z'),
    });
    expect(result.plausible).toBe(false);
    expect(result.reason).toMatch(/vor der Signatur/);
  });

  it('weist einen Zeitpunkt nach Ablauf des TSA-Zertifikats ab', () => {
    const result = checkTimestampPlausibility({
      genTime: new Date('2031-01-01T00:00:00Z'),
      tsaNotAfter: new Date('2030-01-01T00:00:00Z'),
      now: new Date('2031-06-01T00:00:00Z'),
    });
    expect(result.plausible).toBe(false);
    expect(result.reason).toMatch(/TSA-Zertifikat/);
  });

  it('weist einen fehlenden Zeitpunkt ab', () => {
    const result = checkTimestampPlausibility({ genTime: null });
    expect(result.plausible).toBe(false);
    expect(result.reason).toMatch(/keinen genTime/);
  });
});

// ============================================================================
// Kryptografische TSA-Signatur (verifyTimestampSignature)
// ============================================================================

const OID_SHA256_RSA = '1.2.840.113549.1.1.11'; // sha256WithRSAEncryption

/**
 * Erzeugt ein RFC-3161-Token mit **echter RSA-Signatur** der TSA über das
 * encapContentInfo. Belegt, dass `verifyTimestampSignature` eine gültige
 * Signatur annimmt und eine manipulierte ablehnt.
 */
function buildSignedTimeStampResp(opts: {
  messageImprintHex: string;
  genTime: Date;
  /** DER des TSA-Zertifikats als Binärstring (von forge erzeugt). */
  tsaCertDer: string;
  tsaPrivateKeyPem: string;
  /** Optional: den signierten Byte-Strom NACH der Signatur verändern. */
  tamperPayload?: (der: string) => string;
  /** Optional: zusätzlich die Signaturbytes verändern. */
  tamperSignature?: (sig: string) => string;
}): Buffer {
  const genTimeStr =
    `${String(opts.genTime.getUTCFullYear()).padStart(4, '0')}` +
    `${String(opts.genTime.getUTCMonth() + 1).padStart(2, '0')}` +
    `${String(opts.genTime.getUTCDate()).padStart(2, '0')}` +
    `${String(opts.genTime.getUTCHours()).padStart(2, '0')}` +
    `${String(opts.genTime.getUTCMinutes()).padStart(2, '0')}` +
    `${String(opts.genTime.getUTCSeconds()).padStart(2, '0')}Z`;

  const tstInfo = createAsn1(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
    createAsn1(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.INTEGER, false, forge.util.createBuffer('1')),
    createAsn1(forge.asn1.Class.UNIVERSAL, T_OID, false, OID_CT_TST_INFO),
    createAsn1(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
      createAsn1(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
        createAsn1(forge.asn1.Class.UNIVERSAL, T_OID, false, OID_SHA256),
        createAsn1(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.NULL, false, ''),
      ]),
      createAsn1(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.OCTETSTRING, false,
        Buffer.from(opts.messageImprintHex, 'hex').toString('binary')),
    ]),
    createAsn1(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.INTEGER, false, forge.util.createBuffer('7')),
    createAsn1(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.GENERALIZEDTIME, false, genTimeStr),
  ]);

  // encapContentInfo — genau dieser Byte-Strom wird signiert.
  const encap = createAsn1(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
    createAsn1(forge.asn1.Class.UNIVERSAL, T_OID, false, OID_CT_TST_INFO),
    createAsn1(forge.asn1.Class.CONTEXT_SPECIFIC, 0, true, [
      createAsn1(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.OCTETSTRING, false,
        forge.asn1.toDer(tstInfo).getBytes()),
    ]),
  ]);
  let encapDer = forge.asn1.toDer(encap).getBytes();

  // Echte RSA/SHA-256-Signatur über den Byte-Strom.
  // WICHTIG: die Manipulation erfolgt NACH der Signatur — sonst würde über
  // die manipulierten Daten korrekt signiert und die Signatur wäre gültig.
  // Genau das muss die Prüfung abfangen.
  // Signatur-Bytes: forge erwartet bei OCTETSTRING einen Binärstring —
  // jeder Byte ist ein Zeichen im Bereich 0-255. Buffer→Binärstring
  // konvertiert, statt über String.fromCharCode (verliert Bytes > 255).
  const signatureBuf = cryptoSign('sha256', Buffer.from(encapDer, 'binary'), opts.tsaPrivateKeyPem);
  let signature = signatureBuf.toString('latin1');

  // Nachsignierte Manipulation: das letzte Byte des signierten Stroms
  // umkippen. Die Signatur deckt den ursprünglichen Strom ab, das Token
  // enthält aber einen anderen.
  if (opts.tamperPayload) {
    encapDer = opts.tamperPayload(encapDer);
    signature = opts.tamperSignature
      ? opts.tamperSignature(signature)
      : signature;
  }

  // SignedData mit SignerInfo
  const signerInfo = createAsn1(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
    createAsn1(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.INTEGER, false, String.fromCharCode(1)),
    createAsn1(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
      createAsn1(forge.asn1.Class.UNIVERSAL, T_OID, false, '1.2.840.113549.1.1.5'),
      createAsn1(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.INTEGER, false, String.fromCharCode(1)),
    ]),
    createAsn1(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
      createAsn1(forge.asn1.Class.UNIVERSAL, T_OID, false, OID_SHA256),
      createAsn1(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.NULL, false, ''),
    ]),
    createAsn1(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
      createAsn1(forge.asn1.Class.UNIVERSAL, T_OID, false, OID_SHA256_RSA),
      createAsn1(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.NULL, false, ''),
    ]),
    createAsn1(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.OCTETSTRING, false, signature),
  ]);

  // `encap` per DER neu einlesen: dersel forge-Knoten darf nicht an zwei
  // Stellen desselben Baums stehen.
  const encapClone = forge.asn1.fromDer(forge.util.createBuffer(encapDer));

  const signedData = createAsn1(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
    createAsn1(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.INTEGER, false, String.fromCharCode(3)),
    createAsn1(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, [
      createAsn1(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
        createAsn1(forge.asn1.Class.UNIVERSAL, T_OID, false, OID_SHA256),
        createAsn1(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.NULL, false, ''),
      ]),
    ]),
    encapClone,
    createAsn1(forge.asn1.Class.CONTEXT_SPECIFIC, 0, true, [
      forge.asn1.fromDer(forge.util.createBuffer(opts.tsaCertDer)),
    ]),
    createAsn1(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, [signerInfo]),
  ]);

  const contentInfo = createAsn1(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
    createAsn1(forge.asn1.Class.UNIVERSAL, T_OID, false, OID_SIGNED_DATA),
    createAsn1(forge.asn1.Class.CONTEXT_SPECIFIC, 0, true, [signedData]),
  ]);

  const resp = createAsn1(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
    createAsn1(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
      createAsn1(forge.asn1.Class.CONTEXT_SPECIFIC, 0, true, [
        createAsn1(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.INTEGER, false, String.fromCharCode(0)),
      ]),
    ]),
    contentInfo,
  ]);
  return Buffer.from(forge.asn1.toDer(resp).getBytes(), 'binary');
}

describe('verifyTimestampSignature', () => {
  /**
   * Echtes, selbstsigniertes X.509-Zertifikat.
   *
   * Bewusst über `openssl` und nicht über forge: ein aus forge-JWK
   * gebautes Zertifikat serialisiert den Modulus ohne führendes NUL-Byte
   * und wird von `node:crypto.createPublicKey` als ANDERER Schlüssel
   * gelesen — die Signaturprüfung schlägt dann aus einem
   * Fixture-Grund fehl. `openssl` liefert ein Zertifikat, das forge und
   * node:crypto übereinstimmend lesen.
   */
  const CERT_CN = 'TSA-Test GmbH';
  const genDir = mkdtempSync(join(tmpdir(), 'banz-tsa-'));
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048',
    '-keyout', join(genDir, 'key.pem'),
    '-out', join(genDir, 'cert.pem'),
    '-days', '365', '-nodes',
    '-subj', `/CN=${CERT_CN}`,
  ], { stdio: 'pipe' });
  const tsaPrivateKeyPem = readFileSync(join(genDir, 'cert.pem'), 'utf8')
    .includes('PRIVATE') ? '' : readFileSync(join(genDir, 'key.pem'), 'utf8');
  const tsaCertDer = Buffer.from(
    readFileSync(join(genDir, 'cert.pem'), 'utf8')
      .replace(/-----[^-]+-----/g, '')
      .replace(/\s+/g, ''),
    'base64',
  ).toString('latin1');

  const imprint = 'ab'.repeat(32);

  it('erkennt eine gültige Signatur bei vertrauenswürdigem Aussteller', () => {
    const token = parseTimestampToken(
      buildSignedTimeStampResp({
        messageImprintHex: imprint,
        genTime: new Date('2026-03-15T10:30:00Z'),
        tsaCertDer,
        tsaPrivateKeyPem,
      }),
    );
    expect(token.parsed).toBe(true);
    expect(token.tsaSignature).toBeTruthy();

    const result = verifyTimestampSignature(token, {
      trustedIssuers: [CERT_CN],
    });
    expect(result.trusted).toBe(true);
    expect(result.valid).toBe(true);
  });

  it('weist einen nicht vertrauten Aussteller ab (fail-closed)', () => {
    const token = parseTimestampToken(
      buildSignedTimeStampResp({
        messageImprintHex: imprint,
        genTime: new Date('2026-03-15T10:30:00Z'),
        tsaCertDer,
        tsaPrivateKeyPem,
      }),
    );
    const result = verifyTimestampSignature(token, { trustedIssuers: [] });
    expect(result.valid).toBe(false);
    expect(result.trusted).toBe(false);
    expect(result.reason).toMatch(/fail-closed/);
  });

  it('erkennt eine manipulierte Signatur', () => {
    const token = parseTimestampToken(
      buildSignedTimeStampResp({
        messageImprintHex: imprint,
        genTime: new Date('2026-03-15T10:30:00Z'),
        tsaCertDer,
        tsaPrivateKeyPem,
        // Das letzte Byte des signierten Stroms umkippen (z. B. 0x00 → 0x01).
        // Das ergibt gültiges DER, aber eine falsche Signatur — genau der
        // Fall, den die Prüfung abfangen muss.
        tamperPayload: (der) => der.slice(0, -1) + (der.endsWith('\u0000') ? '\u0001' : '\u0000'),
      }),
    );
    const result = verifyTimestampSignature(token, {
      trustedIssuers: [CERT_CN],
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/Signaturprüfung fehlgeschlagen/);
  });
});
