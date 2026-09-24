/**
 * E2E-Test: Konzern-Konsolidierung (PublG §11, HGB §§ 301–306).
 *
 * Tests (lt. Sprint-Plan):
 *   1.  POST /api/konsolidierung/einheiten ohne Auth → 401
 *   2.  POST /api/konsolidierung/einheiten ohne WIRTSCHAFTSPRUEFER-Rolle → 403
 *   3.  POST /api/konsolidierung/einheiten mit Cross-Kanzlei-Mandanten → 403
 *   4.  POST /api/konsolidierung/einheiten mit 0 Tochtern → 400 (Validation)
 *   5.  POST /api/konsolidierung/einheiten mit beteiligungsquote > 100 → 400
 *   6.  POST /api/konsolidierung/einheiten mit 1 Mutter + 1 Tochter → 201
 *   7.  GET /api/konsolidierung/einheiten/:id → 200 + Einheit
 *   8.  POST /api/konsolidierung/einheiten/:id/calculate → 200 + Buchungen
 *   9.  POST /api/konsolidierung/einheiten/:id/apply → 201 + Konzern-IDs
 *   10. POST /api/konsolidierung/einheiten/:id/finalize → 204
 *
 * Hinweis: Diese Tests sind gegen die Live-App (Port 3000). Tests werden
 * gegen Test-Stack mit DB-Schema ausgeführt.
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

interface KonsolidierungEinheit {
  id: string;
  kanzleiId: string;
  mutterMandantId: string;
  tochterMandantIds: string[];
  geschaeftsjahr: number;
  beteiligungsquote: number;
  konsolidierungsArt: string;
  status: string;
  konzernBilanzId: string | null;
  konzernGuvId: string | null;
  buchungen: KonsolidierungsBuchung[];
}

interface KonsolidierungsBuchung {
  id: string;
  einheitId: string;
  buchungsArt: string;
  beschreibung: string;
  kontoSoll: string;
  kontoHaben: string;
  betrag: number;
  mandantId: string | null;
  bezugId: string | null;
  reihenfolge: number;
  istAutomatisch: boolean;
}

interface ApplyResponse {
  konzernBilanzId: string;
  konzernGuvId: string;
  salden: {
    konzernAktivaSumme: number;
    konzernPassivaSumme: number;
    konzernBilanzDifferenz: number;
    konzernGuVErgebnis: number;
    eigenkapitalQuoteKonzern: number;
    goodwill: number;
    badwill: number;
  };
  anzahlBuchungen: number;
}

describe('Konsolidierung E2E (M3 Sprint 1)', () => {
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

  async function loginAs(
    email: string,
    password: string,
  ): Promise<LoginResponse> {
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

  async function authHeaders(
    accessToken: string,
  ): Promise<Record<string, string>> {
    return {
      'content-type': 'application/json',
      authorization: `Bearer ${accessToken}`,
    };
  }

  // ===========================================================================
  // 1. POST /api/konsolidierung/einheiten ohne Auth → 401
  // ===========================================================================
  it('POST /api/konsolidierung/einheiten ohne Auth → 401', async () => {
    const res = await fetch(`${BASE}/api/konsolidierung/einheiten`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mutterMandantId: '00000000-0000-4000-8000-000000000000',
        tochterMandantIds: ['00000000-0000-4000-8000-000000000001'],
        geschaeftsjahr: 2025,
        beteiligungsquote: 100,
        konsolidierungsArt: 'VOLLKONSOLIDIERUNG',
      }),
    });
    expect(res.status).toBe(401);
  });

  // ===========================================================================
  // 2. POST ohne WIRTSCHAFTSPRUEFER-Rolle (z.B. GF) → 403
  // ===========================================================================
  it('POST /api/konsolidierung/einheiten als GF → 403', async () => {
    const loginRes = await loginAs('gf-demo@demo-gmbh.de', 'Demo123!');
    const headers = await authHeaders(loginRes.accessToken);
    const res = await fetch(`${BASE}/api/konsolidierung/einheiten`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        mutterMandantId: loginRes.user.mandanten[0].id,
        tochterMandantIds: [loginRes.user.mandanten[0].id],
        geschaeftsjahr: 2025,
        beteiligungsquote: 100,
        konsolidierungsArt: 'VOLLKONSOLIDIERUNG',
      }),
    });
    expect(res.status).toBe(403);
  });

  // ===========================================================================
  // 3. POST mit Cross-Kanzlei-Mandanten → 403
  // ===========================================================================
  it('POST /api/konsolidierung/einheiten mit Cross-Kanzlei-Mandanten → 403', async () => {
    const loginRes = await loginAs('wp@kanzlei.de', 'Demo123!');
    const headers = await authHeaders(loginRes.accessToken);
    // Zweiter Mandant existiert nicht oder ist in anderer Kanzlei
    const res = await fetch(`${BASE}/api/konsolidierung/einheiten`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        mutterMandantId: loginRes.user.mandanten[0].id,
        tochterMandantIds: [
          '00000000-0000-4000-8000-000000000099', // existiert nicht
        ],
        geschaeftsjahr: 2025,
        beteiligungsquote: 100,
        konsolidierungsArt: 'VOLLKONSOLIDIERUNG',
      }),
    });
    expect(res.status).toBe(403);
  });

  // ===========================================================================
  // 4. POST mit 0 Tochtern → 400 (Validation)
  // ===========================================================================
  it('POST /api/konsolidierung/einheiten mit 0 Tochtern → 400', async () => {
    const loginRes = await loginAs('wp@kanzlei.de', 'Demo123!');
    const headers = await authHeaders(loginRes.accessToken);
    const res = await fetch(`${BASE}/api/konsolidierung/einheiten`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        mutterMandantId: loginRes.user.mandanten[0].id,
        tochterMandantIds: [],
        geschaeftsjahr: 2025,
        beteiligungsquote: 100,
        konsolidierungsArt: 'VOLLKONSOLIDIERUNG',
      }),
    });
    expect(res.status).toBe(400);
  });

  // ===========================================================================
  // 5. POST mit beteiligungsquote > 100 → 400
  // ===========================================================================
  it('POST /api/konsolidierung/einheiten mit beteiligungsquote > 100 → 400', async () => {
    const loginRes = await loginAs('wp@kanzlei.de', 'Demo123!');
    const headers = await authHeaders(loginRes.accessToken);
    const res = await fetch(`${BASE}/api/konsolidierung/einheiten`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        mutterMandantId: loginRes.user.mandanten[0].id,
        tochterMandantIds: ['00000000-0000-4000-8000-000000000001'],
        geschaeftsjahr: 2025,
        beteiligungsquote: 150,
        konsolidierungsArt: 'VOLLKONSOLIDIERUNG',
      }),
    });
    expect(res.status).toBe(400);
  });

  // ===========================================================================
  // 6. POST mit 1 Mutter + 1 Tochter → 201
  // ===========================================================================
  it('POST /api/konsolidierung/einheiten mit 1 Mutter + 1 Tochter → 201', async () => {
    const loginRes = await loginAs('wp@kanzlei.de', 'Demo123!');
    const headers = await authHeaders(loginRes.accessToken);
    // Hole 2 Mandanten der Kanzlei (Demo GmbH + Demo AG wenn vorhanden)
    const mandantListRes = await fetch(`${BASE}/api/mandant`, { headers });
    const mandanten = (await mandantListRes.json()) as Array<{
      id: string;
      firmenname: string;
    }>;
    if (mandanten.length < 2) {
      throw new Error('Pilot benötigt ≥ 2 Mandanten in der Kanzlei');
    }
    const res = await fetch(`${BASE}/api/konsolidierung/einheiten`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        mutterMandantId: mandanten[0].id,
        tochterMandantIds: [mandanten[1].id],
        geschaeftsjahr: 2025,
        beteiligungsquote: 100,
        konsolidierungsArt: 'VOLLKONSOLIDIERUNG',
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as KonsolidierungEinheit;
    expect(body.id).toBeTruthy();
    expect(body.status).toBe('DRAFT');
    expect(body.mutterMandantId).toBe(mandanten[0].id);
    expect(body.tochterMandantIds).toContain(mandanten[1].id);
  });

  // ===========================================================================
  // 7. GET /api/konsolidierung/einheiten/:id → 200
  // ===========================================================================
  it('GET /api/konsolidierung/einheiten/:id → 200 + Einheit', async () => {
    const loginRes = await loginAs('wp@kanzlei.de', 'Demo123!');
    const headers = await authHeaders(loginRes.accessToken);

    const listRes = await fetch(`${BASE}/api/konsolidierung/einheiten`, {
      headers,
    });
    const list = (await listRes.json()) as KonsolidierungEinheit[];
    if (list.length === 0) {
      throw new Error('Keine Einheiten zum Testen vorhanden');
    }
    const einheitId = list[0].id;
    const res = await fetch(`${BASE}/api/konsolidierung/einheiten/${einheitId}`, {
      headers,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as KonsolidierungEinheit;
    expect(body.id).toBe(einheitId);
    expect(Array.isArray(body.buchungen)).toBe(true);
  });

  // ===========================================================================
  // 8. POST /api/konsolidierung/einheiten/:id/calculate → 200 + Buchungen
  // ===========================================================================
  it('POST /api/konsolidierung/einheiten/:id/calculate → 200 + Buchungen', async () => {
    const loginRes = await loginAs('wp@kanzlei.de', 'Demo123!');
    const headers = await authHeaders(loginRes.accessToken);

    const listRes = await fetch(`${BASE}/api/konsolidierung/einheiten`, {
      headers,
    });
    const list = (await listRes.json()) as KonsolidierungEinheit[];
    if (list.length === 0) {
      throw new Error('Keine Einheiten zum Testen vorhanden');
    }
    const einheitId = list[0].id;
    const res = await fetch(
      `${BASE}/api/konsolidierung/einheiten/${einheitId}/calculate`,
      {
        method: 'POST',
        headers,
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as KonsolidierungsBuchung[];
    expect(Array.isArray(body)).toBe(true);
  });

  // ===========================================================================
  // 9. POST /api/konsolidierung/einheiten/:id/apply → 201 + Konzern-IDs
  // ===========================================================================
  it('POST /api/konsolidierung/einheiten/:id/apply → 201 + Konzern-IDs', async () => {
    const loginRes = await loginAs('wp@kanzlei.de', 'Demo123!');
    const headers = await authHeaders(loginRes.accessToken);

    const listRes = await fetch(`${BASE}/api/konsolidierung/einheiten`, {
      headers,
    });
    const list = (await listRes.json()) as KonsolidierungEinheit[];
    if (list.length === 0) {
      throw new Error('Keine Einheiten zum Testen vorhanden');
    }
    const einheitId = list[0].id;
    const res = await fetch(
      `${BASE}/api/konsolidierung/einheiten/${einheitId}/apply`,
      {
        method: 'POST',
        headers,
      },
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as ApplyResponse;
    expect(body.konzernBilanzId).toBeTruthy();
    expect(body.konzernGuvId).toBeTruthy();
    expect(body.salden).toBeTruthy();
  });

  // ===========================================================================
  // 10. POST /api/konsolidierung/einheiten/:id/finalize → 204
  // ===========================================================================
  it('POST /api/konsolidierung/einheiten/:id/finalize → 204', async () => {
    const loginRes = await loginAs('wp@kanzlei.de', 'Demo123!');
    const headers = await authHeaders(loginRes.accessToken);

    const listRes = await fetch(`${BASE}/api/konsolidierung/einheiten`, {
      headers,
    });
    const list = (await listRes.json()) as KonsolidierungEinheit[];
    if (list.length === 0) {
      throw new Error('Keine Einheiten zum Testen vorhanden');
    }
    const einheitId = list[0].id;
    const res = await fetch(
      `${BASE}/api/konsolidierung/einheiten/${einheitId}/finalize`,
      {
        method: 'POST',
        headers,
      },
    );
    expect(res.status).toBe(204);
  });
});