import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

/**
 * Ein archivierter Mandant darf nicht mehr veroeffentlicht werden.
 *
 * BEFUND 2026-10-21 (Nachtrag 76): Die Archiv-Entscheidung sagt: „Der
 * Bestand bleibt lesbar und nachvollziehbar (§ 147 AO), es entstehen **keine
 * neuen Belege**." Die Einreichung legt einen neuen Datensatz an
 * (BanzSubmission) und schreibt den Abschluss fort (SIGNED -> SUBMITTED).
 *
 * **Gemessen.**
 *
 *     PATCH /api/mandant/<id>/archivierung        -> HTTP 200
 *     POST  /api/jahresabschluss/<id>/einreichen  -> HTTP 200
 *     Status des Abschlusses: SUBMITTED (Bestellnummer: MESS-…)
 *     BanzSubmission-Eintraege: 1
 *
 * Der Signaturpfad ist gesperrt (Nachtrag 60) — aber ein Abschluss, der VOR
 * der Archivierung signiert wurde, ist SIGNED und damit einreichbar. Ein
 * Mandant, der aus dem aktiven Bestand verschwunden ist, konnte damit noch
 * zum Bundesanzeiger gehen.
 *
 * **Gegenprobe:** nach dem Aufheben der Archivierung klappt die Einreichung
 * wieder — sonst waere die Sperre ein Produktschalter.
 */
const BASE = 'http://localhost:3000';
const P12_PATH = join(process.cwd(), 'tmp', 'test-certs', 'test-token.p12');
const P12_PASSWORD = 'Test1234!';

