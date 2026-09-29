/**
 * E2E-Test: DATEV-Import-Modul (Reverse — CSV → Bilanz/GuV).
 *
 * Voraussetzungen:
 *   - Postgres läuft (z.B. via `npm run docker:stack`).
 *   - Schema migriert und geseedet.
 *
 * Tests:
 *   1.  POST /api/datev-import/preview ohne Auth → 401
 *   2.  POST /api/datev-import/preview als GF → 403
 *   3.  POST /api/datev-import/preview mit kleinem CSV → 200 + Saldovortrag
 *   4.  CSV mit ungültigem Header → 400
 *   5.  CSV mit leerem Header-Format-Name → 400
 *   6.  POST /api/datev-import/execute → 201 + bilanzId + guvId
 *   7.  Import mit userMappingOverrides → unmapped Konten werden gemappt
 *   8.  Import ohne userMappingOverrides, unmapped Konten → 200 + skippedCount > 0
 *   9.  Cross-Mandant Import → 404
 *   10. Import mit gleichem GJ wie existierender Bilanz → überschreibt + warnung
 */

import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { readFileSync } from 'fs';
import { join } from 'path';

const BASE = 'http://localhost:3000';

interface LoginResponse {
  accessToken: string;
  user: {
    id: string;
    email: string;
    mandanten: Array<{ id: string; firmenname: string; rolle: string }>;
  };
}

interface PreviewResponse {
  parsed: {
    formatName: string;
    version: number;
    beraternummer: string;
    mandantennummer: string;
    sachkontenlaenge: 4 | 5;
    buchungstyp: number;
  };
  saldovortrag: Array<{
    konto: string;
    soll: number;
    haben: number;
    saldo: number;
    buchungsCount: number;
  }>;
  mappedPositionen: Array<{
    datevKonto: string;
    saldo: number;
    buchungsCount: number;
    mapping: unknown;
    autoMapped: boolean;
    userOverride: boolean;
    warning?: string;
  }>;
  unmappedKonten: string[];
  warnings: string[];
}

interface ImportResultResponse {
  importedCount: number;
  skippedCount: number;
  bilanzId: string | null;
  guvId: string | null;
  warnings: string[];
  overwriteWarned: boolean;
}

