import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { fuehreVierAugenPruefungDurch } from './helpers/wp-vier-augen';

/**
 * Signatur des Jahresabschlusses (qeS).
 *
 * BEFUND 2026-10-17 (Nachtrag 35): Dieser Pfad war **nie erreichbar** —
 * es gab keinen Jahresabschluss (Nachtrag 27), also auch nichts zu
 * signieren. Mit dem Abschluss-Modul wurde er aktiv, und er war
 * ungeprueft. Gemessen ueber die oeffentliche API:
 *
 *     status = DRAFT, abgeschlossenAm = null
 *     POST /api/signatur/sign-abschluss  ->  200, signatureId 533ae411-…
 *
 * Eine qeS bescheinigt die *Vollstaendigkeit* eines Dokuments. Sie auf
 * einen Abschluss zu setzen, der nie abgeschlossen wurde, ist unter
 * keiner Lesart vertretbar — und weil das signierte PDF danach mit
 * COMPLIANCE-Object-Lock fuer 10 Jahre in WORM liegt, ist der Schaden
 * nicht ruecknehmbar.
 *
 * Der zweite Befund desselben Laufs: `Jahresabschluss.signiertAm` ist eine
 * Spalte im Schema und wurde von **keiner Zeile im Projekt geschrieben**.
 * Nach der Signatur stand dort `null`, waehrend `wormObjectKey` auf ein
 * signiertes Objekt zeigte — ein Datensatz, der sich selbst widerspricht.
 *
 * Geprueft wird:
 *   1. Signieren eines DRAFT-Abschlusses -> 409 (nicht 200, kein WORM)
 *   2. Danach existiert KEIN signiertes WORM-Objekt zu diesem Abschluss
 *   3. Signieren eines FINALIZED-Abschlusses -> 200
 *   4. Danach status = SIGNED und signiertAm gesetzt
 *
 * Wie die uebrigen Signatur-Specs: HTTP gegen den laufenden Server auf
 * :3000, WORM gegen den S3-Mock aus run-local.sh (echte Object-Lock-
 * Semantik). Kein `createNestApplication()`.
 */

const BASE = 'http://localhost:3000';
const P12_PATH = './tmp/test-certs/test-token.p12';
const P12_PASSWORD = 'Test1234!';
const MANDANT = 'Demo GmbH';

