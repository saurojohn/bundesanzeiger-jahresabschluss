import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

/**
 * BEFUND 2026-10-23 (Nachtrag 89): Die Archivsperre stand nur im
 * **Anlege-Pfad** der Konsolidierung. `applyKonsolidierung` legt die
 * Konzern-Bilanz UND die Konzern-GuV an — zwei neue, VALIDATED Sätze.
 *
 * **Gemessen** an der laufenden API (Mutter archivieren, dann anwenden):
 *
 *     PATCH /api/mandant/<M>/archivierung                -> HTTP 200
 *     POST  /api/bilanz?mandantId=<M>                     -> HTTP 403 (Gegenprobe)
 *     POST  /api/konsolidierung/einheiten/<E>/apply
 *       -> HTTP 201 {"konzernBilanzId":"…","konzernGuvId":"…"}
 *     SELECT id, geschaeftsjahr, status FROM bilanz
 *       WHERE mandantId='<M>' AND konzernEinheitId='<E>'
 *       -> [{"status":"VALIDATED"}]
 *
 * Das widerspricht der dokumentierten Archivregel („Der Bestand bleibt zur
 * Nachvollziehbarkeit erhalten (§ 147 AO), wird aber nicht fortgeschrieben")
 * — die Regel war an **einer** der beiden Schreibpfade eingeloest.
 *
 * Der Test prüft beide Richtungen: der Normalweg muss weiterhin funktionieren
 * (Gegenprobe), und der archivierte Mandant darf keine neuen Belege
 * bekommen.
 */
const BASE = 'http://localhost:3000';

