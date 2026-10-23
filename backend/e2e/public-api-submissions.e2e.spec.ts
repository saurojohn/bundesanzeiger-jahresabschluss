import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

/**
 * BEFUND 2026-10-23 (Nachtrag 88): Die Liste der Einreichungsbelege war die
 * **einzige** der oeffentlichen API ohne Cursor-Paging — und sie meldete
 * die Vorgangsnummer nie.
 *
 * **Gemessen** an der laufenden API (drei Einreichungsbelege, `pageSize=2`):
 *
 *     items: 2, total: 3, hasMore: false, nextCursor: null
 *     Submission …: status=SUBMITTED banzVorgangsnummer=null
 *
 *     DB: banzBestellnummer  = ["MESS-BESTELL-1","MESS-BESTELL-2","MESS-BESTELL-3"]
 *     DB: banzVorgangsnummer = [null,null,null]
 *
 * Zwei Fehler nebeneinander:
 *
 * 1. **Die Nummer kam aus dem falschen Feld.** Die API las
 *    `banzVorgangsnummer` — ein Feld, das **niemand schreibt**. Die
 *    Einreichung schreibt `banzBestellnummer` (Nachtrag 62, eindeutig
 *    per `@unique`). Ein externes ERP konnte die Einreichung darum nicht
 *    zuordnen.
 *
 * 2. **`hasMore: false` trotz abgeschnittener Datensaetze.** Der Client
 *    glaubte, es sei alles geliefert — und `nextCursor: null` hinderte ihn
 *    daran, den Rest zu holen. Der dritte Beleg war unerreichbar.
 *
 * Der Kommentar, der das begründete ("die Tabelle ist bislang leer"), war
 * falsch: die Einreichung schreibt seit 2026-10-20 BanzSubmission-Datensätze.
 */
const BASE = 'http://localhost:3000';