describe('Jahresabschluss signieren (qeS)', () => {
  const prisma = new PrismaClient();
  let token = '';
  let wpToken = '';
  /** Der ZWEITE Wirtschaftspruefer — gibt die WP-Pruefung frei (Vier-Augen). */
  let wp2Token = '';
  let mandantId = '';
  let p12Base64 = '';
  let draftId = '';
  let finalizedId = '';

  const JAHR_DRAFT = 2093;
  const JAHR_FINAL = 2094;

  async function anmelden(email: string): Promise<{ accessToken: string }> {
    const r = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'Demo123!' }),
    });
    expect(r.status, `Login ${email}`).toBe(200);
    return (await r.json()) as { accessToken: string };
  }

  async function satzAnlegen(art: 'bilanz' | 'guv' | 'anhang', jahr: number): Promise<string> {
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
          abschnitte: [
            { titel: 'Allgemeine Angaben', reihenfolge: 1, inhalt: 'Sitz: Berlin' },
          ],
        }),
      });
    }
    expect(res.status, `${art} GJ ${jahr}`).toBe(201);
    const roh = (await res.json()) as Record<string, unknown>;
    const obj = (roh.bilanz ?? roh.guv ?? roh) as { id: string };
    return obj.id;
  }

  /** Legt die drei Saetze an, setzt sie auf VALIDATED und legt den Abschluss an. */
  async function abschlussBereit(jahr: number, abschliessen: boolean): Promise<string> {
    const b = await satzAnlegen('bilanz', jahr);
    const g = await satzAnlegen('guv', jahr);
    const a = await satzAnlegen('anhang', jahr);
    for (const [url, id] of [
      ['/api/bilanz', b],
      ['/api/guv', g],
      ['/api/anhang', a],
    ] as const) {
      const r = await fetch(`${BASE}${url}/${id}?mandantId=${mandantId}`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
          'x-mandant-id': mandantId,
        },
        body: JSON.stringify({ status: 'VALIDATED' }),
      });
      expect(r.status, `${url} auf VALIDATED`).toBe(200);
    }
    const ja = await fetch(`${BASE}/api/jahresabschluss?mandantId=${mandantId}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'x-mandant-id': mandantId,
      },
      body: JSON.stringify({ mandantId, geschaeftsjahr: jahr }),
    });
    expect(ja.status, 'Jahresabschluss anlegen').toBe(201);
    const id = ((await ja.json()) as { id: string }).id;
    if (abschliessen) {
      const fin = await fetch(`${BASE}/api/jahresabschluss/${id}/finalize?mandantId=${mandantId}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
          'x-mandant-id': mandantId,
        },
        body: JSON.stringify({}),
      });
      expect(fin.status, 'finalize').toBe(200);

      // BEFUND 2026-10-21 (Nachtrag 79): Die qeS-**Endabnahme** verlangt
      // eine freigegebene Vier-Augen-Pruefung der Bilanz (Entscheidung der
      // Fachverantwortlichen: fail-closed). Ohne sie ist keine Signatur
      // moeglich — der Weg ist: WP prueft, zweite Person gibt frei, dann
      // signiert.
      await fuehreVierAugenPruefungDurch({
        base: BASE,
        mandantId,
        bilanzId: b,
        tokenPruefend: wpToken,
        tokenFreigebend: wp2Token,
      });
    }
    return id;
  }

  async function signieren(abschlussId: string): Promise<Response> {
    return fetch(`${BASE}/api/signatur/sign-abschluss?mandantId=${mandantId}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${wpToken}`,
        'x-mandant-id': mandantId,
      },
      body: JSON.stringify({
        jahresabschlussId: abschlussId,
        mandantId,
        p12Base64,
        p12Password: P12_PASSWORD,
      }),
    });
  }

  beforeAll(async () => {
    const sb = await anmelden('steuerberater@kanzlei.de');
    token = sb.accessToken;
    wpToken = (await anmelden('wp@kanzlei.de')).accessToken;
    wp2Token = (await anmelden('wp2@kanzlei.de')).accessToken;
    p12Base64 = readFileSync(join(process.cwd(), P12_PATH)).toString('base64');

    const liste = (await (
      await fetch(`${BASE}/api/mandant`, {
        headers: { authorization: `Bearer ${token}` },
      })
    ).json()) as Array<{ id: string; firmenname: string }>;
    mandantId = liste.find((m) => m.firmenname === MANDANT)?.id ?? '';
    expect(mandantId, `${MANDANT} muss erreichbar sein`).not.toBe('');

    draftId = await abschlussBereit(JAHR_DRAFT, false);
    finalizedId = await abschlussBereit(JAHR_FINAL, true);
  });

  afterAll(async () => {
    for (const id of [draftId, finalizedId]) {
      if (!id) continue;
      // BEFUND 2026-10-17: stand hier `{ entityType: 'Abschluss',
      // entityId: id }` — das war ein stiller Leerlauf. Ein
      // Jahresabschluss-Signatur-Datensatz traegt `entityType: NULL`
      // (siehe `resolveJahresabschlussId`: `entityType: abschlussId ? null
      // : entityType`). Die Abfrage passte auf keine Zeile und liess sie
      // liegen. TypeScript hat es nicht gemerkt, Prisma nicht, und der
      // Test blieb gruen.
      await prisma.signature.deleteMany({ where: { jahresabschlussId: id } });
      await prisma.jahresabschluss.deleteMany({ where: { id } });
    }
    for (const jahr of [JAHR_DRAFT, JAHR_FINAL]) {
      await prisma.bilanz.deleteMany({ where: { mandantId, geschaeftsjahr: jahr } });
      await prisma.guV.deleteMany({ where: { mandantId, geschaeftsjahr: jahr } });
      await prisma.anhang.deleteMany({ where: { mandantId, geschaeftsjahr: jahr } });
    }
    await prisma.$disconnect();
  });

  it('Signieren eines DRAFT-Abschlusses → 409', async () => {
    const vorher = await prisma.jahresabschluss.findUniqueOrThrow({
      where: { id: draftId },
      select: { status: true },
    });
    expect(vorher.status, 'Vorbedingung: der Abschluss steht auf DRAFT').toBe('DRAFT');

    const res = await signieren(draftId);
    expect(
      res.status,
      'eine qeS auf einen nie abgeschlossenen Jahresabschluss ist zulaessig?',
    ).toBe(409);
    const body = (await res.json()) as { message: string };
    expect(body.message).toMatch(/abgeschlossen/i);
  });

  it('nach der verweigerten Signatur liegt KEIN signiertes WORM-Objekt', async () => {
    // Nicht nur der Statuscode: es darf auch kein Objekt entstanden sein.
    // Eine 409 nach einem WORM-Upload waere nur eine Verzoegerung des
    // Schadens.
    const signiert = await prisma.wormObject.findMany({
      where: { entityType: 'ABSCHLUSS_PDF_SIGNED', entityId: draftId },
      select: { objectKey: true },
    });
    expect(
      signiert,
      'die verweigerte Signatur hat trotzdem ein Objekt in WORM abgelegt',
    ).toHaveLength(0);
  });

  it('Signieren eines FINALIZED-Abschlusses → 200, Status wird SIGNED', async () => {
    const res = await signieren(finalizedId);
    expect(
      res.status,
      `Signieren des abgeschlossenen Jahresabschlusses: ${res.status} ` +
        `${await res.clone().text()}`,
    ).toBe(200);

    const nachher = await prisma.jahresabschluss.findUniqueOrThrow({
      where: { id: finalizedId },
      select: { status: true, signiertAm: true },
    });
    expect(nachher.status, 'der Abschluss muss nach der Signatur SIGNED sein').toBe('SIGNED');
    expect(
      nachher.signiertAm,
      'signiertAm blieb null, obwohl signiert wurde — der Datensatz widerspricht sich selbst',
    ).not.toBeNull();
  });

  it('die Signaturliste des Jahresabschlusses findet den Record', async () => {
    // Vor der Reparatur von Nachtrag 36 lieferte
    // `GET /signatur/signaturen?entityType=Abschluss` fuer JEDEN
    // Jahresabschluss eine leere Liste: `findByEntity` fragte
    // `{ entityType, entityId }`, und die Datensaetze tragen bei einem
    // Abschluss `entityType: null`.
    //
    // Nebenbefund derselben Untersuchung: `findByJahresabschluss` und
    // `findLatestByJahresabschluss` haben im ganzen Projekt **keinen
    // Aufrufer**. Die Abschluss-Signaturenliste war also nie verdrahtet —
    // was die Luecke hier lange unsichtbar gemacht hat.
    const r = await fetch(
      `${BASE}/api/signatur/signaturen?entityType=Abschluss&entityId=${finalizedId}`,
      { headers: { authorization: `Bearer ${wpToken}`, 'x-mandant-id': mandantId } },
    );
    expect(r.status).toBe(200);
    const eintraege = (await r.json()) as unknown[];
    expect(
      Array.isArray(eintraege) ? eintraege.length : -1,
      'der signierte Jahresabschluss hat genau einen Signaturdatensatz',
    ).toBe(1);
  });

  it('ein bereits signierter Abschluss lässt sich erneut signieren (Korrekturweg)', async () => {
    // ENTSCHEIDUNG 2026-10-21 (Nachtrag 78, Frage 1 = A): Ein Abschluss im
    // Status SIGNED darf erneut signiert werden.
    //
    // Bis eben galt hier eine harte Sperre (`status !== 'FINALIZED'`), mit
    // der Begruendung: "eine zweite Signatur wuerde zwei unvereinbare
    // Nachweise erzeugen, ohne den ersten zu loeschen. Der korrekte Weg ist
    // ein neuer Jahresabschluss, nicht eine zweite Signatur auf denselben."
    //
    // Der Weg "neuer Jahresabschluss" war jedoch durch den
    // Unique-Constraint (mandantId, geschaeftsjahr) blockiert — ein
    // geaenderter Bestandteil nach der Signatur fuehrte damit in einen
    // Zustand, aus dem man nicht mehr herauskam. Und die Entscheidung der
    // Fachverantwortlichen vom 2026-10-14 sagt ausdruecklich: "Ein
    // Korrekturvorgang erzeugt zwingend eine neue Signatur, und der alte
    // WORM-Satz darf nicht geloescht werden."
    //
    // **Die unvereinbaren Nachweise gibt es nicht.** Der WORM behaelt beide
    // Fassungen (jede Signatur legt ein eigenes WORM-Objekt an), und die
    // **juengste** gilt — `findActiveByEntity` sortiert nach `uploadedAt`
    // desc. Der erste Nachweis wird nicht geloescht, er wird ueberholt.
    const res = await signieren(finalizedId);
    expect(
      res.status,
      'ein zweites Mal signieren: der Korrekturvorgang erzeugt eine neue ' +
        'Signatur, der erste WORM-Satz bleibt unveraendert erhalten',
    ).toBe(200);

    // Nicht `entityType: 'Abschluss'` — Jahresabschluss-Signaturen tragen
    // dort `null`. `jahresabschlussId` ist die Achse, die das Schema fuer
    // diesen Fall vorsieht.
    const signaturen = await prisma.signature.count({
      where: { jahresabschlussId: finalizedId },
    });
    expect(signaturen, 'beide Signaturen bleiben im Trail erhalten').toBe(2);

    // Und die **juengste** ist die massgebliche: die WORM-Suche liefert den
    // zuletzt hochgeladenen Satz.
    const worm = await prisma.wormObject.findFirst({
      where: { entityType: 'ABSCHLUSS_PDF_SIGNED', entityId: finalizedId },
      orderBy: { uploadedAt: 'desc' },
      select: { uploadedAt: true, sha256Hash: true },
    });
    const neuesteSignatur = await prisma.signature.findFirst({
      where: { jahresabschlussId: finalizedId },
      orderBy: { createdAt: 'desc' },
      select: { hashNachher: true },
    });
    expect(worm, 'es muss ein signiertes WORM-Objekt geben').toBeTruthy();
    expect(
      worm!.sha256Hash,
      'das aktive WORM-Objekt ist die zuletzt signierte Fassung',
    ).toBe(neuesteSignatur?.hashNachher);
  });
});
