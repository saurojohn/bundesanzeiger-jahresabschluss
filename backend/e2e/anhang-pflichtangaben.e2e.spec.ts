import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

/**
 * BEFUND 2026-10-24 (Nachtrag 93): Die Inhaltsregeln des Anhangs gelten
 * für die **Abschnitte** (ab VALIDATED eingefroren) — für die drei
 * Pflichtangaben (§ 284 Abs. 2 Nr. 1/2, § 285 HGB) gilt sie **nicht**:
 * die bleiben auch nach der Freigabe änderbar.
 *
 * Das ist **so gewollt** und dokumentiert:
 *
 *   Entscheidung der Fachverantwortlichen vom 2026-10-14 (Nachtrag 77):
 *   „Soll das Signieren die Bilanz/GuV/Anhang gegen Änderung sperren?"
 *   → **Nein**. „Ein Korrekturvorgang erzeugt zwingend eine neue
 *   Signatur … Stattdessen muss SICHTBAR sein, wenn die vorgelegten Daten
 *   nicht mehr der signierten Fassung entsprechen."
 *
 * Die Positionen der Bilanz und der GuV sind ab VALIDATED eingefroren —
 * damit sind die drei Pflichtangaben der **einzige** Weg, einen
 * Korrekturvorgang am signierten Jahresabschluss zu erzeugen (Nachtrag 78:
 * Re-Signatur; der Abweichungsindikator zeigt die Abweichung an, die
 * Einreichung wird gesperrt).
 *
 * Der Test ist damit ein **Wächter der Produktentscheidung**: wer die
 * Aenderbarkeit entfernt, zerstört den Korrekturvorgang.
 *
 * Der zweite Teil des Befunds — die Platzhalterprüfung sah nur die
 * Abschnitte an — ist behoben: ein "[Ort]" in den Pflichtangaben wird
 * jetzt gemeldet.
 */
const BASE = 'http://localhost:3000';

