import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';

/**
 * Bezugsachse der Signature-Records.
 *
 * BEFUND 2026-10-17 (Nachtrag 36): `Signature` traegt GENAU EINE von zwei
 * Bezugsachsen — `jahresabschlussId` ODER `entityType` + `entityId`
 * (`resolveJahresabschlussId` setzt die jeweils andere auf `null`).
 *
 * Der Leser `SignatureRepository.findByEntity` fragte aber nur
 * `{ entityType, entityId }`. Damit fand er **genau die Datensätze nicht,
 * die zu einem Jahresabschluss gehören** — also die Records, die der
 * Fix vom 2026-10-13 erzeugt hat. Damals wurde der Datensatz bei einer
 * Bilanz-Signatur gar nicht geschrieben (toter Verweis); der Fix holte
 * ihn zurück und parkte ihn auf der Abschluss-Achse, wo ihn niemand
 * abfragte.
 *
 * Gemessen, live über die öffentliche API:
 *
 *     POST /api/signatur/sign-bilaz              -> 200 (signiert, PDF in WORM)
 *     GET  /api/signatur/status?entityType=Bilanz&entityId=<bilanzId>
 *       status:           "UNSIGNIERT"
 *       anzahlSignaturen: 0
 *
 *     DB: { entityType: null, entityId: null, jahresabschlussId: "317a2dd2-…" }
 *
 * Der Anwender signiert, bekommt 200, ein zehn Jahre gesperrtes Objekt
 * liegt in WORM — und die Seite zeigt weiter „UNSIGNIERT". Betroffen sind
 * `getSignaturStatus` (Status-Badge) und `listSignaturen` (Signaturliste);
 * damit war auch die `ABWEICHEND`-Erkennung blind, denn sie setzt auf
 * `signaturen[0]`.
 *
 * Geprüft wird:
 *   1. Bilanz MIT Jahresabschluss-Bezug -> Status SIGNIERT
 *   2. Bilanz OHNE Jahresabschluss-Bezug -> Status SIGNIERT (unverändert)
 *   3. Die Signatur steht in beiden Fällen in der Liste
 */

const BASE = 'http://localhost:3000';
const P12_PATH = './tmp/test-certs/test-token.p12';
const P12_PASSWORD = 'Test1234!';
const MANDANT = 'Demo GmbH';

/** GJ ohne Jahresabschluss (nur die beiden Saetze, kein Abschluss). */
const JAHR_OHNE = 2095;
/** GJ mit Jahresabschluss — die Entitaeten haengen daran. */
const JAHR_MIT = 2096;