describe('Archivierung: ein archivierter Mandant wird nicht mehr eingereicht (Nachtrag 76)', () => {
  const prisma = new PrismaClient();
  let token = '';
  let userId = '';
  let mandantId = '';
  let abschlussId = '';
  /** Zweiter Abschluss — fuer die Gegenprobe (siehe dort). */
  let abschlussIdGegenprobe = '';
  let jahr = 0;

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

  /**
   * Legt Bestand + Abschluss an, schliesst und signiert ihn.
   */
  async function abschlussAufbauen(jahrNummer: number): Promise<string> {
    const auth = () => ({
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      'x-mandant-id': mandantId,
    });

    const bilanzRes = await fetch(`${BASE}/api/bilanz?mandantId=${mandantId}`, {
      method: 'POST', headers: auth(),
      body: JSON.stringify({
        mandantId, geschaeftsjahr: jahrNummer,
        positionen: [
          { seite: 'AKTIVA', kontonummer: 'B.IV.', bezeichnung: 'Kasse', betragAktuell: 1000, reihenfolge: 1 },
          { seite: 'PASSIVA', kontonummer: 'A.', bezeichnung: 'Gezeichnetes Kapital', betragAktuell: 1000, reihenfolge: 2 },
        ],
      }),
    });
    const bId = ((await bilanzRes.json()) as { bilanz?: { id?: string } }).bilanz?.id ?? '';

    const guvRes = await fetch(`${BASE}/api/guv?mandantId=${mandantId}`, {
      method: 'POST', headers: auth(),
      body: JSON.stringify({
        mandantId, geschaeftsjahr: jahrNummer, verfahren: 'GKV',
        positionen: [
          { kontonummer: '1.', bezeichnung: 'Umsatzerloese', kategorie: 'ERLOES', betragAktuell: 1000, reihenfolge: 1 },
        ],
      }),
    });
    const guvBody = (await guvRes.json()) as { guv?: { id?: string }; guV?: { id?: string } };
    const gId = guvBody.guV?.id ?? guvBody.guv?.id ?? '';

    const anhangRes = await fetch(`${BASE}/api/anhang?mandantId=${mandantId}`, {
      method: 'POST', headers: auth(),
      body: JSON.stringify({
        mandantId, geschaeftsjahr: jahrNummer,
        abschnitte: [{ titel: 'Allgemeine Angaben', reihenfolge: 1, inhalt: 'Sitz: Berlin' }],
      }),
    });
    const anhangBody = (await anhangRes.json()) as { anhang?: { id?: string }; id?: string };
    const aId = anhangBody.anhang?.id ?? anhangBody.id ?? '';

    await prisma.bilanz.update({ where: { id: bId }, data: { status: 'VALIDATED' } });
    await prisma.guV.update({ where: { id: gId }, data: { status: 'VALIDATED' } });
    await prisma.anhang.update({ where: { id: aId }, data: { status: 'VALIDATED' } });

    const abschlussRes = await fetch(`${BASE}/api/jahresabschluss`, {
      method: 'POST', headers: auth(),
      body: JSON.stringify({ mandantId, geschaeftsjahr: jahrNummer }),
    });
    const aId2 = ((await abschlussRes.json()) as { id?: string }).id ?? '';

    const fin = await fetch(`${BASE}/api/jahresabschluss/${aId2}/finalize`, {
      method: 'POST', headers: auth(), body: JSON.stringify({}),
    });
    expect(fin.status, 'Abschluss finalisieren').toBe(200);

    const sign = await fetch(`${BASE}/api/signatur/sign-abschluss`, {
      method: 'POST', headers: auth(),
      body: JSON.stringify({
        jahresabschlussId: aId2, mandantId,
        p12Base64: readFileSync(P12_PATH).toString('base64'),
        p12Password: P12_PASSWORD,
      }),
    });
    expect(sign.status, 'Abschluss signieren').toBe(200);
    return aId2;
  }

  beforeAll(async () => {
    const kanzlei = await prisma.kanzlei.findFirstOrThrow({
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    const user = await prisma.user.create({
      data: {
        email: `archiv-einreichen-${Date.now()}@kanzlei.de`,
        passwordHash: await bcrypt.hash('Demo123!', 10),
        vorname: 'Mess',
        nachname: 'Einreicher',
        globalRole: 'USER',
        isActive: true,
      },
      select: { id: true, email: true },
    });
    userId = user.id;

    const mandant = await prisma.mandant.create({
      data: {
        kanzleiId: kanzlei.id,
        firmenname: `Archiv-Einreichen-${Date.now()}`,
        rechtsform: 'GmbH',
        adresse: { strasse: 'Archivweg 2', plz: '10999', ort: 'Muenchen', land: 'DE' },
        geschaeftsfuehrer: [{ name: 'Test', geburtsdatum: '1970-01-01', anteilProzent: 100 }],
        groessenklasse: 'KLEINST',
        publishChannel: 'PDF_DIRECT',
      },
      select: { id: true },
    });
    mandantId = mandant.id;

    // KANZLEI_ADMIN (archivieren), WIRTSCHAFTSPRUEFER (signieren),
    // STEUERBERATER (einreichen) — alles auf demselben Mandanten.
    for (const rolle of ['KANZLEI_ADMIN', 'WIRTSCHAFTSPRUEFER', 'STEUERBERATER']) {
      await prisma.userMandantRole.create({
        data: { userId, mandantId, rolle },
      });
    }

    // **Danach** anmelden: der JWT traegt die Mandanten des Users.
    token = await login(user.email);

    // **Zwei** freie Jahre: die Einreichung setzt den Abschluss auf
    // SUBMITTED. Mit einem gemeinsamen Abschluss laeuft die Gegenprobe im
    // Negativproben-Lauf auf "steht auf SUBMITTED" — rot, aber aus dem
    // falschen Grund.
    const freieJahre: number[] = [];
    for (let j = 2050; j <= 2099 && freieJahre.length < 2; j++) {
      const b = await prisma.bilanz.count({ where: { mandantId, geschaeftsjahr: j } });
      const g = await prisma.guV.count({ where: { mandantId, geschaeftsjahr: j } });
      const a = await prisma.anhang.count({ where: { mandantId, geschaeftsjahr: j } });
      if (b + g + a === 0) freieJahre.push(j);
    }
    expect(freieJahre.length, 'zwei freie Geschaeftsjahre finden').toBe(2);
    jahr = freieJahre[0];

    // Zwei signierte Jahresabschluesse: einer je Test (die Einreichung
    // setzt den Status auf SUBMITTED).
    abschlussId = await abschlussAufbauen(freieJahre[0]);
    expect(abschlussId, 'erster signierter Jahresabschluss').toBeTruthy();
    abschlussIdGegenprobe = await abschlussAufbauen(freieJahre[1]);
    expect(abschlussIdGegenprobe, 'zweiter signierter Jahresabschluss').toBeTruthy();
  });

  afterAll(async () => {
    for (const id of [abschlussId, abschlussIdGegenprobe]) {
      if (!id) continue;
      await prisma.banzSubmission.deleteMany({ where: { jahresabschlussId: id } });
      await prisma.signature.deleteMany({ where: { jahresabschlussId: id } });
      await prisma.jahresabschluss.deleteMany({ where: { id } });
    }
    // Die Bestandteile werden in `abschlussAufbauen` je Jahr angelegt —
    // das Aufraeumen laeuft deshalb ueber den Mandanten (es ist der eigene
    // Testmandant).
    if (mandantId) {
      await prisma.bilanz.deleteMany({ where: { mandantId } });
      await prisma.guV.deleteMany({ where: { mandantId } });
      await prisma.anhang.deleteMany({ where: { mandantId } });
      await prisma.userMandantRole.deleteMany({ where: { mandantId } });
      await prisma.mandant.deleteMany({ where: { id: mandantId } });
    }
    if (userId) await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  const auth = () => ({
    'content-type': 'application/json',
    authorization: `Bearer ${token}`,
    'x-mandant-id': mandantId,
  });

  it('reicht einen archivierten Mandanten nicht ein', async () => {
    const archiv = await fetch(`${BASE}/api/mandant/${mandantId}/archivierung`, {
      method: 'PATCH', headers: auth(), body: JSON.stringify({}),
    });
    expect(archiv.status, 'der Mandant muss sich archivieren lassen').toBe(200);

    const res = await fetch(`${BASE}/api/jahresabschluss/${abschlussId}/einreichen`, {
      method: 'POST', headers: auth(),
      body: JSON.stringify({ banzBestellnummer: `MESS-${Date.now()}` }),
    });
    const body = await res.text();
    expect(
      res.status,
      'ein archivierter Mandant darf nicht eingereicht werden — ' +
        `Antwort: ${body.slice(0, 200)}`,
    ).toBe(409);

    const abschluss = await prisma.jahresabschluss.findUnique({
      where: { id: abschlussId },
      select: { status: true, banzBestellnummer: true },
    });
    expect(abschluss?.status, 'der Abschluss darf nicht fortgeschrieben sein').toBe('SIGNED');
    expect(abschluss?.banzBestellnummer, 'es darf keine Bestellnummer gesetzt sein').toBeNull();

    const subs = await prisma.banzSubmission.count({ where: { jahresabschlussId: abschlussId } });
    expect(subs, 'es darf kein Einreichungsbeleg entstanden sein').toBe(0);
  });

  it('Gegenprobe: nach dem Aufheben der Archivierung klappt die Einreichung', async () => {
    const aufheben = await fetch(`${BASE}/api/mandant/${mandantId}/archivierung/aufheben`, {
      method: 'PATCH', headers: auth(), body: JSON.stringify({}),
    });
    expect(aufheben.status, 'die Archivierung muss sich aufheben lassen').toBe(200);

    const res = await fetch(`${BASE}/api/jahresabschluss/${abschlussIdGegenprobe}/einreichen`, {
      method: 'POST', headers: auth(),
      body: JSON.stringify({ banzBestellnummer: `MESS-${Date.now()}` }),
    });
    const body = await res.text();
    expect(
      res.status,
      'nach dem Aufheben der Archivierung ist die Einreichung wieder erlaubt — ' +
        `Antwort: ${body.slice(0, 200)}`,
    ).toBe(200);
  });
});
