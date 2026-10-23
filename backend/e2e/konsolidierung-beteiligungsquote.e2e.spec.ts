import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

/**
 * BEFUND 2026-10-23 (Nachtrag 90): Die Beteiligungsquote wurde an
 * mehreren Stellen gelesen — mit unterschiedlichen Lesarten. Der Helper
 * nahm BEIDE Formen an (`wert > 1 ? wert/100 : wert`), obwohl der
 * gespeicherte Wert **immer Prozent** ist (DTO 0–100, Spalte
 * `Decimal(5,2)`, Frontend-Feld „Beteiligungsquote (%)").
 *
 * Dadurch war 1 % Beteiligung (1) nicht von 100 % (als Bruchteil 1) zu
 * unterscheiden.
 *
 * **GEMESSEN** an der laufenden API (Tochter 1000 EUR Aktiva, Mutter
 * ebenfalls 1000 EUR, Konzern-Bilanz Position `B.IV.`):
 *
 *     Beteiligungsquote  1 %   -> 2000   (erwartet 1010)
 *     Beteiligungsquote  0,5 % -> 1500   (erwartet 1005)
 *     Beteiligungsquote 60 %   -> 1600   (erwartet 1600)   ok
 *
 * Bei 1 % Beteiligung ging die Tochter also zu 100 % in den
 * Konzernabschluss ein: die Minderheitsbeteiligung war um das
 * Hundertfache überhöht (§ 305 Abs. 1 HGB).
 *
 * Der Test prüft die ANGEWENDETE Quote am Ergebnis (nicht die
 * Zwischenschritte): 1 % müssen 10 EUR der Tochter einbringen, 60 %
 * dagegen 600 EUR (Gegenprobe — der Weg war vorher korrekt).
 */
const BASE = 'http://localhost:3000';

