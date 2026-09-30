/**
 * E2E-Test: PDF-Generierung + WORM-Storage + Download.
 *
 * 10 Tests:
 *   1. POST /api/pdf/bilanz/:id/generate ohne Auth → 401
 *   2. POST /api/pdf/bilanz/:id/generate ohne STEUERBERATER-Rolle → 403
 *   3. POST /api/pdf/bilanz/:id/generate mit STEUERBERATER-Rolle → 200
 *   4. GET /api/pdf/bilanz/:id/download → 200 + application/pdf
 *   5. GET /api/pdf/bilanz/:id/download vor Generate → 404
 *   6. PDF enthält "Bundesanzeiger Jahresabschluss"
 *   7. PDF enthält Mandanten-Firmenname
 *   8. PDF enthält Geschäftsjahr
 *   9. PDF enthält "WORM-Hinweis"
 *  10. Cross-Mandant PDF-Download → 403
 *
 * S3 wird gemockt (S3Client-Adapter wird durch eine In-Memory-Implementierung
 * ersetzt, die PutObject/HeadObject/GetObject auf einem Filesystem simuliert).
 *
 * Voraussetzungen zum AUSFÜHREN:
 *   - MinIO/S3 läuft (oder Mock aktiv)
 *   - Schema migriert + geseedet
 *
 * In CI ohne MinIO: vitest mit `--run=false` überspringen (siehe AGENTS.md).
 */

import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
// WICHTIG: bewusst der Deep-Import statt `pdf-parse`.
// Die Package-`index.js` prueft `isDebugMode = !module.parent` und fuehrt dann
// ihren Demo-Code aus (liest './test/data/05-versions-space.pdf'). Unter
// Vitest ist `module.parent` leer, dadurch scheiterte die ganze Datei schon
// beim Import mit ENOENT — unabhaengig von den eigentlichen Tests.
import pdfParse from 'pdf-parse/lib/pdf-parse.js';

const BASE = 'http://localhost:3000';

function authHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}

interface BilanzSummary {
  id: string;
  geschaeftsjahr: number;
  status: string;
  wormObjectKey: string | null;
}


// ---------------------------------------------------------------------------
// S3-Mock: ersetzt den echten S3Client durch eine In-Memory-Implementierung.
// Wir mocken @aws-sdk/client-s3 VOR dem App-Init, sodass der StorageService
// beim Start einen gemockten Client injiziert bekommt.
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

/**
 * PDF-Text-Layer wirklich extrahieren.
 *
 * `buffer.toString('latin1')` liest nur den ROHEN Datei-Byte-Stream. PDFKit
 * komprimiert die Content-Streams (FlateDecode) — der Text steht also in
 * komprimierten Chunks und ist per latin1-String-Suche nicht auffindbar.
 * 'Bundesanzeiger Jahresabschluss' traf es nur, weil der Titel zusaetzlich in
 * den PDF-Info-Metadaten (/Title) steht, die unkomprimiert sind.
 *
 * AGENTS.md §6 schreibt dafuer pdf-parse vor — genau das nutzen wir jetzt.
 */
async function extractPdfText(buffer: Buffer): Promise<string> {
  const parsed = await pdfParse(buffer);
  return parsed.text;
}

interface PdfGenResponse {
  wormObjectKey: string;
  sha256Hash: string;
  sizeBytes: number;
  uploadedAt: string;
  retentionExpiresAt: string;
  downloadUrl: string;
}


