import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * E2E: Archivierte Mandanten werden nicht mehr fortgeschrieben — auch nicht
 * durch die Wirtschaftsprüfung und nicht durch die Signatur.
 *
 * ENTSCHEIDUNG der Fachverantwortlichen vom 2026-10-14:
 *   „Darf ein archivierter Mandant noch geprüft (WP) und signiert werden?"
 *   -> Nein (§ 147 AO). Ein archivierter Mandant wird nicht fortgeschrieben.
 *
 * BEFUND: Bilanz, GuV, Anhang, Konsolidierung und DATEV-Import waren bereits
 * über `assertMandantNichtArchiviert` gesperrt. **WP und Signatur waren es
 * nicht** — und die Signatur ist die folgenreichste Lücke, weil sie ein
 * Dokument mit rechtlicher Wirkung erzeugt.
 *
 * Dieser Spec deckt außerdem etwas ab, das vorher nirgends e2e geprüft war:
 * die Archivierung selbst. Es gab dafür nur einen Unit-Test.
 *
 * WICHTIG — die zweite Hälfte: **Lesen muss weiterhin möglich sein.**
 * § 147 Abs. 3 AO verlangt Aufbewahrung und Nachvollziehbarkeit. Ein
 * archivierter Mandant, dessen Bestand nicht mehr lesbar wäre, wäre kein
 * archivierter Mandant, sondern ein Datenverlust. Deshalb prüft dieser Spec
 * beides getrennt.
 */

const BASE = 'http://localhost:3000';
const P12_PATH = './tmp/test-certs/test-token.p12';
const P12_PASSWORD = 'Test1234!';