describe('Signature: Bezugsachse wird gefunden', () => {
  const prisma = new PrismaClient();
  let sbToken = '';
  let wpToken = '';
  let mandantId = '';
  let p12Base64 = '';
  /** Bilanz OHNE Abschluss-Bezug. */
  let bilanzFrei = '';
  /** Bilanz MIT Abschluss-Bezug. */
  let bilanzGebunden = '';
  let abschlussId = '';

  async function anmelden(email: string): Promise<string> {
    const r = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'Demo123!' }),
    });
    expect(r.status, `Login ${email}`).toBe(200);
    return ((await r.json()) as { accessToken: string }).accessToken;
  }

  async function satzAnlegen(
    art: 'bilanz' | 'guv' | 'anhang',
    jahr: number,
  ): Promise<string> {
    const h = {
      'content-type': 'application/json',
      authorization: `Bearer ${sbToken}`,
      'x-mandant-id': mandantId,
    };
    let res: Response;
    if (art === 'bilanz') {
      res = await fetch(`${BASE}/api/bilanz?mandantId=${mandantId}`, {
        method: 'POST',
        headers: h,
        body: JSON.stringify({
          mandantId,
          geschaeftsjahr: jahr,
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
          geschaeftsjahr: jahr,
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
          geschaeftsjahr: jahr,
          abschnitte: [{ titel: 'Angaben', reihenfolge: 1, inhalt: 'Sitz: Berlin' }],
        }),
      });
    }
    expect(res.status, `${art} GJ ${jahr}`).toBe(201);
    const roh = (await res.json()) as Record<string, unknown>;
    return ((roh.bilanz ?? roh.guv ?? roh) as { id: string }).id;
  }

  async function signaturStatus(bilanzId: string): Promise<{
    status: string;
    anzahlSignaturen: number;
    signiertAm: string | null;
  }> {
    const r = await fetch(
      `${BASE}/api/signatur/status?entityType=Bilanz&entityId=${bilanzId}`,
      { headers: { authorization: `Bearer ${wpToken}`, 'x-mandant-id': mandantId } },
    );
    expect(r.status, `Signaturstatus ${bilanzId}`).toBe(200);
    return (await r.json()) as {
      status: string;
      anzahlSignaturen: number;
      signiertAm: string | null;
    };
  }

  /**
   * Signaturstatus eines **Jahresabschlusses**.
   *
   * BEFUND 2026-10-20 (Nachtrag 60, TODO-8.15): Ein Jahresabschluss, dessen
   * Bilanz geprueft (signiert) wurde, ist **nicht** signiert. Die
   * Endabnahme ist die Vier-Augen-Kontrolle ueber den Abschluss.
   */
  async function abschlussStatus(abschlussId: string): Promise<{
    status: string;
    anzahlSignaturen: number;
    anzahlBestandteilPruefungen: number;
    signaturEbene: string;
    hinweis: string;
  }> {
    const r = await fetch(
      `${BASE}/api/signatur/status?entityType=Abschluss&entityId=${abschlussId}`,
      { headers: { authorization: `Bearer ${wpToken}`, 'x-mandant-id': mandantId } },
    );
    expect(r.status, `Abschluss-Signaturstatus ${abschlussId}`).toBe(200);
    return (await r.json()) as {
      status: string;
      anzahlSignaturen: number;
      anzahlBestandteilPruefungen: number;
      signaturEbene: string;
      hinweis: string;
    };
  }

  async function bilanzSignieren(bilanzId: string): Promise<void> {
    const r = await fetch(`${BASE}/api/signatur/sign-bilanz?mandantId=${mandantId}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${wpToken}`,
        'x-mandant-id': mandantId,
      },
      body: JSON.stringify({
        bilanzId,
        mandantId,
        p12Base64,
        p12Password: P12_PASSWORD,
      }),
    });
    expect(r.status, `Bilanz signieren ${bilanzId}`).toBe(200);
  }

  beforeAll(async () => {
    sbToken = await anmelden('steuerberater@kanzlei.de');
    wpToken = await anmelden('wp@kanzlei.de');
    p12Base64 = readFileSync(join(process.cwd(), P12_PATH)).toString('base64');

    const liste = (await (
      await fetch(`${BASE}/api/mandant`, {
        headers: { authorization: `Bearer ${sbToken}` },
      })
    ).json()) as Array<{ id: string; firmenname: string }>;
    mandantId = liste.find((m) => m.firmenname === MANDANT)?.id ?? '';
    expect(mandantId, `${MANDANT} muss erreichbar sein`).not.toBe('');

    // Fall 1: nur eine Bilanz, **kein** Jahresabschluss.
    bilanzFrei = await satzAnlegen('bilanz', JAHR_OHNE);

    // Fall 2: alle drei Saetze plus Jahresabschluss.
    await satzAnlegen('bilanz', JAHR_MIT);
    await satzAnlegen('guv', JAHR_MIT);
    await satzAnlegen('anhang', JAHR_MIT);
    const ja = await fetch(`${BASE}/api/jahresabschluss?mandantId=${mandantId}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${sbToken}`,
        'x-mandant-id': mandantId,
      },
      body: JSON.stringify({ mandantId, geschaeftsjahr: JAHR_MIT }),
    });
    expect(ja.status, 'Jahresabschluss anlegen').toBe(201);
    abschlussId = ((await ja.json()) as { id: string }).id;
    bilanzGebunden = (
      await prisma.jahresabschluss.findUniqueOrThrow({
        where: { id: abschlussId },
        select: { bilanzId: true },
      })
    ).bilanzId;

    await bilanzSignieren(bilanzFrei);
    await bilanzSignieren(bilanzGebunden);
  });

  afterAll(async () => {
    await prisma.signature.deleteMany({
      where: { entityId: { in: [bilanzFrei, bilanzGebunden] } },
    });
    await prisma.signature.deleteMany({ where: { jahresabschlussId: abschlussId } });
    if (abschlussId) {
      await prisma.jahresabschluss.deleteMany({ where: { id: abschlussId } });
    }
    for (const jahr of [JAHR_OHNE, JAHR_MIT]) {
      await prisma.bilanz.deleteMany({ where: { mandantId, geschaeftsjahr: jahr } });
      await prisma.guV.deleteMany({ where: { mandantId, geschaeftsjahr: jahr } });
      await prisma.anhang.deleteMany({ where: { mandantId, geschaeftsjahr: jahr } });
    }
    await prisma.$disconnect();
  });

  it('Bilanz OHNE Jahresabschluss-Bezug -> SIGNIERT (unveraendertes Verhalten)', async () => {
    const s = await signaturStatus(bilanzFrei);
    expect(s.status).toBe('SIGNIERT');
    expect(s.anzahlSignaturen).toBe(1);
  });

  it('Bilanz MIT Jahresabschluss-Bezug -> SIGNIERT (der behobene Fall)', async () => {
    // Vor der Reparatur stand hier "UNSIGNIERT" / anzahlSignaturen: 0,
    // obwohl der Record auf der jahresabschlussId-Achse lag.
    const s = await signaturStatus(bilanzGebunden);
    expect(
      s.status,
      'die Bilanz wurde signiert (200), ihr signiertes PDF liegt in WORM — ' +
        'die Seite darf trotzdem nicht "UNSIGNIERT" anzeigen',
    ).toBe('SIGNIERT');
    expect(s.anzahlSignaturen).toBe(1);
    expect(s.signiertAm).not.toBeNull();
  });

  it('der Record liegt auf BEIDEN Achsen und traegt die Ebene BESTANDTEIL', async () => {
    // Voraussetzung des Fehlers festhalten: ohne diese Zeile waere der
    // Test oben auch dann gruen, wenn der Record auf der entityType-Achse
    // laege — und der Test pruefte dann nichts Besonderes.
    //
    // BEFUND 2026-10-20 (Nachtrag 60, TODO-8.15): Vorher lag der Record
    // einer **Bilanz**-Signatur auf der jahresabschlussId-Achse, mit
    // `entityType`/`entityId` = null — er war damit von einer
    // Abschluss-Signatur nicht unterscheidbar. Ein Auditor las „der
    // Jahresabschluss ist signiert", obwohl nur die Bilanz geprueft war.
    //
    // Jetzt: beide Achsen (was signiert wurde + zu welchem Aggregat es
    // gehoert) und die Ebene (was die Signatur bescheinigt).
    const record = await prisma.signature.findFirst({
      where: { jahresabschlussId: abschlussId },
      select: { entityType: true, entityId: true, signaturEbene: true },
    });
    expect(record, 'der Record muss auf der Abschluss-Achse liegen').not.toBeNull();
    expect(
      record!.entityType,
      'der Record muss sagen, WAS signiert wurde',
    ).toBe('Bilanz');
    expect(record!.entityId).toBe(bilanzGebunden);
    expect(
      record!.signaturEbene,
      'eine Bilanz-Signatur ist eine Bestandteilpruefung, keine Endabnahme',
    ).toBe('BESTANDTEIL');
  });

  it('der Jahresabschluss gilt NICHT als signiert, wenn nur die Bilanz geprueft wurde', async () => {
    // Das ist der Kern der Entscheidung: eine Bestandteilpruefung ist
    // keine Endabnahme. Vorher zeigte der Abschluss "SIGNIERT", weil die
    // Bilanz-Signatur auf seiner Achse lag.
    const s = await abschlussStatus(abschlussId);
    expect(
      s.status,
      'eine Bilanzpruefung darf den Jahresabschluss nicht als signiert ausweisen',
    ).toBe('UNSIGNIERT');
    expect(s.anzahlSignaturen, 'als Endabnahme zaehlt keine Bilanz-Signatur').toBe(0);
    expect(
      s.anzahlBestandteilPruefungen,
      'die Bilanzpruefung muss aber als Bestandteilpruefung sichtbar sein',
    ).toBe(1);
    expect(s.hinweis).toContain('keine Endabnahme');
  });

  it('listSignaturen findet die gebundene Bilanz ebenfalls', async () => {
    const r = await fetch(
      // Kein `mandantId` als Query-Parameter: `SignaturListeQueryDto` steht
      // auf `forbidNonWhitelisted`, der Mandantenkontext kommt aus dem Header.
      `${BASE}/api/signatur/signaturen?entityType=Bilanz&entityId=${bilanzGebunden}`,
      { headers: { authorization: `Bearer ${wpToken}`, 'x-mandant-id': mandantId } },
    );
    expect(r.status).toBe(200);
    const eintraege = (await r.json()) as unknown[];
    expect(
      Array.isArray(eintraege) ? eintraege.length : 0,
      'die Signaturliste ist der zweite Leser derselben Abfrage',
    ).toBe(1);
  });
});
