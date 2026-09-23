/**
 * E2E-Test: Bilanz-Modul.
 *
 * Voraussetzungen:
 *   - Postgres laeuft (z.B. via `npm run docker:stack`).
 *   - Schema migriert und geseedet (`npm run prisma:migrate && npm run prisma:seed`).
 *
 * Tests (lt. Sprint-Plan):
 *   1.  GET /api/bilanz/schema → 200 + HGB-Positionen
 *   2.  GET /api/bilanz ohne Auth → 401
 *   3.  POST /api/bilanz ohne STEUERBERATER-Rolle → 403
 *   4.  POST /api/bilanz mit GF-Rolle → 403
 *   5.  POST /api/bilanz mit STEUERBERATER-Rolle → 201
 *   6.  POST /api/bilanz mit Aktiva != Passiva → 201 + Warning
 *   7.  GET /api/bilanz/:id → 200 + Positionen
 *   8.  PATCH /api/bilanz/:id → 200
 *   9.  POST /api/bilanz/:id/validate → 200 + ValidierungDto
 *   10. DELETE /api/bilanz/:id ohne DRAFT → 403
 *
 * Hinweis: Tests werden gegen die Live-App ausgefuehrt (Port 3000),
 * nicht gegen den Nest-Testing-Module. Damit ist die App identisch
 * zum Produktionsverhalten.
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

interface BilanzEntity {
  id: string;
  mandantId: string;
  geschaeftsjahr: number;
  status: string;
  positionen: Array<{
    id: string;
    seite: 'AKTIVA' | 'PASSIVA';
    kontonummer: string;
    bezeichnung: string;
    betragAktuell: string;
  }>;
}

interface BilanzValidierungDto {
  aktivaSumme: number;
  passivaSumme: number;
  differenz: number;
  saldostimmt: boolean;
  fehlendePflichtfelder: string[];
}

describe('Bilanz E2E (Sprint 1.x)', () => {
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
  // 1. GET /api/bilanz/schema → 200 + HGB-Positionen
  // ===========================================================================
  it('GET /api/bilanz/schema → 200 mit HGB-Positionen', async () => {
    const loginRes = await loginAs('steuerberater@kanzlei.de', 'Demo123!');
    const headers = await authHeaders(loginRes.accessToken);
    const res = await fetch(`${BASE}/api/bilanz/schema`, { headers });
    expect(res.status).toBe(200);
    const schema = (await res.json()) as Array<{ kontonummer: string; seite: string }>;
    expect(schema.length).toBeGreaterThan(40);
    // Pruefe einige Pflicht-Positionen
    const aktiva = schema.filter((s) => s.seite === 'AKTIVA');
    const passiva = schema.filter((s) => s.seite === 'PASSIVA');
    expect(aktiva.length).toBeGreaterThan(20);
    expect(passiva.length).toBeGreaterThan(20);
  });

  // ===========================================================================
  // 2. GET /api/bilanz ohne Auth → 401
  // ===========================================================================
  it('GET /api/bilanz ohne Auth → 401', async () => {
    const res = await fetch(`${BASE}/api/bilanz?mandantId=00000000-0000-4000-8000-000000000000`);
    expect(res.status).toBe(401);
  });

  // ===========================================================================
  // 3. POST /api/bilanz ohne STEUERBERATER-Rolle (z.B. WP) → 403
  // ===========================================================================
  it('POST /api/bilanz als WP (nicht STEUERBERATER) → 403', async () => {
    const loginRes = await loginAs('wp@kanzlei.de', 'Demo123!');
    const mandant = loginRes.user.mandanten[0];
    const headers = await authHeaders(loginRes.accessToken);
    const res = await fetch(`${BASE}/api/bilanz`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        mandantId: mandant.id,
        geschaeftsjahr: 2025,
        positionen: [],
      }),
    });
    expect(res.status).toBe(403);
  });

  // ===========================================================================
  // 4. POST /api/bilanz mit GF-Rolle → 403
  // ===========================================================================
  it('POST /api/bilanz als GF → 403', async () => {
    const loginRes = await loginAs('gf-demo@demo-gmbh.de', 'Demo123!');
    const mandant = loginRes.user.mandanten[0];
    const headers = await authHeaders(loginRes.accessToken);
    const res = await fetch(`${BASE}/api/bilanz`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        mandantId: mandant.id,
        geschaeftsjahr: 2025,
        positionen: [],
      }),
    });
    expect(res.status).toBe(403);
  });

  // ===========================================================================
  // 5. POST /api/bilanz mit STEUERBERATER-Rolle → 201
  // ===========================================================================
  it('POST /api/bilanz als STEUERBERATER → 201', async () => {
    const loginRes = await loginAs('steuerberater@kanzlei.de', 'Demo123!');
    const mandant = loginRes.user.mandanten.find((m) => m.firmenname === 'Beispiel GmbH');
    if (!mandant) throw new Error('Beispiel GmbH nicht gefunden');
    const headers = await authHeaders(loginRes.accessToken);
    const res = await fetch(`${BASE}/api/bilanz`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        mandantId: mandant.id,
        geschaeftsjahr: 2024,
        positionen: [
          { seite: 'AKTIVA', kontonummer: 'B.IV.', bezeichnung: 'Kassenbestand', betragAktuell: 100000, reihenfolge: 1 },
          { seite: 'PASSIVA', kontonummer: 'A.I.', bezeichnung: 'Gezeichnetes Kapital', betragAktuell: 25000, reihenfolge: 1 },
          { seite: 'PASSIVA', kontonummer: 'A.V.', bezeichnung: 'Jahresueberschuss', betragAktuell: 75000, reihenfolge: 2 },
        ],
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { bilanz: BilanzEntity; validierung: BilanzValidierungDto };
    expect(body.bilanz.id).toBeTruthy();
    expect(body.bilanz.positionen.length).toBe(3);
    expect(body.validierung.aktivaSumme).toBe(100000);
    expect(body.validierung.passivaSumme).toBe(100000);
    expect(body.validierung.saldostimmt).toBe(true);
  });

  // ===========================================================================
  // 6. POST /api/bilanz mit Aktiva != Passiva → 201 + Warning
  // ===========================================================================
  it('POST /api/bilanz mit unausgeglichenem Saldo → 201 + warnungen', async () => {
    const loginRes = await loginAs('steuerberater@kanzlei.de', 'Demo123!');
    const mandant = loginRes.user.mandanten.find((m) => m.firmenname === 'Beispiel GmbH');
    if (!mandant) throw new Error('Beispiel GmbH nicht gefunden');
    const headers = await authHeaders(loginRes.accessToken);
    const res = await fetch(`${BASE}/api/bilanz`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        mandantId: mandant.id,
        geschaeftsjahr: 2023,
        positionen: [
          { seite: 'AKTIVA', kontonummer: 'B.IV.', bezeichnung: 'Bank', betragAktuell: 100000, reihenfolge: 1 },
          { seite: 'PASSIVA', kontonummer: 'A.I.', bezeichnung: 'Gezeichnetes Kapital', betragAktuell: 50000, reihenfolge: 1 },
        ],
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      bilanz: BilanzEntity;
      validierung: BilanzValidierungDto;
      warnungen?: string[];
    };
    expect(body.validierung.saldostimmt).toBe(false);
    expect(body.validierung.differenz).toBe(50000);
    expect(body.warnungen).toBeDefined();
    expect(body.warnungen?.length).toBeGreaterThan(0);
  });

  // ===========================================================================
  // 7. GET /api/bilanz/:id → 200 + Positionen
  // ===========================================================================
  it('GET /api/bilanz/:id → 200 + Positionen', async () => {
    const loginRes = await loginAs('steuerberater@kanzlei.de', 'Demo123!');
    const mandant = loginRes.user.mandanten.find((m) => m.firmenname === 'Demo GmbH');
    if (!mandant) throw new Error('Demo GmbH nicht gefunden');
    const headers = await authHeaders(loginRes.accessToken);
    // Liste — der Seed hat eine Bilanz fuer GJ 2025 angelegt.
    const listRes = await fetch(`${BASE}/api/bilanz?mandantId=${mandant.id}&geschaeftsjahr=2025`, { headers });
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as BilanzListEntry[];
    expect(list.length).toBeGreaterThan(0);
    const bilanzId = list[0].id;

    const res = await fetch(`${BASE}/api/bilanz/${bilanzId}?mandantId=${mandant.id}`, { headers });
    expect(res.status).toBe(200);
    const bilanz = (await res.json()) as BilanzEntity;
    expect(bilanz.id).toBe(bilanzId);
    expect(bilanz.positionen.length).toBeGreaterThan(0);
  });

  // ===========================================================================
  // 8. PATCH /api/bilanz/:id → 200
  // ===========================================================================
  it('PATCH /api/bilanz/:id → 200', async () => {
    const loginRes = await loginAs('steuerberater@kanzlei.de', 'Demo123!');
    const mandant = loginRes.user.mandanten.find((m) => m.firmenname === 'Demo GmbH');
    if (!mandant) throw new Error('Demo GmbH nicht gefunden');
    const headers = await authHeaders(loginRes.accessToken);
    const listRes = await fetch(`${BASE}/api/bilanz?mandantId=${mandant.id}&geschaeftsjahr=2025`, { headers });
    const list = (await listRes.json()) as BilanzListEntry[];
    const bilanzId = list[0].id;

    const res = await fetch(`${BASE}/api/bilanz/${bilanzId}?mandantId=${mandant.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ hinweise: 'Test-Hinweis via PATCH' }),
    });
    expect(res.status).toBe(200);
    const updated = (await res.json()) as BilanzEntity;
    expect(updated.hinweise).toBe('Test-Hinweis via PATCH');
  });

  // ===========================================================================
  // 9. POST /api/bilanz/:id/validate → 200 + ValidierungDto
  // ===========================================================================
  it('POST /api/bilanz/:id/validate → 200 + ValidierungDto', async () => {
    const loginRes = await loginAs('steuerberater@kanzlei.de', 'Demo123!');
    const mandant = loginRes.user.mandanten.find((m) => m.firmenname === 'Demo GmbH');
    if (!mandant) throw new Error('Demo GmbH nicht gefunden');
    const headers = await authHeaders(loginRes.accessToken);
    const listRes = await fetch(`${BASE}/api/bilanz?mandantId=${mandant.id}&geschaeftsjahr=2025`, { headers });
    const list = (await listRes.json()) as BilanzListEntry[];
    const bilanzId = list[0].id;

    const res = await fetch(`${BASE}/api/bilanz/${bilanzId}/validate?mandantId=${mandant.id}`, {
      method: 'POST',
      headers,
    });
    expect(res.status).toBe(200);
    const validation = (await res.json()) as BilanzValidierungDto;
    expect(typeof validation.aktivaSumme).toBe('number');
    expect(typeof validation.passivaSumme).toBe('number');
    expect(typeof validation.saldostimmt).toBe('boolean');
    expect(Array.isArray(validation.fehlendePflichtfelder)).toBe(true);
  });

  // ===========================================================================
  // 10. DELETE /api/bilanz/:id ohne DRAFT (z.B. VALIDATED) → 403 / 400
  // ===========================================================================
  it('DELETE /api/bilanz/:id ohne DRAFT-Status → 400', async () => {
    const loginRes = await loginAs('steuerberater@kanzlei.de', 'Demo123!');
    const mandant = loginRes.user.mandanten.find((m) => m.firmenname === 'Demo GmbH');
    if (!mandant) throw new Error('Demo GmbH nicht gefunden');
    const headers = await authHeaders(loginRes.accessToken);
    const listRes = await fetch(`${BASE}/api/bilanz?mandantId=${mandant.id}&geschaeftsjahr=2025`, { headers });
    const list = (await listRes.json()) as BilanzListEntry[];
    const bilanzId = list[0].id;

    // Versuche, Status auf VALIDATED zu setzen, dann zu loeschen.
    await fetch(`${BASE}/api/bilanz/${bilanzId}?mandantId=${mandant.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ status: 'VALIDATED' }),
    });

    const res = await fetch(`${BASE}/api/bilanz/${bilanzId}?mandantId=${mandant.id}`, {
      method: 'DELETE',
      headers,
    });
    // Erwartung: 400 BadRequestException (Validierung verweigert Loeschung)
    // oder 403 (MandantGuard).
    expect([400, 403, 404]).toContain(res.status);

    // Wieder zurueck auf DRAFT setzen, damit andere Tests nicht leiden.
    await fetch(`${BASE}/api/bilanz/${bilanzId}?mandantId=${mandant.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ status: 'DRAFT' }),
    });
  });
});