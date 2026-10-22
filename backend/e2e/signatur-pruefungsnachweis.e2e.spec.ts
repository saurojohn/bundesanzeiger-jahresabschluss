import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { fuehreVierAugenPruefungDurch } from './helpers/wp-vier-augen';

/**
 * Die qeS-**Endabnahme** verlangt den Pruefungsnachweis, den sie bescheinigt.
 *
 * BEFUND 2026-10-21 (Nachtrag 79): Die Kette lief ohne jede Vier-Augen-
 * Pruefung durch:
 *
 *     VALIDATED setzen (nur Berater)  -> Bilanz 200, GuV 200, Anhang 200
 *     finalize                        -> HTTP 200
 *     sign-abschluss (WP, qeS)       -> HTTP 200
 *     einreichen (Kanzlei)           -> HTTP 200  -> SUBMITTED
 *     WP-Pruefungen zur Bilanz: 0
 *
 * Der Einreichungsweg verlangt zwingend eine qeS (IKS K-20) — jeder
 * veroeffentlichte Jahresabschluss gilt damit als **gepruefte Fassung**.
 * Eine qeS ohne Pruefungsnachweis ist eine Bescheinigung ohne Grundlage.
 *
 * ENTSCHEIDUNG der Fachverantwortlichen vom 2026-10-21: fail-closed. Der
 * Weg ist: WP prueft, eine zweite Person gibt frei, dann signiert.
 *
 * **Nur die Endabnahme.** Eine *Bestandteil*-Signatur (Bilanz/GuV/Anhang)
 * bescheinigt nur ein geprueftes Teilstueck (Nachtrag 60) und braucht
 * deshalb keinen Pruefungsnachweis.
 */
const BASE = 'http://localhost:3000';
const P12_PATH = join(process.cwd(), 'tmp', 'test-certs', 'test-token.p12');
const P12_PASSWORD = 'Test1234!';