describe('Konsolidierung: ein archivierter Mandant bekommt keine neuen Belege (Nachtrag 89)', () => {
  const prisma = new PrismaClient();
  // Zwei FREIE Jahre: pro Mutter+Geschäftsjahr ist nur EINE
  // Konsolidierungseinheit zulässig — die Gegenprobe und der Archivfall
  // brauchen also je eine eigene. Die Jahre werden gesucht, nicht
  // festgesetzt: andere Specs belegen 2086-2090 (Nachtrag 87/88), und ein
  // festes Jahr macht diesen Test von fremden Daten abhaengig.
  let JAHR = 0;
  let JAHR_ARCHIV = 0;
  let mutterId = '';
  let tochterId = '';
  let token = '';
  let adminToken = '';
  let einheitId = '';
  let mutterArchiviertVorher: Date | null = null;

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

  // Der Apply verlangt WIRTSCHAFTSPRUEFER oder KANZLEI_ADMIN.
  const applyHead = () => ({
    authorization: `Bearer ${adminToken}`,
    'x-mandant-id': mutterId,
  });

  /** Legt Bilanz + GuV fuer einen Mandanten an (nur solange er aktiv ist). */
  async function saetzeAnlegen(mandantId: string, label: string, jahr: number) {
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
    expect(b.status, `Bilanz ${label}`).toBe(201);
    expect(g.status, `GuV ${label}`).toBe(201);
  }

  async function einheitAnlegen(jahr: number): Promise<string> {
    const res = await j('/api/konsolidierung/einheiten', {
      method: 'POST',
      headers: { authorization: `Bearer ${adminToken}`, 'x-mandant-id': mutterId },
      body: JSON.stringify({
        mutterMandantId: mutterId,
        tochterMandantIds: [tochterId],
        geschaeftsjahr: jahr,
        beteiligungsquote: 100,
        konsolidierungsArt: 'VOLLKONSOLIDIERUNG',
      }),
    });
    expect(res.status, `Einheit anlegen: ${res.text.slice(0, 200)}`).toBe(201);
    return (res.body as { id: string }).id;
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
    mutterArchiviertVorher = mutter.archiviertAt;

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

    // Zwei freie Jahre suchen (GuV und Anhang muessen ebenfalls frei sein —
    // die Jahrgangs-Eindeutigkeit gilt je Satzart).
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
    [JAHR, JAHR_ARCHIV] = freieJahre;

    // Die Einzelabschluesse beider Gesellschaften (die Konzernrechnung
    // braucht sie; ein Mandant darf sie nur anlegen, solange er aktiv ist).
    for (const jahr of [JAHR, JAHR_ARCHIV]) {
      await saetzeAnlegen(mutterId, `Mutter ${String(jahr)}`, jahr);
      await saetzeAnlegen(tochterId, `Tochter ${String(jahr)}`, jahr);
    }
  });

  afterAll(async () => {
    if (einheitId) {
      await prisma.bilanz.deleteMany({ where: { konzernEinheitId: einheitId } });
      await prisma.guV.deleteMany({ where: { konzernEinheitId: einheitId } });
      await prisma.konsolidierungsEinheit.deleteMany({ where: { id: einheitId } });
    }
    await prisma.mandant.update({
      where: { id: mutterId },
      data: { archiviertAt: mutterArchiviertVorher },
    });
    for (const jahr of [JAHR, JAHR_ARCHIV]) {
      await prisma.bilanz.deleteMany({ where: { mandantId: mutterId, geschaeftsjahr: jahr } });
      await prisma.guV.deleteMany({ where: { mandantId: mutterId, geschaeftsjahr: jahr } });
      await prisma.anhang.deleteMany({ where: { mandantId: mutterId, geschaeftsjahr: jahr } });
      await prisma.bilanz.deleteMany({ where: { mandantId: tochterId, geschaeftsjahr: jahr } });
      await prisma.guV.deleteMany({ where: { mandantId: tochterId, geschaeftsjahr: jahr } });
      await prisma.anhang.deleteMany({ where: { mandantId: tochterId, geschaeftsjahr: jahr } });
    }
    await prisma.$disconnect();
  });

  it('Gegenprobe: aktive Mandanten werden konsolidiert (der Weg bleibt offen)', async () => {
    einheitId = await einheitAnlegen(JAHR);
    const res = await j(`/api/konsolidierung/einheiten/${einheitId}/apply`, {
      method: 'POST',
      headers: applyHead(),
      body: JSON.stringify({}),
    });
    expect(res.status, `Anwenden: ${res.text.slice(0, 200)}`).toBe(201);
    const body = res.body as { konzernBilanzId?: string; konzernGuvId?: string };
    expect(body.konzernBilanzId).toBeTruthy();
    expect(body.konzernGuvId).toBeTruthy();
  });

  it('ein archivierter Mandant bekommt keine neuen Belege (BUG vor dem Fix)', async () => {
    // Eine eigene Einheit mit eigenem Jahr — pro Jahr ist nur eine zulaessig.
    const eigeneEinheitId = await einheitAnlegen(JAHR_ARCHIV);

    const archiv = await j(`/api/mandant/${mutterId}/archivierung`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${adminToken}`, 'x-mandant-id': mutterId },
      body: JSON.stringify({}),
    });
    expect(archiv.status, `Archivieren: ${archiv.text.slice(0, 160)}`).toBe(200);

    const res = await j(`/api/konsolidierung/einheiten/${eigeneEinheitId}/apply`, {
      method: 'POST',
      headers: applyHead(),
      body: JSON.stringify({}),
    });
    expect(
      res.status,
      `ein archivierter Mandant darf nicht konsolidiert werden — Antwort: ${res.text.slice(0, 220)}`,
    ).toBe(409);

    // Und es darf kein Konzern-Satz entstanden sein.
    const konzernSaetze = await prisma.bilanz.findMany({
      where: { mandantId: mutterId, konzernEinheitId: eigeneEinheitId },
      select: { id: true, status: true },
    });
    expect(
      konzernSaetze,
      'der archivierte Mandant hat neue Belege bekommen',
    ).toEqual([]);

    await prisma.konsolidierungsEinheit.deleteMany({ where: { id: eigeneEinheitId } });
  });
});
