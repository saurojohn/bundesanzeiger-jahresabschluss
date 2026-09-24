/**
 * E2E-Test: E-Bilanz-XBRL-Modul.
 *
 * Tests (lt. Sprint-Plan):
 *   1.  POST /api/ebilanz/generate ohne Auth → 401
 *   2.  POST /api/ebilanz/generate ohne STEUERBERATER-Rolle → 403
 *   3.  POST /api/ebilanz/generate mit fehlender BilanzId → 400
 *   4.  POST /api/ebilanz/generate mit Cross-Mandant-IDs → 404
 *   5.  POST /api/ebilanz/generate mit saldostimmender Bilanz → 200 + xbrlBase64
 *   6.  Generiertes XBRL ist well-formed XML
 *   7.  Generiertes XBRL enthält firmenname
 *   8.  Generiertes XBRL enthält steuernummer
 *   9.  Generiertes XBRL enthält Bilanz-Aktiva + Passiva-Summen
 *   10. Generiertes XBRL enthält Aufwände als POSITIVE Werte (Sign-Convention!)
 *   11. POST /api/ebilanz/validate mit saldostimmendem → valid: true
 *   12. POST /api/ebilanz/validate mit manipuliertem XML (Aktiva ≠ Passiva) → valid: false + BILANCE_MISMATCH
 *
 * Hinweis: Diese Tests sind gegen die Live-App (Port 3000) — App-Init
 * nicht nötig. Tests werden gegen Test-Stack mit DB-Schema ausgeführt.
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

interface BilanzListEntry {
  id: string;
  mandantId: string;
  geschaeftsjahr: number;
  status: string;
}

interface GuVListEntry {
  id: string;
  mandantId: string;
  geschaeftsjahr: number;
}

interface AnhangListEntry {
  id: string;
  mandantId: string;
  geschaeftsjahr: number;
}

interface GenerateEbilanzResponse {
  xbrlBase64: string;
  metadata: {
    taxonomieVersion: string;
    aktivaSumme: number;
    passivaSumme: number;
    saldostimmt: boolean;
    netIncome: number;
    erloeseSumme: number;
    aufwandSumme: number;
    sizeBytes: number;
    anzahlFacts: number;
    geschaeftsjahr: number;
    firmenname: string;
  };
}

interface ValidationResult {
  valid: boolean;
  errors: Array<{ code: string; message: string; conceptCode?: string }>;
  warnings: Array<{ code: string; message: string; conceptCode?: string }>;
}

describe('E-Bilanz E2E (M2 Sprint 1+2)', () => {
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
   * Liefert für einen Mandanten die aktuelle (oder neueste) Bilanz/GuV/Anhang-ID
   * für ein bestimmtes Geschäftsjahr.
   */
  async function findTriplet(
    mandantId: string,
    jahr: number,
    headers: Record<string, string>,
  ): Promise<{ bilanzId: string; guvId: string; anhangId: string }> {
    const bilanzRes = await fetch(
      `${BASE}/api/bilanz?mandantId=${mandantId}&geschaeftsjahr=${jahr}`,
      { headers },
    );
    const bilanzen = (await bilanzRes.json()) as BilanzListEntry[];
    if (bilanzen.length === 0) throw new Error('Keine Bilanz gefunden');

    const guvRes = await fetch(
      `${BASE}/api/guv?mandantId=${mandantId}&geschaeftsjahr=${jahr}`,
      { headers },
    );
    const guvs = (await guvRes.json()) as GuVListEntry[];
    if (guvs.length === 0) throw new Error('Keine GuV gefunden');

    const anhangRes = await fetch(
      `${BASE}/api/anhang?mandantId=${mandantId}&geschaeftsjahr=${jahr}`,
      { headers },
    );
    const anhaenge = (await anhangRes.json()) as AnhangListEntry[];
    if (anhaenge.length === 0) throw new Error('Kein Anhang gefunden');

    return {
      bilanzId: bilanzen[0].id,
      guvId: guvs[0].id,
      anhangId: anhaenge[0].id,
    };
  }

  // ===========================================================================
  // 1. POST /api/ebilanz/generate ohne Auth → 401
  // ===========================================================================
  it('POST /api/ebilanz/generate ohne Auth → 401', async () => {
    const res = await fetch(`${BASE}/api/ebilanz/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mandantId: '00000000-0000-4000-8000-000000000000',
        bilanzId: '00000000-0000-4000-8000-000000000001',
        guvId: '00000000-0000-4000-8000-000000000002',
        anhangId: '00000000-0000-4000-8000-000000000003',
      }),
    });
    expect(res.status).toBe(401);
  });

  // ===========================================================================
  // 2. POST /api/ebilanz/generate ohne STEUERBERATER-Rolle (z.B. GF) → 403
  // ===========================================================================
  it('POST /api/ebilanz/generate als GF (nicht STEUERBERATER) → 403', async () => {
    const loginRes = await loginAs('gf-demo@demo-gmbh.de', 'Demo123!');
    const headers = await authHeaders(loginRes.accessToken);
    const res = await fetch(`${BASE}/api/ebilanz/generate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        mandantId: loginRes.user.mandanten[0].id,
        bilanzId: '00000000-0000-4000-8000-000000000001',
        guvId: '00000000-0000-4000-8000-000000000002',
        anhangId: '00000000-0000-4000-8000-000000000003',
      }),
    });
    expect(res.status).toBe(403);
  });

  // ===========================================================================
  // 3. POST /api/ebilanz/generate mit fehlender bilanzId → 400
  // ===========================================================================
  it('POST /api/ebilanz/generate mit fehlender bilanzId → 400', async () => {
    const loginRes = await loginAs('steuerberater@kanzlei.de', 'Demo123!');
    const mandant = loginRes.user.mandanten.find((m) => m.firmenname === 'Demo GmbH');
    if (!mandant) throw new Error('Demo GmbH nicht gefunden');
    const headers = await authHeaders(loginRes.accessToken);
    const res = await fetch(`${BASE}/api/ebilanz/generate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        mandantId: mandant.id,
        // bilanzId fehlt absichtlich
        guvId: '00000000-0000-4000-8000-000000000002',
        anhangId: '00000000-0000-4000-8000-000000000003',
      }),
    });
    expect(res.status).toBe(400);
  });

  // ===========================================================================
  // 4. POST /api/ebilanz/generate mit Cross-Mandant-IDs → 404
  // ===========================================================================
  it('POST /api/ebilanz/generate mit Cross-Mandant-IDs → 404', async () => {
    const loginRes = await loginAs('steuerberater@kanzlei.de', 'Demo123!');
    const mandant = loginRes.user.mandanten[0];
    const headers = await authHeaders(loginRes.accessToken);
    const res = await fetch(`${BASE}/api/ebilanz/generate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        mandantId: mandant.id,
        bilanzId: '11111111-1111-4111-8111-111111111111', // nicht existierend
        guvId: '11111111-1111-4111-8111-111111111112',
        anhangId: '11111111-1111-4111-8111-111111111113',
      }),
    });
    expect(res.status).toBe(404);
  });

  // ===========================================================================
  // 5. POST /api/ebilanz/generate mit saldostimmender Bilanz → 200 + xbrlBase64
  // ===========================================================================
  it('POST /api/ebilanz/generate mit saldostimmendem Abschluss → 200 + xbrlBase64', async () => {
    const loginRes = await loginAs('steuerberater@kanzlei.de', 'Demo123!');
    const mandant = loginRes.user.mandanten.find((m) => m.firmenname === 'Demo GmbH');
    if (!mandant) throw new Error('Demo GmbH nicht gefunden');
    const headers = await authHeaders(loginRes.accessToken);

    // Demo GmbH hat GJ 2025 mit saldostimmender Bilanz (per Seed).
    const { bilanzId, guvId, anhangId } = await findTriplet(mandant.id, 2025, headers);

    const res = await fetch(`${BASE}/api/ebilanz/generate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        bilanzId,
        guvId,
        anhangId,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as GenerateEbilanzResponse;
    expect(body.xbrlBase64).toBeTruthy();
    expect(body.xbrlBase64.length).toBeGreaterThan(100);
    expect(body.metadata.taxonomieVersion).toBe('hgb-kt-2025-04-01');
    expect(body.metadata.firmenname).toBe('Demo GmbH');
    expect(body.metadata.saldostimmt).toBe(true);
  });

  // ===========================================================================
  // 6. Generiertes XBRL ist well-formed XML
  // ===========================================================================
  it('Generiertes XBRL ist well-formed XML', async () => {
    const loginRes = await loginAs('steuerberater@kanzlei.de', 'Demo123!');
    const mandant = loginRes.user.mandanten.find((m) => m.firmenname === 'Demo GmbH');
    if (!mandant) throw new Error('Demo GmbH nicht gefunden');
    const headers = await authHeaders(loginRes.accessToken);
    const { bilanzId, guvId, anhangId } = await findTriplet(mandant.id, 2025, headers);

    const res = await fetch(`${BASE}/api/ebilanz/generate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ bilanzId, guvId, anhangId }),
    });
    const body = (await res.json()) as GenerateEbilanzResponse;
    const xml = Buffer.from(body.xbrlBase64, 'base64').toString('utf-8');
    expect(xml.startsWith('<?xml')).toBe(true);
    expect(xml).toContain('<xbrli:xbrl');
    expect(xml).toContain('</xbrli:xbrl>');
  });

  // ===========================================================================
  // 7. Generiertes XBRL enthält firmenname
  // ===========================================================================
  it('Generiertes XBRL enthält firmenname', async () => {
    const loginRes = await loginAs('steuerberater@kanzlei.de', 'Demo123!');
    const mandant = loginRes.user.mandanten.find((m) => m.firmenname === 'Demo GmbH');
    if (!mandant) throw new Error('Demo GmbH nicht gefunden');
    const headers = await authHeaders(loginRes.accessToken);
    const { bilanzId, guvId, anhangId } = await findTriplet(mandant.id, 2025, headers);

    const res = await fetch(`${BASE}/api/ebilanz/generate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ bilanzId, guvId, anhangId }),
    });
    const body = (await res.json()) as GenerateEbilanzResponse;
    const xml = Buffer.from(body.xbrlBase64, 'base64').toString('utf-8');
    expect(xml).toContain('genInfo.companyInfo.companyName');
    expect(xml).toContain('Demo GmbH');
  });

  // ===========================================================================
  // 8. Generiertes XBRL enthält steuernummer
  // ===========================================================================
  it('Generiertes XBRL enthält steuernummer', async () => {
    const loginRes = await loginAs('steuerberater@kanzlei.de', 'Demo123!');
    const mandant = loginRes.user.mandanten.find((m) => m.firmenname === 'Demo GmbH');
    if (!mandant) throw new Error('Demo GmbH nicht gefunden');
    const headers = await authHeaders(loginRes.accessToken);
    const { bilanzId, guvId, anhangId } = await findTriplet(mandant.id, 2025, headers);

    const res = await fetch(`${BASE}/api/ebilanz/generate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ bilanzId, guvId, anhangId }),
    });
    const body = (await res.json()) as GenerateEbilanzResponse;
    const xml = Buffer.from(body.xbrlBase64, 'base64').toString('utf-8');
    expect(xml).toContain('genInfo.companyInfo.taxNumber');
  });

  // ===========================================================================
  // 9. Generiertes XBRL enthält Bilanz-Aktiva + Passiva-Summen (total)
  // ===========================================================================
  it('Generiertes XBRL enthält Bilanz-Aktiva + Passiva-Summen', async () => {
    const loginRes = await loginAs('steuerberater@kanzlei.de', 'Demo123!');
    const mandant = loginRes.user.mandanten.find((m) => m.firmenname === 'Demo GmbH');
    if (!mandant) throw new Error('Demo GmbH nicht gefunden');
    const headers = await authHeaders(loginRes.accessToken);
    const { bilanzId, guvId, anhangId } = await findTriplet(mandant.id, 2025, headers);

    const res = await fetch(`${BASE}/api/ebilanz/generate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ bilanzId, guvId, anhangId }),
    });
    const body = (await res.json()) as GenerateEbilanzResponse;
    const xml = Buffer.from(body.xbrlBase64, 'base64').toString('utf-8');
    expect(xml).toContain('<bs.ass');
    expect(xml).toContain('<bs.eqLiab');
    expect(xml).toContain('total="true"');
  });

  // ===========================================================================
  // 10. Generiertes XBRL enthält Aufwände als POSITIVE Werte (Sign-Convention!)
  // ===========================================================================
  it('Generiertes XBRL enthält Aufwände als POSITIVE Werte (Sign-Convention)', async () => {
    const loginRes = await loginAs('steuerberater@kanzlei.de', 'Demo123!');
    const mandant = loginRes.user.mandanten.find((m) => m.firmenname === 'Demo GmbH');
    if (!mandant) throw new Error('Demo GmbH nicht gefunden');
    const headers = await authHeaders(loginRes.accessToken);
    const { bilanzId, guvId, anhangId } = await findTriplet(mandant.id, 2025, headers);

    const res = await fetch(`${BASE}/api/ebilanz/generate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ bilanzId, guvId, anhangId }),
    });
    const body = (await res.json()) as GenerateEbilanzResponse;
    const xml = Buffer.from(body.xbrlBase64, 'base64').toString('utf-8');
    // Wenn Aufwände betraglich vorhanden sind, dürfen sie NICHT als negative
    // Werte (z.B. "-10000.00") im XML stehen.
    // Wir prüfen: wenn es ein costOfMat-Element gibt, dann kein "-"-Prefix.
    const costOfMatMatch = xml.match(/<pl\.costOfMat[^>]*>([^<]+)<\/pl\.costOfMat[^>]*>/);
    if (costOfMatMatch) {
      const value = costOfMatMatch[1];
      expect(value.startsWith('-')).toBe(false);
      expect(parseFloat(value)).toBeGreaterThanOrEqual(0);
    }
  });

  // ===========================================================================
  // 11. POST /api/ebilanz/validate mit saldostimmendem → valid: true
  // ===========================================================================
  it('POST /api/ebilanz/validate mit saldostimmendem → valid: true', async () => {
    const loginRes = await loginAs('steuerberater@kanzlei.de', 'Demo123!');
    const mandant = loginRes.user.mandanten.find((m) => m.firmenname === 'Demo GmbH');
    if (!mandant) throw new Error('Demo GmbH nicht gefunden');
    const headers = await authHeaders(loginRes.accessToken);
    const { bilanzId, guvId, anhangId } = await findTriplet(mandant.id, 2025, headers);

    // 1. Generieren
    const genRes = await fetch(`${BASE}/api/ebilanz/generate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ bilanzId, guvId, anhangId }),
    });
    const genBody = (await genRes.json()) as GenerateEbilanzResponse;

    // 2. Validieren
    const valRes = await fetch(`${BASE}/api/ebilanz/validate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ xbrlBase64: genBody.xbrlBase64 }),
    });
    expect(valRes.status).toBe(200);
    const valBody = (await valRes.json()) as ValidationResult;
    expect(valBody.valid).toBe(true);
    expect(valBody.errors.length).toBe(0);
  });

  // ===========================================================================
  // 12. POST /api/ebilanz/validate mit manipuliertem XML (Aktiva ≠ Passiva) → valid: false
  // ===========================================================================
  it('POST /api/ebilanz/validate mit manipuliertem XML → valid: false + BILANCE_MISMATCH', async () => {
    const loginRes = await loginAs('steuerberater@kanzlei.de', 'Demo123!');
    const headers = await authHeaders(loginRes.accessToken);

    // Wir generieren zuerst ein gültiges XML und manipulieren dann die Summe.
    const mandant = loginRes.user.mandanten.find((m) => m.firmenname === 'Demo GmbH');
    if (!mandant) throw new Error('Demo GmbH nicht gefunden');
    const { bilanzId, guvId, anhangId } = await findTriplet(mandant.id, 2025, headers);
    const genRes = await fetch(`${BASE}/api/ebilanz/generate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ bilanzId, guvId, anhangId }),
    });
    const genBody = (await genRes.json()) as GenerateEbilanzResponse;
    const xml = Buffer.from(genBody.xbrlBase64, 'base64').toString('utf-8');

    // Wir addieren 1.000.000 zur Aktiva-Summe.
    const currentSum = genBody.metadata.aktivaSumme;
    const newSum = currentSum + 1_000_000;
    const manipulatedXml = xml.replace(
      new RegExp(`<bs\\.ass[^>]*total="true"[^>]*>${currentSum.toFixed(2)}<`),
      `<bs.ass total="true" contextRef="V_Y" decimals="240" unit="EUR">${newSum.toFixed(2)}<`,
    );
    const manipulatedBase64 = Buffer.from(manipulatedXml).toString('base64');

    const valRes = await fetch(`${BASE}/api/ebilanz/validate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ xbrlBase64: manipulatedBase64 }),
    });
    expect(valRes.status).toBe(200);
    const valBody = (await valRes.json()) as ValidationResult;
    expect(valBody.valid).toBe(false);
    expect(valBody.errors.some((e) => e.code === 'BILANCE_MISMATCH')).toBe(true);
  });
});