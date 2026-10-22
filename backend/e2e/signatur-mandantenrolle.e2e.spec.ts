import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { fuehreVierAugenPruefungDurch } from './helpers/wp-vier-augen';
import bcrypt from 'bcrypt';

/**
 * Die qeS-Signatur muss von einem Wirtschaftspruefer **des Mandanten**
 * kommen, dessen Abschluss signiert wird.
 *
 * BEFUND 2026-10-21 (Nachtrag 73): Der `RolesGuard` prueft die Rolle auf dem
 * **Kontext-Mandanten** (x-mandant-id) — nicht auf dem Ziel. Die
 * Service-Ebene pruefte nur den *Zugriff* auf das Ziel
 * (`assertMandantAccess`: irgendeine Rolle genuegt). Zusammen belegten die
 * beiden Pruefungen nicht „Rolle fuer diesen Mandanten".
 *
 * **Gemessen.** Ein User, der in Mandant A (Demo GmbH) Wirtschaftspruefer
 * und in Mandant B (Beispiel GmbH) nur STEUERBERATER ist, signierte den
 * **Jahresabschluss** von Mandant B:
 *
 *     POST /api/signatur/sign-abschluss (Kontext = A) -> HTTP 200
 *     Signaturen am Abschluss: 1
 *
 * Eine qeS nach § 126 AO ersetzt die eigenhaendige Unterschrift. Sie
 * bescheinigt die Endabnahme durch einen fuer diesen Mandanten bestellten
 * Wirtschaftspruefer (IDW PS 880) — hier von jemandem, der fuer Mandant B
 * der **Ersteller** ist.
 *
 * **Die Regel jetzt:** die Rolle muss auf dem Ziel-Mandanten gelten. Fuer
 * den **Jahresabschluss** (Endabnahme) nur WIRTSCHAFTSPRUEFER; fuer einen
 * **Bestandteil** (Bilanz/GuV/Anhang) auch STEUERBERATER — die
 * Komponentensignatur wird als `signaturEbene: BESTANDTEIL` erfasst und ist
 * keine Endabnahme (Nachtrag 60).
 *
 * Test-P12: lokal `bash scripts/generate-test-p12.sh ./tmp/test-certs`,
 * in der CI erzeugt der Setup-Schritt `scripts-gen-test-p12.ts`.
 */
const BASE = 'http://localhost:3000';
const P12_PATH = join(process.cwd(), 'tmp', 'test-certs', 'test-token.p12');
const P12_PASSWORD = 'Test1234!';

