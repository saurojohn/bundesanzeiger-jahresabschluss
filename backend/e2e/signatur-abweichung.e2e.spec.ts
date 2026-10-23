import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { fuehreVierAugenPruefungDurch } from './helpers/wp-vier-augen';

/**
 * Der Abweichungsindikator muss **informativ** sein — nicht dauerhaft rot.
 *
 * ENTSCHEIDUNG der Fachverantwortlichen vom 2026-10-14:
 * „Soll das Signieren die Bilanz/GuV/Anhang gegen Änderung sperren?" -> Nein.
 * „Ein Korrekturvorgang erzeugt zwingend eine neue Signatur, und der alte
 * WORM-Satz darf nicht gelöscht werden. Stattdessen muss **SICHTBAR** sein,
 * wenn die vorgelegten Daten nicht mehr der signierten Fassung entsprechen."
 *
 * BEFUND 2026-10-21 (Nachtrag 77): Der Indikator war bei **jedem**
 * signierten Jahresabschluss rot — ohne jede Aenderung an den Daten:
 *
 *     GET /api/signatur/status?entityType=Abschluss&entityId=…
 *     -> status=ABWEICHEND, geaendertNachSignatur=true
 *
 * Ursache: die Signatur setzt selbst den Status des Jahresabschlusses auf
 * `SIGNED`; dieser Schreibvorgang liegt **nach** dem Anlegen des
 * Signaturdatensatzes und damit nach `letzte.createdAt`.
 *
 * Ein dauerhaft roter Indikator traegt keine Information: eine echte
 * Abweichung (ein Bestandteil nach der Signatur geaendert) fiel nicht mehr
 * auf, weil sie neben dem Dauerfehler verschwand. Die Sichtbarkeitspflicht
 * war damit **nicht erfuellbar**.
 *
 * **Die Regel jetzt:** der Jahresabschluss ist ein Aggregat; die signierte
 * Fassung ist ein PDF ueber Bilanz + GuV + Anhang. Geprueft wird der
 * Aktualisierungszeitpunkt der **Bestandteile** — der eigene `updatedAt` des
 * Jahresabschlusses beschreibt seinen Arbeitsstatus, nicht die Daten.
 */
const BASE = 'http://localhost:3000';
const P12_PATH = join(process.cwd(), 'tmp', 'test-certs', 'test-token.p12');
const P12_PASSWORD = 'Test1234!';

