import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

/**
 * Audit-Kette: das Löschen eines Mandanten darf sie nicht zerstören.
 *
 * BEFUND 2026-10-19 (Nachtrag 54): `AuditLog.mandantId` ist ein
 * Fremdschluessel auf `Mandant`. Prisma setzt bei optionalen Relationen
 * `onDelete: SetNull` — **die Datenbank** setzt die Spalte auf NULL, wenn
 * der Mandant geloescht wird. Der Audit-Eintrag blieb dabei bestehen (die
 * Aufzeichnung "Mandant wurde angelegt" soll ja erhalten bleiben), aber
 * `mandantId` war Teil des gehashten Inhalts. Der gespeicherte Hash passte
 * danach nicht mehr zum Datensatz.
 *
 * Reproduktion ueber die oeffentliche API:
 *
 *     (1) POST /api/mandant         -> Audit-Eintrag mit mandantId=<id>
 *     (2) DELETE /api/mandant/<id>  -> 204
 *     (3) AuditLog.mandantId ist jetzt NULL, entryHash unveraendert
 *     (4) GET /api/audit/integrity  -> BROKEN
 *
 * **Jedes Loeschen eines Mandanten war damit eine dauerhafte Beschaedigung
 * der Audit-Kette seiner Kanzlei.** Und weil `verifyIntegrity()` am ersten
 * inkonsistenten Knoten abbricht, war danach **jeder weitere Eintrag nicht
 * mehr verifizierbar**. Fuer einen Auditor sieht `BROKEN` wie Manipulation
 * aus.
 *
 * Behoben: Der Hash schuetzt den **Inhalt** (Aktion, Entitaet,
 * previousState/newState, IP, User-Agent, Zeitpunkt), nicht die
 * **Referenzen**, die die Datenbank von sich aus aendert. Die Identitaet der
 * Entitaet bleibt geschuetzt, weil `toAuditDto()` ihre `id` in
 * `newState`/`previousState` schreibt — also in den gehashten Inhalt.
 */

const BASE = 'http://localhost:3000';

describe('Audit-Kette überlebt das Löschen eines Mandanten', () => {
  const prisma = new PrismaClient();
  let adminToken = '';
  let kanzleiId = '';
  let mandantId = '';

  const login = async (email: string, pw = 'Demo123!') => {
    const r = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: pw }),
    });
    const d = (await r.json()) as { accessToken: string };
    expect(d.accessToken, `Login ${email}`).toBeTruthy();
    return d.accessToken;
  };

  const integritaet = async () => {
    const r = await (
      await fetch(`${BASE}/api/audit/integrity?kanzleiId=${kanzleiId}`, {
        headers: { authorization: `Bearer ${adminToken}` },
      })
    ).json();
    return r as { status: string; entriesChecked: number };
  };

  beforeAll(async () => {
    adminToken = await login('admin@kanzlei.de', 'Admin123!');
    // Die kanzleiId wird **im Test** aus dem neu angelegten Mandanten
    // abgeleitet, nicht aus `mandanten[0]`: im vollen Suite-Lauf ist die
    // Mandantenliste von anderen Specs manipuliert, und `mandanten[0]` kann
    // dann ein Mandant in einer Kanzlei ohne Audit-Eintraege sein —
    // `integrity` antwortet `NO_ENTRIES` und der Test scheitert aus dem
    // falschen Grund.
  });

  afterAll(async () => {
    if (mandantId) {
      await prisma.auditLog.deleteMany({ where: { entityId: mandantId } });
      await prisma.mandant.deleteMany({ where: { id: mandantId } });
    }
    await prisma.$disconnect();
  });

  it('die Kette bleibt nach dem Löschen eines Mandanten intakt', async () => {
    const kanzleiAdmin = await login('kanzlei-admin@kanzlei.de');

    // (1) Mandant anlegen
    const neu = (await (
      await fetch(`${BASE}/api/mandant`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${kanzleiAdmin}`,
        },
        body: JSON.stringify({
          firmenname: 'Kettenbruch-Regression GmbH',
          rechtsform: 'GmbH',
          adresse: { strasse: 'Kettenstr 2', plz: '10115', ort: 'Berlin', land: 'DE' },
          geschaeftsfuehrer: [
            { name: 'Max Muster', geburtsdatum: '1980-01-01', anteilProzent: 100 },
          ],
          groessenklasse: 'KLEIN',
          publishChannel: 'PDF_DIRECT',
        }),
      })
    ).json()) as { id: string };
    mandantId = neu.id;
    expect(mandantId, 'Mandant anlegen').toBeTruthy();

    // Ein frisch angelegter Mandant ist niemandem zugewiesen — ohne diese
    // Zuweisung lehnt der MandantGuard das Löschen ab.
    const adminUser = await prisma.user.findUniqueOrThrow({
      where: { email: 'kanzlei-admin@kanzlei.de' },
      select: { id: true },
    });
    await prisma.userMandantRole.create({
      data: { userId: adminUser.id, mandantId, rolle: 'KANZLEI_ADMIN' },
    });

    // Die Kanzlei des neu angelegten Mandanten — sie hat jetzt mindestens
    // einen Audit-Eintrag (die CREATE-Aufzeichnung selbst).
    const det = (await (
      await fetch(`${BASE}/api/mandant/${mandantId}`, {
        headers: { authorization: `Bearer ${kanzleiAdmin}` },
      })
    ).json()) as { kanzleiId: string };
    kanzleiId = det.kanzleiId;
    expect(kanzleiId, 'die kanzleiId des Mandanten muss ermittelbar sein').toBeTruthy();

    await new Promise((r) => setTimeout(r, 2500));

    const vorher = await integritaet();
    expect(vorher.status, 'vor dem Löschen muss die Kette intakt sein').toBe('OK');

    // (2) Mandant löschen
    const del = await fetch(`${BASE}/api/mandant/${mandantId}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${kanzleiAdmin}` },
    });
    expect(del.status, `Mandant löschen: ${await del.clone().text()}`).toBe(204);

    await new Promise((r) => setTimeout(r, 2500));

    // (3) Die Datenbank hat mandantId genullt — das ist gewollt: die
    //     Aufzeichnung "Mandant wurde angelegt" bleibt erhalten, ohne einen
    //     Verweis auf einen nicht mehr existierenden Mandanten.
    const eintrag = await prisma.auditLog.findFirst({
      where: { entityType: 'Mandant', entityId: mandantId, action: 'CREATE' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, mandantId: true, entryHash: true },
    });
    expect(eintrag, 'der Audit-Eintrag muss erhalten bleiben').toBeTruthy();
    expect(
      eintrag!.mandantId,
      'die Datenbank setzt den Fremdschlüssel auf NULL — das ist erlaubt',
    ).toBeNull();

    // (4) Und die Kette muss trotzdem intakt sein.
    const nachher = await integritaet();
    expect(
      nachher.status,
      'nach dem Löschen eines Mandanten: BROKEN heisst, dass die Datenbank ' +
        'den gehashten Inhalt veraendert hat — der Hash passt dann nicht mehr, ' +
        'und ab hier ist fuer einen Auditor nichts mehr verifizierbar',
    ).toBe('OK');
  });
});
