/**
 * E2E-Test: DATEV-Buchungsstapel-Modul.
 *
 * Voraussetzungen:
 *   - Postgres läuft (z.B. via `npm run docker:stack`).
 *   - Schema migriert und geseedet.
 *
 * Tests (lt. Sprint-Plan):
 *   1.  POST /api/datev/generate-buchungsstapel ohne Auth → 401
 *   2.  POST /api/datev/generate-buchungsstapel als GF → 403
 *   3.  POST /api/datev/generate-buchungsstapel mit Cross-Mandant GuV → 404
 *   4.  POST /api/datev/generate-buchungsstapel mit GKV-GuV → 200 + CSV
 *   5.  Generierte CSV beginnt mit Header-Spaltennamen
 *   6.  Generierte CSV hat 2 Zeilen pro GuV-Position (Soll + Haben)
 *   7.  CSV verwendet Semikolon als Trenner
 *   8.  CSV ist UTF-8 encoded (kein BOM)
 *   9.  CSV enthält SKR04-Konten (z.B. 4400 für Ertrag)
 *   10. POST /api/datev/generate-sachkonten → 200 + CSV mit allen verwendeten Konten
 */

import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../src/app.module';

const BASE = 'http://localhost:3000';

interface LoginResponse {
  accessToken: string;
  user: {
    id: string;
    email: string;
    mandanten: Array<{ id: string; firmenname: string; rolle: string }>;
  };
}

interface GuVListEntry {
  id: string;
  mandantId: string;
  geschaeftsjahr: number;
}

interface GenerateDatevResponse {
  csvBase64: string;
  filename: string;
  metadata: {
    skrPlan: 'SKR03' | 'SKR04';
    beraternummer: string;
    mandantennummer: string;
    sachkontenlaenge: 4 | 5;
    buchungsZeilenCount: number;
    verwendeteKontenCount: number;
    verwendeteKonten: string[];
    geschaeftsjahr: number;
    firmenname: string;
    erloeseSumme: number;
    aufwandSumme: number;
    csvSizeBytes: number;
    encoding: 'UTF-8';
  };
}

interface GenerateSachkontenResponse {
  csvBase64: string;
  filename: string;
  anzahlKonten: number;
}

interface MappingPreviewResponse {
  mappings: Array<{
    source: { kontonummer: string; bezeichnung: string; betragAktuell: number; kategorie: string };
    target: { konto: string; bezeichnung: string; kontoTyp: string; buschluesselDefault: string };
  }>;
  unMapped: Array<{ kontonummer: string; bezeichnung: string; reason: string }>;
  skrPlan: 'SKR03' | 'SKR04';
}

