/**
 * E2E-Test: mandantId-Quelle (Header vs. Query vs. Body).
 *
 * Hintergrund (Bugfix 2026-10-03): der MandantGuard akzeptiert vier Quellen
 * fuer die mandantId (`params.mandantId` → `x-mandant-id`-Header → `?mandantId=`
 * → Body-Feld). Die Controller lasen jeweils nur eine Teilmenge. Ein Client,
 * der den Mandaten ueber den Header waehlt — genau das macht das Frontend in
 * `apiFetch` — passierte den Guard und bekam danach:
 *
 *   - PATCH /api/{bilanz,guv,anhang}/:id  → nackter `Error` → HTTP 500.
 *     "Speichern" eines bestehenden Datensatzes war in der Oberflaeche
 *     unmoeglich. Empirisch bestaetigt (Negativprobe gegen den Alt-Code:
 *     genau diese vier Tests fallen ohne den Fix um).
 *   - POST /api/bilanz/:id/validate, GET /api/datev/..., DELETE /api/guv/:id
 *     → `mandantId` war `undefined` in der Service-Schicht → 403 "Kein Zugriff
 *     auf diesen Mandanten", obwohl der Mandant authorisiert war.
 *
 * Diese Spec faengt die Fehlerklasse als Ganzes ab: sie geht jede betroffene
 * Route mit NUR Header an. Wer eine Route wieder auf eine Teilmenge der
 * Quellen zurueckbaut, laesst genau diese Tests rot werden.
 *
 * Ausgefuehrt wird gegen die Live-App (Port 3000), nicht gegen ein
 * Testing-Module — damit ist das Verhalten das Produktionsverhalten.
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

interface ListResponse<T> {
  id: string;
  mandantId: string;
  geschaeftsjahr: number;
  status: string;
  positionen?: T[];
}

describe('mandantId-Quelle E2E (Header muss Query ersetzen koennen)', () => {
  let app: INestApplication;
  let accessToken: string;
  let mandantId: string;

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

    const loginRes = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'steuerberater@kanzlei.de',
        password: 'Demo123!',
      }),
    });
    expect(loginRes.status).toBe(200);
    const login = (await loginRes.json()) as LoginResponse;
    accessToken = login.accessToken;
    mandantId = login.user.mandanten[0].id;
  });

  afterAll(async () => {
    await app.close();
  });

  /** Authorization + `x-mandant-id`, OHNE `?mandantId=` — der Weg des Frontends. */
  function headerOnly(extra: Record<string, string> = {}): Record<string, string> {
    return {
      'content-type': 'application/json',
      authorization: `Bearer ${accessToken}`,
      'x-mandant-id': mandantId,
      ...extra,
    };
  }

  function authOnly(extra: Record<string, string> = {}): Record<string, string> {
    return {
      'content-type': 'application/json',
      authorization: `Bearer ${accessToken}`,
      ...extra,
    };
  }

  /**
   * Anlegen ueber `?mandantId=` + mandantId im Body — so macht es das
   * Frontend. Das Create-DTO verlangt `mandantId` zwingend im Body
   * (CreateGuVDto/CreateBilanzDto), die mandantId-Quelle ist also nur fuer
   * PATCH/DELETE/GET/validate/PDF relevant — genau die Routen, die hier
   * geprueft werden.
   */
  async function createBilanz(jahr: number): Promise<ListResponse<unknown>> {
    const res = await fetch(`${BASE}/api/bilanz?mandantId=${mandantId}`, {
      method: 'POST',
      headers: headerOnly(),
      body: JSON.stringify({
        mandantId,
        geschaeftsjahr: jahr,
        positionen: [
          { seite: 'AKTIVA', kontonummer: 'B.IV.', bezeichnung: 'Kassenbestand', betragAktuell: 100000, reihenfolge: 1 },
          { seite: 'PASSIVA', kontonummer: 'A.I.', bezeichnung: 'Gezeichnetes Kapital', betragAktuell: 100000, reihenfolge: 1 },
        ],
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { bilanz: ListResponse<unknown> };
    return body.bilanz;
  }

  async function createGuv(jahr: number): Promise<ListResponse<unknown>> {
    const res = await fetch(`${BASE}/api/guv?mandantId=${mandantId}`, {
      method: 'POST',
      headers: headerOnly(),
      body: JSON.stringify({
        mandantId,
        geschaeftsjahr: jahr,
        verfahren: 'GKV',
        positionen: [
          { kontonummer: '1.', bezeichnung: 'Umsatzerloese', kategorie: 'ERLOES', betragAktuell: 100000, reihenfolge: 1 },
        ],
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { guv: ListResponse<unknown> };
    return body.guv;
  }

  async function createAnhang(jahr: number): Promise<ListResponse<unknown>> {
    const res = await fetch(`${BASE}/api/anhang?mandantId=${mandantId}`, {
      method: 'POST',
      headers: headerOnly(),
      body: JSON.stringify({
        mandantId,
        geschaeftsjahr: jahr,
        bilanzierungsMethoden: 'nach Vorjahresabschluss',
        // `abschnitte` traegt im DTO ein `?`, wird aber ohne `@IsOptional()`
        // validiert — das Feld muss mitgeschickt werden (leer ist erlaubt).
        abschnitte: [],
      }),
    });
    expect(res.status).toBe(201);
    return (await res.json()) as ListResponse<unknown>;
  }

  // ===========================================================================
  // 1. Regression: PATCH mit NUR Header war HTTP 500
  // ===========================================================================
  it('PATCH /api/bilanz/:id mit NUR x-mandant-id-Header → 200 (kein 500)', async () => {
    const bilanz = await createBilanz(2081);
    const res = await fetch(`${BASE}/api/bilanz/${bilanz.id}`, {
      method: 'PATCH',
      headers: headerOnly(),
      body: JSON.stringify({ hinweise: 'ueber Header gespeichert' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ListResponse<unknown>;
    expect(body.hinweise).toBe('ueber Header gespeichert');
  });

  it('PATCH /api/guv/:id mit NUR x-mandant-id-Header → 200 (kein 500)', async () => {
    const guv = await createGuv(2081);
    const res = await fetch(`${BASE}/api/guv/${guv.id}`, {
      method: 'PATCH',
      headers: headerOnly(),
      body: JSON.stringify({ hinweise: 'ueber Header gespeichert' }),
    });
    expect(res.status).toBe(200);
  });

  it('PATCH /api/anhang/:id mit NUR x-mandant-id-Header → 200 (kein 500)', async () => {
    const anhang = await createAnhang(2081);
    const res = await fetch(`${BASE}/api/anhang/${anhang.id}`, {
      method: 'PATCH',
      headers: headerOnly(),
      body: JSON.stringify({ sonstigePflichtangaben: 'ueber Header gespeichert' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sonstigePflichtangaben?: string };
    expect(body.sonstigePflichtangaben).toBe('ueber Header gespeichert');
  });

  // ===========================================================================
  // 2. Regression: validate mit NUR Header war 403 "Kein Zugriff auf diesen
  //    Mandanten" — sachlich falsch, der Mandant war authorisiert.
  // ===========================================================================
  it('POST /api/bilanz/:id/validate mit NUR Header → 200 (kein 403)', async () => {
    const bilanz = await createBilanz(2082);
    const res = await fetch(`${BASE}/api/bilanz/${bilanz.id}/validate`, {
      method: 'POST',
      headers: headerOnly(),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const validierung = (await res.json()) as { saldostimmt: boolean };
    expect(validierung.saldostimmt).toBe(true);
  });

  // ===========================================================================
  // 3. Regression: DELETE mit NUR Header
  // ===========================================================================
  it('DELETE /api/guv/:id (DRAFT) mit NUR Header → 204', async () => {
    const guv = await createGuv(2083);
    const res = await fetch(`${BASE}/api/guv/${guv.id}`, {
      method: 'DELETE',
      headers: headerOnly(),
    });
    expect(res.status).toBe(204);

    const danach = await fetch(`${BASE}/api/guv/${guv.id}?mandantId=${mandantId}`, {
      headers: headerOnly(),
    });
    expect(danach.status).toBe(404);
  });

  // ===========================================================================
  // 4. PDF-Generate: alle drei Quellen muessen weiter funktionieren.
  //
  //    Ehrliche Einordnung: dieser Endpunkt war KEIN 500er-Fall. Er las
  //    `body?.mandantId` zuerst und fiel sonst auf Query + Header zurueck —
  //    Body, Query und Header waren also schon abgedeckt. Die Tests sichern
  //    das ab, damit die Vereinheitlichung auf `requireMandantId` nichts
  //    verliert (der alte Helper kannte `params.mandantId` nicht undwarf einen
  //    nackten Error, der als 500 gelandet waere).
  // ===========================================================================
  it('POST /api/pdf/guv/:id/generate mit mandantId nur im Body → 200', async () => {
    const guv = await createGuv(2084);
    const res = await fetch(`${BASE}/api/pdf/guv/${guv.id}/generate`, {
      method: 'POST',
      headers: authOnly(),
      body: JSON.stringify({ mandantId }),
    });
    // Der Endpunkt streamt die PDF-Datei, deshalb 200 statt 201.
    expect(res.status).toBe(200);
  });

  it('POST /api/pdf/guv/:id/generate mit NUR Header → 200', async () => {
    const guv = await createGuv(2085);
    const res = await fetch(`${BASE}/api/pdf/guv/${guv.id}/generate`, {
      method: 'POST',
      headers: headerOnly(),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
  });

  // ===========================================================================
  // 5. Der Query-Parameter muss weiterhin funktionieren (Rueckwaerts-
  //    kompatibilitaet: die Listen-Views haengen ?mandantId= an)
  // ===========================================================================
  it('GET /api/guv?mandantId= (nur Query, kein Header) → 200', async () => {
    const res = await fetch(`${BASE}/api/guv?mandantId=${mandantId}`, {
      headers: authOnly(),
    });
    expect(res.status).toBe(200);
    const list = (await res.json()) as ListResponse<unknown>[];
    expect(Array.isArray(list)).toBe(true);
  });

  it('POST /api/pdf/guv/:id/generate mit mandantId nur im Query → 200', async () => {
    const guv = await createGuv(2086);
    const res = await fetch(
      `${BASE}/api/pdf/guv/${guv.id}/generate?mandantId=${mandantId}`,
      { method: 'POST', headers: authOnly(), body: JSON.stringify({}) },
    );
    expect(res.status).toBe(200);
  });

  // ===========================================================================
  // 6. Ohne jede mandantId-Angabe bleibt es beim Guard: 403, nie 500.
  // ===========================================================================
  it('PATCH /api/guv/:id ohne jede mandantId-Angabe → 403 (nicht 500)', async () => {
    const guv = await createGuv(2087);
    const res = await fetch(`${BASE}/api/guv/${guv.id}`, {
      method: 'PATCH',
      headers: authOnly(),
      body: JSON.stringify({ hinweise: 'x' }),
    });
    expect(res.status).toBe(403);
  });

  // ===========================================================================
  // 7. Zugriffsschutz: Header einer fremden mandantId → 403
  //    (der Decorator darf die Pruefung des Guards nicht umgehen)
  // ===========================================================================
  it('PATCH mit Header einer fremden mandantId → 403 "Kein Zugriff"', async () => {
    const guv = await createGuv(2088);
    const res = await fetch(`${BASE}/api/guv/${guv.id}`, {
      method: 'PATCH',
      headers: headerOnly({ 'x-mandant-id': '00000000-0000-4000-8000-000000000000' }),
      body: JSON.stringify({ hinweise: 'fremd' }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { message: string };
    expect(body.message).toContain('Kein Zugriff');
  });

  it('GET /api/guv mit Header einer fremden mandantId → 403 (Mandantentrennung)', async () => {
    const res = await fetch(`${BASE}/api/guv`, {
      headers: headerOnly({ 'x-mandant-id': '00000000-0000-4000-8000-000000000000' }),
    });
    expect(res.status).toBe(403);
  });
});