describe('Konsolidierung: die Beteiligungsquote wird als Prozent angewendet (Nachtrag 90)', () => {
  const prisma = new PrismaClient();
  let JAHR_1PROZENT = 0;
  let JAHR_60PROZENT = 0;
  let mutterId = '';
  let tochterId = '';
  let token = '';
  let adminToken = '';
  const einheitIds: string[] = [];

  async function j(path: string, opts: Record<string, unknown> = {}) {
    const res = await fetch(`${BASE}${path}`, {
      ...opts,
      headers: {
        'content-type': 'application/json',
        ...((opts.headers as Record<string, string>) ?? {}),
      },
    });
    const text = await res.text();
    let body: unknown = text;
    try { body = JSON.parse(text); } catch { /* Klartext */ }
    return { status: res.status, body: body as Record<string, unknown>, text };
  }

  const applyHead = () => ({
    authorization: `Bearer ${adminToken}`,
    'x-mandant-id': mutterId,
  });

  /** Legt Bilanz + GuV fuer einen Mandanten an (nur solange er aktiv ist). */
  async function saetzeAnlegen(mandantId: string, jahr: number) {
    const b = await j(`/api/bilanz?mandantId=${mandantId}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'x-mandant-id': mandantId },
      body: JSON.stringify({
        mandantId, geschaeftsjahr: jahr,
        positionen: [
          { seite: 'AKTIVA', kontonummer: 'B.IV.', bezeichnung: 'Kasse', betragAktuell: 1000, reihenfolge: 1 },
          { seite: 'PASSIVA', kontonummer: 'A.I.', bezeichnung: 'Kapital', betragAktuell: 1000, reihenfolge: 1 },
        ],
      }),
    });
    const g = await j(`/api/guv?mandantId=${mandantId}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'x-mandant-id': mandantId },
      body: JSON.stringify({
        mandantId, geschaeftsjahr: jahr, verfahren: 'GKV',
        positionen: [
          { kontonummer: '1.', bezeichnung: 'Umsatz', kategorie: 'ERLOES', betragAktuell: 1000, reihenfolge: 1 },
        ],
      }),
    });
    expect(b.status, `Bilanz ${mandantId}/${jahr}`).toBe(201);
    expect(g.status, `GuV ${mandantId}/${jahr}`).toBe(201);
  }

  /**
   * Konsolidiert Mutter + Tochter und liefert die Konzern-Position
   * `B.IV.` (Aktiva) — dort steht, wieviel der Tochter eingeflossen ist.
   */
  async function konzernKasse(jahr: number, quote: number): Promise<number> {
    await saetzeAnlegen(mutterId, jahr);
    await saetzeAnlegen(tochterId, jahr);

    const angelegt = await j('/api/konsolidierung/einheiten', {
      method: 'POST',
      headers: applyHead(),
      body: JSON.stringify({
        mutterMandantId: mutterId,
        tochterMandantIds: [tochterId],
        geschaeftsjahr: jahr,
        beteiligungsquote: quote,
        konsolidierungsArt: 'VOLLKONSOLIDIERUNG',
      }),
    });
    expect(angelegt.status, `Einheit anlegen: ${angelegt.text.slice(0, 200)}`).toBe(201);
    const einheitId = (angelegt.body as { id: string }).id;
    einheitIds.push(einheitId);

    const apply = await j(`/api/konsolidierung/einheiten/${einheitId}/apply`, {
      method: 'POST',
      headers: applyHead(),
      body: JSON.stringify({}),
    });
    expect(apply.status, `Anwenden: ${apply.text.slice(0, 200)}`).toBe(201);

    const konzern = await prisma.bilanz.findFirst({
      where: { mandantId: mutterId, konzernEinheitId: einheitId },
      include: { positionen: true },
    });
    const kasse = konzern?.positionen?.find(
      (p) => p.kontonummer === 'B.IV.' && p.seite === 'AKTIVA',
    );
    expect(kasse, 'die Konzern-Bilanz muss die Position B.IV. ausweisen').toBeTruthy();
    return Number(kasse!.betragAktuell);
  }

  beforeAll(async () => {
    const mandanten = await prisma.mandant.findMany({
      where: { firmenname: { in: ['Demo GmbH', 'Beispiel GmbH'] } },
    });
    const mutter = mandanten.find((m) => m.firmenname === 'Demo GmbH');
    const tochter = mandanten.find((m) => m.firmenname === 'Beispiel GmbH');
    if (!mutter || !tochter) throw new Error('Seed-Mandanten fehlen');
    mutterId = mutter.id;
    tochterId = tochter.id;

    const loginSb = await j('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'steuerberater@kanzlei.de', password: 'Demo123!' }),
    });
    token = (loginSb.body as { accessToken: string }).accessToken;
    const loginAdmin = await j('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'kanzlei-admin@kanzlei.de', password: 'Demo123!' }),
    });
    adminToken = (loginAdmin.body as { accessToken: string }).accessToken;

    // Zwei FREIE Jahre suchen (pro Mutter+Geschäftsjahr ist nur eine
    // Konsolidierungseinheit zulaessig). Die Jahre werden gesucht, nicht
    // festgesetzt — andere Specs belegen 2086-2090.
    const freieJahre: number[] = [];
    for (let jahr = 2092; jahr <= 2099 && freieJahre.length < 2; jahr++) {
      const belegt =
        (await prisma.guV.count({ where: { mandantId: mutterId, geschaeftsjahr: jahr } })) +
        (await prisma.guV.count({ where: { mandantId: tochterId, geschaeftsjahr: jahr } })) +
        (await prisma.anhang.count({ where: { mandantId: mutterId, geschaeftsjahr: jahr } })) +
        (await prisma.anhang.count({ where: { mandantId: tochterId, geschaeftsjahr: jahr } })) +
        (await prisma.bilanz.count({ where: { mandantId: mutterId, geschaeftsjahr: jahr } })) +
        (await prisma.bilanz.count({ where: { mandantId: tochterId, geschaeftsjahr: jahr } }));
      if (belegt === 0) freieJahre.push(jahr);
    }
    expect(freieJahre.length, 'zwei freie Jahre finden').toBe(2);
    [JAHR_1PROZENT, JAHR_60PROZENT] = freieJahre;
  });

  afterAll(async () => {
    for (const id of einheitIds) {
      await prisma.bilanz.deleteMany({ where: { konzernEinheitId: id } });
      await prisma.guV.deleteMany({ where: { konzernEinheitId: id } });
      await prisma.konsolidierungsEinheit.deleteMany({ where: { id } });
    }
    for (const jahr of [JAHR_1PROZENT, JAHR_60PROZENT]) {
      for (const m of [mutterId, tochterId]) {
        await prisma.bilanz.deleteMany({ where: { mandantId: m, geschaeftsjahr: jahr, konzernEinheitId: null } });
        await prisma.guV.deleteMany({ where: { mandantId: m, geschaeftsjahr: jahr, konzernEinheitId: null } });
        await prisma.anhang.deleteMany({ where: { mandantId: m, geschaeftsjahr: jahr } });
      }
    }
    await prisma.$disconnect();
  });

  it('1 % Beteiligung bringen 10 EUR der Tochter in den Konzern (BUG vor dem Fix)', async () => {
    const betrag = await konzernKasse(JAHR_1PROZENT, 1);
    // 1000 (Mutter) + 1000 × 0,01 (Tochter) = 1010
    expect(
      betrag,
      'die Tochter ist zu 100 % eingeflossen (die Quote wurde als Bruchteil gelesen)',
    ).toBe(1010);
  });

  it('Gegenprobe: 60 % Beteiligung bringen 600 EUR der Tochter ein', async () => {
    const betrag = await konzernKasse(JAHR_60PROZENT, 60);
    // 1000 (Mutter) + 1000 × 0,6 (Tochter) = 1600
    expect(betrag).toBe(1600);
  });
});