describe('DATEV E2E (M2 Sprint 3)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    app.setGlobalPrefix('api', { exclude: ['health'] });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  async function loginAs(email: string, password: string): Promise<LoginResponse> {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      throw new Error(`Login als ${email} fehlgeschlagen: ${res.status}`);
    }
    return (await res.json()) as LoginResponse;
  }

  async function authHeaders(accessToken: string): Promise<Record<string, string>> {
    return {
      'content-type': 'application/json',
      authorization: `Bearer ${accessToken}`,
    };
  }

  /**
   * Findet die erste GuV eines Mandanten für ein Geschäftsjahr.
   */
  async function findGuV(
    mandantId: string,
    jahr: number,
    headers: Record<string, string>,
  ): Promise<string> {
    const res = await fetch(`${BASE}/api/guv?mandantId=${mandantId}&geschaeftsjahr=${jahr}`, {
      headers,
    });
    const list = (await res.json()) as GuVListEntry[];
    if (list.length === 0) throw new Error(`Keine GuV für ${mandantId} / ${jahr} gefunden`);
    return list[0]!.id;
  }

  // ===========================================================================
  // 1. POST /api/datev/generate-buchungsstapel ohne Auth → 401
  // ===========================================================================
  it('POST /api/datev/generate-buchungsstapel ohne Auth → 401', async () => {
    const res = await fetch(`${BASE}/api/datev/generate-buchungsstapel`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        guvId: '00000000-0000-4000-8000-000000000001',
        beraternummer: '12345',
        mandantennummer: '67890',
      }),
    });
    expect(res.status).toBe(401);
  });

  // ===========================================================================
  // 2. POST /api/datev/generate-buchungsstapel als GF (nicht STEUERBERATER) → 403
  // ===========================================================================
  it('POST /api/datev/generate-buchungsstapel als GF → 403', async () => {
    const loginRes = await loginAs('gf-demo@demo-gmbh.de', 'Demo123!');
    const headers = await authHeaders(loginRes.accessToken);
    const res = await fetch(`${BASE}/api/datev/generate-buchungsstapel?mandantId=${loginRes.user.mandanten[0]!.id}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        guvId: '00000000-0000-4000-8000-000000000001',
        beraternummer: '12345',
        mandantennummer: '67890',
      }),
    });
    expect(res.status).toBe(403);
  });

  // ===========================================================================
  // 3. POST /api/datev/generate-buchungsstapel mit Cross-Mandant GuV → 404
  // ===========================================================================
  it('POST /api/datev/generate-buchungsstapel mit Cross-Mandant-GuV → 404', async () => {
    const loginRes = await loginAs('steuerberater@kanzlei.de', 'Demo123!');
    const mandant = loginRes.user.mandanten[0]!;
    const headers = await authHeaders(loginRes.accessToken);
    const res = await fetch(`${BASE}/api/datev/generate-buchungsstapel?mandantId=${mandant.id}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        guvId: '11111111-1111-4111-8111-111111111111', // nicht existierend
        beraternummer: '12345',
        mandantennummer: '67890',
      }),
    });
    expect(res.status).toBe(404);
  });

  // ===========================================================================
  // 4. POST /api/datev/generate-buchungsstapel mit GKV-GuV → 200 + CSV
  // ===========================================================================
  it('POST /api/datev/generate-buchungsstapel mit GKV-GuV → 200 + CSV', async () => {
    const loginRes = await loginAs('steuerberater@kanzlei.de', 'Demo123!');
    const mandant = loginRes.user.mandanten.find((m) => m.firmenname === 'Demo GmbH');
    if (!mandant) throw new Error('Demo GmbH nicht gefunden');
    const headers = await authHeaders(loginRes.accessToken);
    const guvId = await findGuV(mandant.id, 2025, headers);

    const res = await fetch(`${BASE}/api/datev/generate-buchungsstapel?mandantId=${mandant.id}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        guvId,
        beraternummer: '12345',
        mandantennummer: '67890',
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as GenerateDatevResponse;
    expect(body.csvBase64).toBeTruthy();
    expect(body.csvBase64.length).toBeGreaterThan(100);
    expect(body.metadata.skrPlan).toBe('SKR04');
    expect(body.metadata.beraternummer).toBe('12345');
    expect(body.metadata.mandantennummer).toBe('67890');
    expect(body.metadata.encoding).toBe('UTF-8');
    expect(body.metadata.buchungsZeilenCount).toBeGreaterThanOrEqual(2);
    expect(body.metadata.csvSizeBytes).toBeGreaterThan(0);
  });

  // ===========================================================================
  // 5. Generierte CSV beginnt mit Header-Spaltennamen
  // ===========================================================================
  it('Generierte CSV beginnt mit "Formatname"-Header', async () => {
    const loginRes = await loginAs('steuerberater@kanzlei.de', 'Demo123!');
    const mandant = loginRes.user.mandanten.find((m) => m.firmenname === 'Demo GmbH');
    if (!mandant) throw new Error('Demo GmbH nicht gefunden');
    const headers = await authHeaders(loginRes.accessToken);
    const guvId = await findGuV(mandant.id, 2025, headers);

    const res = await fetch(`${BASE}/api/datev/generate-buchungsstapel?mandantId=${mandant.id}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        guvId,
        beraternummer: '12345',
        mandantennummer: '67890',
      }),
    });
    const body = (await res.json()) as GenerateDatevResponse;
    const csv = Buffer.from(body.csvBase64, 'base64').toString('utf-8');

    // Die erste Zeile ist die Header-Spaltennamen-Zeile.
    const firstLine = csv.split('\r\n')[0]!;
    expect(firstLine.startsWith('"Formatname"')).toBe(true);
    expect(firstLine).toContain('"Berater"');
    expect(firstLine).toContain('"Mandant"');
    expect(firstLine).toContain('"Sachkontenlaenge"');

    // Die zweite Zeile ist die Header-Daten-Zeile (Formatname "EXTF_Buchungsstapel").
    const secondLine = csv.split('\r\n')[1]!;
    expect(secondLine).toContain('"EXTF_Buchungsstapel"');
    expect(secondLine).toContain('"12"'); // DATEV-Format Version 12

    // Die dritte Zeile sind die Buchungs-Spaltennamen.
    const thirdLine = csv.split('\r\n')[2]!;
    expect(thirdLine.startsWith('"Umsatz"')).toBe(true);
    expect(thirdLine).toContain('"Konto"');
    expect(thirdLine).toContain('"Gegenkonto"');
    expect(thirdLine).toContain('"Belegdatum"');
    expect(thirdLine).toContain('"Buchungstext"');
  });

  // ===========================================================================
  // 6. Generierte CSV hat 2 Zeilen pro GuV-Position (Soll + Haben)
  // ===========================================================================
  it('Generierte CSV hat 2 Zeilen pro GuV-Position (Soll + Haben)', async () => {
    const loginRes = await loginAs('steuerberater@kanzlei.de', 'Demo123!');
    const mandant = loginRes.user.mandanten.find((m) => m.firmenname === 'Demo GmbH');
    if (!mandant) throw new Error('Demo GmbH nicht gefunden');
    const headers = await authHeaders(loginRes.accessToken);
    const guvId = await findGuV(mandant.id, 2025, headers);

    const res = await fetch(`${BASE}/api/datev/generate-buchungsstapel?mandantId=${mandant.id}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        guvId,
        beraternummer: '12345',
        mandantennummer: '67890',
      }),
    });
    const body = (await res.json()) as GenerateDatevResponse;
    expect(body.metadata.buchungsZeilenCount % 2).toBe(0);
    // buchungsZeilenCount muss >= 2 sein (mindestens 1 GuV-Position).
    expect(body.metadata.buchungsZeilenCount).toBeGreaterThanOrEqual(2);

    // In den Buchungs-Zeilen müssen gleich viele "S"- und "H"-Vorkommen sein.
    const csv = Buffer.from(body.csvBase64, 'base64').toString('utf-8');
    const buchungsZeilen = csv.split('\r\n').slice(3); // Skip Header (3 Zeilen)
    const validBuchungsZeilen = buchungsZeilen.filter((l) => l.startsWith('"') || /^-?\d/.test(l));
    const sCount = validBuchungsZeilen.filter((l) => l.includes(';"S";')).length;
    const hCount = validBuchungsZeilen.filter((l) => l.includes(';"H";')).length;
    expect(sCount).toBe(hCount);
    expect(sCount).toBeGreaterThanOrEqual(1);
  });

  // ===========================================================================
  // 7. CSV verwendet Semikolon als Trenner
  // ===========================================================================
  it('CSV verwendet Semikolon als Trenner (NICHT Komma)', async () => {
    const loginRes = await loginAs('steuerberater@kanzlei.de', 'Demo123!');
    const mandant = loginRes.user.mandanten.find((m) => m.firmenname === 'Demo GmbH');
    if (!mandant) throw new Error('Demo GmbH nicht gefunden');
    const headers = await authHeaders(loginRes.accessToken);
    const guvId = await findGuV(mandant.id, 2025, headers);

    const res = await fetch(`${BASE}/api/datev/generate-buchungsstapel?mandantId=${mandant.id}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        guvId,
        beraternummer: '12345',
        mandantennummer: '67890',
      }),
    });
    const body = (await res.json()) as GenerateDatevResponse;
    const csv = Buffer.from(body.csvBase64, 'base64').toString('utf-8');

    // Die Spaltennamen-Zeile muss durch Semikolons getrennt sein.
    const firstLine = csv.split('\r\n')[0]!;
    expect(firstLine).toContain('";"');
    expect(firstLine).not.toContain('","');
  });

  // ===========================================================================
  // 8. CSV ist UTF-8 encoded (kein BOM)
  // ===========================================================================
  it('CSV ist UTF-8 encoded (kein BOM)', async () => {
    const loginRes = await loginAs('steuerberater@kanzlei.de', 'Demo123!');
    const mandant = loginRes.user.mandanten.find((m) => m.firmenname === 'Demo GmbH');
    if (!mandant) throw new Error('Demo GmbH nicht gefunden');
    const headers = await authHeaders(loginRes.accessToken);
    const guvId = await findGuV(mandant.id, 2025, headers);

    const res = await fetch(`${BASE}/api/datev/generate-buchungsstapel?mandantId=${mandant.id}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        guvId,
        beraternummer: '12345',
        mandantennummer: '67890',
      }),
    });
    const body = (await res.json()) as GenerateDatevResponse;
    const csvBytes = Buffer.from(body.csvBase64, 'base64');

    // UTF-8-BOM ist EF BB BF — darf NICHT vorhanden sein.
    expect(csvBytes[0]).not.toBe(0xef);
    expect(csvBytes[1]).not.toBe(0xbb);
    expect(csvBytes[2]).not.toBe(0xbf);

    // CSV ist Text (UTF-8 decodierbar).
    const csv = csvBytes.toString('utf-8');
    expect(csv.length).toBeGreaterThan(0);
  });

  // ===========================================================================
  // 9. CSV enthält SKR04-Konten (z.B. 4400 für Ertrag, 5000 für Material)
  // ===========================================================================
  it('CSV enthält SKR04-Konten', async () => {
    const loginRes = await loginAs('steuerberater@kanzlei.de', 'Demo123!');
    const mandant = loginRes.user.mandanten.find((m) => m.firmenname === 'Demo GmbH');
    if (!mandant) throw new Error('Demo GmbH nicht gefunden');
    const headers = await authHeaders(loginRes.accessToken);
    const guvId = await findGuV(mandant.id, 2025, headers);

    const res = await fetch(`${BASE}/api/datev/generate-buchungsstapel?mandantId=${mandant.id}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        guvId,
        beraternummer: '12345',
        mandantennummer: '67890',
      }),
    });
    const body = (await res.json()) as GenerateDatevResponse;
    const csv = Buffer.from(body.csvBase64, 'base64').toString('utf-8');

    // Mindestens eines der üblichen SKR04-Konten muss vorhanden sein.
    const hatErtragskonto = csv.includes('"4400"') || csv.includes('"4410"') || csv.includes('"4500"');
    const hatAufwandskonto =
      csv.includes('"5000"') || csv.includes('"6000"') || csv.includes('"6200"');
    const hatBankkonto = csv.includes('"1800"');
    expect(hatErtragskonto || hatAufwandskonto).toBe(true);
    expect(hatBankkonto).toBe(true);

    // verwendeteKonten-Liste muss SKR04-Konten enthalten.
    expect(body.metadata.verwendeteKonten).toContain('1800');
  });

  // ===========================================================================
  // 10. POST /api/datev/generate-sachkonten → 200 + CSV mit allen verwendeten Konten
  // ===========================================================================
  it('POST /api/datev/generate-sachkonten → 200 + CSV', async () => {
    const loginRes = await loginAs('steuerberater@kanzlei.de', 'Demo123!');
    const headers = await authHeaders(loginRes.accessToken);

    const res = await fetch(`${BASE}/api/datev/generate-sachkonten`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        usedKonten: ['4400', '5000', '1800'],
        skrPlan: 'SKR04',
        beraternummer: '12345',
        mandantennummer: '67890',
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as GenerateSachkontenResponse;
    expect(body.csvBase64).toBeTruthy();
    expect(body.anzahlKonten).toBe(3);

    const csv = Buffer.from(body.csvBase64, 'base64').toString('utf-8');
    expect(csv).toContain('"4400"');
    expect(csv).toContain('"5000"');
    expect(csv).toContain('"1800"');

    // Konto-Bezeichnungen: massgeblich ist die projektinterne SKR04-Tabelle
    // (src/modules/datev/mappings/skr04-*.ts) — sie ist die Single Source of
    // Truth fuer Export UNCH Import (Round-Trip).
    //
    // HINWEIS/Aufgabe fuer die Fachpruefung: die Bezeichnungen dort sind
    // teilweise projektintern und nicht 1:1 die offiziellen DATEV-SKR04-
    // Kontobezeichnungen (offiziell waere 4400 z.B. "Erlöse aus 19% USt").
    // Fuer den GoBD-rechtssicherten Export sollte die Tabelle spaeter gegen
    // die offizielle SKR04-Liste abgeglichen werden.
    expect(csv).toContain('Erlöse aus Beratung'); // 4400
    expect(csv).toContain('Materialaufwand'); // 5000
  });

  // ===========================================================================
  // 11. GET /api/datev/preview/:guvId → 200 + Mapping-Preview
  // ===========================================================================
  it('GET /api/datev/preview/:guvId → 200 + Mapping-Preview', async () => {
    const loginRes = await loginAs('steuerberater@kanzlei.de', 'Demo123!');
    const mandant = loginRes.user.mandanten.find((m) => m.firmenname === 'Demo GmbH');
    if (!mandant) throw new Error('Demo GmbH nicht gefunden');
    const headers = await authHeaders(loginRes.accessToken);
    const guvId = await findGuV(mandant.id, 2025, headers);

    const res = await fetch(`${BASE}/api/datev/preview/${guvId}?mandantId=${mandant.id}`, {
      headers,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as MappingPreviewResponse;
    expect(body.skrPlan).toBe('SKR04');
    expect(body.mappings.length).toBeGreaterThan(0);

    // Mindestens ein Mapping muss ein SKR04-Konto haben.
    expect(body.mappings.some((m) => m.target.konto === '4400' || m.target.konto === '5000')).toBe(true);
  });
});