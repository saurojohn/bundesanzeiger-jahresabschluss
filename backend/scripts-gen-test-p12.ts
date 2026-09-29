/**
 * Erzeugt ein TEST-P12 (selbstsigniert) fuer die e2e-Suite.
 *
 * Warum: `signatur.e2e.spec.ts` laedt `./tmp/test-certs/test-token.p12` und
 * fiel bei fehlender Datei still auf `dummy-p12-bytes` zurueck. Alle
 * Signatur-Tests nahmen daraufhin 400/500 an und wurden gruen, ohne dass der
 * Signierpfad je ausgefuehrt wurde — 7 der 137 Tests prueften nichts.
 *
 * ACHTUNG: Das ist KEIN qualifiziertes Signaturzertifikat (keine qeS). Es
 * belegt, dass der Code-Pfad laeuft — nicht die rechtliche Gueltigkeit.
 * Fuer einen BAnz-Einreichungsbetrieb ist ein echtes, von einer
 * qualifizierten Stelle ausgestelltes Token erforderlich.
 *
 * Aufruf: npx ts-node scripts-gen-test-p12.ts
 */
import forge from 'node-forge';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT_DIR = join(process.cwd(), 'tmp', 'test-certs');
const OUT_FILE = join(OUT_DIR, 'test-token.p12');
const PASSWORD = 'Test1234!';

function main(): void {
  console.log('[p12] erzeuge selbstsigniertes Test-Token …');
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 24 * 3600 * 1000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 24 * 3600 * 1000);

  const attrs = [
    { name: 'commonName', value: 'Bundesanzeiger Test-Signer' },
    { name: 'organizationName', value: 'Bundesanzeiger Jahresabschluss (TEST)' },
    { name: 'countryName', value: 'DE' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, nonRepudiation: true },
    // subjectAltName mit E-Mail: Bei qualifizierten Zertifikaten steht die
    // Signierer-Identitaet dort, nicht im CN. Der Signaturpfad prueft
    // bevorzugt die SAN.
    {
      name: 'subjectAltName',
      altNames: [
        { type: 6, value: 'https://bundesanzeiger-jahresabschluss.test' },
        { type: 1, value: 'signer@bundesanzeiger-jahresabschluss.test' },
      ],
    },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(
    keys.privateKey,
    [cert],
    PASSWORD,
    { algorithm: '3des' },
  );
  const p12Der = forge.asn1.toDer(p12Asn1).getBytes();

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_FILE, Buffer.from(p12Der, 'binary'));
  console.log(`[p12] geschrieben: ${OUT_FILE} (${p12Der.length} bytes), Passwort: ${PASSWORD}`);
}

main();
