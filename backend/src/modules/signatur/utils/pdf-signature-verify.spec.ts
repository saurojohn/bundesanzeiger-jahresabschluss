// Globals explizit importieren: die ESLint-Config fuer `src/` kennt die
// Vitest-Globals nicht (die e2e-Specs liegen ausserhalb von src/).
import { beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import PDFDocument from 'pdfkit';
import { plainAddPlaceholder } from '@signpdf/placeholder-plain';
import { P12Signer } from '@signpdf/signer-p12';
import signpdf from '@signpdf/signpdf';
import {
  assessCertificateTrust,
  verifyPdfSignature,
  type CertificateInfo,
} from './pdf-signature-verify';

/**
 * Tests der Signatur-Integritäts- und Zertifikatsprüfung.
 *
 * Abgedeckt sind die drei Behauptungen, die bis 2026-09-28 ungeprüft waren:
 *   1. Integrität: ByteRange/messageDigest/encryptedDigest (Runde 7 + 9)
 *   2. Zertifikatsgültigkeit — war hart kodiert `false` (Runde 2, §D.1)
 *   3. Ausstellervertrauen — war für jeden Issuer `true` (Runde 2, §D.1)
 */

const P12_PATH = './tmp/test-certs/test-token.p12';
const P12_PASSWORD = 'Test1234!';

let signedPdf: Buffer;

beforeAll(async () => {
  if (!existsSync(P12_PATH)) {
    throw new Error(
      `Test-P12 fehlt: ${P12_PATH} — erzeuge es mit \`npx ts-node scripts-gen-test-p12.ts\``,
    );
  }
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<void>((r) => doc.on('end', () => r()));
  doc.fontSize(18).text('Bundesanzeiger Jahresabschluss', { align: 'center' });
  for (let i = 0; i < 25; i += 1) doc.fontSize(10).text(`Position ${i}: ${(i + 1) * 100} EUR`);
  doc.end();
  await done;

  const p12 = readFileSync(P12_PATH);
  const placeholder = plainAddPlaceholder({
    pdfBuffer: Buffer.concat(chunks),
    reason: 'GoBD-Test',
    contactInfo: 'test@example.de',
    name: 'Test',
    location: 'DE',
    signingTime: new Date(),
    subFilter: 'adbe.pkcs7.detached',
  });
  signedPdf = await signpdf.sign(placeholder, new P12Signer(p12, { passphrase: P12_PASSWORD }));
}, 60_000);

// -----------------------------------------------------------------------------
describe('Kryptografische Integrität', () => {
  it('erkennt eine gültige Signatur', () => {
    const r = verifyPdfSignature(signedPdf);
    expect(r.verified).toBe(true);
    expect(r.cryptographic).toBe(true);
  });

  it('liest Signierer und Gültigkeit aus dem Zertifikat', () => {
    const cert = verifyPdfSignature(signedPdf).certificate;
    expect(cert).toBeDefined();
    expect(cert!.subject).toContain('Test-Signer');
    expect(new Date(cert!.notAfter).getTime()).toBeGreaterThan(Date.now());
  });

  it('erkennt eine Manipulation im signierten Bereich (9 Positionen)', () => {
    let erkannt = 0;
    for (const pos of [50, 200, 900, 1800, 2600, 4000, 7000, 12000, 18000]) {
      const m = Buffer.from(signedPdf);
      m[pos] = (m[pos]! ^ 0xff) & 0xff;
      if (!verifyPdfSignature(m).verified) erkannt += 1;
    }
    expect(erkannt, 'alle Einzelmanipulationen müssen auffallen').toBe(9);
  });

  it('erkennt angehängte Bytes außerhalb der signierten Bereiche', () => {
    const appended = Buffer.concat([signedPdf, Buffer.from('\n%% angehängt\n', 'utf-8')]);
    const r = verifyPdfSignature(appended);
    expect(r.verified).toBe(false);
    expect(r.reason).toMatch(/angehängt|entfernt/);
  });

  it('erkennt abgeschnittene Bytes', () => {
    const r = verifyPdfSignature(signedPdf.subarray(0, signedPdf.length - 60));
    expect(r.verified).toBe(false);
  });

  it('weist den Bypass „Inhalt ändern + messageDigest neu berechnen" ab', () => {
    // Der Angriff aus Runde 8: Inhalt ändern und den messageDigest neu
    // berechnen. Ohne Prüfung von encryptedDigest wäre das durchgegangen.
    const text = signedPdf.toString('latin1');
    const hexStart = text.indexOf('/Contents <') + '/Contents <'.length;
    const slot = Buffer.from(text.slice(hexStart, hexStart + 16384), 'hex');
    const mdOid = Buffer.from([0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x09, 0x04]);
    const digestOffset = slot.indexOf(mdOid) + mdOid.length + 4;
    const br = text
      .match(/\/ByteRange\s*\[\s*\d+\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/)!
      .slice(1)
      .map(Number);

    const tampered = Buffer.from(signedPdf);
    tampered[600] = (tampered[600]! ^ 0xff) & 0xff;
    const newDigest = createHash('sha256')
      .update(Buffer.concat([tampered.subarray(0, br[0]!), tampered.subarray(br[1]!, br[1]! + br[2]!)]))
      .digest();
    tampered.write(newDigest.toString('hex'), hexStart + digestOffset * 2, 'latin1');

    // messageDigest passt jetzt — die RSA-Signatur über signedAttrs nicht.
    expect(verifyPdfSignature(tampered).cryptographic).toBe(false);
  });
});

// -----------------------------------------------------------------------------
describe('Zertifikats-Vertrauensbewertung', () => {
  const base: CertificateInfo = {
    subject: 'CN=Steuerberater Müller, O=Kanzlei Muster GmbH, C=DE',
    issuer: 'CN=Bundesamt für Steuerberatung, O=BfSt, C=DE',
    notBefore: '2026-01-01T00:00:00.000Z',
    notAfter: '2027-01-01T00:00:00.000Z',
    selfSigned: false,
    isCa: false,
    keyUsageDigitalSignature: true,
    keyUsageNonRepudiation: true,
    keyUsageKeyCertSign: false,
    emails: ['mueller@kanzlei-muster.test'],
    sha256Fingerprint: 'A'.repeat(64),
  };

  it('akzeptiert ein gültiges, vertrauenswürdiges Zertifikat', () => {
    const t = assessCertificateTrust(base, {
      trustedIssuers: ['Bundesamt für Steuerberatung'],
      now: new Date('2026-06-01T00:00:00Z'),
    });
    expect(t.trusted).toBe(true);
    expect(t.certificateExpired).toBe(false);
  });

  it('weist ein abgelaufenes Zertifikat ab', () => {
    const t = assessCertificateTrust(base, {
      trustedIssuers: ['Bundesamt für Steuerberatung'],
      now: new Date('2028-01-01T00:00:00Z'),
    });
    expect(t.certificateExpired).toBe(true);
    expect(t.trusted).toBe(false);
  });

  it('weist ein noch nicht gültiges Zertifikat ab', () => {
    const t = assessCertificateTrust(base, {
      trustedIssuers: ['Bundesamt für Steuerberatung'],
      now: new Date('2025-06-01T00:00:00Z'),
    });
    expect(t.notYetValid).toBe(true);
    expect(t.trusted).toBe(false);
  });

  it('weist ein Zertifikat ohne Signatur-KeyUsage ab', () => {
    const t = assessCertificateTrust(
      { ...base, keyUsageDigitalSignature: false, keyUsageNonRepudiation: false },
      { trustedIssuers: ['Bundesamt'] },
    );
    expect(t.keyUsageOk).toBe(false);
    expect(t.trusted).toBe(false);
  });

  it('weist ein CA-Zertifikat als Signaturzertifikat ab', () => {
    const t = assessCertificateTrust({ ...base, isCa: true }, { trustedIssuers: ['Bundesamt'] });
    expect(t.trusted).toBe(false);
    expect(t.reason).toMatch(/CA/);
  });

  it('weist ein selbstsigniertes Zertifikat ab (Default: fail-closed)', () => {
    const t = assessCertificateTrust(
      { ...base, issuer: base.subject, selfSigned: true },
      { trustedIssuers: ['Muster GmbH'] },
    );
    expect(t.trusted).toBe(false);
    expect(t.reason).toMatch(/selbstsigniert/i);
  });

  it('lässt selbstsignierte Zertifikate nur auf ausdrückliche Freigabe zu', () => {
    const t = assessCertificateTrust(
      { ...base, issuer: base.subject, selfSigned: true },
      { allowSelfSigned: true },
    );
    expect(t.trusted).toBe(true);
  });

  it('erkennt keinen Aussteller, wenn keine Vertrauensliste hinterlegt ist', () => {
    const t = assessCertificateTrust(base, {});
    expect(t.trusted).toBe(false);
    expect(t.reason).toMatch(/keine Liste/i);
  });

  it('erkennt einen Aussteller, der nicht auf der Liste steht', () => {
    const t = assessCertificateTrust(base, { trustedIssuers: ['Andere Stelle'] });
    expect(t.trusted).toBe(false);
    expect(t.reason).toMatch(/Vertrauensliste/);
  });

  it('erkennt die Identität über die SAN-E-Mail', () => {
    const ok = assessCertificateTrust(base, {
      expectedSignerEmail: 'mueller@kanzlei-muster.test',
      trustedIssuers: ['Bundesamt'],
    });
    expect(ok.trusted).toBe(true);
  });

  it('erkennt eine falsche Identität', () => {
    const wrong = assessCertificateTrust(base, {
      expectedSignerEmail: 'jemand.anders@example.de',
      trustedIssuers: ['Bundesamt'],
    });
    expect(wrong.trusted).toBe(false);
  });

  it('normalisiert Umlaute im Subject-Namensabgleich', () => {
    // Ohne SAN bleibt nur der Subject-Text. "Müller" muss dabei zu "Mueller"
    // werden — sonst findet der Abgleich deutsche Namen nicht.
    const ohneSan = assessCertificateTrust(
      { ...base, emails: [] },
      { expectedSignerEmail: 'mueller', trustedIssuers: ['Bundesamt'] },
    );
    expect(ohneSan.trusted).toBe(true);
  });

  it('erkennt eine Abweichung auch ohne SAN', () => {
    const falsch = assessCertificateTrust(
      { ...base, emails: [] },
      { expectedSignerEmail: 'schmidt', trustedIssuers: ['Bundesamt'] },
    );
    expect(falsch.trusted).toBe(false);
  });

  it('bewertet das echte Test-Zertifikat als nicht vertrauenswürdig', () => {
    const cert = verifyPdfSignature(signedPdf).certificate!;
    const t = assessCertificateTrust(cert, { trustedIssuers: [] });
    expect(t.trusted).toBe(false);
    expect(t.selfSigned).toBe(true);
    // Der Integritätsnachweis bleibt davon unberührt
    expect(verifyPdfSignature(signedPdf).cryptographic).toBe(true);
  });
});
