import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

/**
 * Jahresabschluss-PDF: erzeugen und herunterladen.
 *
 * BEFUND 2026-10-17 (Nachtrag 35): `POST /pdf/abschluss/:id/generate` und
 * `GET /pdf/abschluss/:id/download` waren vorhandener, aber **unerreichbarer
 * Code** — es gab keinen Jahresabschluss. Mit dem Abschluss-Modul wurden
 * beide aktiv, ohne dass eine einzige Spec sie beruehrt hatte
 * (`grep -rn "abschluss/:id/generate" e2e/` liefert nichts).
 *
 * Das ist hier keine Fehlerbehauptung, sondern eine **Absicherung**: Der
 * PDF-Service hat eine gemessene Historie von Zugriffsbefunden (der Seed
 * legt fuer "Test AG" eine eigene Bilanz an, "damit der Cross-Mandant-Test
 * in pdf.e2e_spec laeuft — vorher endete er in einem stillen return"). Die
 * `ABSCHLUSS`-Variante war nie geprueft.
 *
 * Geprueft wird:
 *   1. Erzeugen -> 200 mit WORM-Key
 *   2. Herunterladen -> 200, echtes PDF (Beginn %PDF)
 *   3. Herunterladen vor dem Erzeugen -> 404 mit einer Handlung statt 500
 *   4. Cross-Mandant-Erzeugen -> 404, **kein** Objekt im WORM des anderen
 *   5. Cross-Mandant-Download -> 404 (nicht 403: der Mandantenkontext darf
 *      die Existenz nicht verraten)
 *
 * Zu Punkt 4 ist der WORM-Check der wichtigste: Ein 404 nach dem Upload
 * waere nur eine Verzoegerung des Schadens — dasselbe Muster wie in
 * Nachtrag 35.
 */

const BASE = 'http://localhost:3000';
const MANDANT_A = 'Demo GmbH';
const MANDANT_B = 'Test AG';
const JAHR = 2097;