describe('qeS: der Signierer muss WP des Mandanten sein (Nachtrag 73)', () => {
  const prisma = new PrismaClient();
  /** Mandant A — hier ist die Person WP. */
  let mandantAId = '';
  /** Mandant B — hier ist dieselbe Person nur STEUERBERATER. */
  let mandantBId = '';
  let personId = '';
  let personEmail = '';
  /** Zwei unabhaengige Jahresabschluesse — siehe der Hinweis beim Setup. */
  let bilanzId = '';
  /** Die Bilanz des Gegenprobe-Abschlusses (fuer den Vier-Augen-Nachweis). */
  let bilanzIdGegenprobe = '';
  let guvId = '';
  let anhangId = '';
  let abschlussId = '';
  let abschlussIdGegenprobe = '';
  /** IDs des zweiten Bestands (fuer die Gegenprobe). */
  let zweiterBestand = { bilanz2Id: '', guv2Id: '', anhang2Id: '' };


  /**
   * Freie Geschaeftsjahre suchen.
   *
   * Die Belegung durch die anderen Specs ist nicht vorhersehbar — sie raeumen
   * ihre Daten erst im `afterAll` ab, und der Jahresabschluss hat einen
   * Unique-Constraint auf (mandantId, geschaeftsjahr). Ein gerechnetes Jahr
   * (`2050 + Date.now() % 40`) ist deshalb **nicht** sicher: im Voll-Lauf
   * kollidierte es mit dem Rest eines anderen Specs (409), der zweite
   * Jahresabschluss blieb leer — und der Test scheiterte an einer leeren ID
   * statt an der eigentlichen Behauptung.
   *
   * Gesucht wird deshalb ein Jahr, in dem **keiner** der vier Saetze liegt.
   */
  const freieJahre = async (anzahl: number): Promise<number[]> => {
    const jahre: number[] = [];
    for (let jahr = 2050; jahr <= 2099 && jahre.length < anzahl; jahr++) {
      const [bilanzen, guvs, anhaenge, abschluesse] = await Promise.all([
        prisma.bilanz.count({ where: { mandantId: mandantBId, geschaeftsjahr: jahr } }),
        prisma.guV.count({ where: { mandantId: mandantBId, geschaeftsjahr: jahr } }),
        prisma.anhang.count({ where: { mandantId: mandantBId, geschaeftsjahr: jahr } }),
        prisma.jahresabschluss.count({ where: { mandantId: mandantBId, geschaeftsjahr: jahr } }),
      ]);
      if (bilanzen + guvs + anhaenge + abschluesse === 0) jahre.push(jahr);
    }
    if (jahre.length < anzahl) {
      throw new Error(`keine ${anzahl} freien Geschaeftsjahre fuer den Test`);
    }
    return jahre;
  };

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
    mandantAId = (
      await prisma.mandant.findFirstOrThrow({
        where: { firmenname: 'Demo GmbH' },
        select: { id: true },
      })
    ).id;
    mandantBId = (
      await prisma.mandant.findFirstOrThrow({
        where: { firmenname: 'Beispiel GmbH' },
        select: { id: true },
      })
    ).id;

    // Zwei freie Jahre: einer je Jahresabschluss (Negativprobe / Gegenprobe).
    const [jahr, jahr2] = await freieJahre(2);

    personEmail = `mess-sign-${Date.now()}@kanzlei.de`;
    const person = await prisma.user.create({
      data: {
        email: personEmail,
        passwordHash: await bcrypt.hash('Demo123!', 10),
        vorname: 'Mess',
        nachname: 'Signierer',
        globalRole: 'USER',
        isActive: true,
      },
      select: { id: true },
    });
    personId = person.id;
    await prisma.userMandantRole.create({
      data: { userId: personId, mandantId: mandantAId, rolle: 'WIRTSCHAFTSPRUEFER' },
    });
    await prisma.userMandantRole.create({
      data: { userId: personId, mandantId: mandantBId, rolle: 'STEUERBERATER' },
    });

    // Der Bestand fuer Mandant B: die Person ist dort STEUERBERATER und
    // darf den Abschluss vorbereiten.
    const token = await login(personEmail);
    const auth = (mandantId: string) => ({
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      'x-mandant-id': mandantId,
    });

    // **Zwei** Abschluesse, einer je Test.
    //
    // Grund: das Signieren setzt den Abschluss auf SIGNED. Beide Tests
    // denselben Abschluss zu nutzen heisst: der erste Test (Negativprobe)
    // laesst den zweiten (Gegenprobe) an einem bereits signierten Abschluss
    // laufen — der scheitert dann mit 409 „steht auf SIGNED" statt mit dem
    // eigentlichen Fehler. Im Negativproben-Lauf war genau das zu sehen:
    // die Gegenprobe wurde rot, **aus dem falschen Grund**.
    const bilanzRes = await fetch(`${BASE}/api/bilanz?mandantId=${mandantBId}`, {
      method: 'POST',
      headers: auth(mandantBId),
      body: JSON.stringify({
        mandantId: mandantBId,
        geschaeftsjahr: jahr,
        positionen: [
          { seite: 'AKTIVA', kontonummer: 'B.IV.', bezeichnung: 'Kasse', betragAktuell: 1000, reihenfolge: 1 },
          { seite: 'PASSIVA', kontonummer: 'A.', bezeichnung: 'Gezeichnetes Kapital', betragAktuell: 1000, reihenfolge: 2 },
        ],
      }),
    });
    const bilanzBody = (await bilanzRes.json()) as { bilanz?: { id?: string } };
    bilanzId = bilanzBody.bilanz?.id ?? '';

    const guvRes = await fetch(`${BASE}/api/guv?mandantId=${mandantBId}`, {
      method: 'POST',
      headers: auth(mandantBId),
      body: JSON.stringify({
        mandantId: mandantBId,
        geschaeftsjahr: jahr,
        verfahren: 'GKV',
        positionen: [
          { kontonummer: '1.', bezeichnung: 'Umsatzerloese', kategorie: 'ERLOES', betragAktuell: 1000, reihenfolge: 1 },
        ],
      }),
    });
    const guvBody = (await guvRes.json()) as { guv?: { id?: string }; guV?: { id?: string } };
    guvId = guvBody.guV?.id ?? guvBody.guv?.id ?? '';

    const anhangRes = await fetch(`${BASE}/api/anhang?mandantId=${mandantBId}`, {
      method: 'POST',
      headers: auth(mandantBId),
      body: JSON.stringify({
        mandantId: mandantBId,
        geschaeftsjahr: jahr,
        abschnitte: [{ titel: 'Allgemeine Angaben', reihenfolge: 1, inhalt: 'Sitz: Berlin' }],
      }),
    });
    const anhangBody = (await anhangRes.json()) as {
      anhang?: { id?: string };
      id?: string;
    };
    anhangId = anhangBody.anhang?.id ?? anhangBody.id ?? '';

    expect(bilanzId && guvId && anhangId, 'Bestand fuer Mandant B anlegen').toBeTruthy();

    const abschlussRes = await fetch(`${BASE}/api/jahresabschluss`, {
      method: 'POST',
      headers: auth(mandantBId),
      body: JSON.stringify({ mandantId: mandantBId, geschaeftsjahr: jahr }),
    });
    const abschlussBody = (await abschlussRes.json()) as { id?: string };
    abschlussId = abschlussBody.id ?? '';
    expect(abschlussId, 'Jahresabschluss anlegen').toBeTruthy();

    // Die drei Saetze auf "abgeschlossen" setzen — direkt in der DB, weil es
    // hier um die **Signaturberechtigung** geht, nicht um den Abschlussweg.
    await prisma.bilanz.update({ where: { id: bilanzId }, data: { status: 'VALIDATED' } });
    await prisma.guV.update({ where: { id: guvId }, data: { status: 'VALIDATED' } });
    await prisma.anhang.update({ where: { id: anhangId }, data: { status: 'VALIDATED' } });

    const fin = await fetch(`${BASE}/api/jahresabschluss/${abschlussId}/finalize`, {
      method: 'POST',
      headers: auth(mandantBId),
      body: JSON.stringify({}),
    });
    expect(fin.status, `Abschluss finalisieren: ${await fin.clone().text()}`).toBe(200);

    // (2) Ein zweiter, vollstaendiger Abschluss fuer die Gegenprobe.
    const bilanz2 = await fetch(`${BASE}/api/bilanz?mandantId=${mandantBId}`, {
      method: 'POST',
      headers: auth(mandantBId),
      body: JSON.stringify({
        mandantId: mandantBId,
        geschaeftsjahr: jahr2,
        positionen: [
          { seite: 'AKTIVA', kontonummer: 'B.IV.', bezeichnung: 'Kasse', betragAktuell: 1000, reihenfolge: 1 },
          { seite: 'PASSIVA', kontonummer: 'A.', bezeichnung: 'Gezeichnetes Kapital', betragAktuell: 1000, reihenfolge: 2 },
        ],
      }),
    });
    const bilanz2Body = (await bilanz2.json()) as { bilanz?: { id?: string } };
    const bilanz2Id = bilanz2Body.bilanz?.id ?? '';

    const guv2 = await fetch(`${BASE}/api/guv?mandantId=${mandantBId}`, {
      method: 'POST',
      headers: auth(mandantBId),
      body: JSON.stringify({
        mandantId: mandantBId,
        geschaeftsjahr: jahr2,
        verfahren: 'GKV',
        positionen: [
          { kontonummer: '1.', bezeichnung: 'Umsatzerloese', kategorie: 'ERLOES', betragAktuell: 1000, reihenfolge: 1 },
        ],
      }),
    });
    const guv2Body = (await guv2.json()) as { guv?: { id?: string }; guV?: { id?: string } };
    const guv2Id = guv2Body.guV?.id ?? guv2Body.guv?.id ?? '';

    const anhang2 = await fetch(`${BASE}/api/anhang?mandantId=${mandantBId}`, {
      method: 'POST',
      headers: auth(mandantBId),
      body: JSON.stringify({
        mandantId: mandantBId,
        geschaeftsjahr: jahr2,
        abschnitte: [{ titel: 'Allgemeine Angaben', reihenfolge: 1, inhalt: 'Sitz: Berlin' }],
      }),
    });
    const anhang2Body = (await anhang2.json()) as { anhang?: { id?: string }; id?: string };
    const anhang2Id = anhang2Body.anhang?.id ?? anhang2Body.id ?? '';

    await prisma.bilanz.update({ where: { id: bilanz2Id }, data: { status: 'VALIDATED' } });
    await prisma.guV.update({ where: { id: guv2Id }, data: { status: 'VALIDATED' } });
    await prisma.anhang.update({ where: { id: anhang2Id }, data: { status: 'VALIDATED' } });

    const abschluss2 = await fetch(`${BASE}/api/jahresabschluss`, {
      method: 'POST',
      headers: auth(mandantBId),
      body: JSON.stringify({ mandantId: mandantBId, geschaeftsjahr: jahr2 }),
    });
    const abschluss2Body = (await abschluss2.json()) as { id?: string };
    abschlussIdGegenprobe = abschluss2Body.id ?? '';
    expect(abschlussIdGegenprobe, 'zweiter Jahresabschluss anlegen').toBeTruthy();

    const fin2 = await fetch(`${BASE}/api/jahresabschluss/${abschlussIdGegenprobe}/finalize`, {
      method: 'POST',
      headers: auth(mandantBId),
      body: JSON.stringify({}),
    });
    expect(fin2.status, `zweiter Abschluss finalisieren: ${await fin2.clone().text()}`).toBe(200);

    zweiterBestand = { bilanz2Id, guv2Id, anhang2Id };
    bilanzIdGegenprobe = bilanz2Id;
  });

  afterAll(async () => {
    for (const id of [abschlussId, abschlussIdGegenprobe]) {
      if (!id) continue;
      await prisma.signature.deleteMany({ where: { jahresabschlussId: id } });
      await prisma.jahresabschluss.deleteMany({ where: { id } });
    }
    if (zweiterBestand.bilanz2Id) {
      await prisma.bilanz.deleteMany({ where: { id: zweiterBestand.bilanz2Id } });
    }
    if (zweiterBestand.guv2Id) {
      await prisma.guV.deleteMany({ where: { id: zweiterBestand.guv2Id } });
    }
    if (zweiterBestand.anhang2Id) {
      await prisma.anhang.deleteMany({ where: { id: zweiterBestand.anhang2Id } });
    }
    if (bilanzId) await prisma.bilanz.deleteMany({ where: { id: bilanzId } });
    if (guvId) await prisma.guV.deleteMany({ where: { id: guvId } });
    if (anhangId) await prisma.anhang.deleteMany({ where: { id: anhangId } });
    if (personId) {
      await prisma.userMandantRole.deleteMany({ where: { userId: personId } });
      await prisma.user.deleteMany({ where: { id: personId } });
    }
    await prisma.$disconnect();
  });

  const p12 = readFileSync(P12_PATH).toString('base64');

  it('signiert keinen Jahresabschluss ohne WP-Rolle auf dem Mandanten', async () => {
    const token = await login(personEmail);
    const res = await fetch(`${BASE}/api/signatur/sign-abschluss`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        // Der Kontext zeigt auf Mandant A, in dem die Person WP ist.
        'x-mandant-id': mandantAId,
      },
      body: JSON.stringify({
        jahresabschlussId: abschlussId,
        mandantId: mandantBId,
        p12Base64: p12,
        p12Password: P12_PASSWORD,
      }),
    });
    const body = await res.text();
    expect(
      res.status,
      'eine qeS auf den Jahresabschluss darf nur von einem Wirtschaftspruefer ' +
        `des Mandanten stammen — Antwort: ${body.slice(0, 200)}`,
    ).toBe(403);

    const sigs = await prisma.signature.count({ where: { jahresabschlussId: abschlussId } });
    expect(sigs, 'es darf keine Signatur entstanden sein').toBe(0);
  });

  it('Gegenprobe: der WP des Mandanten darf den Abschluss signieren', async () => {
    // wp@kanzlei.de ist Wirtschaftspruefer in Mandant B — der erlaubte Weg
    // muss offen bleiben, sonst waere die Kontrolle nur ein Produktschalter.
    //
    // BEFUND 2026-10-21 (Nachtrag 79): Die Endabnahme verlangt zusaetzlich
    // einen **freigegebenen Vier-Augen-Pruefungsnachweis** der Bilanz. Also
    // erst pruefen (wp@), dann von einer zweiten Person freigeben lassen
    // (wp2@), dann signieren.
    const wpToken = await login('wp@kanzlei.de');
    const wp2Token = await login('wp2@kanzlei.de');
    await fuehreVierAugenPruefungDurch({
      base: BASE,
      mandantId: mandantBId,
      bilanzId: bilanzIdGegenprobe,
      tokenPruefend: wpToken,
      tokenFreigebend: wp2Token,
    });

    const token = wpToken;
    const res = await fetch(`${BASE}/api/signatur/sign-abschluss`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'x-mandant-id': mandantBId,
      },
      body: JSON.stringify({
        jahresabschlussId: abschlussIdGegenprobe,
        mandantId: mandantBId,
        p12Base64: p12,
        p12Password: P12_PASSWORD,
      }),
    });
    const body = await res.text();
    expect(
      res.status,
      'der Wirtschaftspruefer des Mandanten muss signieren koennen — ' +
        `Antwort: ${body.slice(0, 200)}`,
    ).toBe(200);

    const sigs = await prisma.signature.count({
      where: { jahresabschlussId: abschlussIdGegenprobe },
    });
    expect(sigs, 'die Signatur muss existieren').toBe(1);
  });
});
