import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { fuehreVierAugenPruefungDurch } from './helpers/wp-vier-augen';

/**
 * Jahresabschluss: SIGNED -> SUBMITTED -> PUBLISHED.
 *
 * BEFUND 2026-10-20 (Nachtrag 62, TODO-8.10): Die Zustandsmaschine stand im
 * Modell (`DRAFT | FINALIZED | SIGNED | SUBMITTED | PUBLISHED`), im Kommentar
 * und in der Typdefinition — und hatte **keinen Schreibpfad**. `banzBestellnummer`
 * und `veroeffentlichtAm` blieben unbeschrieben, die Tabelle `banz_submission`
 * war leer (der Public-API-Service dokumentiert das selbst).
 *
 * ## Was hier passiert — und was ausdruecklich nicht
 *
 * Die Anwendung **reicht nichts beim Bundesanzeiger ein.** Es gibt keine
 * oeffentliche Submission-API des Verlags (`MILESTONE-4.md`: „Submission via
 * eBilanz-Online + DATEV, **nicht direkt**"). Der Portalzugang haengt an
 * externen Bedingungen (`JAHRESABSCHLUSS-MODUL-PLAN.md`, Schritt 4).
 *
 * Die Kanzlei reicht **draussen** ein und traegt hier nach, was das Portal
 * zurueckgegeben hat: die Bestellnummer. Diese Nummer ist der einzige Beleg
 * fuer die Einreichung — ohne sie waere der Statuswechsel eine Behauptung.
 * Deshalb ist sie Pflicht, und sie muss eindeutig sein.
 *
 * Geprueft wird:
 *   1. einreichen mit gueltiger Nummer  -> 200, SUBMITTED, Beleg im Audit-Trail
 *   2. doppelte Bestellnummer           -> 409
 *   3. zu kurze Bestellnummer           -> 400
 *   4. einreichen ohne Signatur         -> 409
 *   5. veroeffentlichen ohne Einreichung-> 409
 *   6. veroeffentlichen                 -> 200, PUBLISHED, Zeitstempel
 *   7. der Wirtschaftspruefer darf nicht einreichen -> 403
 */
const BASE = 'http://localhost:3000';
const P12_PATH = './tmp/test-certs/test-token.p12';
const P12_PASSWORD = 'Test1234!';
const MANDANT = 'Demo GmbH';
const JAHR_A = 2097;
const JAHR_B = 2098;
/** Abgeschlossen, aber nicht signiert — der fail-closed-Fall. */
const JAHR_C = 2099;