describe('Jahresabschluss-PDF (erzeugen + herunterladen)', () => {
  const prisma = new PrismaClient();
  let token = '';
  let mandantA = '';
  let mandantB = '';
  let abschlussId = '';

  async function anmelden(): Promise<string> {
    const r = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'steuerberater@kanzlei.de', password: 'Demo123!' }),
    });
    expect(r.status, 'Login').toBe(200);
    return ((await r.json()) as { accessToken: string }).accessToken;
  }

  async function satzAnlegen(art: 'bilanz' | 'guv' | 'anhang', mandantId: string): Promise<string> {
    const h = {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      'x-mandant-id': mandantId,
    };
    let res: Response;
    if (art === 'bilanz') {
      res = await fetch(`${BASE}/api/bilanz?mandantId=${mandantId}`, {
        method: 'POST',
        headers: h,
        body: JSON.stringify({
          mandantId,
          geschaeftsjahr: JAHR,
          positionen: [
            { seite: 'AKTIVA', kontonummer: 'B.IV.', bezeichnung: 'Kasse', betragAktuell: 1000, reihenfolge: 1 },
            { seite: 'PASSIVA', kontonummer: 'A.I.', bezeichnung: 'Kapital', betragAktuell: 1000, reihenfolge: 1 },
          ],
        }),
      });
    } else if (art === 'guv') {
      res = await fetch(`${BASE}/api/guv?mandantId=${mandantId}`, {
        method: 'POST',
        headers: h,
        body: JSON.stringify({
          mandantId,
          geschaeftsjahr: JAHR,
          verfahren: 'GKV',
          positionen: [
            { kontonummer: '1.', bezeichnung: 'Umsatzerloese', kategorie: 'ERLOES', betragAktuell: 1000, reihenfolge: 1 },
          ],
        }),
      });
    } else {
      res = await fetch(`${BASE}/api/anhang?mandantId=${mandantId}`, {
        method: 'POST',
        headers: h,
        body: JSON.stringify({
          mandantId,
          geschaeftsjahr: JAHR,
          abschnitte: [{ titel: 'Angaben', reihenfolge: 1, inhalt: 'Sitz: Berlin' }],
        }),
      });
    }
    expect(res.status, `${art} anlegen`).toBe(201);
    const roh = (await res.json()) as Record<string, unknown>;
    return ((roh.bilanz ?? roh.guv ?? roh) as { id: string }).id;
  }

  beforeAll(async () => {
    token = await anmelden();
    const liste = (await (
      await fetch(`${BASE}/api/mandant`, { headers: { authorization: `Bearer ${token}` } })
    ).json()) as Array<{ id: string; firmenname: string }>;
    mandantA = liste.find((m) => m.firmenname === MANDANT_A)?.id ?? '';
    mandantB = liste.find((m) => m.firmenname === MANDANT_B)?.id ?? '';
    expect(mandantA, `${MANDANT_A} muss erreichbar sein`).not.toBe('');
    expect(mandantB, `${MANDANT_B} muss fuer den Cross-Mandant-Fall da sein`).not.toBe('');

    await satzAnlegen('bilanz', mandantA);
    await satzAnlegen('guv', mandantA);
    await satzAnlegen('anhang', mandantA);
    const ja = await fetch(`${BASE}/api/jahresabschluss?mandantId=${mandantA}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'x-mandant-id': mandantA,
      },
      body: JSON.stringify({ mandantId: mandantA, geschaeftsjahr: JAHR }),
    });
    expect(ja.status, 'Jahresabschluss anlegen').toBe(201);
    abschlussId = ((await ja.json()) as { id: string }).id;
  });

  afterAll(async () => {
    await prisma.wormObject.deleteMany({
      where: { entityType: 'ABSCHLUSS_PDF', entityId: abschlussId },
    });
    await prisma.wormObject.deleteMany({
      where: { entityType: 'ABSCHLUSS_PDF_SIGNED', entityId: abschlussId },
    });
    await prisma.jahresabschluss.deleteMany({ where: { id: abschlussId } });
    await prisma.bilanz.deleteMany({ where: { mandantId: mandantA, geschaeftsjahr: JAHR } });
    await prisma.guV.deleteMany({ where: { mandantId: mandantA, geschaeftsjahr: JAHR } });
    await prisma.anhang.deleteMany({ where: { mandantId: mandantA, geschaeftsjahr: JAHR } });
    await prisma.$disconnect();
  });

  it('Herunterladen vor dem Erzeugen -> 404 mit einer Handlung', async () => {
    const r = await fetch(`${BASE}/api/pdf/abschluss/${abschlussId}/download`, {
      headers: { authorization: `Bearer ${token}`, 'x-mandant-id': mandantA },
    });
    expect(r.status, 'ohne vorheriges /generate gibt es nichts zu laden').toBe(404);
    const body = (await r.json()) as { message: string };
    expect(body.message).toMatch(/generate/i);
  });

  it('Erzeugen -> 200 mit WORM-Key', async () => {
    const r = await fetch(`${BASE}/api/pdf/abschluss/${abschlussId}/generate`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'x-mandant-id': mandantA,
      },
      body: JSON.stringify({}),
    });
    expect(r.status).toBe(200);
    const body = (await r.json()) as { wormObjectKey: string; sha256Hash: string };
    expect(body.wormObjectKey).toMatch(/abschluss/);
    expect(body.sha256Hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('Herunterladen -> 200, echtes PDF', async () => {
    const r = await fetch(`${BASE}/api/pdf/abschluss/${abschlussId}/download`, {
      headers: { authorization: `Bearer ${token}`, 'x-mandant-id': mandantA },
    });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('application/pdf');
    const buf = Buffer.from(await r.arrayBuffer());
    expect(buf.subarray(0, 5).toString('latin1'), 'das muss ein PDF sein').toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(1000);
  });

  it('Cross-Mandant: Erzeugen im fremden Kontext -> 404', async () => {
    // Mandantkonzept B, Abschluss von A. `assertEntityExists` filtert nach
    // `mandantId` — der Abschluss ist im Kontext von B unsichtbar.
    const r = await fetch(`${BASE}/api/pdf/abschluss/${abschlussId}/generate`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'x-mandant-id': mandantB,
      },
      body: JSON.stringify({}),
    });
    expect(r.status).toBe(404);
  });

  it('Cross-Mandant: es landet KEIN zusaetzliches Objekt im WORM', async () => {
    // Nicht der Statuscode ist der Beleg, sondern das Artefakt. Ein 404
    // nach dem Upload waere nur eine Verzoegerung des Schadens.
    const objekte = await prisma.wormObject.findMany({
      where: { entityId: abschlussId },
      select: { entityType: true, mandantId: true },
    });
    const fremde = objekte.filter((o) => o.mandantId === mandantB);
    expect(
      fremde,
      `im Mandantenkontext ${MANDANT_B} darf kein Objekt liegen`,
    ).toHaveLength(0);
    // Und im eigenen Kontext liegt genau eines.
    expect(objekte.filter((o) => o.mandantId === mandantA)).toHaveLength(1);
  });

  it('Cross-Mandant: Download im fremden Kontext -> 404', async () => {
    const r = await fetch(`${BASE}/api/pdf/abschluss/${abschlussId}/download`, {
      headers: { authorization: `Bearer ${token}`, 'x-mandant-id': mandantB },
    });
    // 404 statt 403: der Mandantenkontext soll nicht verraten, dass es den
    // Abschluss ueberhaupt gibt.
    expect(r.status).toBe(404);
  });
});
