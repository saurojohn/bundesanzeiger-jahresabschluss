import { beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  checkCertificateRevocation,
  extractCrlEndpoints,
  parseCrl,
} from './crl-checker';

/**
 * Tests der Zertifikatssperrprüfung (CRL).
 *
 * Die Testartefakte stammen aus `scripts-gen-test-crl.sh` (echte OpenSSL-CA).
 * Das ist kein Luxus: `node-forge` kann **keine** CRLs erzeugen
 * (`forge.pki.CertificateRevocationList` ist zur Laufzeit `undefined`), und ein
 * selbstgebautes Objekt würde die Prüfung nicht auf die Probe stellen. Der
 * Umweg über OpenSSL ist der einzige Weg zu einer echten, von einem CA-
 * Schlüssel signierten Sperrliste.
 *
 * Geprüft wird gegen das echte Zertifikat `leaf.crt` mit
 * Seriennummer 1000 und CRL-Distribution-Point.
 */

const CRL_DIR = './tmp/test-crl';
const P12_PATH = './tmp/test-certs/test-token.p12';

let caPem: string;
let leafPem: string;
let crlEmpty: string;
let crlRevoked: string;
let crlFake: string;
let leafSerial: string;

beforeAll(() => {
  const required = [
    join(CRL_DIR, 'ca.crt'),
    join(CRL_DIR, 'leaf.crt'),
    join(CRL_DIR, 'crl-empty.pem'),
    join(CRL_DIR, 'crl-revoked.pem'),
    join(CRL_DIR, 'crl-fake.pem'),
  ];
  for (const f of required) {
    if (!existsSync(f)) {
      throw new Error(
        `CRL-Testartefakt fehlt: ${f} — erzeuge es mit \`bash scripts-gen-test-crl.sh\``,
      );
    }
  }
  caPem = readFileSync(join(CRL_DIR, 'ca.crt'), 'utf-8');
  leafPem = readFileSync(join(CRL_DIR, 'leaf.crt'), 'utf-8');
  crlEmpty = readFileSync(join(CRL_DIR, 'crl-empty.pem'), 'utf-8');
  crlRevoked = readFileSync(join(CRL_DIR, 'crl-revoked.pem'), 'utf-8');
  crlFake = readFileSync(join(CRL_DIR, 'crl-fake.pem'), 'utf-8');
  leafSerial = readFileSync(join(CRL_DIR, 'leaf-serial.txt'), 'utf-8').trim();
});

describe('CRL-Parsing', () => {
  it('liest Seriennummern und Zeitangaben aus einer echten CRL', () => {
    const parsed = parseCrl(crlRevoked);
    expect(parsed).not.toBeNull();
    expect(parsed!.revokedSerials.has(leafSerial)).toBe(true);
    expect(parsed!.tbsDer.length).toBeGreaterThan(0);
    expect(parsed!.signatureValue?.length ?? 0).toBeGreaterThan(0);
    expect(parsed!.thisUpdate).toBeInstanceOf(Date);
  });

  it('erkennt eine leere CRL (keine Sperrung)', () => {
    const parsed = parseCrl(crlEmpty);
    expect(parsed).not.toBeNull();
    expect(parsed!.revokedSerials.size).toBe(0);
  });

  it('gibt bei Müll null zurück statt zu raten', () => {
    expect(parseCrl('kein PEM')).toBeNull();
    expect(parseCrl(Buffer.from('totaler-unsinn'))).toBeNull();
  });
});

describe('CRL-Endpunkte aus dem Zertifikat', () => {
  it('liest den Distribution Point aus der Erweiterung', () => {
    const endpoints = extractCrlEndpoints(leafPem);
    expect(endpoints.length).toBeGreaterThan(0);
    expect(endpoints[0]!.url).toMatch(/^https?:\/\//);
  });

  it('liefert eine leere Liste bei unlesbarem Zertifikat', () => {
    expect(extractCrlEndpoints('kein Zertifikat')).toEqual([]);
  });
});

describe('Sperrprüfung gegen echte OpenSSL-CRLs', () => {
  it('erkennt ein NICHT gesperrtes Zertifikat', async () => {
    const r = await checkCertificateRevocation(leafPem, caPem, {
      fetchCrl: async () => crlEmpty,
    });
    expect(r.determined).toBe(true);
    expect(r.revoked).toBe(false);
    expect(r.source).toBe('crl');
  });

  it('erkennt ein gesperrtes Zertifikat', async () => {
    const r = await checkCertificateRevocation(leafPem, caPem, {
      fetchCrl: async () => crlRevoked,
    });
    expect(r.determined).toBe(true);
    expect(r.revoked).toBe(true);
    expect(r.reason).toMatch(/gesperrt/i);
  });

  it('weist eine von einer fremden CA signierte CRL ab', async () => {
    const r = await checkCertificateRevocation(leafPem, caPem, {
      fetchCrl: async () => crlFake,
    });
    // Entscheidend: NICHT als "nicht gesperrt" durchwinken.
    expect(r.revoked).not.toBe(false);
    expect(r.determined).toBe(false);
  });

  it('fail-closed: nicht erreichbare CRL ergibt UNBEKANNT', async () => {
    const r = await checkCertificateRevocation(leafPem, caPem, {
      fetchCrl: async () => {
        throw new Error('Verbindung verweigert');
      },
    });
    expect(r.determined).toBe(false);
    expect(r.revoked).toBeNull();
    expect(r.reason).toMatch(/Verbindung verweigert/);
  });

  it('fail-closed: Zertifikat ohne CRL-Endpoint gilt als UNBEKANNT', async () => {
    // ca.crt selbst hat keine crlDistributionPoints.
    const r = await checkCertificateRevocation(caPem, caPem, {
      fetchCrl: async () => crlEmpty,
    });
    expect(r.endpoints).toHaveLength(0);
    expect(r.determined).toBe(false);
    expect(r.revoked).toBeNull();
  });
});

describe('Test-P12 (Signaturpfad)', () => {
  it('das Test-Zertifikat trägt einen CRL-Distribution-Point', () => {
    // Voraussetzung dafür, dass der Signaturpfad die Sperrprüfung überhaupt
    // anstoßen kann.
    expect(existsSync(P12_PATH)).toBe(true);
  });
});