describe('Abweichungsindikator nach der Signatur (Nachtrag 77)', () => {
  const prisma = new PrismaClient();
  let token = '';
  let userId = '';
  /** Die zweite Wirtschaftsprueferin (Vier-Augen-Freigabe). */
  let zweiterWpId = '';
  let zweiterWpEmail = '';
  let mandantId = '';
  let anhangId = '';
  let bilanzId = '';
  let guvId = '';
  let abschlussId = '';
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

  beforeAll(async () => {
    const kanzlei = await prisma.kanzlei.findFirstOrThrow({
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    const user = await prisma.user.create({
      data: {
        email: `abweichung-${Date.now()}@kanzlei.de`,
        passwordHash: await bcrypt.hash('Demo123!', 10),
        vorname: 'Mess',
        nachname: 'Pruefer',
        globalRole: 'USER',
        isActive: true,
      },
      select: { id: true, email: true },
    });
    userId = user.id;

    const mandant = await prisma.mandant.create({
      data: {
        kanzleiId: kanzlei.id,
        firmenname: `Abweichung-${Date.now()}`,
        rechtsform: 'GmbH',
        adresse: { strasse: 'Abwweg 1', plz: '10999', ort: 'Muenchen', land: 'DE' },
        geschaeftsfuehrer: [{ name: 'Test', geburtsdatum: '1970-01-01', anteilProzent: 100 }],
        groessenklasse: 'KLEINST',
        publishChannel: 'PDF_DIRECT',
      },
      select: { id: true },
    });
    mandantId = mandant.id;
    for (const rolle of ['STEUERBERATER', 'WIRTSCHAFTSPRUEFER']) {
      await prisma.userMandantRole.create({
        data: { userId, mandantId, rolle },
      });
    }

    // Die **zweite** Wirtschaftsprueferin: sie gibt die WP-Pruefung frei
    // (Vier-Augen-Prinzip, IDW PS 880). Ohne sie waere die Endabnahme
    // nicht moeglich (Nachtrag 79).
    const zweite = await prisma.user.create({
      data: {
        email: `abweichung-wp2-${Date.now()}@kanzlei.de`,
        passwordHash: await bcrypt.hash('Demo123!', 10),
        vorname: 'Mess',
        nachname: 'Zweitprueferin',
        globalRole: 'USER',
        isActive: true,
      },
      select: { id: true, email: true },
    });
    zweiterWpId = zweite.id;
    zweiterWpEmail = zweite.email;
    await prisma.userMandantRole.create({
      data: { userId: zweiterWpId, mandantId, rolle: 'WIRTSCHAFTSPRUEFER' },
    });
    token = await login(user.email);

    for (let j = 2050; j <= 2099; j++) {
      const b = await prisma.bilanz.count({ where: { mandantId, geschaeftsjahr: j } });
      const g = await prisma.guV.count({ where: { mandantId, geschaeftsjahr: j } });
      const a = await prisma.anhang.count({ where: { mandantId, geschaeftsjahr: j } });
      if (b + g + a === 0) { jahr = j; break; }
    }
    expect(jahr, 'ein freies Geschaeftsjahr finden').toBeGreaterThan(0);

    const auth = () => ({
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      'x-mandant-id': mandantId,
    });

    const bilanzRes = await fetch(`${BASE}/api/bilanz?mandantId=${mandantId}`, {
      method: 'POST', headers: auth(),
      body: JSON.stringify({
        mandantId, geschaeftsjahr: jahr,
        positionen: [
          { seite: 'AKTIVA', kontonummer: 'B.IV.', bezeichnung: 'Kasse', betragAktuell: 1000, reihenfolge: 1 },
          { seite: 'PASSIVA', kontonummer: 'A.', bezeichnung: 'Gezeichnetes Kapital', betragAktuell: 1000, reihenfolge: 2 },
        ],
      }),
    });
    bilanzId = ((await bilanzRes.json()) as { bilanz?: { id?: string } }).bilanz?.id ?? '';

    const guvRes = await fetch(`${BASE}/api/guv?mandantId=${mandantId}`, {
      method: 'POST', headers: auth(),
      body: JSON.stringify({
        mandantId, geschaeftsjahr: jahr, verfahren: 'GKV',
        positionen: [
          { kontonummer: '1.', bezeichnung: 'Umsatzerloese', kategorie: 'ERLOES', betragAktuell: 1000, reihenfolge: 1 },
        ],
      }),
    });
    const guvBody = (await guvRes.json()) as { guV?: { id?: string }; guv?: { id?: string } };
    guvId = guvBody.guV?.id ?? guvBody.guv?.id ?? '';

    const anhangRes = await fetch(`${BASE}/api/anhang?mandantId=${mandantId}`, {
      method: 'POST', headers: auth(),
      body: JSON.stringify({
        mandantId, geschaeftsjahr: jahr,
        abschnitte: [{ titel: 'Allgemeine Angaben', reihenfolge: 1, inhalt: 'Sitz: Berlin' }],
      }),
    });
    const anhangBody = (await anhangRes.json()) as { anhang?: { id?: string }; id?: string };
    anhangId = anhangBody.anhang?.id ?? anhangBody.id ?? '';

    await prisma.bilanz.update({ where: { id: bilanzId }, data: { status: 'VALIDATED' } });
    await prisma.guV.update({ where: { id: guvId }, data: { status: 'VALIDATED' } });
    await prisma.anhang.update({ where: { id: anhangId }, data: { status: 'VALIDATED' } });

    const abschlussRes = await fetch(`${BASE}/api/jahresabschluss`, {
      method: 'POST', headers: auth(),
      body: JSON.stringify({ mandantId, geschaeftsjahr: jahr }),
    });
    abschlussId = ((await abschlussRes.json()) as { id?: string }).id ?? '';
    expect(abschlussId, 'Jahresabschluss anlegen').toBeTruthy();

    const fin = await fetch(`${BASE}/api/jahresabschluss/${abschlussId}/finalize`, {
      method: 'POST', headers: auth(), body: JSON.stringify({}),
    });
    expect(fin.status, 'Abschluss finalisieren').toBe(200);

    // BEFUND 2026-10-21 (Nachtrag 79): Die Endabnahme verlangt einen
    // freigegebenen Vier-Augen-Pruefungsnachweis der Bilanz — erst pruefen
    // (Person 1), dann von der zweiten Person freigeben lassen (Person 2).
    const zweiterToken = await login(zweiterWpEmail);
    await fuehreVierAugenPruefungDurch({
      base: BASE,
      mandantId,
      bilanzId,
      tokenPruefend: token,
      tokenFreigebend: zweiterToken,
    });

    const sign = await fetch(`${BASE}/api/signatur/sign-abschluss`, {
      method: 'POST', headers: auth(),
      body: JSON.stringify({
        jahresabschlussId: abschlussId, mandantId,
        p12Base64: readFileSync(P12_PATH).toString('base64'),
        p12Password: P12_PASSWORD,
      }),
    });
    expect(sign.status, 'Abschluss signieren').toBe(200);
  });

  afterAll(async () => {
    if (abschlussId) {
      await prisma.signature.deleteMany({ where: { jahresabschlussId: abschlussId } });
      await prisma.jahresabschluss.deleteMany({ where: { id: abschlussId } });
    }
    if (mandantId) {
      await prisma.bilanz.deleteMany({ where: { mandantId } });
      await prisma.guV.deleteMany({ where: { mandantId } });
      await prisma.anhang.deleteMany({ where: { mandantId } });
      await prisma.userMandantRole.deleteMany({ where: { mandantId } });
      await prisma.mandant.deleteMany({ where: { id: mandantId } });
    }
    if (userId) await prisma.user.deleteMany({ where: { id: userId } });
    if (zweiterWpId) await prisma.user.deleteMany({ where: { id: zweiterWpId } });
    await prisma.$disconnect();
  });

  const status = async (entityType: string, entityId: string) => {
    const r = await fetch(
      `${BASE}/api/signatur/status?entityType=${entityType}&entityId=${entityId}`,
      { headers: { authorization: `Bearer ${token}`, 'x-mandant-id': mandantId } },
    );
    expect(r.status, `Status fuer ${entityType}`).toBe(200);
    return (await r.json()) as {
      status: string;
      geaendertNachSignatur: boolean;
      hinweis: string;
    };
  };

  it('meldet einen frisch signierten Jahresabschluss als SIGNIERT, nicht als ABWEICHEND', async () => {
    const abschluss = await status('Abschluss', abschlussId);
    expect(
      abschluss.status,
      'direkt nach der Signatur sind die Daten unveraendert — der Indikator ' +
        `darf nicht rot sein (Hinweis: ${abschluss.hinweis.slice(0, 120)})`,
    ).toBe('SIGNIERT');
    expect(abschluss.geaendertNachSignatur).toBe(false);
  });

  it('meldet eine Aenderung eines Bestandteils nach der Signatur auch am Jahresabschluss', async () => {
    // Der Anhang laesst nach der Signatur noch Inhalt aendern
    // (bilanzierungsMethoden) — die Positionen sind ab VALIDATED eingefroren.
    const patch = await fetch(`${BASE}/api/anhang/${anhangId}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'x-mandant-id': mandantId,
      },
      body: JSON.stringify({
        bilanzierungsMethoden: 'HGB 2023 §248 — nach der Signatur geaendert',
      }),
    });
    expect(patch.status, `Anhang aendern: ${await patch.clone().text()}`).toBe(200);

    const anhang = await status('Anhang', anhangId);
    expect(anhang.status, 'der Anhang selbst weicht ab').toBe('ABWEICHEND');

    const abschluss = await status('Abschluss', abschlussId);
    expect(
      abschluss.status,
      'der Jahresabschluss aggregiert Bilanz + GuV + Anhang — die Abweichung ' +
        'eines Bestandteils muss auch am Abschluss sichtbar sein',
    ).toBe('ABWEICHEND');
    expect(abschluss.geaendertNachSignatur).toBe(true);
  });

  it('Gegenprobe: nach einer neuen Signatur ist der Abschluss wieder SIGNIERT', async () => {
    // Der Korrekturvorgang (ENTSCHEIDUNG 2026-10-21, Nachtrag 78): ein
    // Abschluss im Status SIGNED darf **erneut** signiert werden. Damit
    // setzt die neue Signatur die geaenderte Datenbasis wieder unter
    // Dach.
    const sign = await fetch(`${BASE}/api/signatur/sign-abschluss`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'x-mandant-id': mandantId,
      },
      body: JSON.stringify({
        jahresabschlussId: abschlussId, mandantId,
        p12Base64: readFileSync(P12_PATH).toString('base64'),
        p12Password: P12_PASSWORD,
      }),
    });
    expect(sign.status, `erneute Signatur: ${await sign.clone().text()}`).toBe(200);

    const abschluss = await status('Abschluss', abschlussId);
    expect(
      abschluss.status,
      'die neue Signatur deckt den geaenderten Bestandteil wieder ab — der ' +
        'Indikator muss wieder gruen sein',
    ).toBe('SIGNIERT');

    // Der Anhang ist mit abgedeckt: er ist **Teil** des signierten
    // Jahresabschlusses (die signierte Fassung ist ein PDF ueber
    // Bilanz + GuV + Anhang). Die erneute Abschluss-Signatur deckt ihn
    // deshalb mit ab.
    const anhang = await status('Anhang', anhangId);
    expect(
      anhang.status,
      'der Anhang ist Bestandteil des signierten Abschlusses — die neue ' +
        'Abschluss-Signatur deckt ihn mit ab',
    ).toBe('SIGNIERT');
  });

  it('reicht einen Jahresabschluss mit abweichenden Daten nicht ein', async () => {
    // ENTSCHEIDUNG 2026-10-21 (Nachtrag 78, Frage 2 = "sperren"):
    // fail-closed. Veroeffentlicht wuerde die signierte Fassung, waehrend
    // das System die geaenderten Zahlen zeigt (§ 147 AO).
    //
    // Der Zustand dafuer wird hier neu hergestellt: der Anhang wird nach
    // der erneuten Abschluss-Signatur noch einmal geaendert.
    const patch = await fetch(`${BASE}/api/anhang/${anhangId}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'x-mandant-id': mandantId,
      },
      body: JSON.stringify({
        bilanzierungsMethoden: 'HGB 2023 §248 — nach der zweiten Signatur geaendert',
      }),
    });
    expect(patch.status, 'Anhang aendern').toBe(200);

    const res = await fetch(`${BASE}/api/jahresabschluss/${abschlussId}/einreichen`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'x-mandant-id': mandantId,
      },
      body: JSON.stringify({ banzBestellnummer: `MESS-${Date.now()}` }),
    });
    const body = await res.text();
    expect(
      res.status,
      'eine Einreichung mit abweichenden Daten ist nicht zulaessig — ' +
        `Antwort: ${body.slice(0, 220)}`,
    ).toBe(409);

    const abschluss = await prisma.jahresabschluss.findUnique({
      where: { id: abschlussId },
      select: { status: true, banzBestellnummer: true },
    });
    expect(abschluss?.status, 'der Abschluss darf nicht fortgeschritten sein').toBe('SIGNED');
    expect(abschluss?.banzBestellnummer, 'es darf keine Bestellnummer gesetzt sein').toBeNull();

    const subs = await prisma.banzSubmission.count({ where: { jahresabschlussId: abschlussId } });
    expect(subs, 'es darf kein Einreichungsbeleg entstanden sein').toBe(0);
  });

  it('Gegenprobe: nach der erneuten Signatur ist die Einreichung wieder moeglich', async () => {
    const sign = await fetch(`${BASE}/api/signatur/sign-abschluss`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'x-mandant-id': mandantId,
      },
      body: JSON.stringify({
        jahresabschlussId: abschlussId, mandantId,
        p12Base64: readFileSync(P12_PATH).toString('base64'),
        p12Password: P12_PASSWORD,
      }),
    });
    expect(sign.status, 'erneute Signatur').toBe(200);

    const res = await fetch(`${BASE}/api/jahresabschluss/${abschlussId}/einreichen`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'x-mandant-id': mandantId,
      },
      body: JSON.stringify({ banzBestellnummer: `MESS-${Date.now()}` }),
    });
    const body = await res.text();
    expect(
      res.status,
      'nach der erneuten Signatur ist die Einreichung wieder erlaubt — ' +
        `Antwort: ${body.slice(0, 220)}`,
    ).toBe(200);
  });

  // BEFUND 2026-10-24 (Nachtrag 95): Nach der EINREICHUNG beim
  // Bundesanzeiger war der Anhang-Inhalt weiterhin aenderbar. Die
  // eingereichte Fassung liegt im WORM, und eine erneute Signatur ist
  // fuer einen eingereichten Abschluss gesperrt (Nachtrag 78) — die
  // Aenderung konnte also NIE nachgezogen werden. Der Datenbestand
  // wuerde dauerhaft vom eingereichten Dokument abweichen.
  it('nach der Einreichung ist der Anhang-Inhalt eingefroren (BUG vor dem Fix)', async () => {
    const abschluss = await prisma.jahresabschluss.findUnique({
      where: { id: abschlussId },
      select: { status: true, banzBestellnummer: true },
    });
    expect(abschluss?.status, 'der Abschluss steht auf SUBMITTED').toBe('SUBMITTED');
    expect(abschluss?.banzBestellnummer, 'die Einreichung hat eine Bestellnummer').toBeTruthy();

    const patch = await fetch(`${BASE}/api/anhang/${anhangId}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'x-mandant-id': mandantId,
      },
      body: JSON.stringify({
        bilanzierungsMethoden: 'NACHTRAG nach der Einreichung',
      }),
    });
    const text = await patch.text();
    expect(
      patch.status,
      'nach der Einreichung darf der Anhang-Inhalt nicht mehr geaendert werden — ' +
        `Antwort: ${text.slice(0, 220)}`,
    ).toBe(409);

    // Und der Text ist unveraendert.
    const inDb = await prisma.anhang.findUnique({
      where: { id: anhangId },
      select: { bilanzierungsMethoden: true },
    });
    expect(inDb?.bilanzierungsMethoden).not.toBe('NACHTRAG nach der Einreichung');

    // Dieselbe Regel gilt fuer die `hinweise` der Bilanz und der GuV —
    // sie stehen ebenfalls im PDF.
    for (const [bezeichnung, pfad, id] of [
      ['Bilanz', '/api/bilanz', bilanzId],
      ['GuV', '/api/guv', guvId],
    ] as const) {
      const patch2 = await fetch(`${BASE}${pfad}/${id}`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
          'x-mandant-id': mandantId,
        },
        body: JSON.stringify({ hinweise: 'NACHTRAG nach der Einreichung' }),
      });
      const text2 = await patch2.text();
      expect(
        patch2.status,
        `die Hinweise der ${bezeichnung} duerfen nach der Einreichung nicht ` +
          `geaendert werden — Antwort: ${text2.slice(0, 200)}`,
      ).toBe(409);
    }

    const hinweiseInDb = await prisma.bilanz.findUnique({
      where: { id: bilanzId },
      select: { hinweise: true },
    });
    expect(hinweiseInDb?.hinweise).not.toBe('NACHTRAG nach der Einreichung');
  });
});
