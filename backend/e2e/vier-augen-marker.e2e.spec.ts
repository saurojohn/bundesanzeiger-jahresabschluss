import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

/**
 * Der Vier-Augen-Freigabemarker darf nicht weggeraeumt werden.
 *
 * BEFUND 2026-10-22 (Nachtrag 81): Die Statusregel blockierte nur den
 * Uebergang nach `DRAFT`. Jeder andere Uebergang aus `APPROVED` war frei:
 *
 *     Vier-Augen-Freigabe       -> HTTP 200,  Status der Bilanz: APPROVED
 *     PATCH {status: VALIDATED} -> HTTP 200,  Status der Bilanz: VALIDATED
 *     PATCH mit Positionen      -> HTTP 400  (die Daten blieben geschuetzt)
 *
 * Die Daten waren also gesperrt, der Pruefdatensatz lebte — aber das PDF
 * druckt `Status: ${bilanz.status}`. Im **signierten und veroeffentlichten**
 * Dokument stand danach "VALIDATED" statt "Freigegeben (WP)": der
 * Audit-Trail und das Dokument widersprachen sich.
 *
 * ENTSCHEIDUNG der Fachverantwortlichen vom 2026-10-22: fail-closed. Der
 * Freigabestatus ist der Endzustand des Statusfelds.
 */
const BASE = 'http://localhost:3000';

