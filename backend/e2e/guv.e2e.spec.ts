/**
 * E2E-Test: GuV-Modul.
 *
 * Voraussetzungen:
 *   - Postgres laeuft (z.B. via `npm run docker:stack`).
 *   - Schema migriert und geseedet.
 *
 * Tests (lt. Sprint-Plan):
 *   1. GET /api/guv/schema?verfahren=GKV → 200 + GKV-Positionen
 *   2. GET /api/guv/schema?verfahren=UKV → 200 + UKV-Positionen
 *   3. POST /api/guv mit GKV → 201
 *   4. POST /api/guv mit UKV → 201
 *   5. POST /api/guv mit negativer Summe → 201 + Validierung markiert
 *   6. POST /api/guv/:id/validate → 200 + Saldo
 *   7. GET /api/guv?geschaeftsjahr=2025 → 200 + gefiltert
 *   8. Cross-Mandant-Zugriff → 403
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

interface GuVEntity {
  id: string;
  mandantId: string;
  geschaeftsjahr: number;
  verfahren: string;
  status: string;
  ergebnis: string;
  positionen: Array<{
    id: string;
    kontonummer: string;
    kategorie: string;
    betragAktuell: string;
  }>;
}

interface GuVValidierungDto {
  summeErloese: number;
  summeAufwendungen: number;
  differenz: number;
  jahresergebnis: number;
  istUeberschuss: boolean;
}

describe('GuV E2E (Sprint 1.x)', () => {
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

  // ===========================================================================
  // 1. GET /api/guv/schema?verfahren=GKV → 200 + GKV-Positionen
  // ===========================================================================
  it('GET /api/guv/schema?verfahren=GKV → 200 + GKV-Positionen', async () => {
    const loginRes = await loginAs('steuerberater@kanzlei.de', 'Demo123!');
    const headers = await authHeaders(loginRes.accessToken);
    const res = await fetch(`${BASE}/api/guv/schema?verfahren=GKV`, { headers });
    expect(res.status).toBe(200);
    const schema = (await res.json()) as Array<{ kontonummer: string }>;
    // GKV hat 17 Hauptpositionen + Unterpositionen.
    expect(schema.length).toBeGreaterThanOrEqual(17);
    // Pruefen, dass "1." Umsatzerloese enthalten ist.
    expect(schema.some((s) => s.kontonummer === '1.')).toBe(true);
    expect(schema.some((s) => s.kontonummer === '17.')).toBe(true);
  });

  // ===========================================================================
  // 2. GET /api/guv/schema?verfahren=UKV → 200 + UKV-Positionen
  // ===========================================================================
  it('GET /api/guv/schema?verfahren=UKV → 200 + UKV-Positionen', async () => {
    const loginRes = await loginAs('steuerberater@kanzlei.de', 'Demo123!');
    const headers = await authHeaders(loginRes.accessToken);
    const res = await fetch(`${BASE}/api/guv/schema?verfahren=UKV`, { headers });
    expect(res.status).toBe(200);
    const schema = (await res.json()) as Array<{ kontonummer: string }>;
    // UKV ist vereinfacht (16 Positionen).
    expect(schema.length).toBeGreaterThanOrEqual(15);
    expect(schema.some((s) => s.kontonummer === '1.')).toBe(true);
  });

  // ===========================================================================
  // 3. POST /api/guv mit GKV → 201
  // ===========================================================================
  it('POST /api/guv mit GKV → 201', async () => {
    const loginRes = await loginAs('steuerberater@kanzlei.de', 'Demo123!');
    const mandant = loginRes.user.mandanten.find((m) => m.firmenname === 'Beispiel GmbH');
    if (!mandant) throw new Error('Beispiel GmbH nicht gefunden');
    const headers = await authHeaders(loginRes.accessToken);
    const res = await fetch(`${BASE}/api/guv`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        mandantId: mandant.id,
        geschaeftsjahr: 2024,
        verfahren: 'GKV',
        positionen: [
          { kontonummer: '1.', bezeichnung: 'Umsatzerloese', kategorie: 'ERLOES', betragAktuell: 100000, reihenfolge: 1 },
          { kontonummer: '5a.', bezeichnung: 'Material', kategorie: 'MATERIAL', betragAktuell: 30000, reihenfolge: 2 },
          { kontonummer: '6a.', bezeichnung: 'Personal', kategorie: 'PERSONAL', betragAktuell: 40000, reihenfolge: 3 },
        ],
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { guv: GuVEntity; validierung: GuVValidierungDto };
    expect(body.guv.verfahren).toBe('GKV');
    expect(body.validierung.summeErloese).toBe(100000);
    expect(body.validierung.summeAufwendungen).toBe(70000);
    expect(body.validierung.jahresergebnis).toBe(30000);
    expect(body.validierung.istUeberschuss).toBe(true);
  });

  // ===========================================================================
  // 4. POST /api/guv mit UKV → 201
  // ===========================================================================
  it('POST /api/guv mit UKV → 201', async () => {
    const loginRes = await loginAs('steuerberater@kanzlei.de', 'Demo123!');
    const mandant = loginRes.user.mandanten.find((m) => m.firmenname === 'Beispiel GmbH');
    if (!mandant) throw new Error('Beispiel GmbH nicht gefunden');
    const headers = await authHeaders(loginRes.accessToken);
    const res = await fetch(`${BASE}/api/guv`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        mandantId: mandant.id,
        geschaeftsjahr: 2023,
        verfahren: 'UKV',
        positionen: [
          { kontonummer: '1.', bezeichnung: 'Umsatzerloese', kategorie: 'ERLOES', betragAktuell: 200000, reihenfolge: 1 },
          { kontonummer: '2.', bezeichnung: 'Herstellungskosten', kategorie: 'MATERIAL', betragAktuell: 80000, reihenfolge: 2 },
        ],
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { guv: GuVEntity; validierung: GuVValidierungDto };
    expect(body.guv.verfahren).toBe('UKV');
    expect(body.validierung.jahresergebnis).toBe(120000);
  });

  // ===========================================================================
  // 5. POST /api/guv mit negativem Saldo → 201 + Warnungen
  // ===========================================================================
  it('POST /api/guv mit negativem Saldo → 201 + Warnungen', async () => {
    const loginRes = await loginAs('steuerberater@kanzlei.de', 'Demo123!');
    const mandant = loginRes.user.mandanten.find((m) => m.firmenname === 'Test AG');
    if (!mandant) throw new Error('Test AG nicht gefunden');
    const headers = await authHeaders(loginRes.accessToken);
    const res = await fetch(`${BASE}/api/guv`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        mandantId: mandant.id,
        geschaeftsjahr: 2024,
        verfahren: 'GKV',
        positionen: [
          { kontonummer: '1.', bezeichnung: 'Umsatzerloese', kategorie: 'ERLOES', betragAktuell: 50000, reihenfolge: 1 },
          { kontonummer: '5a.', bezeichnung: 'Material', kategorie: 'MATERIAL', betragAktuell: 80000, reihenfolge: 2 },
          { kontonummer: '6a.', bezeichnung: 'Personal', kategorie: 'PERSONAL', betragAktuell: 50000, reihenfolge: 3 },
        ],
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      guv: GuVEntity;
      validierung: GuVValidierungDto;
      warnungen?: string[];
    };
    expect(body.validierung.jahresergebnis).toBeLessThan(0);
    expect(body.validierung.istUeberschuss).toBe(false);
    expect(body.warnungen).toBeDefined();
    expect(body.warnungen?.length).toBeGreaterThan(0);
  });

  // ===========================================================================
  // 6. POST /api/guv/:id/validate → 200 + Saldo
  // ===========================================================================
  it('POST /api/guv/:id/validate → 200 + Saldo', async () => {
    const loginRes = await loginAs('steuerberater@kanzlei.de', 'Demo123!');
    const mandant = loginRes.user.mandanten.find((m) => m.firmenname === 'Demo GmbH');
    if (!mandant) throw new Error('Demo GmbH nicht gefunden');
    const headers = await authHeaders(loginRes.accessToken);
    const listRes = await fetch(`${BASE}/api/guv?mandantId=${mandant.id}&geschaeftsjahr=2025`, { headers });
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as Array<{ id: string }>;
    expect(list.length).toBeGreaterThan(0);
    const guvId = list[0].id;

    const res = await fetch(`${BASE}/api/guv/${guvId}/validate?mandantId=${mandant.id}`, {
      method: 'POST',
      headers,
    });
    expect(res.status).toBe(200);
    const validation = (await res.json()) as GuVValidierungDto;
    expect(typeof validation.summeErloese).toBe('number');
    expect(typeof validation.summeAufwendungen).toBe('number');
    expect(typeof validation.jahresergebnis).toBe('number');
  });

  // ===========================================================================
  // 7. GET /api/guv?geschaeftsjahr=2025 → 200 + gefiltert
  // ===========================================================================
  it('GET /api/guv?geschaeftsjahr=2025 → 200 + gefilterte Liste', async () => {
    const loginRes = await loginAs('steuerberater@kanzlei.de', 'Demo123!');
    const mandant = loginRes.user.mandanten.find((m) => m.firmenname === 'Demo GmbH');
    if (!mandant) throw new Error('Demo GmbH nicht gefunden');
    const headers = await authHeaders(loginRes.accessToken);
    const res = await fetch(`${BASE}/api/guv?mandantId=${mandant.id}&geschaeftsjahr=2025`, { headers });
    expect(res.status).toBe(200);
    const list = (await res.json()) as Array<{ geschaeftsjahr: number }>;
    for (const guv of list) {
      expect(guv.geschaeftsjahr).toBe(2025);
    }
  });

  // ===========================================================================
  // 8. Cross-Mandant-Zugriff → 403
  // ===========================================================================
  it('GF versucht fremde Mandant-GuV → 403', async () => {
    // GF-demo hat nur Zugriff auf Demo GmbH.
    const loginRes = await loginAs('gf-demo@demo-gmbh.de', 'Demo123!');
    const demoMandant = loginRes.user.mandanten.find((m) => m.firmenname === 'Demo GmbH');
    if (!demoMandant) throw new Error('Demo GmbH nicht in GF-Mandanten');

    // Wir brauchen die ID eines fremden Mandanten (Beispiel GmbH oder Test AG).
    // Login als Steuerberater, der alle sieht, um die ID zu holen.
    const adminRes = await loginAs('steuerberater@kanzlei.de', 'Demo123!');
    const fremdMandant = adminRes.user.mandanten.find((m) => m.firmenname === 'Beispiel GmbH');
    if (!fremdMandant) throw new Error('Beispiel GmbH nicht gefunden');
    if (fremdMandant.id === demoMandant.id) throw new Error('IDs gleich — Test ungueltig');

    const headers = await authHeaders(loginRes.accessToken);
    // Versuche, fremden Mandanten zu lesen.
    const res = await fetch(`${BASE}/api/guv?mandantId=${fremdMandant.id}`, { headers });
    // MandantGuard schlaegt zu: 403.
    expect(res.status).toBe(403);
  });
});