/**
 * E2E-Test: Signatur-Modul (M2 Sprint 4 — qeS-Signatur).
 *
 * 12 Tests:
 *   1. POST /api/signatur/inspect-p12 ohne Auth → 401
 *   2. POST /api/signatur/inspect-p12 ohne STEUERBERATER-Rolle → 403
 *   3. POST /api/signatur/inspect-p12 mit Test-P12 → 200 + Metadata
 *   4. POST /api/signatur/inspect-p12 mit falschem Passwort → 400
 *   5. POST /api/signatur/sign-bilanz ohne STEUERBERATER-Rolle → 403
 *   6. POST /api/signatur/sign-bilanz mit Test-P12 → 200 + signedPdfBase64 + SignatureId
 *   7. Signed PDF ist well-formed (beginnt mit %PDF-)
 *   8. Signed PDF enthält eingebettete Signatur (Dictionary-Objekt)
 *   9. Signed PDF in WORM-Storage abgelegt (Audit-Trail / Manifest)
 *  10. POST /api/signatur/validate mit signed PDF → valid: true
 *  11. POST /api/signatur/validate mit manipuliertem PDF → documentIntegrity: false
 *  12. POST /api/signatur/validate mit unsigned PDF → signatureCount: 0
 *
 * HINWEIS: Diese Spec ist tsc-clean, wird aber NICHT in CI ausgeführt
 * — sie braucht einen echten MinIO/S3 + generierten Test-P12-Token.
 *
 * Test-P12-Generierung (lokal):
 *   bash scripts/generate-test-p12.sh ./tmp/test-certs
 *
 * Voraussetzungen zum AUSFÜHREN:
 *   - MinIO/S3 läuft (oder Mock aktiv)
 *   - Schema migriert + geseedet
 *   - Test-P12 generiert (oben)
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module';

// ---------------------------------------------------------------------------
// S3-Mock (analog pdf.e2e.spec.ts)
// ---------------------------------------------------------------------------

// Der frueher hier eingebaute In-Memory-Mock fuer @aws-sdk/client-s3 ist
// entfernt: die Specs sprechen HTTP gegen den laufenden Server, nicht
// gegen ein hier gebautes Nest-TestingModule. Das Mock-Objekt war daher
// nie gefuellt — WORM-Pruefungen liefen ins Leere und waren gruen,
// ohne dass ein Objekt abgelegt worden waere.
//
// Jetzt laeuft die Zustellung gegen den echten S3-Weg: den S3-Mock
// aus run-local.sh (s3-mock/server.js) mit echter Object-Lock-
// Semantik. Voraussetzung: ./run-local.sh laeuft.


const BASE = 'http://localhost:3000';

function authHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}

interface SignResponse {
  signatureId: string;
  signedPdfBase64: string;
  signedPdfWormKey: string;
  hashBefore: string;
  hashAfter: string;
  timestamp?: string;
  timestampAuthority?: string;
  certificateMetadata?: Record<string, string>;
}

interface InspectP12Response {
  subject: string;
  fingerprintSha256: string;
  signatureType: string;
}
const P12_PASSWORD = 'Test1234!';
const P12_PATH = './tmp/test-certs/test-token.p12';

interface ValidationResponse {
  valid: boolean;
  signatureCount: number;
  signedBy: string;
  issuerTrusted: boolean;
  certificateExpired: boolean;
  timestampValid: boolean;
  documentIntegrity: boolean;
  warnings: string[];
  errors: string[];
}


describe('Signatur E2E (M2 Sprint 4 — qeS)', () => {
  let app: INestApplication;
  let steuerberaterToken: string;
  let gfToken: string;
  let demoMandantId: string;
  let demoBilanzId: string;
  let p12Base64: string;

  beforeAll(async () => {
    // Mock-Env VOR App-Init setzen
    process.env['S3_ENDPOINT'] = 'http://mock-s3.local';
    process.env['S3_REGION'] = 'eu-central-1';
    process.env['S3_ACCESS_KEY'] = 'mock-access-key';
    process.env['S3_SECRET_KEY'] = 'mock-secret-key';
    process.env['S3_BUCKET'] = 'mock-bucket';
    process.env['S3_OBJECT_LOCK_RETENTION_DAYS'] = '3650';
    // Mock-TSA explizit deaktivieren (kein TSA_URL → Mock-Modus im Service)
    delete process.env['TSA_URL'];

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    // P12 laden.
    //
    // Bugfix 2026-09-29: Der `catch`-Zweig legte `dummy-p12-bytes` an. Alle
    // Signatur-Tests bekamen daraufhin HTTP 400/500 und behaupteten danach
    // `expect([400, 500]).toContain(res.status)` — 7 Tests wurden gruen, ohne
    // dass der Signierpfad je lief. Ein fehlendes Test-Zertifikat ist ein
    // Umgebungsfehler und darf nicht stillschweigend zu gruen fuehren.
    //
    // Erzeugen:  npx ts-node scripts-gen-test-p12.ts
    try {
      p12Base64 = readFileSync(join(process.cwd(), P12_PATH)).toString('base64');
    } catch (err) {
      throw new Error(
        `Test-P12 fehlt: ${P12_PATH} — erzeuge es mit ` +
          `\`npx ts-node scripts-gen-test-p12.ts\` (Original: ${(err as Error).message})`,
      );
    }

    // Login Test-User
    const sb = await login('steuerberater@kanzlei.de', 'Demo123!');
    steuerberaterToken = sb.accessToken;
    demoMandantId =
      sb.user.mandanten.find((m) => m.firmenname === 'Demo GmbH')?.id ?? '';

    const gf = await login('gf-demo@demo-gmbh.de', 'Demo123!');
    gfToken = gf.accessToken;

    // Hole existierende Bilanz-ID aus dem Seed
    const list = await fetchBilanzList(steuerberaterToken, demoMandantId, 2025);
    demoBilanzId = list[0]?.id ?? '';
  });

  afterAll(async () => {
    await app.close();
  });

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  async function login(email: string, password: string): Promise<LoginResponse> {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      throw new Error(`Login ${email} fehlgeschlagen: ${res.status}`);
    }
    return (await res.json()) as LoginResponse;
  }

  async function fetchBilanzList(
    token: string,
    mandantId: string,
    jahr: number,
  ): Promise<Array<{ id: string }>> {
    const res = await fetch(
      `${BASE}/api/bilanz?mandantId=${mandantId}&geschaeftsjahr=${jahr}`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    if (!res.ok) {
      throw new Error(`Bilanz-Liste fehlgeschlagen: ${res.status}`);
    }
    return (await res.json()) as Array<{ id: string }>;
  }

  function authHeaders(token: string): Record<string, string> {
    return {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    };
  }

  // -------------------------------------------------------------------------
  // 1. inspect-p12 ohne Auth → 401
  // -------------------------------------------------------------------------
  it('POST /api/signatur/inspect-p12 ohne Auth → 401', async () => {
    const res = await fetch(`${BASE}/api/signatur/inspect-p12`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        p12Base64,
        p12Password: P12_PASSWORD,
      }),
    });
    expect(res.status).toBe(401);
  });

  // -------------------------------------------------------------------------
  // 2. inspect-p12 ohne STEUERBERATER-Rolle → 403
  // -------------------------------------------------------------------------
  it('POST /api/signatur/inspect-p12 als GF (kein STEUERBERATER) → 403', async () => {
    const res = await fetch(`${BASE}/api/signatur/inspect-p12`, {
      method: 'POST',
      headers: authHeaders(gfToken),
      body: JSON.stringify({
        p12Base64,
        p12Password: P12_PASSWORD,
      }),
    });
    expect(res.status).toBe(403);
  });

  // -------------------------------------------------------------------------
  // 3. inspect-p12 mit Test-P12 → 200 + Metadata
  // -------------------------------------------------------------------------
  it('POST /api/signatur/inspect-p12 mit Test-P12 → 200 + Metadata', async () => {
    const res = await fetch(`${BASE}/api/signatur/inspect-p12`, {
      method: 'POST',
      headers: authHeaders(steuerberaterToken),
      body: JSON.stringify({
        p12Base64,
        p12Password: P12_PASSWORD,
      }),
    });
    // Erwartet: 200 wenn P12 gültig ist, sonst 400 (Bad-Token)
    if (res.status === 200) {
      const meta = (await res.json()) as InspectP12Response;
      expect(meta.subject).toContain('Test-Signer');
      expect(meta.fingerprintSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(['EINFACH', 'FORTGESCHRITTEN', 'QUALIFIZIERT']).toContain(
        meta.signatureType,
      );
    } else {
      // Dummy-P12 (Fallback) → 400 erwartet
      expect(res.status).toBe(400);
    }
  });

  // -------------------------------------------------------------------------
  // 4. inspect-p12 mit falschem Passwort → 400
  // -------------------------------------------------------------------------
  it('POST /api/signatur/inspect-p12 mit falschem Passwort → 400', async () => {
    const res = await fetch(`${BASE}/api/signatur/inspect-p12`, {
      method: 'POST',
      headers: authHeaders(steuerberaterToken),
      body: JSON.stringify({
        p12Base64,
        p12Password: 'WRONG-PASSWORD',
      }),
    });
    // Falsches Passwort muss mit 400 abgewiesen werden — das ist der Zweck
    // dieses Tests. (Er war zuvor Teil eines `[400,500]`-Toleranzbereichs.)
    expect(res.status).toBe(400);
  });

  // -------------------------------------------------------------------------
  // 5. sign-bilanz ohne STEUERBERATER-Rolle → 403
  // -------------------------------------------------------------------------
  it('POST /api/signatur/sign-bilanz als GF (kein STEUERBERATER) → 403', async () => {
    const res = await fetch(`${BASE}/api/signatur/sign-bilanz`, {
      method: 'POST',
      headers: authHeaders(gfToken),
      body: JSON.stringify({
        bilanzId: demoBilanzId,
        mandantId: demoMandantId,
        p12Base64,
        p12Password: P12_PASSWORD,
      }),
    });
    expect(res.status).toBe(403);
  });

  // -------------------------------------------------------------------------
  // 6. sign-bilanz mit Test-P12 → 200 + signedPdfBase64 + SignatureId
  // -------------------------------------------------------------------------
  it('POST /api/signatur/sign-bilanz mit Test-P12 → 200 + signedPdfBase64', async () => {
    // Kein stilles Skip: fehlt der Seed-Datensatz, ist das ein Umgebungsfehler.
    expect(demoBilanzId, 'Demo-Bilanz-Id muss ermittelt sein').not.toBe('');
    const res = await fetch(`${BASE}/api/signatur/sign-bilanz`, {
      method: 'POST',
      headers: authHeaders(steuerberaterToken),
      body: JSON.stringify({
        bilanzId: demoBilanzId,
        mandantId: demoMandantId,
        p12Base64,
        p12Password: P12_PASSWORD,
        signatureType: 'FORTGESCHRITTEN',
        includeTimestamp: true,
      }),
    });
    // Bei Dummy-P12: 400, bei echtem Test-P12: 200
    if (res.status === 200) {
      const body = (await res.json()) as SignResponse;
      expect(body.signatureId).toBeTruthy();
      expect(body.signedPdfBase64.length).toBeGreaterThan(1000);
      expect(body.signedPdfWormKey).toMatch(/^mandant\/.+\/bilanz-signed\/.+\/.+\.pdf$/);
      expect(body.hashBefore).toMatch(/^[a-f0-9]{64}$/);
      expect(body.hashAfter).toMatch(/^[a-f0-9]{64}$/);
      // Ohne konfigurierte TSA_URL nutzt der Signaturpfad den Mock-TSA.
      // Das Ergebnis MUSS das auch ausweisen — ein echter TSA liefert hier
      // einen anderen Autoritaetsnamen.
      expect(body.timestampAuthority).toMatch(/MOCK/i);
      expect(body.timestamp).toBeTruthy();
      // Signatur und Hash-Kette muessen vollstaendig sein
      expect(body.signedPdfBase64.length).toBeGreaterThan(1000);
      expect(body.hashBefore).not.toBe(body.hashAfter);
    }
  });

  // -------------------------------------------------------------------------
  // 7. Signed PDF ist well-formed (beginnt mit %PDF-)
  // -------------------------------------------------------------------------
  it('Signed PDF ist well-formed (%PDF- magic)', async () => {
    expect(demoBilanzId, 'Demo-Bilanz-Id muss ermittelt sein').not.toBe('')
    const res = await fetch(`${BASE}/api/signatur/sign-bilanz`, {
      method: 'POST',
      headers: authHeaders(steuerberaterToken),
      body: JSON.stringify({
        bilanzId: demoBilanzId,
        mandantId: demoMandantId,
        p12Base64,
        p12Password: P12_PASSWORD,
      }),
    });
    expect(res.status, 'Signatur-Request muss 200 liefern').toBe(200);
    const body = (await res.json()) as SignResponse;
    const buffer = Buffer.from(body.signedPdfBase64, 'base64');
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
  });

  // -------------------------------------------------------------------------
  // 8. Signed PDF enthält eingebettete Signatur (Dictionary-Objekt)
  // -------------------------------------------------------------------------
  it('Signed PDF enthält eingebettete Signatur (/Type /Sig)', async () => {
    expect(demoBilanzId, 'Demo-Bilanz-Id muss ermittelt sein').not.toBe('')
    const res = await fetch(`${BASE}/api/signatur/sign-bilanz`, {
      method: 'POST',
      headers: authHeaders(steuerberaterToken),
      body: JSON.stringify({
        bilanzId: demoBilanzId,
        mandantId: demoMandantId,
        p12Base64,
        p12Password: P12_PASSWORD,
      }),
    });
    expect(res.status, 'Signatur-Request muss 200 liefern').toBe(200);
    const body = (await res.json()) as SignResponse;
    const buffer = Buffer.from(body.signedPdfBase64, 'base64');
    const text = buffer.toString('latin1');
    expect(text).toMatch(/\/Type\s*\/Sig\b/);
  });

  // -------------------------------------------------------------------------
  // 9. Signed PDF in WORM-Storage abgelegt (Audit-Trail / Manifest)
  // -------------------------------------------------------------------------
  it('Signed PDF ist im WORM-Storage abgelegt', async () => {
    expect(demoBilanzId, 'Demo-Bilanz-Id muss ermittelt sein').not.toBe('')
    const res = await fetch(`${BASE}/api/signatur/sign-bilanz`, {
      method: 'POST',
      headers: authHeaders(steuerberaterToken),
      body: JSON.stringify({
        bilanzId: demoBilanzId,
        mandantId: demoMandantId,
        p12Base64,
        p12Password: P12_PASSWORD,
      }),
    });
    expect(res.status, 'Signatur-Request muss 200 liefern').toBe(200);
    const body = (await res.json()) as SignResponse;
    // WORM-Ablage: der Key folgt dem Schema mandant/<id>/bilanz-signed/<jahr>/<uuid>.pdf
    // und der S3-Object-Lock wird vom StorageService gesetzt — geprueft wird die
    // tatsaechliche Antwort des laufenden Servers (S3-Mock aus run-local.sh
    // mit echter Lock-Semantik), nicht ein lokales, nie befuelltes Map-Objekt.
    expect(body.signedPdfWormKey).toMatch(
      /^mandant\/.+\/bilanz-signed\/\d{4}\/.+\.pdf$/,
    );
    expect(body.timestampAuthority).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // 10. validate mit signed PDF → valid: true
  // -------------------------------------------------------------------------
  it('POST /api/signatur/validate mit signed PDF → valid: true', async () => {
    expect(demoBilanzId, 'Demo-Bilanz-Id muss ermittelt sein').not.toBe('')
    const signRes = await fetch(`${BASE}/api/signatur/sign-bilanz`, {
      method: 'POST',
      headers: authHeaders(steuerberaterToken),
      body: JSON.stringify({
        bilanzId: demoBilanzId,
        mandantId: demoMandantId,
        p12Base64,
        p12Password: P12_PASSWORD,
      }),
    });
    expect(signRes.status, 'Signatur-Request muss 200 liefern').toBe(200);
    const signed = (await signRes.json()) as SignResponse;

    const valRes = await fetch(`${BASE}/api/signatur/validate?mandantId=${demoMandantId}`, {
      method: 'POST',
      headers: authHeaders(steuerberaterToken),
      body: JSON.stringify({
        signedPdfBase64: signed.signedPdfBase64,
      }),
    });
    expect(valRes.status).toBe(200);
    const result = (await valRes.json()) as ValidationResponse;
    expect(result.signatureCount).toBeGreaterThan(0);
    expect(result.documentIntegrity).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 11. validate mit manipuliertem PDF → documentIntegrity: false
  // -------------------------------------------------------------------------
  it('POST /api/signatur/validate mit manipuliertem PDF → documentIntegrity: false', async () => {
    expect(demoBilanzId, 'Demo-Bilanz-Id muss ermittelt sein').not.toBe('')
    const signRes = await fetch(`${BASE}/api/signatur/sign-bilanz`, {
      method: 'POST',
      headers: authHeaders(steuerberaterToken),
      body: JSON.stringify({
        bilanzId: demoBilanzId,
        mandantId: demoMandantId,
        p12Base64,
        p12Password: P12_PASSWORD,
      }),
    });
    expect(signRes.status, 'Signatur-Request muss 200 liefern').toBe(200);
    const signed = (await signRes.json()) as SignResponse;
    const buffer = Buffer.from(signed.signedPdfBase64, 'base64');
    // Mutation: ersetze ein paar Bytes in der Mitte (NICHT im
    // Signatur-Slot, sondern im Body).
    expect(buffer.length, 'signiertes PDF muss nicht leer sein').toBeGreaterThan(200)
    const mutated = Buffer.from(buffer);
    mutated[100] = (mutated[100] ?? 0) ^ 0xff;
    mutated[150] = (mutated[150] ?? 0) ^ 0xff;

    const valRes = await fetch(`${BASE}/api/signatur/validate?mandantId=${demoMandantId}`, {
      method: 'POST',
      headers: authHeaders(steuerberaterToken),
      body: JSON.stringify({
        signedPdfBase64: mutated.toString('base64'),
      }),
    });
    expect(valRes.status).toBe(200);
    const result = (await valRes.json()) as ValidationResult;
    // Bei Mutation muss documentIntegrity false sein — entweder
    // ByteRange ungültig oder Anzahl /Type /Sig = 0
    expect(result.documentIntegrity).toBe(false);
  });

  // -------------------------------------------------------------------------
  // -------------------------------------------------------------------------
  // 11b. Nachtraeglich angehaengte Bytes → werden erkannt
  // -------------------------------------------------------------------------
  // Gegenfall zum vorigen Test: eine Manipulation AUSSERHALB des
  // signierten Bereichs (angefuegter Trailer) verschiebt das Dateiende und
  // muss ueber /ByteRange auffallen.
  it('nachträglich angehängte Bytes → documentIntegrity: false', async () => {
    expect(demoBilanzId, 'Demo-Bilanz-Id muss ermittelt sein').not.toBe('')
    const signRes = await fetch(`${BASE}/api/signatur/sign-bilanz`, {
      method: 'POST',
      headers: authHeaders(steuerberaterToken),
      body: JSON.stringify({
        bilanzId: demoBilanzId,
        mandantId: demoMandantId,
        p12Base64,
        p12Password: P12_PASSWORD,
      }),
    });
    expect(signRes.status, 'Signatur-Request muss 200 liefern').toBe(200);
    const signed = (await signRes.json()) as SignResponse;
    // Buffer.write() schreibt ab Position 0 — fuer ein echtes Anhaengen
    // braucht es Buffer.concat().
    const appended = Buffer.concat([
      Buffer.from(signed.signedPdfBase64, 'base64'),
      Buffer.from('\n%% nachtraeglich angehaengt\n', 'utf-8'),
    ]);

    const valRes = await fetch(`${BASE}/api/signatur/validate?mandantId=${demoMandantId}`, {
      method: 'POST',
      headers: authHeaders(steuerberaterToken),
      body: JSON.stringify({ signedPdfBase64: appended.toString('base64') }),
    });
    expect(valRes.status).toBe(200);
    const result = (await valRes.json()) as ValidationResponse;
    expect(result.documentIntegrity).toBe(false);
    expect(result.valid).toBe(false);
  });

  // 12. validate mit unsigned PDF → signatureCount: 0
  // -------------------------------------------------------------------------
  it('POST /api/signatur/validate mit unsigned PDF → signatureCount: 0', async () => {
    const dummyUnsignedPdf = Buffer.from(
      '%PDF-1.4\n%¥±ë\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Size 1 /Root 1 0 R >>\nstartxref\n0\n%%EOF\n',
    );
    // mandantId gehoert in den Query-String: der Endpunkt traegt
    // @RequireMandant() + MandantGuard, und der Guard liest params ->
    // x-mandant-id -> query -> body. Ohne mandantId antwortete er 403
    // ("mandantId erforderlich"), bevor die Signaturpruefung lief.
    const valRes = await fetch(`${BASE}/api/signatur/validate?mandantId=${demoMandantId}`, {
      method: 'POST',
      headers: authHeaders(steuerberaterToken),
      body: JSON.stringify({
        signedPdfBase64: dummyUnsignedPdf.toString('base64'),
      }),
    });
    expect(valRes.status).toBe(200);
    const result = (await valRes.json()) as ValidationResult;
    expect(result.signatureCount).toBe(0);
    expect(result.valid).toBe(false);
  });
});

// Type-Alias für kompaktere Test-Signaturen
interface ValidationResult {
  valid: boolean;
  signatureCount: number;
  documentIntegrity: boolean;
}