describe('Vier-Augen-Freigabemarker: nicht wegräumbar (Nachtrag 81)', () => {
  const prisma = new PrismaClient();
  let mandantId = '';
  let email1 = '';
  let email2 = '';
  let bilanzId = '';
  let bilanzOhneFreigabeId = '';

  const login = async (email: string) => {
    const r = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'Demo123!' }),
    });
    const d = (await r.json()) as { accessToken: string };
    expect(d.accessToken, `Login ${email}`).toBeTruthy();
    return d.accessToken;
  };

  const bilanzAnlegen = async (token: string, jahrNummer: number): Promise<string> => {
    const res = await fetch(`${BASE}/api/bilanz?mandantId=${mandantId}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'x-mandant-id': mandantId,
      },
      body: JSON.stringify({
        mandantId,
        geschaeftsjahr: jahrNummer,
        positionen: [
          { seite: 'AKTIVA', kontonummer: 'B.IV.', bezeichnung: 'Kasse', betragAktuell: 1000, reihenfolge: 1 },
          { seite: 'PASSIVA', kontonummer: 'A.', bezeichnung: 'Kapital', betragAktuell: 1000, reihenfolge: 2 },
        ],
      }),
    });
    const id = ((await res.json()) as { bilanz?: { id?: string } }).bilanz?.id ?? '';
    expect(id, 'Bilanz anlegen').toBeTruthy();
    await prisma.bilanz.update({ where: { id }, data: { status: 'VALIDATED' } });
    return id;
  };

  beforeAll(async () => {
    const ts = Date.now();
    const kanzlei = await prisma.kanzlei.findFirstOrThrow({
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    const mandant = await prisma.mandant.create({
      data: {
        kanzleiId: kanzlei.id,
        firmenname: `Freigabemarker-${ts}`,
        rechtsform: 'GmbH',
        adresse: { strasse: 'Markerweg 1', plz: '10999', ort: 'Muenchen', land: 'DE' },
        geschaeftsfuehrer: [{ name: 'Test', geburtsdatum: '1970-01-01', anteilProzent: 100 }],
        groessenklasse: 'KLEINST',
        publishChannel: 'PDF_DIRECT',
      },
      select: { id: true },
    });
    mandantId = mandant.id;

    // Zwei Personen auf demselben Mandanten: Person 1 bereitet vor und
    // prueft, Person 2 gibt frei (Vier-Augen-Prinzip).
    for (const [nr, rollen] of [
      [1, ['STEUERBERATER', 'WIRTSCHAFTSPRUEFER']],
      [2, ['WIRTSCHAFTSPRUEFER']],
    ] as const) {
      const u = await prisma.user.create({
        data: {
          email: `marker-${nr}-${ts}@kanzlei.de`,
          passwordHash: await bcrypt.hash('Demo123!', 10),
          vorname: 'Mess',
          nachname: `Person${nr}`,
          globalRole: 'USER',
          isActive: true,
        },
        select: { id: true, email: true },
      });
      for (const rolle of rollen) {
        await prisma.userMandantRole.create({
          data: { userId: u.id, mandantId, rolle },
        });
      }
      if (nr === 1) email1 = u.email;
      else email2 = u.email;
    }

    // Freie Jahre suchen — die Belegung durch andere Specs ist nicht
    // vorhersehbar.
    const jahre: number[] = [];
    for (let j = 2050; j <= 2099 && jahre.length < 2; j++) {
      const belegt = await prisma.bilanz.count({ where: { mandantId, geschaeftsjahr: j } });
      if (!belegt) jahre.push(j);
    }
    expect(jahre.length, 'zwei freie Geschaeftsjahre finden').toBe(2);

    const token1 = await login(email1);
    const token2 = await login(email2);

    bilanzId = await bilanzAnlegen(token1, jahre[0]);
    bilanzOhneFreigabeId = await bilanzAnlegen(token1, jahre[1]);

    // Die Vier-Augen-Pruefung: starten (Person 1), freigeben (Person 2).
    const pruefungRes = await fetch(`${BASE}/api/wp/pruefungen`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token1}`,
        'x-mandant-id': mandantId,
      },
      body: JSON.stringify({ bilanzId }),
    });
    const pruefungBody = (await pruefungRes.json()) as { pruefung?: { id?: string }; id?: string };
    const pruefungId = pruefungBody.pruefung?.id ?? pruefungBody.id ?? '';
    expect(pruefungId, 'WP-Pruefung starten').toBeTruthy();

    const freigabe = await fetch(`${BASE}/api/wp/pruefungen/${pruefungId}/finalize`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token2}`,
        'x-mandant-id': mandantId,
      },
      body: JSON.stringify({ status: 'APPROVED', zusammenfassung: 'Freigabe (Test)' }),
    });
    expect(freigabe.status, `Freigabe: ${await freigabe.clone().text()}`).toBe(200);
  });

  afterAll(async () => {
    if (mandantId) {
      await prisma.wPPruefungsAbschluss.deleteMany({ where: { bilanzId } });
      await prisma.bilanz.deleteMany({ where: { mandantId } });
      await prisma.userMandantRole.deleteMany({ where: { mandantId } });
      await prisma.mandant.deleteMany({ where: { id: mandantId } });
    }
    if (email1) {
      await prisma.user.deleteMany({ where: { email: email1 } });
    }
    if (email2) {
      await prisma.user.deleteMany({ where: { email: email2 } });
    }
    await prisma.$disconnect();
  });

  const patch = async (id: string, body: unknown) => {
    const token = await login(email1);
    const res = await fetch(`${BASE}/api/bilanz/${id}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'x-mandant-id': mandantId,
      },
      body: JSON.stringify(body),
    });
    return { status: res.status, text: await res.text() };
  };

  it('der Marker steht nach der Freigabe auf APPROVED', async () => {
    const bilanz = await prisma.bilanz.findUnique({
      where: { id: bilanzId },
      select: { status: true },
    });
    expect(bilanz?.status, 'die Vier-Augen-Freigabe setzt APPROVED').toBe('APPROVED');
  });

  it('der Marker lässt sich nicht auf VALIDATED setzen', async () => {
    const res = await patch(bilanzId, { status: 'VALIDATED' });
    expect(
      res.status,
      'der Freigabemarker darf nicht weggeraeumt werden — ' +
        `Antwort: ${res.text.slice(0, 200)}`,
    ).toBe(400);
    expect(res.text, 'die Meldung muss den Freigabestatus nennen').toContain('APPROVED');

    const bilanz = await prisma.bilanz.findUnique({
      where: { id: bilanzId },
      select: { status: true },
    });
    expect(bilanz?.status, 'der Marker muss stehen bleiben').toBe('APPROVED');
  });

  it('der Marker lässt sich auch nicht auf ARCHIVED setzen', async () => {
    const res = await patch(bilanzId, { status: 'ARCHIVED' });
    expect(
      res.status,
      'auch der Vorwaertsschritt darf den Freigabemarker nicht mitnehmen — ' +
        `Antwort: ${res.text.slice(0, 200)}`,
    ).toBe(400);

    const bilanz = await prisma.bilanz.findUnique({
      where: { id: bilanzId },
      select: { status: true },
    });
    expect(bilanz?.status).toBe('APPROVED');
  });

  it('Gegenprobe: ohne Freigabe bleibt der Weg auf ARCHIVED offen', async () => {
    const res = await patch(bilanzOhneFreigabeId, { status: 'ARCHIVED' });
    expect(
      res.status,
      'eine nicht freigegebene Bilanz darf weiterhin archiviert werden — ' +
        `Antwort: ${res.text.slice(0, 200)}`,
    ).toBe(200);

    const bilanz = await prisma.bilanz.findUnique({
      where: { id: bilanzOhneFreigabeId },
      select: { status: true },
    });
    expect(bilanz?.status).toBe('ARCHIVED');
  });

  it('Gegenprobe: die Daten bleiben nach der Freigabe geschützt', async () => {
    const res = await patch(bilanzId, {
      positionen: [
        { seite: 'AKTIVA', kontonummer: 'B.IV.', bezeichnung: 'Kasse', betragAktuell: 9999, reihenfolge: 1 },
        { seite: 'PASSIVA', kontonummer: 'A.', bezeichnung: 'Kapital', betragAktuell: 9999, reihenfolge: 2 },
      ],
    });
    expect(
      res.status,
      'die Positionen einer freigegebenen Bilanz bleiben eingefroren — ' +
        `Antwort: ${res.text.slice(0, 200)}`,
    ).toBe(400);
  });
});