describe('PDF E2E (Sprint 1.x — WORM Storage)', () => {
  // (kein lokales Nest-App mehr — die Specs gehen per HTTP gegen den laufenden Server)
  let steuerberaterToken: string;
  let gfToken: string;
  let wpToken: string;
  let demoMandantId: string;
  let beispielMandantId: string;
  let demoBilanzId: string;
  let beispielBilanzId: string;
  const nonExistentBilanzId = '00000000-0000-4000-8000-000000000000';

  // Kein TestingModule und keine Mock-S3-Env-Variablen mehr.
  //
  // Die Specs sprechen HTTP gegen den laufenden Server (siehe BASE). Das hier
  // erzeugte Nest-App-Objekt wurde nie fuer einen Aufruf benutzt — es war toter
  // Bootstrap-Code, der zudem S3_ENDPOINT auf ein nicht existierendes
  // "mock-s3.local" zeigte und damit suggerierte, es werde ein In-Memory-S3
  // benutzt. Tatsaechlich laeuft die WORM-Strecke gegen s3-mock/server.js.
  beforeAll(async () => {
    const probe = await fetch(`${BASE}/health`).catch(() => null);
    if (!probe || !probe.ok) {
      throw new Error(
        `Backend unter ${BASE} nicht erreichbar — bitte ./run-local.sh starten`,
      );
    }

    // Login verschiedener Test-User
    const sb = await login('steuerberater@kanzlei.de', 'Demo123!');
    steuerberaterToken = sb.accessToken;
    demoMandantId = sb.user.mandanten.find((m) => m.firmenname === 'Demo GmbH')?.id ?? '';
    beispielMandantId = sb.user.mandanten.find((m) => m.firmenname === 'Beispiel GmbH')?.id ?? '';

    const gf = await login('gf-demo@demo-gmbh.de', 'Demo123!');
    gfToken = gf.accessToken;

    const wp = await login('wp@kanzlei.de', 'Demo123!');
    wpToken = wp.accessToken;

    // Hole existierende Bilanz-IDs aus dem Seed
    const listDemo = await fetchBilanzList(steuerberaterToken, demoMandantId, 2025);
    demoBilanzId = listDemo[0]?.id ?? '';

    const listBeispiel = await fetchBilanzList(steuerberaterToken, beispielMandantId, 2025);
    beispielBilanzId = listBeispiel[0]?.id ?? '';
  });

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

  async function fetchBilanzList(token: string, mandantId: string, jahr: number): Promise<Array<{ id: string }>> {
    const res = await fetch(
      `${BASE}/api/bilanz?mandantId=${mandantId}&geschaeftsjahr=${jahr}`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    if (!res.ok) {
      throw new Error(`Bilanz-Liste fehlgeschlagen: ${res.status}`);
    }
    return (await res.json()) as Array<{ id: string }>;
  }

  function headers(token: string): Record<string, string> {
    return {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    };
  }

  // ===========================================================================
  // 1. POST ohne Auth → 401
  // ===========================================================================
  it('POST /api/pdf/bilanz/:id/generate ohne Auth → 401', async () => {
    const res = await fetch(`${BASE}/api/pdf/bilanz/${demoBilanzId}/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mandantId: demoMandantId }),
    });
    expect(res.status).toBe(401);
  });

  // ===========================================================================
  // 2. POST mit GF-Rolle (kein STEUERBERATER) → 403
  // ===========================================================================
  it('POST /api/pdf/bilanz/:id/generate als GF (kein STEUERBERATER) → 403', async () => {
    const res = await fetch(`${BASE}/api/pdf/bilanz/${demoBilanzId}/generate`, {
      method: 'POST',
      headers: headers(gfToken),
      body: JSON.stringify({ mandantId: demoMandantId }),
    });
    expect(res.status).toBe(403);
  });

  // ===========================================================================
  // 3. POST mit STEUERBERATER → 200 + wormObjectKey
  // ===========================================================================
  it('POST /api/pdf/bilanz/:id/generate als STEUERBERATER → 200 + wormObjectKey', async () => {
    const res = await fetch(`${BASE}/api/pdf/bilanz/${demoBilanzId}/generate`, {
      method: 'POST',
      headers: headers(steuerberaterToken),
      body: JSON.stringify({ mandantId: demoMandantId }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as PdfGenResponse;
    expect(body.wormObjectKey).toBeTruthy();
    expect(body.wormObjectKey).toMatch(/^mandant\/.+\/bilanz\/.+\/.+\.pdf$/);
    expect(body.sha256Hash).toMatch(/^[a-f0-9]{64}$/);
    expect(body.sizeBytes).toBeGreaterThan(1000);
    expect(body.downloadUrl).toMatch(/^\/api\/pdf\/bilanz\/.+\/download/);
  });

  // ===========================================================================
  // 4. GET download nach Generate → 200 + application/pdf
  // ===========================================================================
  it('GET /api/pdf/bilanz/:id/download → 200 + application/pdf', async () => {
    const res = await fetch(
      `${BASE}/api/pdf/bilanz/${demoBilanzId}/download?mandantId=${demoMandantId}`,
      { headers: { authorization: `Bearer ${steuerberaterToken}` } },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toMatch(/inline; filename="bilanz-.+\.pdf"/);
    const buffer = Buffer.from(await res.arrayBuffer());
    expect(buffer.length).toBeGreaterThan(1000);
    // PDF Magic Bytes: %PDF-
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
  });

  // ===========================================================================
  // 5. GET download VOR Generate → 404
  // ===========================================================================
  it('GET /api/pdf/bilanz/:id/download vor Generate → 404', async () => {
    // Setup: Bilanz in Beispiel-GmbH existiert (Seed), aber wurde noch
    // nicht für PDF generiert.
    // Wir nutzen aber den nonExistentBilanzId, da die Seed-Bilanz bereits
    // im vorherigen Test mit-generiert wurde (in-memory Mock).
    // → Erstelle eine neue Bilanz, die noch KEIN PDF hat.
    const createRes = await fetch(`${BASE}/api/bilanz`, {
      method: 'POST',
      headers: headers(steuerberaterToken),
      body: JSON.stringify({
        mandantId: beispielMandantId,
        geschaeftsjahr: 2024,
        positionen: [
          { seite: 'AKTIVA', kontonummer: 'B.IV.', bezeichnung: 'Bank', betragAktuell: 100, reihenfolge: 1 },
          { seite: 'PASSIVA', kontonummer: 'A.I.', bezeichnung: 'Kapital', betragAktuell: 100, reihenfolge: 1 },
        ],
      }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { bilanz: { id: string } };
    const newBilanzId = created.bilanz.id;

    const res = await fetch(
      `${BASE}/api/pdf/bilanz/${newBilanzId}/download?mandantId=${beispielMandantId}`,
      { headers: { authorization: `Bearer ${steuerberaterToken}` } },
    );
    expect(res.status).toBe(404);
  });

  // ===========================================================================
  // 6. PDF enthält "Bundesanzeiger Jahresabschluss" (text search)
  // ===========================================================================
  it('PDF enthält "Bundesanzeiger Jahresabschluss"', async () => {
    const res = await fetch(
      `${BASE}/api/pdf/bilanz/${demoBilanzId}/download?mandantId=${demoMandantId}`,
      { headers: { authorization: `Bearer ${steuerberaterToken}` } },
    );
    expect(res.status).toBe(200);
    const buffer = Buffer.from(await res.arrayBuffer());
    const text = await extractPdfText(buffer);
    // Voller Titel statt nur des Praefixes — der Textlayer wird jetzt per
    // pdf-parse korrekt dekomprimiert, der Titel steht in Header UND Footer
    // jeder Seite. Ein verkuerztes Praefix wuerde einen Layoutverlust
    // (z.B. fehlender Footer) nicht mehr aufdecken.
    expect(text).toContain('Bundesanzeiger Jahresabschluss');
  });

  // ===========================================================================
  // 7. PDF enthält Mandanten-Firmenname
  // ===========================================================================
  it('PDF enthält Mandanten-Firmenname "Demo GmbH"', async () => {
    const res = await fetch(
      `${BASE}/api/pdf/bilanz/${demoBilanzId}/download?mandantId=${demoMandantId}`,
      { headers: { authorization: `Bearer ${steuerberaterToken}` } },
    );
    const buffer = Buffer.from(await res.arrayBuffer());
    const text = await extractPdfText(buffer);
    expect(text).toContain('Demo');
  });

  // ===========================================================================
  // 8. PDF enthält Geschäftsjahr
  // ===========================================================================
  it('PDF enthält Geschäftsjahr 2025', async () => {
    const res = await fetch(
      `${BASE}/api/pdf/bilanz/${demoBilanzId}/download?mandantId=${demoMandantId}`,
      { headers: { authorization: `Bearer ${steuerberaterToken}` } },
    );
    const buffer = Buffer.from(await res.arrayBuffer());
    const text = await extractPdfText(buffer);
    expect(text).toContain('2025');
  });

  // ===========================================================================
  // 9. PDF enthält "WORM-Hinweis"
  // ===========================================================================
  it('PDF enthält "WORM-Hinweis"', async () => {
    const res = await fetch(
      `${BASE}/api/pdf/bilanz/${demoBilanzId}/download?mandantId=${demoMandantId}`,
      { headers: { authorization: `Bearer ${steuerberaterToken}` } },
    );
    const buffer = Buffer.from(await res.arrayBuffer());
    const text = await extractPdfText(buffer);
    expect(text).toContain('WORM');
  });

  // ===========================================================================
  // 10. Cross-Mandant PDF-Download → 403
  // ===========================================================================
  it('Cross-Mandant PDF-Download → 403', async () => {
    // WP hat nur Zugriff auf Demo GmbH + Beispiel GmbH, NICHT auf Test AG.
    // Wir versuchen, eine Bilanz von Test AG herunterzuladen, mit dem
    // Mandant-Guard aktiv.
    // Bugfix 2026-09-28: Vorher wurde die Bilanzliste ABGEFRAGT und ERST DANACH
    // geprueft, ob die Mandant-Id ueberhaupt existiert. Bei leerer Id schlug der
    // Request mit 403 fehl und liess den Test mit "Bilanz-Liste fehlgeschlagen"
    // abbrechen, statt sauber zu pruefen, dass der Guard greift.
    //
    // Zudem stammt die Id aus dem Login von `admin@kanzlei.de` — dieser User hat
    // im Seed nur EINEN Mandanten (Demo GmbH), 'Test AG' ist dort nicht enthalten,
    // die Id war also immer leer. Der STEUERBERATER hat alle drei Mandanten.
    const testAgMandantId =
      (await login('steuerberater@kanzlei.de', 'Demo123!')).user.mandanten.find(
        (m) => m.firmenname === 'Test AG',
      )?.id ?? '';
    if (testAgMandantId.length === 0) {
      // Kein stiller Skip: der User MUSS Test AG sehen, sonst prüft der
      // Sicherheitstest nichts. Solange der Seed keine Bilanz für Test AG
      // anlegt, blieb dieser Test ein `return` und lief nie.
      throw new Error('Test AG ist für steuerberater@kanzlei.de nicht sichtbar — Setup unvollständig');
    }

    // Liste mit einem User MIT Zugriff auf Test AG (sonst waere schon die
    // Liste 403 und der eigentliche Download-Pfad ungeprueft).
    const listTestAg = await fetchBilanzList(steuerberaterToken, testAgMandantId, 2025);
    // Wenn WP auf Test AG keinen Zugriff hat, sollte MandantGuard 403 werfen.
    const bilanzIdTestAg = listTestAg[0]?.id;
    if (!bilanzIdTestAg) {
      throw new Error(
        'Test AG hat keine Bilanz GJ 2025 — der Cross-Mandant-Test würde sonst nichts prüfen',
      );
    }
    const res = await fetch(
      `${BASE}/api/pdf/bilanz/${bilanzIdTestAg}/download?mandantId=${testAgMandantId}`,
      { headers: { authorization: `Bearer ${wpToken}` } },
    );
    expect(res.status).toBe(403);
  });
});