describe('Archiv-Sperre: WP und Signatur auf archivierten Mandanten', () => {
  let prisma: PrismaService;
  let wpToken = '';
  let wp2Token = '';
  let adminToken = '';
  let mandantId = '';
  let bilanzId = '';
  let p12Base64 = '';

  async function login(email: string): Promise<string> {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'Demo123!' }),
    });
    if (!res.ok) throw new Error(`Login ${email} fehlgeschlagen: ${res.status}`);
    const body = (await res.json()) as { accessToken: string; user: { mandanten: Array<{ id: string; firmenname: string }> } };
    return body.accessToken;
  }

  function headers(token: string): Record<string, string> {
    return { 'content-type': 'application/json', authorization: `Bearer ${token}` };
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    prisma = moduleRef.get(PrismaService);

    try {
      p12Base64 = readFileSync(join(process.cwd(), P12_PATH)).toString('base64');
    } catch {
      throw new Error(
        `Test-P12 fehlt: \`npx ts-node scripts-gen-test-p12.ts\` erzeugt ${P12_PATH}`,
      );
    }

    wpToken = await login('wp@kanzlei.de');
    // Der zweite Wirtschaftspruefer. `finalize` verlangt das Vier-Augen-Prinzip:
    // wer die Pruefung durchgefuehrt hat, darf sie nicht freigeben. Ohne
    // wp2 wuerde der finalize-Fall an dieser Regel scheitern (403) statt am
    // Archiv-Guard (409) — ein Test, der aus dem falschen Grund rot wird.
    wp2Token = await login('wp2@kanzlei.de');
    adminToken = await login('kanzlei-admin@kanzlei.de');

    const me = (await (
      await fetch(`${BASE}/api/auth/me`, { headers: headers(wpToken) })
    ).json()) as { mandanten: Array<{ id: string; firmenname: string }> };
    const demo = me.mandanten.find((m) => m.firmenname === 'Demo GmbH');
    if (!demo) throw new Error('Demo GmbH nicht im Mandanten des WP');
    mandantId = demo.id;

    const liste = (await (
      await fetch(`${BASE}/api/bilanz?mandantId=${mandantId}`, { headers: headers(wpToken) })
    ).json()) as Array<{ id: string }> | { items: Array<{ id: string }> };
    const arr = Array.isArray(liste) ? liste : liste.items;
    bilanzId = arr[0]?.id ?? '';
    if (!bilanzId) throw new Error('Demo GmbH braucht eine Bilanz (Seed)');
  });

  afterAll(async () => {
    // Aufheben, damit der Rest der Suite einen aktiven Mandanten vorfindet.
    await fetch(`${BASE}/api/mandant/${mandantId}/archivierung/aufheben`, {
      method: 'PATCH',
      headers: { ...headers(adminToken), 'x-mandant-id': mandantId },
    }).catch(() => undefined);
    await prisma.mandant
      .update({ where: { id: mandantId }, data: { archiviertAt: null } })
      .catch(() => undefined);
  });

  async function archivieren(): Promise<void> {
    const res = await fetch(`${BASE}/api/mandant/${mandantId}/archivierung`, {
      method: 'PATCH',
      headers: { ...headers(adminToken), 'x-mandant-id': mandantId },
    });
    expect(res.status, 'Mandant muss sich archivieren lassen').toBe(200);
  }

  async function aufheben(): Promise<void> {
    await fetch(`${BASE}/api/mandant/${mandantId}/archivierung/aufheben`, {
      method: 'PATCH',
      headers: { ...headers(adminToken), 'x-mandant-id': mandantId },
    });
  }

  // =========================================================================
  // 1. Der Kontrollfall: VOR der Archivierung ist alles erlaubt
  //
  // `pruefungId` wird hier bewusst festgehalten: `POST /api/wp/pruefungen`
  // legt eine Prüfung im Status IN_PROGRESS an, und genau die braucht der
  // `finalize`-Fall weiter unten.
  // =========================================================================
  let pruefungId = '';

  it('Kontrolle: vor der Archivierung ist die WP-Prüfung erlaubt (200/201)', async () => {
    const res = await fetch(`${BASE}/api/wp/pruefungen`, {
      method: 'POST',
      headers: { ...headers(wpToken), 'x-mandant-id': mandantId },
      body: JSON.stringify({ bilanzId }),
    });
    expect(res.status, 'ohne Archivierung muss die Prüfung starten').toBe(201);
    const body = (await res.json()) as { pruefung?: { id: string }; id?: string };
    pruefungId = body.pruefung?.id ?? body.id ?? '';
    expect(pruefungId, 'die Kontroll-Prüfung braucht eine ID fuer den finalize-Fall').toBeTruthy();
  });

  // =========================================================================
  // 2. Archiviert -> alle fuenf WP-Schreibpfade 409
  // =========================================================================
  it('archiviert: WP-Schreibpfade werden abgelehnt', async () => {
    await archivieren();
    try {
      const faelle: Array<{ name: string; url: string; body: unknown }> = [
        {
          name: 'POST /api/wp/pruefungen (Prüfung starten)',
          url: `${BASE}/api/wp/pruefungen`,
          body: { bilanzId },
        },
        {
          name: 'POST /api/wp/bilanz/:id/regeln/run (Plausibilität)',
          url: `${BASE}/api/wp/bilanz/${bilanzId}/regeln/run`,
          body: {},
        },
        {
          name: 'POST /api/wp/notizen (Notiz anlegen)',
          url: `${BASE}/api/wp/notizen`,
          body: { bilanzId, notizText: 'Archiv-Sperre' },
        },
        {
          // Prüft den Guard in `finalizePruefung` selbst. Ohne ihn wäre der
          // Fall grün aus dem falschen Grund.
          name: 'POST /api/wp/pruefungen/:id/finalize (Prüfung abschließen)',
          url: `${BASE}/api/wp/pruefungen/${pruefungId}/finalize`,
          body: { status: 'APPROVED', zusammenfassung: 'Archiv-Sperre' },
        },
        {
          name: 'POST /api/signatur/sign-bilanz (signieren)',
          url: `${BASE}/api/signatur/sign-bilanz`,
          body: { bilanzId, mandantId, p12Base64, p12Password: P12_PASSWORD },
        },
      ];

      for (const f of faelle) {
        // Der finalize-Fall laeuft als ZWEITER WP, sonst greift zuerst das
        // Vier-Augen-Prinzip statt des Archiv-Guards.
        const token = f.name.includes('abschließen') ? wp2Token : wpToken;
        const res = await fetch(f.url, {
          method: 'POST',
          headers: { ...headers(token), 'x-mandant-id': mandantId },
          body: JSON.stringify(f.body),
        });
        const text = await res.text();
        expect(
          res.status,
          `${f.name} muss auf einem archivierten Mandanten abgelehnt werden — war ${res.status}: ${text.slice(0, 160)}`,
        ).toBe(409);
        expect(text, 'die Meldung muss den Archivgrund nennen').toContain('archiviert');
      }
    } finally {
      await aufheben();
    }
  });

  // =========================================================================
  // 3. Der Gegenbeweis: LESEN bleibt moeglich (§ 147 Abs. 3 AO)
  // =========================================================================
  it('archiviert: Lesen bleibt moeglich (Bestand bleibt nachvollziehbar)', async () => {
    await archivieren();
    try {
      const lesen: Array<{ name: string; url: string }> = [
        { name: 'GET /api/bilanz/:id', url: `${BASE}/api/bilanz/${bilanzId}?mandantId=${mandantId}` },
        { name: 'GET /api/bilanz (Liste)', url: `${BASE}/api/bilanz?mandantId=${mandantId}` },
        { name: 'GET /api/wp/notizen', url: `${BASE}/api/wp/notizen?bilanzId=${bilanzId}` },
        { name: 'GET /api/signatur/signaturen', url: `${BASE}/api/signatur/signaturen?entityType=Bilanz&entityId=${bilanzId}` },
      ];

      for (const l of lesen) {
        const res = await fetch(l.url, {
          headers: { ...headers(wpToken), 'x-mandant-id': mandantId },
        });
        const text = await res.text();
        expect(
          res.status,
          `${l.name} muss bei archiviertem Mandanten lesbar bleiben — war ${res.status}: ${text.slice(0, 160)}`,
        ).toBe(200);
      }
    } finally {
      await aufheben();
    }
  });

  // =========================================================================
  // 4. Nach der Aufhebung gilt wieder der Normalfall
  // =========================================================================
  it('nach Aufhebung: Signieren ist wieder moeglich', async () => {
    await archivieren();
    const gesperrt = await fetch(`${BASE}/api/signatur/sign-bilanz`, {
      method: 'POST',
      headers: { ...headers(wpToken), 'x-mandant-id': mandantId },
      body: JSON.stringify({ bilanzId, mandantId, p12Base64, p12Password: P12_PASSWORD }),
    });
    expect(gesperrt.status).toBe(409);

    await aufheben();

    const frei = await fetch(`${BASE}/api/signatur/sign-bilanz`, {
      method: 'POST',
      headers: { ...headers(wpToken), 'x-mandant-id': mandantId },
      body: JSON.stringify({ bilanzId, mandantId, p12Base64, p12Password: P12_PASSWORD }),
    });
    expect(frei.status, 'nach Aufhebung muss die Signatur wieder durchgehen').toBe(200);
  });
});