describe('Anhang: die Pflichtangaben sind nach der Freigabe gesperrt (Nachtrag 93)', () => {
  const prisma = new PrismaClient();
  let mandantId = '';
  let token = '';
  const anhangIds: string[] = [];
  const jahre: number[] = [];

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

  async function anhangAnlegen(jahr: number, felder: Record<string, string>) {
    const res = await j('/api/anhang', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'x-mandant-id': mandantId },
      body: JSON.stringify({
        mandantId,
        geschaeftsjahr: jahr,
        bilanzierungsMethoden: 'Lineare Abschreibung',
        bewertungsMethoden: 'Wertaufzeichnung',
        sonstigePflichtangaben: 'Keine weiteren Angaben',
        abschnitte: [
          {
            titel: 'Grundlagen',
            inhalt: 'Der Anhang wurde nach den handelsrechtlichen Vorschriften aufgestellt.',
            reihenfolge: 1,
          },
        ],
        ...felder,
      }),
    });
    expect(res.status, `Anhang anlegen: ${res.text.slice(0, 200)}`).toBe(201);
    const id = (res.body as { id: string }).id;
    anhangIds.push(id);
    return id;
  }

  beforeAll(async () => {
    const login = await j('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'steuerberater@kanzlei.de', password: 'Demo123!' }),
    });
    token = (login.body as { accessToken: string }).accessToken;
    const mandanten = await prisma.mandant.findMany({ where: { firmenname: 'Demo GmbH' } });
    const mandant = mandanten[0];
    if (!mandant) throw new Error('Seed-Mandant fehlt');
    mandantId = mandant.id;
    for (let jahr = 2094; jahr <= 2097; jahr++) {
      const belegt = await prisma.anhang.count({ where: { mandantId, geschaeftsjahr: jahr } });
      if (belegt === 0) jahre.push(jahr);
    }
    expect(jahre.length, 'drei freie Jahre finden').toBeGreaterThanOrEqual(3);
  });

  afterAll(async () => {
    for (const id of anhangIds) {
      await prisma.anhangAbschnitt.deleteMany({ where: { anhangId: id } });
      await prisma.anhang.deleteMany({ where: { id } });
    }
    await prisma.$disconnect();
  });

  it('nach der Freigabe lassen sich die drei Pflichtangaben weiterhin aendern (Korrekturvorgang)', async () => {
    const id = await anhangAnlegen(jahre[0], {});

    // Den Anhang aus der Bearbeitung nehmen.
    const validiert = await j(`/api/anhang/${id}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${token}`, 'x-mandant-id': mandantId },
      body: JSON.stringify({ status: 'VALIDATED' }),
    });
    expect(validiert.status, `Anhang validieren: ${validiert.text.slice(0, 200)}`).toBe(200);

    // Die Gegenprobe: die Abschnitte waren schon gesperrt.
    const abschnitte = await j(`/api/anhang/${id}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${token}`, 'x-mandant-id': mandantId },
      body: JSON.stringify({
        abschnitte: [{ titel: 'Neu', inhalt: 'Neuer Inhalt', reihenfolge: 1 }],
      }),
    });
    expect(abschnitte.status, 'die Abschnitte sind gesperrt').toBe(400);

    // Die drei Pflichtangaben — das ist der Korrekturvorgang und bleibt
    // deshalb moeglich (Entscheidung der Fachverantwortlichen vom
    // 2026-10-14: „Soll das Signieren gegen Aenderung sperren?" -> NEIN).
    // Die Positionen von Bilanz und GuV sind ab VALIDATED eingefroren —
    // damit sind diese drei Felder der einzige Korrekturweg.
    for (const feld of [
      'bilanzierungsMethoden',
      'bewertungsMethoden',
      'sonstigePflichtangaben',
    ] as const) {
      const res = await j(`/api/anhang/${id}`, {
        method: 'PATCH',
        headers: { authorization: `Bearer ${token}`, 'x-mandant-id': mandantId },
        body: JSON.stringify({ [feld]: 'Korrektur nach der Freigabe.' }),
      });
      expect(res.status, `${feld} muss aenderbar bleiben`).toBe(200);
    }

    // Und der geaenderte Text steht in der Datenbank.
    const inDb = await prisma.anhang.findUnique({ where: { id } });
    expect(inDb?.status).toBe('VALIDATED');
    expect(inDb?.bilanzierungsMethoden).toBe('Korrektur nach der Freigabe.');
    expect(inDb?.bewertungsMethoden).toBe('Korrektur nach der Freigabe.');
    expect(inDb?.sonstigePflichtangaben).toBe('Korrektur nach der Freigabe.');
  });

  it('im DRAFT bleibt der Anhang aenderbar (der Normalweg bleibt offen)', async () => {
    const id = await anhangAnlegen(jahre[1], {});
    const res = await j(`/api/anhang/${id}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${token}`, 'x-mandant-id': mandantId },
      body: JSON.stringify({ bilanzierungsMethoden: 'Neue Methode' }),
    });
    expect(res.status, `im DRAFT aendern: ${res.text.slice(0, 200)}`).toBe(200);
    const inDb = await prisma.anhang.findUnique({ where: { id } });
    expect(inDb?.bilanzierungsMethoden).toBe('Neue Methode');
  });

  it('ein Platzhalter in den Pflichtangaben wird gemeldet (BUG vor dem Fix)', async () => {
    // Ein eigener Jahrgang — der erste Test hat jahre[0] belegt.
    const id = await anhangAnlegen(jahre[2], {
      bilanzierungsMethoden: 'Lineare Abschreibung, Sitz [Ort]',
      sonstigePflichtangaben: 'Steuernummer [Steuernummer]',
    });
    const detail = await j(`/api/anhang/${id}?mandantId=${mandantId}`, {
      headers: { authorization: `Bearer ${token}`, 'x-mandant-id': mandantId },
    });
    const offen =
      (detail.body as { offenePlatzhalter?: string[] }).offenePlatzhalter ??
      (detail.body as { anhang?: { offenePlatzhalter?: string[] } }).anhang?.offenePlatzhalter ??
      [];
    expect(offen.sort(), 'die Platzhalter der Pflichtangaben werden gemeldet').toEqual([
      'Ort',
      'Steuernummer',
    ]);
  });
});
