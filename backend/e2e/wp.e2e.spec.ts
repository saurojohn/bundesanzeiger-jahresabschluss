/**
 * E2E-Test: WP-/IDW-Prüfungs-Modul.
 *
 * Voraussetzungen:
 *   - Postgres laeuft (z.B. via `npm run docker:stack`).
 *   - Schema migriert und geseedet (`npm run prisma:migrate && npm run prisma:seed`).
 *
 * Tests (lt. Sprint-Plan):
 *   1.  POST /api/wp/notizen ohne Auth → 401
 *   2.  POST /api/wp/notizen ohne WIRTSCHAFTSPRUEFER-Rolle → 403
 *   3.  POST /api/wp/notizen mit STEUERBERATER-Rolle → 403
 *   4.  POST /api/wp/notizen ohne bilanzId/guvId → 400
 *   5.  POST /api/wp/notizen mit notizText > 500 Zeichen → 400
 *   6.  POST /api/wp/notizen → 201 + Notiz
 *   7.  PATCH /api/wp/notizen/:id/status mit eigenem User → 403 (Self-Ack-Schutz)
 *   8.  PATCH /api/wp/notizen/:id/status mit anderem WP → 200 + Status-APPROVED
 *   9.  POST /api/wp/pruefungen → 201 + pruefung
 *   10. Plausi-Pruefung läuft automatisch → 5 BilanzPruefungsResult vorhanden
 *   11. finalize: Selbstfreigabe 403, Freigabe durch die zweite Person 200
 *   12. GET /api/wp/pruefungen/:id/report → 200 + markdownReport mit allen Daten
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

interface WPNotizResponse {
  id: string;
  bilanzId: string | null;
  guvId: string | null;
  status: string;
  notizText: string;
  wpUserId: string;
}

interface BilanzPruefungsResultDto {
  regelCode: string;
  status: string;
  berechneterWert: number;
  schwellwert: number;
  meldung: string;
  geprueftAm: string;
}

interface WPPruefungDto {
  id: string;
  bilanzId: string;
  status: string;
  zusammenfassung: string | null;
  /** `completedAt` stammt aus dem Abschluss-Datensatz (Prisma:
   *  WPPruefungsAbschluss) und wird beim Finalize gesetzt. */
  completedAt?: string | null;
  pruefungsResults: BilanzPruefungsResultDto[];
  notizen: WPNotizResponse[];
}

interface BilanzSummary {
  id: string;
  mandantId: string;
  geschaeftsjahr: number;
  status: string;
}