describe('Endabnahme: ohne Vier-Augen-Pruefungsnachweis keine qeS (Nachtrag 79)', () => {
  const prisma = new PrismaClient();
  let mandantId = '';
  let wp1Id = '';
  let wp1Email = '';
  let wp2Id = '';
  let wp2Email = '';
  let bilanzId = '';
  let bilanzIdBestandteil = '';
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

  const saetzeAnlegen = async (token: string, jahrNummer: number) => {
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
    const bilanz = ((await bilanzRes.json()) as { bilanz?: { id?: string } }).bilanz?.id ?? '';

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
    const guvId = guvBody.guV?.id ?? guvBody.guv?.id ?? '';

    const anhangRes = await fetch(`${BASE}/api/anhang?mandantId=${mandantId}`, {
      method: 'POST', headers: auth(),
      body: JSON.stringify({
        mandantId, geschaeftsjahr: jahrNummer,
        abschnitte: [{ titel: 'Allgemeine Angaben', reihenfolge: 1, inhalt: 'Sitz: Berlin' }],
      }),
    });
    const anhangBody = (await anhangRes.json()) as { anhang?: { id?: string }; id?: string };
    const anhangId = anhangBody.anhang?.id ?? anhangBody.id ?? '';

    for (const [url, id] of [
      ['/api/bilanz', bilanz],
      ['/api/guv', guvId],
      ['/api/anhang', anhangId],
    ] as const) {
      const r = await fetch(`${BASE}${url}/${id}?mandantId=${mandantId}`, {
        method: 'PATCH', headers: auth(),
        body: JSON.stringify({ status: 'VALIDATED' }),
      });
      expect(r.status, `${url} auf VALIDATED`).toBe(200);
    }
    return { bilanz, guvId, anhangId };
  };

  beforeAll(async () => {
    const kanzlei = await prisma.kanzlei.findFirstOrThrow({
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    const mandant = await prisma.mandant.create({
      data: {
        kanzleiId: kanzlei.id,
        firmenname: `Pruefungsnachweis-${Date.now()}`,
        rechtsform: 'GmbH',
        adresse: { strasse: 'Nachweisweg 1', plz: '10999', ort: 'Muenchen', land: 'DE' },
        geschaeftsfuehrer: [{ name: 'Test', geburtsdatum: '1970-01-01', anteilProzent: 100 }],
        groessenklasse: 'KLEINST',
        publishChannel: 'PDF_DIRECT',
      },
      select: { id: true },
    });
    mandantId = mandant.id;

    for (const nr of [1, 2]) {
      const u = await prisma.user.create({
        data: {
          email: `nachweis-wp${nr}-${Date.now()}@kanzlei.de`,
          passwordHash: await bcrypt.hash('Demo123!', 10),
          vorname: 'Mess',
          nachname: `Pruefer${nr}`,
          globalRole: 'USER',
          isActive: true,
        },
        select: { id: true, email: true },
      });
      // Person 1 bereitet die Saetze vor (STEUERBERATER) **und** prueft
      // (WIRTSCHAFTSPRUEFER) — die realistische Konstellation. Person 2 ist
      // die Zweitprueferin, die die Vier-Augen-Freigabe vornimmt.
      const rollen = nr === 1 ? ['STEUERBERATER', 'WIRTSCHAFTSPRUEFER'] : ['WIRTSCHAFTSPRUEFER'];
      for (const rolle of rollen) {
        await prisma.userMandantRole.create({
          data: { userId: u.id, mandantId, rolle },
        });
      }
      if (nr === 1) { wp1Id = u.id; wp1Email = u.email; }
      else { wp2Id = u.id; wp2Email = u.email; }
    }

    for (let j = 2050; j <= 2099; j++) {
      const b = await prisma.bilanz.count({ where: { mandantId, geschaeftsjahr: j } });
      const g = await prisma.guV.count({ where: { mandantId, geschaeftsjahr: j } });
      const a = await prisma.anhang.count({ where: { mandantId, geschaeftsjahr: j } });
      if (b + g + a === 0) { jahr = j; break; }
    }
    expect(jahr, 'ein freies Geschaeftsjahr finden').toBeGreaterThan(0);

    const token1 = await login(wp1Email);
    const saetze = await saetzeAnlegen(token1, jahr);
    bilanzId = saetze.bilanz;

    const auth = () => ({
      'content-type': 'application/json',
      authorization: `Bearer ${token1}`,
      'x-mandant-id': mandantId,
    });
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

    // Ein zweiter, eigenstaendiger Bestandteil fuer die Gegenprobe
    // (Komponentensignatur — sie braucht keinen Pruefungsnachweis).
    const zweiter = await saetzeAnlegen(token1, jahr + 1);
    bilanzIdBestandteil = zweiter.bilanz;
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
      await prisma.wPPruefungsAbschluss.deleteMany({ where: { bilanzId } });
      await prisma.userMandantRole.deleteMany({ where: { mandantId } });
      await prisma.mandant.deleteMany({ where: { id: mandantId } });
    }
    for (const id of [wp1Id, wp2Id]) {
      if (id) await prisma.user.deleteMany({ where: { id } });
    }
    await prisma.$disconnect();
  });

  const signieren = async (token: string, abschluss: string) => {
    const res = await fetch(`${BASE}/api/signatur/sign-abschluss`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'x-mandant-id': mandantId,
      },
      body: JSON.stringify({
        jahresabschlussId: abschluss,
        mandantId,
        p12Base64: readFileSync(P12_PATH).toString('base64'),
        p12Password: P12_PASSWORD,
      }),
    });
    return { status: res.status, text: await res.text() };
  };

  it('bescheinigt keinen Jahresabschluss ohne Vier-Augen-Pruefungsnachweis', async () => {
    const token1 = await login(wp1Email);
    const res = await signieren(token1, abschlussId);
    expect(
      res.status,
      'ohne freigegebene Vier-Augen-Pruefung gibt es keine Endabnahme — ' +
        `Antwort: ${res.text.slice(0, 220)}`,
    ).toBe(409);
    expect(
      res.text,
      'die Meldung muss den fehlenden Pruefungsnachweis benennen',
    ).toContain('Vier-Augen');

    const sigs = await prisma.signature.count({ where: { jahresabschlussId: abschlussId } });
    expect(sigs, 'es darf keine Signatur entstanden sein').toBe(0);
  });

  it('bescheinigt den Jahresabschluss, nachdem die Pruefung freigegeben wurde', async () => {
    const token1 = await login(wp1Email);
    const token2 = await login(wp2Email);
    await fuehreVierAugenPruefungDurch({
      base: BASE,
      mandantId,
      bilanzId,
      tokenPruefend: token1,
      tokenFreigebend: token2,
    });

    const res = await signieren(token1, abschlussId);
    expect(
      res.status,
      'nach der Vier-Augen-Freigabe muss die Endabnahme moeglich sein — ' +
        `Antwort: ${res.text.slice(0, 220)}`,
    ).toBe(200);

    const sigs = await prisma.signature.count({ where: { jahresabschlussId: abschlussId } });
    expect(sigs, 'die Signatur muss existieren').toBe(1);
  });

  it('Gegenprobe: eine Bestandteil-Signatur braucht keinen Pruefungsnachweis', async () => {
    // Eine Komponentensignatur bescheinigt nur ein geprueftes Teilstueck
    // (Nachtrag 60) — sie ist keine Endabnahme und bleibt zulaessig.
    const token1 = await login(wp1Email);
    const res = await fetch(`${BASE}/api/signatur/sign-bilanz`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token1}`,
        'x-mandant-id': mandantId,
      },
      body: JSON.stringify({
        bilanzId: bilanzIdBestandteil,
        mandantId,
        p12Base64: readFileSync(P12_PATH).toString('base64'),
        p12Password: P12_PASSWORD,
      }),
    });
    const text = await res.text();
    expect(
      res.status,
      'eine Bestandteil-Signatur ist keine Endabnahme und braucht keinen ' +
        `Pruefungsnachweis — Antwort: ${text.slice(0, 200)}`,
    ).toBe(200);
  });
});