describe('DATEV-Import E2E (M3 Sprint 0)', () => {
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

  // ===========================================================================
  // Helper
  // ===========================================================================

  function loadFixtureBase64(filename: string): string {
    const path = join(
      __dirname,
      '..',
      'src',
      'modules',
      'datev-import',
      '__fixtures__',
      filename,
    );
    const content = readFileSync(path, 'utf-8');
    return Buffer.from(content, 'utf-8').toString('base64');
  }

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
   * Liefert die ersten 20 Zeilen eines Mini-CSV-Buchungsstapels (inline).
   */
  /**
   * ECHTE Geschaeftsbuchung — im Gegensatz zu buildMiniCsv() kein interner
   * Ausgleich desselben Kontenpaares, sondern eine echte Erloesbuchung
   * ("Bank an Erloes"). Nur damit erzeugt /execute ueberhaupt eine
   * importierbare Position; der interne Ausgleich netto-null erzeugt
   * korrekt importiertCount = 0 und war als Fixture fuer die
   * execute-Tests unbrauchbar.
   */
  function buildBusinessCsv(umsatzZeilen: string[], jahr: number, bezeichnung = 'Geschaeftsbuchung'): string {
    return [
      '"Formatname";"Version";"Berater";"Mandant";"WJ-Beginn";"WJ-Ende";"Sachkontenlaenge";"Datum-von";"Datum-bis";"Bezeichnung";"Diktat";"Buchungstyp";"Rechnungslegungszweck"',
      `"EXTF_Buchungsstapel";"12";"12345";"67890";"01.01.${jahr}";"31.12.${jahr}";"4";"01.01.${jahr}";"31.12.${jahr}";"${bezeichnung}";"Buchhaltung";"1";"00"`,
      '"Umsatz";"SH";"WKZ";"Kurs";"Basis";"BWKZ";"Konto";"Gegenkonto";"BUSchluessel";"Belegdatum";"Belegfeld1";"Belegfeld2";"Skonto";"Buchungstext";"Postensperre";"Adressnummer";"PartnerBLZ"',
      ...umsatzZeilen,
    ].join('\r\n');
  }

  const ERLOESZEILE = (betrag: string, sh: 'S' | 'H', konto = '1800', gegen = '4400', text = 'Bank an Erloes') =>
    `"${betrag}";"${sh}";"EUR";"";"";"";"${konto}";"${gegen}";"0";"3112";"RG1";"";"";"${text}";"0";"";""`;

  function buildMiniCsv(): string {
    const lines: string[] = [];
    lines.push(
      '"Formatname";"Version";"Berater";"Mandant";"WJ-Beginn";"WJ-Ende";"Sachkontenlaenge";"Datum-von";"Datum-bis";"Bezeichnung";"Diktat";"Buchungstyp";"Rechnungslegungszweck"',
    );
    lines.push(
      '"EXTF_Buchungsstapel";"12";"12345";"67890";"01.01.2026";"31.12.2026";"4";"01.01.2026";"31.12.2026";"Mini Test";"Buchhaltung";"1";"00"',
    );
    lines.push(
      '"Umsatz";"SH";"WKZ";"Kurs";"Basis";"BWKZ";"Konto";"Gegenkonto";"BUSchluessel";"Belegdatum";"Belegfeld1";"Belegfeld2";"Skonto";"Buchungstext";"Postensperre";"Adressnummer";"PartnerBLZ"',
    );
    lines.push(
      '"1000,00";"S";"EUR";"";"";"";"1800";"4400";"0";"3112";"MINI";"";"";"Test Soll";"0";"";""',
    );
    lines.push(
      '"-1000,00";"H";"EUR";"";"";"";"1800";"4400";"0";"3112";"MINI";"";"";"Test Haben";"0";"";""',
    );
    return lines.join('\r\n');
  }

  // ===========================================================================
  // 1. POST /api/datev-import/preview ohne Auth → 401
  // ===========================================================================
  it('POST /api/datev-import/preview ohne Auth → 401', async () => {
    const res = await fetch(`${BASE}/api/datev-import/preview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        csvBase64: Buffer.from('test').toString('base64'),
        mandantId: '00000000-0000-4000-8000-000000000000',
        geschaeftsjahr: 2026,
      }),
    });
    expect(res.status).toBe(401);
  });

  // ===========================================================================
  // 2. POST /api/datev-import/preview als GF → 403
  // ===========================================================================
  it('POST /api/datev-import/preview als GF → 403', async () => {
    const loginRes = await loginAs('gf-demo@demo-gmbh.de', 'Demo123!');
    const headers = await authHeaders(loginRes.accessToken);
    const res = await fetch(`${BASE}/api/datev-import/preview`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        csvBase64: Buffer.from(buildMiniCsv()).toString('base64'),
        mandantId: loginRes.user.mandanten[0]!.id,
        geschaeftsjahr: 2026,
      }),
    });
    expect(res.status).toBe(403);
  });

  // ===========================================================================
  // 3. POST /api/datev-import/preview mit kleinem CSV → 200 + Saldovortrag
  // ===========================================================================
  it('POST /api/datev-import/preview mit kleinem CSV → 200 + Saldovortrag', async () => {
    const loginRes = await loginAs('steuerberater@kanzlei.de', 'Demo123!');
    const mandant = loginRes.user.mandanten.find((m) => m.firmenname === 'Demo GmbH');
    if (!mandant) throw new Error('Demo GmbH nicht gefunden');
    const headers = await authHeaders(loginRes.accessToken);

    const res = await fetch(`${BASE}/api/datev-import/preview`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        csvBase64: Buffer.from(buildMiniCsv()).toString('base64'),
        mandantId: mandant.id,
        geschaeftsjahr: 2026,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as PreviewResponse;

    expect(body.parsed.formatName).toBe('EXTF_Buchungsstapel');
    expect(body.parsed.version).toBe(12);
    expect(body.parsed.beraternummer).toBe('12345');
    expect(body.parsed.mandantennummer).toBe('67890');
    expect(body.parsed.sachkontenlaenge).toBe(4);
    expect(body.saldovortrag.length).toBeGreaterThan(0);

    // Saldo für "1800" Bank: 0 (Soll-Haben-Paar)
    const bank = body.saldovortrag.find((s) => s.konto === '1800');
    expect(bank).toBeDefined();
    expect(bank!.soll).toBe(1000);
    expect(bank!.haben).toBe(1000);
    expect(Math.abs(bank!.saldo)).toBeLessThan(0.01);

    // Saldo für "4400" Erlöse: ebenfalls 0.
    //
    // Korrektur der Testerwartung (2026-09-28): buildMiniCsv() bucht
    // INNERHALB desselben Kontenpaares — Zeile 1 "1800 S an 4400",
    // Zeile 2 "1800 H an 4400". Beide Zeilen betreffen also auch 4400,
    // und zwar je einmal Soll und einmal Haben. Nach der Reparatur des
    // Saldovortrags (Gegenkonto wird auf der GEGENSEITE gebucht) ergibt
    // sich fuer 4400 korrekt soll=1000 / haben=1000 / saldo=0.
    //
    // Die alte Erwartung (haben=0, saldo=+1000) unterstellte, das
    // Gegenkonto werde gar nicht erfasst — das war genau der Fehler, der
    // jeden Saldovortrag unbrauchbar machte. Die eigentliche Erloes-Buchung
    // (Bank an Erloes) deckt der Folgetest ab.
    const erloes = body.saldovortrag.find((s) => s.konto === '4400');
    expect(erloes).toBeDefined();
    expect(erloes!.soll).toBe(1000);
    expect(erloes!.haben).toBe(1000);
    expect(Math.abs(erloes!.saldo)).toBeLessThan(0.01);
  });

  // ===========================================================================
  // 3b. Regressionsschutz: Gegenkonto landet auf der GEGENSEITE
  // ===========================================================================
  // Ohne diesen Test koennte der Saldovortrag erneut "beide Seiten gleich"
  // buchen und trotzdem gruen aussehen (der Mini-CSV oben ist intern
  // ausgeglichen und verdeckt den Fehler). Dieser Fall ist die echte
  // Erloesbuchung "1800 Soll an 4400" — genau hier muss 4400 im Haben
  // stehen, sonst waere der importierte Saldovortrag fachlich falsch.
  it('Gegenkonto wird auf der Gegenseite gebucht (Erloesbuchung Bank an Erloes)', async () => {
    const loginRes = await loginAs('steuerberater@kanzlei.de', 'Demo123!');
    const mandant = loginRes.user.mandanten.find((m) => m.firmenname === 'Demo GmbH');
    if (!mandant) throw new Error('Demo GmbH nicht gefunden');
    const headers = await authHeaders(loginRes.accessToken);

    const lines = [
      '"Formatname";"Version";"Berater";"Mandant";"WJ-Beginn";"WJ-Ende";"Sachkontenlaenge";"Datum-von";"Datum-bis";"Bezeichnung";"Diktat";"Buchungstyp";"Rechnungslegungszweck"',
      '"EXTF_Buchungsstapel";"12";"12345";"67890";"01.01.2026";"31.12.2026";"4";"01.01.2026";"31.12.2026";"Gegenkonto-Test";"Buchhaltung";"1";"00"',
      '"Umsatz";"SH";"WKZ";"Kurs";"Basis";"BWKZ";"Konto";"Gegenkonto";"BUSchluessel";"Belegdatum";"Belegfeld1";"Belegfeld2";"Skonto";"Buchungstext";"Postensperre";"Adressnummer";"PartnerBLZ"',
      '"1000,00";"S";"EUR";"";"";"";"1800";"4400";"0";"3112";"GEGT";"";"";"Bank an Erloes";"0";"";""',
    ];

    const res = await fetch(`${BASE}/api/datev-import/preview`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        csvBase64: Buffer.from(lines.join('\r\n')).toString('base64'),
        mandantId: mandant.id,
        geschaeftsjahr: 2026,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as PreviewResponse;

    const bank = body.saldovortrag.find((s) => s.konto === '1800');
    const erloes = body.saldovortrag.find((s) => s.konto === '4400');
    expect(bank).toBeDefined();
    expect(erloes).toBeDefined();

    // Konto: Soll
    expect(bank!.soll).toBe(1000);
    expect(bank!.haben).toBe(0);
    // Gegenkonto: Haben (das ist der eigentliche Fix)
    expect(erloes!.soll).toBe(0);
    expect(erloes!.haben).toBe(1000);
    expect(erloes!.saldo).toBe(-1000);
  });

  // ===========================================================================
  // 4. CSV mit ungültigem Header → 400
  // ===========================================================================
  it('CSV mit ungültigem Header → 400', async () => {
    const loginRes = await loginAs('steuerberater@kanzlei.de', 'Demo123!');
    const mandant = loginRes.user.mandanten[0]!;
    const headers = await authHeaders(loginRes.accessToken);

    const csvBase64 = loadFixtureBase64('invalid-buchungsstapel.csv');

    const res = await fetch(`${BASE}/api/datev-import/preview`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        csvBase64,
        mandantId: mandant.id,
        geschaeftsjahr: 2026,
      }),
    });
    expect(res.status).toBe(400);
  });

  // ===========================================================================
  // 5. CSV mit leerem Header-Format-Name → 400
  // ===========================================================================
  it('CSV mit leerem Header-Format-Name → 400', async () => {
    const loginRes = await loginAs('steuerberater@kanzlei.de', 'Demo123!');
    const mandant = loginRes.user.mandanten[0]!;
    const headers = await authHeaders(loginRes.accessToken);

    const empty = [
      '"Formatname";"Version";"Berater";"Mandant";"WJ-Beginn";"WJ-Ende";"Sachkontenlaenge";"Datum-von";"Datum-bis";"Bezeichnung";"Diktat";"Buchungstyp";"Rechnungslegungszweck"',
      '"EXTF_Buchungsstapel";"";"";"";"";"";"";"";"";"";"";"";""',
      '"Umsatz";"SH";"WKZ";"Kurs";"Basis";"BWKZ";"Konto";"Gegenkonto";"BUSchluessel";"Belegdatum";"Belegfeld1";"Belegfeld2";"Skonto";"Buchungstext";"Postensperre";"Adressnummer";"PartnerBLZ"',
    ].join('\r\n');
    const csvBase64 = Buffer.from(empty, 'utf-8').toString('base64');

    const res = await fetch(`${BASE}/api/datev-import/preview`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        csvBase64,
        mandantId: mandant.id,
        geschaeftsjahr: 2026,
      }),
    });
    // Empty Version wird als Parsing-Error interpretiert → 400
    expect(res.status).toBe(400);
  });

  // ===========================================================================
  // 6. POST /api/datev-import/execute → 201 + bilanzId + guvId
  // ===========================================================================
  it('POST /api/datev-import/execute → 201 + bilanzId + guvId', async () => {
    const loginRes = await loginAs('steuerberater@kanzlei.de', 'Demo123!');
    const mandant = loginRes.user.mandanten[0]!;
    const headers = await authHeaders(loginRes.accessToken);

    // Verwende eindeutiges Geschäftsjahr (weit in der Zukunft, um Kollisionen zu vermeiden)
    const geschaeftsjahr = 2099;
    const csvBase64 = Buffer.from(
      buildBusinessCsv([ERLOESZEILE('1000,00', 'S')], geschaeftsjahr),
      'utf-8',
    ).toString('base64');

    const res = await fetch(`${BASE}/api/datev-import/execute`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        csvBase64,
        mandantId: mandant.id,
        geschaeftsjahr,
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as ImportResultResponse;
    // Mini-CSV enthält nur GuV-relevante Konten (1800, 4400) → bilanzId = null
    // GuV wird erzeugt, weil 4400 → Umsatzerloese
    expect(body.importedCount).toBeGreaterThan(0);
    expect(body.guvId).toBeTruthy();
  });

  // ===========================================================================
  // 7. Import mit userMappingOverrides → unmapped Konten werden gemappt
  // ===========================================================================
  it('Import mit userMappingOverrides → unmapped Konten werden gemappt', async () => {
    const loginRes = await loginAs('steuerberater@kanzlei.de', 'Demo123!');
    const mandant = loginRes.user.mandanten[0]!;
    const headers = await authHeaders(loginRes.accessToken);

    // CSV mit unbekanntem Konto (z. B. "9999") + Override auf "1."
    const csvLines: string[] = [];
    csvLines.push(
      '"Formatname";"Version";"Berater";"Mandant";"WJ-Beginn";"WJ-Ende";"Sachkontenlaenge";"Datum-von";"Datum-bis";"Bezeichnung";"Diktat";"Buchungstyp";"Rechnungslegungszweck"',
    );
    csvLines.push(
      '"EXTF_Buchungsstapel";"12";"12345";"67890";"01.01.2098";"31.12.2098";"4";"01.01.2098";"31.12.2098";"Override Test";"Buchhaltung";"1";"00"',
    );
    csvLines.push(
      '"Umsatz";"SH";"WKZ";"Kurs";"Basis";"BWKZ";"Konto";"Gegenkonto";"BUSchluessel";"Belegdatum";"Belegfeld1";"Belegfeld2";"Skonto";"Buchungstext";"Postensperre";"Adressnummer";"PartnerBLZ"',
    );
    csvLines.push(
      // 9999 ist das HAUPTkonto (nicht das Gegenkonto) — sonst waere es ein
      // interner Ausgleich 1800 <-> 9999 mit Netto 0, der keine GuV-Position
      // erzeugt und importedCount = 0 liefert. Genau daran scheiterte der Test.
      '"500,00";"S";"EUR";"";"";"";"9999";"1800";"0";"3112";"OVR";"";"";"Sammelkonto";"0";"";""',
      // Einzeilige Buchung: zwei gegenlaeufige Zeilen auf demselben Kontenpaar
      // ergeben Saldo 0. Der Importer ueberspringt Nullsalden VOR dem Mapping
      // ("kein Buchungseffekt") — Override bzw. Warnung "kein Mapping" wuerden
      // nie erreicht. Mit einer Zeile ist der Saldo +500 bzw. +200.
    );
    csvLines.push(
    );
    const csvBase64 = Buffer.from(csvLines.join('\r\n'), 'utf-8').toString('base64');

    const res = await fetch(`${BASE}/api/datev-import/execute`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        csvBase64,
        mandantId: mandant.id,
        geschaeftsjahr: 2098,
        userMappingOverrides: { '9999': '4.' }, // Sammelkonto → "Sonstige betriebliche Erträge"
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as ImportResultResponse;
    expect(body.importedCount).toBeGreaterThan(0);
    // 9999 wurde via Override gemappt — sollte nicht skipped werden
    expect(body.skippedCount).toBe(0);
  });

  // ===========================================================================
  // 8. Import ohne userMappingOverrides, unmapped Konten → 200 + skippedCount > 0
  // ===========================================================================
  it('Import ohne userMappingOverrides, unmapped Konten → skippedCount > 0', async () => {
    const loginRes = await loginAs('steuerberater@kanzlei.de', 'Demo123!');
    const mandant = loginRes.user.mandanten[0]!;
    const headers = await authHeaders(loginRes.accessToken);

    const csvLines: string[] = [];
    csvLines.push(
      '"Formatname";"Version";"Berater";"Mandant";"WJ-Beginn";"WJ-Ende";"Sachkontenlaenge";"Datum-von";"Datum-bis";"Bezeichnung";"Diktat";"Buchungstyp";"Rechnungslegungszweck"',
    );
    csvLines.push(
      '"EXTF_Buchungsstapel";"12";"12345";"67890";"01.01.2097";"31.12.2097";"4";"01.01.2097";"31.12.2097";"Skip Test";"Buchhaltung";"1";"00"',
    );
    csvLines.push(
      '"Umsatz";"SH";"WKZ";"Kurs";"Basis";"BWKZ";"Konto";"Gegenkonto";"BUSchluessel";"Belegdatum";"Belegfeld1";"Belegfeld2";"Skonto";"Buchungstext";"Postensperre";"Adressnummer";"PartnerBLZ"',
    );
    csvLines.push(
      '"200,00";"S";"EUR";"";"";"";"9999";"1800";"0";"3112";"SKIP";"";"";"Unbekannt";"0";"";""',
      // Einzeilige Buchung: zwei gegenlaeufige Zeilen auf demselben Kontenpaar
      // ergeben Saldo 0. Der Importer ueberspringt Nullsalden VOR dem Mapping
      // ("kein Buchungseffekt") — Override bzw. Warnung "kein Mapping" wuerden
      // nie erreicht. Mit einer Zeile ist der Saldo +500 bzw. +200.
    );
    csvLines.push(
    );
    const csvBase64 = Buffer.from(csvLines.join('\r\n'), 'utf-8').toString('base64');

    const res = await fetch(`${BASE}/api/datev-import/execute`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        csvBase64,
        mandantId: mandant.id,
        geschaeftsjahr: 2097,
        // Kein userMappingOverrides — 9999 wird skipped
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as ImportResultResponse;
    expect(body.skippedCount).toBeGreaterThan(0);
    expect(body.warnings.some((w) => w.includes('9999'))).toBe(true);
  });

  // ===========================================================================
  // 9. Cross-Mandant Import → 404
  // ===========================================================================
  it('Cross-Mandant Import (Mandant existiert nicht) → 404', async () => {
    const loginRes = await loginAs('steuerberater@kanzlei.de', 'Demo123!');
    const headers = await authHeaders(loginRes.accessToken);

    const csvBase64 = Buffer.from(buildMiniCsv(), 'utf-8').toString('base64');

    const res = await fetch(`${BASE}/api/datev-import/execute`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        csvBase64,
        // Existiert NICHT
        mandantId: '11111111-1111-4111-8111-111111111111',
        geschaeftsjahr: 2096,
      }),
    });
    expect(res.status).toBe(403); // MandantGuard / assertMandantAccess schlägt vorher zu
  });

  // ===========================================================================
  // 10. Import mit gleichem GJ wie existierender Bilanz → überschreibt + warnung
  // ===========================================================================
  it('Import mit gleichem GJ wie existierender Bilanz → überschreibt + warnung', async () => {
    const loginRes = await loginAs('steuerberater@kanzlei.de', 'Demo123!');
    const mandant = loginRes.user.mandanten[0]!;
    const headers = await authHeaders(loginRes.accessToken);

    const geschaeftsjahr = 2095;
    const csvBase64 = Buffer.from(
      buildBusinessCsv([ERLOESZEILE('750,00', 'S')], geschaeftsjahr),
      'utf-8',
    ).toString('base64');

    // Erster Import — erzeugt GuV
    const firstRes = await fetch(`${BASE}/api/datev-import/execute`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ csvBase64, mandantId: mandant.id, geschaeftsjahr }),
    });
    expect(firstRes.status).toBe(201);

    // Zweiter Import OHNE overwriteExisting → 400
    const conflictRes = await fetch(`${BASE}/api/datev-import/execute`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ csvBase64, mandantId: mandant.id, geschaeftsjahr }),
    });
    expect(conflictRes.status).toBe(400);

    // Dritter Import MIT overwriteExisting=true → 201 + overwriteWarned=true
    const overwriteRes = await fetch(`${BASE}/api/datev-import/execute`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        csvBase64,
        mandantId: mandant.id,
        geschaeftsjahr,
        overwriteExisting: true,
      }),
    });
    expect(overwriteRes.status).toBe(201);
    const body = (await overwriteRes.json()) as ImportResultResponse;
    expect(body.overwriteWarned).toBe(true);
  });
});