describe('Jahresabschluss: Einreichung und Veroeffentlichung (Nachtrag 62)', () => {
  const prisma = new PrismaClient();
  let sbToken = '';
  let wpToken = '';
  /** Der ZWEITE Wirtschaftspruefer — gibt die WP-Pruefung frei (Vier-Augen). */
  let wp2Token = '';
  let mandantId = '';
  let p12Base64 = '';
  let abschlussA = '';
  let abschlussB = '';
  /** FINALIZED, aber nie signiert. */
  let abschlussC = '';

  async function anmelden(email: string): Promise<string> {
    const r = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'Demo123!' }),
    });
    expect(r.status, `Login ${email}`).toBe(200);
    return ((await r.json()) as { accessToken: string }).accessToken;
  }

  function headers(token: string): Record<string, string> {
    return {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      'x-mandant-id': mandantId,
    };
  }

  async function aufraeumen(): Promise<void> {
    await prisma.banzSubmission.deleteMany({ where: { mandantId } });
    await prisma.signature.deleteMany({ where: { userId: { not: undefined } } });
    await prisma.jahresabschluss.deleteMany({ where: { mandantId } });
    for (const jahr of [JAHR_A, JAHR_B, JAHR_C]) {
      await prisma.bilanz.deleteMany({ where: { mandantId, geschaeftsjahr: jahr } });
      await prisma.guV.deleteMany({ where: { mandantId, geschaeftsjahr: jahr } });
      await prisma.anhang.deleteMany({ where: { mandantId, geschaeftsjahr: jahr } });
    }
  }

  /** Legt die drei Saetze an, schliesst sie und legt den Abschluss an. */
  async function abschlussAnlegen(jahr: number): Promise<string> {
    const h = headers(sbToken);

    const b = await fetch(`${BASE}/api/bilanz?mandantId=${mandantId}`, {
      method: 'POST', headers: h,
      body: JSON.stringify({
        mandantId, geschaeftsjahr: jahr,
        positionen: [
          { seite: 'AKTIVA', kontonummer: 'B.IV.', bezeichnung: 'Kasse', betragAktuell: 1000, reihenfolge: 1 },
          { seite: 'PASSIVA', kontonummer: 'A.I.', bezeichnung: 'Kapital', betragAktuell: 1000, reihenfolge: 1 },
        ],
      }),
    });
    expect(b.status, 'Bilanz anlegen').toBe(201);
    const bilanzId = ((await b.json()) as { bilanz: { id: string } }).bilanz.id;

    const g = await fetch(`${BASE}/api/guv?mandantId=${mandantId}`, {
      method: 'POST', headers: h,
      body: JSON.stringify({
        mandantId, geschaeftsjahr: jahr, verfahren: 'GKV',
        positionen: [
          { kontonummer: '1.', bezeichnung: 'Umsatzerloese', kategorie: 'ERLOES', betragAktuell: 1000, reihenfolge: 1 },
        ],
      }),
    });
    expect(g.status, 'GuV anlegen').toBe(201);
    const guvId = ((await g.json()) as { guv: { id: string } }).guv.id;

    const a = await fetch(`${BASE}/api/anhang?mandantId=${mandantId}`, {
      method: 'POST', headers: h,
      body: JSON.stringify({
        mandantId, geschaeftsjahr: jahr,
        abschnitte: [{ titel: 'Allgemeine Angaben', reihenfolge: 1, inhalt: 'Sitz: Berlin' }],
      }),
    });
    expect(a.status, 'Anhang anlegen').toBe(201);
    const anhangId = ((await a.json()) as { id: string }).id;

    await prisma.bilanz.update({ where: { id: bilanzId }, data: { status: 'VALIDATED' } });
    await prisma.guV.update({ where: { id: guvId }, data: { status: 'VALIDATED' } });
    await prisma.anhang.update({ where: { id: anhangId }, data: { status: 'VALIDATED' } });

    const ja = await fetch(`${BASE}/api/jahresabschluss?mandantId=${mandantId}`, {
      method: 'POST', headers: h,
      body: JSON.stringify({ mandantId, geschaeftsjahr: jahr }),
    });
    expect(ja.status, 'Abschluss anlegen').toBe(201);
    const abschlussId = ((await ja.json()) as { id: string }).id;

    const fin = await fetch(`${BASE}/api/jahresabschluss/${abschlussId}/finalize?mandantId=${mandantId}`, {
      method: 'POST', headers: h, body: JSON.stringify({}),
    });
    expect(fin.status, `Abschluss abschliessen: ${await fin.text()}`).toBe(200);

    // BEFUND 2026-10-21 (Nachtrag 79): Die qeS-Endabnahme verlangt einen
    // freigegebenen Vier-Augen-Pruefungsnachweis der Bilanz. Also erst
    // pruefen (wp@), dann von einer zweiten Person freigeben lassen (wp2@).
    await fuehreVierAugenPruefungDurch({
      base: BASE,
      mandantId,
      bilanzId,
      tokenPruefend: wpToken,
      tokenFreigebend: wp2Token,
    });

    return abschlussId;
  }

  /** Signiert den Jahresabschluss als Wirtschaftspruefer. */
  async function signieren(abschlussId: string): Promise<void> {
    const r = await fetch(`${BASE}/api/signatur/sign-abschluss?mandantId=${mandantId}`, {
      method: 'POST', headers: headers(wpToken),
      body: JSON.stringify({
        mandantId, jahresabschlussId: abschlussId,
        p12Base64, p12Password: P12_PASSWORD,
      }),
    });
    expect(r.status, `Abschluss signieren: ${await r.text()}`).toBe(200);
  }

  beforeAll(async () => {
    sbToken = await anmelden('steuerberater@kanzlei.de');
    wpToken = await anmelden('wp@kanzlei.de');
    wp2Token = await anmelden('wp2@kanzlei.de');
    p12Base64 = readFileSync(join(process.cwd(), P12_PATH)).toString('base64');

    const liste = (await (
      await fetch(`${BASE}/api/mandant`, { headers: { authorization: `Bearer ${sbToken}` } })
    ).json()) as Array<{ id: string; firmenname: string }>;
    mandantId = liste.find((m) => m.firmenname === MANDANT)?.id ?? '';
    expect(mandantId, `${MANDANT} muss erreichbar sein`).not.toBe('');

    await aufraeumen();
    abschlussA = await abschlussAnlegen(JAHR_A);
    abschlussB = await abschlussAnlegen(JAHR_B);
    abschlussC = await abschlussAnlegen(JAHR_C);
    await signieren(abschlussA);
    await signieren(abschlussB);
    // abschlussC bleibt FINALIZED — bewusst unsigniert.
  });

  afterAll(async () => {
    await aufraeumen();
    await prisma.$disconnect();
  });

  it('einreichen: 200, SUBMITTED, Bestellnummer + Beleg im Audit-Trail', async () => {
    const nummer = 'BAnz-2026-A-00001';
    const r = await fetch(`${BASE}/api/jahresabschluss/${abschlussA}/einreichen?mandantId=${mandantId}`, {
      method: 'POST', headers: headers(sbToken),
      body: JSON.stringify({ banzBestellnummer: nummer }),
    });
    const text = await r.text();
    expect(r.status, `Einreichen: ${text.slice(0, 200)}`).toBe(200);
    const body = JSON.parse(text) as {
      status: string;
      eingereichtAm: string;
      banzBestellnummer: string;
      submissionId: string;
      payloadHash: string;
    };
    expect(body.status).toBe('SUBMITTED');
    expect(body.banzBestellnummer).toBe(nummer);
    expect(body.eingereichtAm, 'der Zeitpunkt muss belegt sein').toBeTruthy();
    expect(body.payloadHash, 'der Hash des eingereichten Dokuments muss belegt sein')
      .toMatch(/^[a-f0-9]{64}$/);

    // Der Jahresabschluss steht auf SUBMITTED, und die Felder sind geschrieben.
    const abschluss = await prisma.jahresabschluss.findUnique({
      where: { id: abschlussA },
      select: { status: true, eingereichtAm: true, banzBestellnummer: true },
    });
    expect(abschluss!.status).toBe('SUBMITTED');
    expect(abschluss!.eingereichtAm).not.toBeNull();
    expect(abschluss!.banzBestellnummer).toBe(nummer);

    // **Und** es gibt einen Einreichungsbeleg (die Tabelle war leer).
    const submission = await prisma.banzSubmission.findUnique({
      where: { id: body.submissionId },
      select: {
        status: true, banzBestellnummer: true, payloadHash: true,
        payloadFormat: true, rawPayload: true, jahresabschlussId: true,
      },
    });
    expect(submission, 'der Einreichungsbeleg muss existieren').toBeTruthy();
    expect(submission!.status).toBe('SUBMITTED');
    expect(submission!.banzBestellnummer).toBe(nummer);
    expect(submission!.payloadFormat).toBe('PDF');
    expect(submission!.rawPayload.length, 'die Nutzlast muss im Beleg stehen')
      .toBeGreaterThan(1000);

    // Der Audit-Trail muss den Uebergang belegen.
    const eintraege = await prisma.auditLog.findMany({
      where: { entityType: 'Jahresabschluss', entityId: abschlussA },
      orderBy: { createdAt: 'desc' },
    });
    const einreichung = eintraege.find(
      (e) => (e.newState as { status?: string } | null)?.status === 'SUBMITTED',
    );
    expect(einreichung, 'der Uebergang muss im Audit-Trail stehen').toBeTruthy();
    expect(
      (einreichung!.newState as { banzBestellnummer?: string }).banzBestellnummer,
    ).toBe(nummer);
  });

  it('einreichen auf einem nicht signierten Abschluss -> 409', async () => {
    // Der Kern der fail-closed-Regel: **ohne Signatur gibt es keine
    // Einreichung.** Ein Abschluss, der nicht signiert ist, hat keine
    // qeS- bescheinigte Fassung — was sollte da eingereicht werden?
    const r = await fetch(`${BASE}/api/jahresabschluss/${abschlussC}/einreichen?mandantId=${mandantId}`, {
      method: 'POST', headers: headers(sbToken),
      body: JSON.stringify({ banzBestellnummer: 'BAnz-2026-C-00003' }),
    });
    const text = await r.text();
    expect(r.status, `nicht signiert: ${text.slice(0, 200)}`).toBe(409);
    expect(text).toContain('FINALIZED');
  });

  it('eine doppelt vergebene Bestellnummer -> 409', async () => {
    const r = await fetch(`${BASE}/api/jahresabschluss/${abschlussB}/einreichen?mandantId=${mandantId}`, {
      method: 'POST', headers: headers(sbToken),
      body: JSON.stringify({ banzBestellnummer: 'BAnz-2026-A-00001' }),
    });
    const text = await r.text();
    expect(r.status, `doppelte Nummer: ${text.slice(0, 200)}`).toBe(409);
    expect(text).toContain('BAnz-2026-A-00001');
  });

  it('eine zu kurze Bestellnummer -> 400', async () => {
    const r = await fetch(`${BASE}/api/jahresabschluss/${abschlussB}/einreichen?mandantId=${mandantId}`, {
      method: 'POST', headers: headers(sbToken),
      body: JSON.stringify({ banzBestellnummer: 'kurz' }),
    });
    expect(r.status).toBe(400);
  });

  it('veroeffentlichen ohne Einreichung -> 409', async () => {
    // Abschluss B ist noch SIGNED — es gibt nichts zu veroeffentlichen.
    const r = await fetch(`${BASE}/api/jahresabschluss/${abschlussB}/veroeffentlichen?mandantId=${mandantId}`, {
      method: 'POST', headers: headers(sbToken),
      body: JSON.stringify({}),
    });
    const text = await r.text();
    expect(r.status, `veroeffentlichen ohne Einreichung: ${text.slice(0, 200)}`).toBe(409);
    // Die Meldung nennt den **Ist**-Status, nicht den geforderten.
    expect(text).toContain('SIGNED');
  });

  it('veroeffentlichen -> 200, PUBLISHED, Zeitstempel + Audit-Trail', async () => {
    const r = await fetch(`${BASE}/api/jahresabschluss/${abschlussA}/veroeffentlichen?mandantId=${mandantId}`, {
      method: 'POST', headers: headers(sbToken),
      body: JSON.stringify({}),
    });
    const text = await r.text();
    expect(r.status, `veroeffentlichen: ${text.slice(0, 200)}`).toBe(200);
    const body = JSON.parse(text) as {
      status: string;
      veroeffentlichtAm: string | null;
      banzBestellnummer: string | null;
    };
    expect(body.status).toBe('PUBLISHED');
    expect(body.veroeffentlichtAm, 'der Veroeffentlichungszeitpunkt muss belegt sein')
      .not.toBeNull();
    expect(body.banzBestellnummer).toBe('BAnz-2026-A-00001');

    const abschluss = await prisma.jahresabschluss.findUnique({
      where: { id: abschlussA },
      select: { status: true, veroeffentlichtAm: true },
    });
    expect(abschluss!.status).toBe('PUBLISHED');
    expect(abschluss!.veroeffentlichtAm).not.toBeNull();

    // Der Submission-Beleg steht jetzt auf PUBLISHED.
    const submission = await prisma.banzSubmission.findFirst({
      where: { jahresabschlussId: abschlussA },
      select: { status: true },
    });
    expect(submission!.status).toBe('PUBLISHED');

    const eintraege = await prisma.auditLog.findMany({
      where: { entityType: 'Jahresabschluss', entityId: abschlussA },
      orderBy: { createdAt: 'desc' },
    });
    expect(
      eintraege.some(
        (e) => (e.newState as { status?: string } | null)?.status === 'PUBLISHED',
      ),
      'die Veroeffentlichung muss im Audit-Trail stehen',
    ).toBe(true);
  });

  it('der Wirtschaftspruefer darf nicht einreichen -> 403', async () => {
    // Der WP bescheinigt (qeS); die Kanzlei reicht ein. Ein WP, der einen
    // Abschluss ohne Kanzlei-Beteiligung veroeffentlichen koennte, waere die
    // Vier-Augen-Kontrolle ausgehebelt.
    const r = await fetch(`${BASE}/api/jahresabschluss/${abschlussB}/einreichen?mandantId=${mandantId}`, {
      method: 'POST', headers: headers(wpToken),
      body: JSON.stringify({ banzBestellnummer: 'BAnz-2026-B-00002' }),
    });
    expect(r.status).toBe(403);
  });
});