describe('WP / IDW-Pruefung E2E (M3 Sprint 0)', () => {
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

  /** Mandant-ID eines Login-Ergebnisses (Demo GmbH — dort legt der Seed an).
   *  Bewusst per NAME statt `mandanten[0]`: die API sortiert alphabetisch,
   *  `mandanten[0]` ist daher Beispiel GmbH, wo der Seed NICHTS anlegt.
   *  Diese Kopplung an die Reihenfolge hat den Test zum Scheitern gebracht. */
  function mandantOf(u: { user: { mandanten?: Array<{ id: string; firmenname: string }> } }): string {
    const id = u.user.mandanten?.find((m) => m.firmenname === 'Demo GmbH')?.id;
    expect(id, 'Demo GmbH muss im Mandanten des Users liegen').toBeTruthy();
    return id ?? '';
  }

  async function authFetch(
    token: string,
    path: string,
    init: RequestInit = {},
  ): Promise<Response> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      ...((init.headers as Record<string, string>) ?? {}),
    };
    headers['authorization'] = `Bearer ${token}`;
    return fetch(`${BASE}${path}`, { ...init, headers });
  }

  it('1. POST /api/wp/notizen ohne Auth → 401', async () => {
    const res = await fetch(`${BASE}/api/wp/notizen`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bilanzId: '00000000-0000-4000-8000-000000000000', notizText: 'Test' }),
    });
    expect(res.status).toBe(401);
  });

  it('2. POST /api/wp/notizen ohne WIRTSCHAFTSPRUEFER-Rolle (GF) → 403', async () => {
    const gf = await loginAs('gf-demo@demo-gmbh.de', 'Demo123!');
    const res = await authFetch(
      gf.accessToken,
      `/api/wp/notizen?mandantId=${mandantOf(gf)}`, {
      method: 'POST',
      body: JSON.stringify({
        bilanzId: '00000000-0000-4000-8000-000000000000',
        notizText: 'Test',
      }),
    });
    expect(res.status).toBe(403);
  });

  it('3. POST /api/wp/notizen mit STEUERBERATER-Rolle → 403', async () => {
    const sb = await loginAs('steuerberater@kanzlei.de', 'Demo123!');
    const res = await authFetch(
      sb.accessToken,
      `/api/wp/notizen?mandantId=${mandantOf(sb)}`, {
      method: 'POST',
      body: JSON.stringify({
        bilanzId: '00000000-0000-4000-8000-000000000000',
        notizText: 'Test',
      }),
    });
    expect(res.status).toBe(403);
  });

  it('4. POST /api/wp/notizen ohne bilanzId/guvId → 400', async () => {
    const wp = await loginAs('wp@kanzlei.de', 'Demo123!');
    const res = await authFetch(
      wp.accessToken,
      `/api/wp/notizen?mandantId=${mandantOf(wp)}`, {
      method: 'POST',
      body: JSON.stringify({ notizText: 'Test-Notiz' }),
    });
    expect(res.status).toBe(400);
  });

  it('5. POST /api/wp/notizen mit notizText > 500 Zeichen → 400', async () => {
    const wp = await loginAs('wp@kanzlei.de', 'Demo123!');
    const sb = await loginAs('steuerberater@kanzlei.de', 'Demo123!');
    const bilanzRes = await authFetch(
      sb.accessToken,
      `/api/bilanz?mandantId=${mandantOf(sb)}`,
    );
    const bilanzList = (await bilanzRes.json()) as BilanzSummary[];
    const bilanzId = bilanzList[0]?.id;
    expect(bilanzId).toBeDefined();

    const longText = 'a'.repeat(501);
    const res = await authFetch(
      wp.accessToken,
      `/api/wp/notizen?mandantId=${mandantOf(wp)}`, {
      method: 'POST',
      body: JSON.stringify({ bilanzId, notizText: longText }),
    });
    expect(res.status).toBe(400);
  });

  let wpNotizId = '';
  /** Mandant, unter dem die Notiz tatsaechlich angelegt wurde.
   *  Test 8 darf nicht `mandanten[0]` des jeweils LOGINENDEN Users nehmen:
   *  `wp@kanzlei.de` hat zwei Mandanten, `kanzlei-admin` nur eines — deren
   *  `mandanten[0]` sind verschiedene. MandantGuard lehnt zu Recht ab. */
  let wpNotizMandantId = '';
  let wpBilanzId = '';

  it('6. POST /api/wp/notizen → 201 + Notiz', async () => {
    const wp = await loginAs('wp@kanzlei.de', 'Demo123!');
    const sb = await loginAs('steuerberater@kanzlei.de', 'Demo123!');
    const bilanzRes = await authFetch(
      sb.accessToken,
      `/api/bilanz?mandantId=${mandantOf(sb)}`,
    );
    const bilanzList = (await bilanzRes.json()) as BilanzSummary[];
    wpBilanzId = bilanzList[0]?.id ?? '';
    expect(wpBilanzId).toBeTruthy();

    const res = await authFetch(
      wp.accessToken,
      `/api/wp/notizen?mandantId=${mandantOf(wp)}`, {
      method: 'POST',
      body: JSON.stringify({
        bilanzId: wpBilanzId,
        notizText: 'Bankguthaben wirken überdimensioniert.',
      }),
    });
    expect(res.status).toBe(201);
    const notiz = (await res.json()) as WPNotizResponse;
    expect(notiz.status).toBe('PENDING');
    expect(notiz.wpUserId).toBe(wp.user.id);
    expect(notiz.notizText).toContain('Bankguthaben');
    wpNotizId = notiz.id;
    wpNotizMandantId = wp.user.mandanten?.find((m) => m.firmenname === 'Demo GmbH')?.id ?? '';
  });

  it('7. PATCH /api/wp/notizen/:id/status mit eigenem User → 403 (Self-Ack-Schutz)', async () => {
    expect(wpNotizId).toBeTruthy();
    const wp = await loginAs('wp@kanzlei.de', 'Demo123!');
    const res = await authFetch(
      wp.accessToken,
      `/api/wp/notizen/${wpNotizId}/status?mandantId=${wpNotizMandantId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ status: 'APPROVED' }),
      },
    );
    expect(res.status).toBe(403);
  });

  it('8. PATCH /api/wp/notizen/:id/status mit anderem User (KANZLEI_ADMIN) → 200 + APPROVED', async () => {
    expect(wpNotizId).toBeTruthy();
    const admin = await loginAs('kanzlei-admin@kanzlei.de', 'Demo123!');
    const res = await authFetch(
      admin.accessToken,
      `/api/wp/notizen/${wpNotizId}/status?mandantId=${wpNotizMandantId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ status: 'APPROVED' }),
      },
    );
    expect(res.status).toBe(200);
    const updated = (await res.json()) as WPNotizResponse;
    expect(updated.status).toBe('APPROVED');
  });

  let pruefungId = '';

  it('9. POST /api/wp/pruefungen → 201 + pruefung', async () => {
    expect(wpBilanzId).toBeTruthy();
    const wp = await loginAs('wp@kanzlei.de', 'Demo123!');
    const res = await authFetch(
      wp.accessToken,
      `/api/wp/pruefungen?mandantId=${wpNotizMandantId}`, {
      method: 'POST',
      body: JSON.stringify({
        bilanzId: wpBilanzId,
        zusammenfassung: 'Pilot-Prüfung — Demo GmbH',
      }),
    });
    expect(res.status).toBe(201);
    const pruefung = (await res.json()) as WPPruefungDto;
    expect(pruefung.status).toBe('IN_PROGRESS');
    pruefungId = pruefung.id;
  });

  it('10. Plausi-Pruefung läuft automatisch → 5 BilanzPruefungsResult vorhanden', async () => {
    expect(pruefungId).toBeTruthy();
    const wp = await loginAs('wp@kanzlei.de', 'Demo123!');
    const res = await authFetch(
      wp.accessToken,
      `/api/wp/pruefungen/${pruefungId}?mandantId=${wpNotizMandantId}`);
    expect(res.status).toBe(200);
    const pruefung = (await res.json()) as WPPruefungDto;
    expect(pruefung.pruefungsResults.length).toBe(5);
    const codes = pruefung.pruefungsResults.map((r) => r.regelCode).sort();
    expect(codes).toEqual([
      'IDW_ANLAGEVERMOEGEN_BIS_AKTIVA',
      'IDW_EK_QUOTE',
      'IDW_GOING_CONCERN',
      'IDW_LIQUIDITAET_1',
      'IDW_VERSCHULDUNGSGRAD',
    ]);
  });

  it('11. finalize: Selbstfreigabe 403, Freigabe durch die zweite Person 200', async () => {
    // Bugfix 2026-10-07 (Vier-Augen-Prinzip, IDW PS 880 § 11 Abs. 2 WPO).
    //
    // Dieser Test hat bis eben den BEFUND festgeschrieben: `wp@kanzlei.de`
    // beginnt die Prüfung UND gibt sie selbst frei, und der Test erwartete
    // dafür 200. Genau diese Antwort war fachlich falsch.
    expect(pruefungId).toBeTruthy();
    const wp = await loginAs('wp@kanzlei.de', 'Demo123!');

    // 1) Der Prüfende darf seine eigene Prüfung nicht freigeben.
    const selbst = await authFetch(
      wp.accessToken,
      `/api/wp/pruefungen/${pruefungId}/finalize?mandantId=${wpNotizMandantId}`,
      {
        method: 'POST',
        body: JSON.stringify({
          status: 'APPROVED',
          zusammenfassung: 'Pilot erfolgreich abgeschlossen.',
        }),
      },
    );
    expect(selbst.status, 'Selbstfreigabe muss abgewiesen werden').toBe(403);
    const selbstBody = (await selbst.json()) as { message?: string };
    expect(String(selbstBody.message ?? '')).toMatch(/Vier-Augen-Prinzip/i);

    // 2) Eine zweite Person mit der Rolle WIRTSCHAFTSPRUEFER darf.
    const wp2 = await loginAs('wp2@kanzlei.de', 'Demo123!');
    const res = await authFetch(
      wp2.accessToken,
      `/api/wp/pruefungen/${pruefungId}/finalize?mandantId=${wpNotizMandantId}`,
      {
        method: 'POST',
        body: JSON.stringify({
          status: 'APPROVED',
          zusammenfassung: 'Pilot erfolgreich abgeschlossen.',
        }),
      },
    );
    expect(res.status).toBe(200);
    const pruefung = (await res.json()) as WPPruefungDto;
    expect(pruefung.status).toBe('APPROVED');
    expect(pruefung.completedAt).not.toBeNull();
    // Der Aufzeichnungsstand muss zeigen, dass die Vier-Augen-Pruefung
    // stattgefunden hat (§ 147 AO).
    expect(
      (pruefung as unknown as { freigegebenVonId?: string | null }).freigegebenVonId,
      'die freigebende Person muss festgehalten sein',
    ).toBeTruthy();
  });

  it('12. GET /api/wp/pruefungen/:id/report → 200 + markdownReport', async () => {
    expect(pruefungId).toBeTruthy();
    const wp = await loginAs('wp@kanzlei.de', 'Demo123!');
    const res = await authFetch(
      wp.accessToken,
      `/api/wp/pruefungen/${pruefungId}/report?mandantId=${wpNotizMandantId}`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { pruefungId: string; markdownReport: string };
    expect(body.pruefungId).toBe(pruefungId);
    expect(body.markdownReport).toContain('# Wirtschaftsprüfungs-Bericht');
    expect(body.markdownReport).toContain('IDW_EK_QUOTE');
    expect(body.markdownReport).toContain('IDW_LIQUIDITAET_1');
    expect(body.markdownReport).toContain('IDW_VERSCHULDUNGSGRAD');
    expect(body.markdownReport).toContain('IDW_ANLAGEVERMOEGEN_BIS_AKTIVA');
    expect(body.markdownReport).toContain('IDW_GOING_CONCERN');
    expect(body.markdownReport).toContain('## Plausibilitäts-Ergebnisse (IDW PS 880)');
  });
});