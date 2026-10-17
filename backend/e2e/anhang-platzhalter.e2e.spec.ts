import { beforeAll, describe, expect, it } from 'vitest';
import { afterAll } from 'vitest';
// Kein `Test.createTestingModule({ imports: [AppModule] })`.
//
// `AuditIntegrityService` haelt die Hash-Verkettung in einer
// INSTANZ-Eigenen Promise-Kette. Ein zweiter Nest-Container (wie ihn
// `mandant-quelle.e2e` und `signatur.e2e` aufbauen) bekommt eine eigene
// Kette — und `e2e/audit-chain.e2e` ist bei zwei Vollläufen unterschiedlich
// rot geworden. Dieser Spec braucht nur den Datenbankzugriff für das
// Aufräumen, also wird `PrismaClient` direkt benutzt.
import { PrismaClient } from '@prisma/client';
import { ANHANG_VORLAGEN_PLATZHALTER } from '../src/modules/anhang/constants/anhang.constants';

const BASE = 'http://localhost:3000';

/**
 * E2E: Die Detailantwort des Anhangs nennt die offenen Platzhalter.
 *
 * BEFUND 2026-10-17: Ein aus der Vorlage angelegter Anhang speichert
 * `[Ort]`, `[Nummer]`, `[Steuernummer]`, `[Name]` und `[Anzahl]`
 * unaufgeloest, und die PDF-Erzeugung liefert trotzdem HTTP 200 — ein
 * veroeffentlichungsfaehiges Dokument mit "[Ort]" darin. Fuer den Anhang
 * gab es keine Validierungsroute, also auch keine Stelle, an der ein
 * Anwender etwas haette sehen koennen.
 *
 * Die reine Logik prueft `anhang-platzhalter.spec.ts`; hier geht es um den
 * Weg durch die echte API.
 */
describe('Anhang E2E: offene Platzhalter', () => {
  let prisma: PrismaClient;
  let mid = '';
  let anhangId = '';
  let token = '';
  const jahr = 2071;

  beforeAll(async () => {
    prisma = new PrismaClient();

    const login = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'steuerberater@kanzlei.de', password: 'Demo123!' }),
    });
    // `Response.json()` liefert in dieser tsconfig `unknown` — ohne Cast
    // ist der Zugriff auf `.accessToken` ein TS2571.
    token = ((await login.json()) as { accessToken: string }).accessToken;
    // Nicht verschachtelt: `(await (await f()).json()) as T` verliert hier
    // den Typ (TS2571 „Object is of type unknown").
    const meRes = await fetch(`${BASE}/api/auth/me`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const me = (await meRes.json()) as { mandanten: Array<{ id: string; firmenname: string }> };
    mid = me.mandanten.find((m) => m.firmenname === 'Demo GmbH')?.id ?? '';
    expect(mid, 'Demo GmbH muss erreichbar sein').not.toBe('');

    const tpl = (await (await fetch(`${BASE}/api/anhang/templates`, {
      headers: { authorization: `Bearer ${token}`, 'x-mandant-id': mid },
    })).json()) as Array<{ titel: string; reihenfolge: number; inhaltVorlage: string }>;

    const create = await fetch(`${BASE}/api/anhang?mandantId=${mid}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'x-mandant-id': mid,
      },
      body: JSON.stringify({
        mandantId: mid,
        geschaeftsjahr: jahr,
        abschnitte: tpl.map((a) => ({
          titel: a.titel,
          reihenfolge: a.reihenfolge,
          inhalt: a.inhaltVorlage,
        })),
      }),
    });
    expect(create.status, 'der Anhang muss anlegbar sein').toBe(201);
    // Die Anlage-Antwort IST der Datensatz (kein `{ anhang: … }`) — erster
    // Entwurf nahm die falsche Form und schlug fehl.
    const angelegt = (await create.json()) as { id?: string; anhang?: { id: string } };
    anhangId = angelegt.id ?? angelegt.anhang?.id ?? '';
    expect(anhangId, 'die Anlage-Antwort muss eine id liefern').not.toBe('');
  });

  afterAll(async () => {
    await prisma.anhang.deleteMany({ where: { geschaeftsjahr: jahr, mandantId: mid } });
    await prisma.$disconnect();
  });

  it('die Detailantwort liefert die offenen Platzhalter', async () => {
    const detail = (await (
      // Mit Token: die Detailroute haengt am globalen JwtAuthGuard. Ohne
      // Authorization kommt 401 zurueck, und `offenePlatzhalter` fehlt dann —
      // erster Entwurf schickte nur `x-mandant-id` und meldete
      // "expected undefined".
      await fetch(`${BASE}/api/anhang/${anhangId}?mandantId=${mid}`, {
        headers: { authorization: `Bearer ${token}`, 'x-mandant-id': mid },
      })
    ).json()) as {
      offenePlatzhalter?: string[];
      anhang?: { offenePlatzhalter?: string[] };
    };

    const offen = detail.anhang?.offenePlatzhalter ?? detail.offenePlatzhalter ?? [];
    // REihenfolgeunabhaengig vergleichen: der Service liefert die Platzhalter
    // in der Reihenfolge der Vorlage, `toEqual` auf Arrays ist aber
    // reihenfolgeempfindlich. Der erste Entwurf verglich `[Ort, Nummer, …]`
    // mit `[Anzahl, Name, …]` — gleiche Menge, anderer Vergleich.
    expect([...offen].sort()).toEqual([...ANHANG_VORLAGEN_PLATZHALTER].sort());
  });
});