describe('Public API: Einreichungsbelege — Nummer und Paging (Nachtrag 88)', () => {
  const prisma = new PrismaClient();
  const JAHR = 2086;
  let mandantId = '';
  let kanzleiId = '';
  let abschlussId = '';
  let apiKey = '';

  async function j(path: string, opts: Record<string, unknown> = {}) {
    const res = await fetch(`${BASE}${path}`, {
      ...opts,
      headers: { 'content-type': 'application/json', ...((opts.headers as object) ?? {}) },
    });
    const text = await res.text();
    let body: unknown = text;
    try { body = JSON.parse(text); } catch { /* Klartext */ }
    return { status: res.status, body: body as Record<string, unknown>, text };
  }

  beforeAll(async () => {
    const mandant = await prisma.mandant.findFirstOrThrow({
      where: { firmenname: 'Demo GmbH' },
    });
    mandantId = mandant.id;
    kanzleiId = mandant.kanzleiId;

    const bilanz = await prisma.bilanz.create({
      data: {
        mandantId, geschaeftsjahr: JAHR, status: 'VALIDATED',
        positionen: {
          create: [
            { seite: 'AKTIVA', kontonummer: 'B.IV.', bezeichnung: 'Kasse', betragAktuell: 1000, reihenfolge: 1 },
            { seite: 'PASSIVA', kontonummer: 'A.I.', bezeichnung: 'Kapital', betragAktuell: 1000, reihenfolge: 1 },
          ],
        },
      },
      select: { id: true },
    });
    const guv = await prisma.guV.create({
      data: {
        mandantId, geschaeftsjahr: JAHR, status: 'VALIDATED', verfahren: 'GKV', ergebnis: 0,
        positionen: {
          create: [
            { kontonummer: '1.', bezeichnung: 'Umsatz', kategorie: 'ERLOES', betragAktuell: 1000, reihenfolge: 1 },
          ],
        },
      },
      select: { id: true },
    });
    const anhang = await prisma.anhang.create({
      data: {
        mandantId, geschaeftsjahr: JAHR, status: 'VALIDATED',
        abschnitte: { create: [{ titel: 'Allgemein', reihenfolge: 1, inhalt: 'Berlin' }] },
      },
      select: { id: true },
    });

    const login = await j('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'kanzlei-admin@kanzlei.de', password: 'Demo123!' }),
    });
    const token = (login.body as { accessToken: string }).accessToken;

    const abschluss = await j(`/api/jahresabschluss?mandantId=${mandantId}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'x-mandant-id': mandantId },
      body: JSON.stringify({ mandantId, geschaeftsjahr: JAHR }),
    });
    expect(abschluss.status, `Abschluss anlegen: ${abschluss.text.slice(0, 200)}`).toBe(201);
    abschlussId = (abschluss.body as { id: string }).id;

    // Drei Einreichungsbelege mit der Bestellnummer, die die Anwendung
    // heute schreibt (Nachtrag 62).
    for (const n of [1, 2, 3]) {
      await prisma.banzSubmission.create({
        data: {
          jahresabschlussId: abschlussId,
          mandantId,
          channel: 'PDF_DIRECT',
          status: 'SUBMITTED',
          submittedAt: new Date(),
          banzBestellnummer: `MESS-BESTELL-${n}`,
          rawPayload: Buffer.from('%PDF-1.3 mess'),
          payloadFormat: 'PDF',
          payloadHash: 'f'.repeat(64),
        },
      });
    }

    const key = await j('/api/api-keys', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'x-mandant-id': mandantId },
      body: JSON.stringify({
        kanzleiId, name: 'Messschluessel N88', scopes: ['jahresabschluss:read'],
      }),
    });
    expect(key.status, `API-Key: ${key.text.slice(0, 200)}`).toBe(201);
    apiKey = `${(key.body as { apiKey: { keyId: string } }).apiKey.keyId}.${(key.body as { plaintextSecret: string }).plaintextSecret}`;
  });

  afterAll(async () => {
    if (abschlussId) {
      await prisma.banzSubmission.deleteMany({ where: { jahresabschlussId: abschlussId } });
      await prisma.jahresabschluss.deleteMany({ where: { id: abschlussId } });
    }
    await prisma.bilanz.deleteMany({ where: { mandantId, geschaeftsjahr: JAHR } });
    await prisma.guV.deleteMany({ where: { mandantId, geschaeftsjahr: JAHR } });
    await prisma.anhang.deleteMany({ where: { mandantId, geschaeftsjahr: JAHR } });
    await prisma.$disconnect();
  });

  it('meldet die Vorgangsnummer — nicht null (BUG vor dem Fix)', async () => {
    const res = await j(
      `/api/v1/mandanten/${mandantId}/banz-submissions?pageSize=10`,
      { headers: { authorization: `Bearer ${apiKey}` } },
    );
    expect(res.status).toBe(200);
    const items = (res.body as { items: Array<{ banzVorgangsnummer: string | null }> }).items;
    expect(items.length).toBe(3);
    for (const s of items) {
      expect(
        s.banzVorgangsnummer,
        'die API muss die Bestellnummer melden — sie las ein Feld, das niemand schreibt',
      ).toMatch(/^MESS-BESTELL-/);
    }
  });

  it('meldet hasMore und liefert einen Cursor (BUG vor dem Fix)', async () => {
    const res = await j(
      `/api/v1/mandanten/${mandantId}/banz-submissions?pageSize=2`,
      { headers: { authorization: `Bearer ${apiKey}` } },
    );
    expect(res.status).toBe(200);
    const body = res.body as {
      items: unknown[];
      total: number;
      hasMore: boolean;
      nextCursor: string | null;
    };
    expect(body.total).toBe(3);
    expect(body.items.length).toBe(2);
    expect(body.hasMore, 'bei 3 Sätzen und pageSize 2 gibt es mehr').toBe(true);
    expect(body.nextCursor, 'ohne Cursor ist der dritte Satz unerreichbar').toBeTruthy();
  });

  it('der Cursor führt zum Rest der Liste (Datenverlust ausgeschlossen)', async () => {
    const erste = await j(
      `/api/v1/mandanten/${mandantId}/banz-submissions?pageSize=2`,
      { headers: { authorization: `Bearer ${apiKey}` } },
    );
    const cursor = (erste.body as { nextCursor: string }).nextCursor;
    const zweite = await j(
      `/api/v1/mandanten/${mandantId}/banz-submissions?pageSize=2&cursor=${encodeURIComponent(cursor)}`,
      { headers: { authorization: `Bearer ${apiKey}` } },
    );
    expect(zweite.status).toBe(200);
    const body = zweite.body as {
      items: Array<{ banzVorgangsnummer: string | null }>;
      hasMore: boolean;
    };
    expect(body.items.length, 'die zweite Seite muss den dritten Beleg liefern').toBe(1);
    expect(body.items[0]!.banzVorgangsnummer).toMatch(/^MESS-BESTELL-/);
    expect(body.hasMore).toBe(false);
  });
});
