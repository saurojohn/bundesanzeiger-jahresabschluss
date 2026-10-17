import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

/**
 * Jahresabschluss abschliessen — die Vollständigkeitsprüfung.
 *
 * BEFUND 2026-10-17 (Nachtrag 27): Es gab keinen Abschluss, also auch keine
 * Prüfung. Ein Jahresabschluss liess sich nicht "fertig" machen — und nichts
 * hinderte daran, einen unfertigen Bestand zu publizieren.
 *
 * Geprüft wird jede **Sperre** einzeln:
 *   1. Bilanz geht nicht auf                    -> 409
 *   2. Anhang hat offene Platzhalter            -> 409
 *   3. einer der drei Sätze steht auf DRAFT     -> 409
 *   4. Mandant archiviert                       -> 409
 *   5. alle Prüfungen bestanden                 -> 201, FINALIZED
 *   6. zweites Abschließen                       -> 409 (kein Zurücksetzen)
 *   7. Saldoabgleich Bilanz/GuV                 -> gemeldet, NICHT gesperrt
 *
 * Punkt 7 ist die bewusste Offenheit: `A.V.` ist nicht zwangsläufig das
 * GuV-Ergebnis (Kapitalerhöhungen, Entnahmen), und solche Bewegungen
 * modelliert das Produkt nicht. Eine harte Sperre würde berechtigte
 * Abschlüsse blockieren — der Abgleich wird deshalb gemeldet.
 *
 * Kein `createNestApplication()`: die Spec spricht per HTTP mit dem Server
 * auf :3000; `PrismaClient` nur fuer Aufraeumen und das Setzen von
 * Zustaenden, die die API nicht zulaesst (z.B. ein archivierter Mandant).
 */

const BASE = 'http://localhost:3000';
const JAHR = 2077;
const MANDANT = 'Demo GmbH';

interface LoginAntwort {
  accessToken: string;
  user: { mandanten: Array<{ id: string; firmenname: string }> };
}

describe('Jahresabschluss E2E (abschliessen / Vollstaendigkeitspruefung)', () => {
  const prisma = new PrismaClient();
  let token = '';
  let mid = '';

  async function anmelden(email: string): Promise<LoginAntwort> {
    const r = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'Demo123!' }),
    });
    expect(r.status, `Login ${email}`).toBe(200);
    return (await r.json()) as LoginAntwort;
  }

  function headers(): Record<string, string> {
    return {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      'x-mandant-id': mid,
    };
  }

  /** Legt die drei Saetze an und schliesst sie (VALIDATED). */
  async function saetzeAnlegen(balanced = true): Promise<void> {
    const b = await fetch(`${BASE}/api/bilanz?mandantId=${mid}`, {
      method: 'POST', headers: headers(),
      body: JSON.stringify({
        mandantId: mid, geschaeftsjahr: JAHR,
        positionen: balanced
          ? [
              { seite: 'AKTIVA', kontonummer: 'B.IV.', bezeichnung: 'Kasse', betragAktuell: 1000, reihenfolge: 1 },
              { seite: 'PASSIVA', kontonummer: 'A.I.', bezeichnung: 'Kapital', betragAktuell: 1000, reihenfolge: 1 },
            ]
          : [
              // Absichtlich unausgeglichen: 1000 != 500
              { seite: 'AKTIVA', kontonummer: 'B.IV.', bezeichnung: 'Kasse', betragAktuell: 1000, reihenfolge: 1 },
              { seite: 'PASSIVA', kontonummer: 'A.I.', bezeichnung: 'Kapital', betragAktuell: 500, reihenfolge: 1 },
            ],
      }),
    });
    expect(b.status, 'Bilanz anlegen').toBe(201);
    // Die Anlage-Antwort ist `{ bilanz, validierung }` — nicht flach.
    const bilanzId = ((await b.json()) as { bilanz: { id: string } }).bilanz.id;

    const g = await fetch(`${BASE}/api/guv?mandantId=${mid}`, {
      method: 'POST', headers: headers(),
      body: JSON.stringify({
        mandantId: mid, geschaeftsjahr: JAHR, verfahren: 'GKV',
        positionen: [
          { kontonummer: '1.', bezeichnung: 'Umsatzerloese', kategorie: 'ERLOES', betragAktuell: 1000, reihenfolge: 1 },
        ],
      }),
    });
    expect(g.status, 'GuV anlegen').toBe(201);
    const guvId = ((await g.json()) as { guv: { id: string } }).guv.id;

    const an = await fetch(`${BASE}/api/anhang?mandantId=${mid}`, {
      method: 'POST', headers: headers(),
      body: JSON.stringify({
        mandantId: mid, geschaeftsjahr: JAHR,
        abschnitte: [{ titel: 'Allgemeine Angaben', reihenfolge: 1, inhalt: 'Sitz: Berlin' }],
      }),
    });
    expect(an.status, 'Anhang anlegen').toBe(201);
    // Der Anhang antwortet flach mit `id`.
    const anhangId = ((await an.json()) as { id: string }).id;

    // Alle drei auf VALIDATED — sonst waere der DRAFT-Check der Blocker.
    await prisma.bilanz.update({ where: { id: bilanzId }, data: { status: 'VALIDATED' } });
    await prisma.guV.update({ where: { id: guvId }, data: { status: 'VALIDATED' } });
    await prisma.anhang.update({ where: { id: anhangId }, data: { status: 'VALIDATED' } });
  }

  async function abschlussAnlegen(): Promise<string> {
    const r = await fetch(`${BASE}/api/jahresabschluss`, {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ mandantId: mid, geschaeftsjahr: JAHR }),
    });
    // Der Body wird EINMAL gelesen: ein `await r.text()` im Erwartungstext
    // wertet die Vorlage sofort aus und der Aufruf `r.json()` danach
    // scheitert mit "Body has already been read".
    const text = await r.text();
    expect(r.status, `Abschluss anlegen: ${text}`).toBe(201);
    return (JSON.parse(text) as { id: string }).id;
  }

  async function allesAufraeumen(): Promise<void> {
    await prisma.jahresabschluss.deleteMany({ where: { mandantId: mid, geschaeftsjahr: JAHR } });
    await prisma.bilanz.deleteMany({ where: { mandantId: mid, geschaeftsjahr: JAHR } });
    await prisma.guV.deleteMany({ where: { mandantId: mid, geschaeftsjahr: JAHR } });
    await prisma.anhang.deleteMany({ where: { mandantId: mid, geschaeftsjahr: JAHR } });
  }

  beforeAll(async () => {
    const login = await anmelden('steuerberater@kanzlei.de');
    token = login.accessToken;
    mid = login.user.mandanten.find((m) => m.firmenname === MANDANT)?.id ?? '';
    expect(mid, `${MANDANT} muss erreichbar sein`).not.toBe('');
    await allesAufraeumen();
  });

  afterAll(async () => {
    await allesAufraeumen();
    await prisma.$disconnect();
  });

  // =========================================================================
  it('Sperre 1: unausgeglichene Bilanz → 409', async () => {
    await allesAufraeumen();
    await saetzeAnlegen(false); // unausgeglichen
    const id = await abschlussAnlegen();

    const res = await fetch(`${BASE}/api/jahresabschluss/${id}/finalize?mandantId=${mid}`, {
      method: 'POST', headers: headers(), body: JSON.stringify({}),
    });
    const body = (await res.json()) as { message?: string; pruefungen?: Array<{ gegenstand: string; bestanden: boolean }> };
    expect(res.status, 'eine unausgeglichene Bilanz darf nicht abgeschlossen werden').toBe(409);
    expect(
      body.pruefungen?.some((p) => p.gegenstand === 'Bilanz' && !p.bestanden),
      'die Meldung muss die Bilanz als Grund nennen',
    ).toBe(true);
  });

  // =========================================================================
  it('Sperre 2: offene Platzhalter im Anhang → 409', async () => {
    await allesAufraeumen();
    await saetzeAnlegen(true);
    // Platzhalter nachtragen — der Anhang war "Sitz: Berlin".
    const anhang = await prisma.anhang.findFirst({ where: { mandantId: mid, geschaeftsjahr: JAHR } });
    const abschnitt = await prisma.anhangAbschnitt.findFirst({ where: { anhangId: anhang!.id } });
    await prisma.anhangAbschnitt.update({
      where: { id: abschnitt!.id },
      data: { inhalt: 'Sitz: [Ort], HRB [Nummer]' },
    });

    const id = await abschlussAnlegen();
    const res = await fetch(`${BASE}/api/jahresabschluss/${id}/finalize?mandantId=${mid}`, {
      method: 'POST', headers: headers(), body: JSON.stringify({}),
    });
    const body = (await res.json()) as { pruefungen?: Array<{ gegenstand: string; bestanden: boolean; meldung: string }> };
    expect(res.status, 'ein Anhang mit Platzhaltern darf nicht abgeschlossen werden').toBe(409);
    const anhangPruefung = body.pruefungen?.find((p) => p.gegenstand === 'Anhang');
    expect(anhangPruefung?.bestanden).toBe(false);
    expect(anhangPruefung?.meldung).toContain('Ort');
  });

  // =========================================================================
  it('Sperre 3: ein Bestandteil steht noch auf DRAFT → 409', async () => {
    await allesAufraeumen();
    await saetzeAnlegen(true);
    const guv = await prisma.guV.findFirst({ where: { mandantId: mid, geschaeftsjahr: JAHR } });
    await prisma.guV.update({ where: { id: guv!.id }, data: { status: 'DRAFT' } });

    const id = await abschlussAnlegen();
    const res = await fetch(`${BASE}/api/jahresabschluss/${id}/finalize?mandantId=${mid}`, {
      method: 'POST', headers: headers(), body: JSON.stringify({}),
    });
    const body = (await res.json()) as { pruefungen?: Array<{ gegenstand: string; bestanden: boolean }> };
    expect(res.status, 'ein Satz in Bearbeitung sperrt den Abschluss').toBe(409);
    expect(
      body.pruefungen?.some((p) => p.gegenstand.startsWith('GuV (Bearbeitungsstatus)') && !p.bestanden),
    ).toBe(true);
  });

  // =========================================================================
  it('Sperre 4: archivierter Mandant → 409', async () => {
    await allesAufraeumen();
    await saetzeAnlegen(true);
    const id = await abschlussAnlegen();

    await prisma.mandant.update({ where: { id: mid }, data: { archiviertAt: new Date() } });
    try {
      const res = await fetch(`${BASE}/api/jahresabschluss/${id}/finalize?mandantId=${mid}`, {
        method: 'POST', headers: headers(), body: JSON.stringify({}),
      });
      const text = await res.text();
      expect(res.status, `archivierter Mandant: ${text.slice(0, 140)}`).toBe(409);
      expect(text).toContain('archiviert');
    } finally {
      await prisma.mandant.update({ where: { id: mid }, data: { archiviertAt: null } });
    }
  });

  // =========================================================================
  it('alle Prüfungen bestanden → 201, FINALIZED, mit Saldoabgleich', async () => {
    await allesAufraeumen();
    await saetzeAnlegen(true);
    const id = await abschlussAnlegen();

    const res = await fetch(`${BASE}/api/jahresabschluss/${id}/finalize?mandantId=${mid}`, {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ zusammenfassung: 'Vollstaendig geprueft.' }),
    });
    const text = await res.text();
    expect(res.status, `Abschliessen: ${text}`).toBe(201);
    const body = JSON.parse(text) as {
      status: string;
      finalisiertAm: string | null;
      pruefungen: Array<{ bestanden: boolean }>;
      warnungen: Array<{ meldung: string }>;
      saldoabgleich: { berechenbar: boolean; abweichung: number | null; hinweis: string };
    };
    expect(body.status).toBe('FINALIZED');
    expect(body.finalisiertAm, 'der Abschluss braucht einen Zeitstempel').toBeTruthy();
    expect(body.pruefungen.every((p) => p.bestanden)).toBe(true);
    // Die Standard-Fixture hat KEINE Position A.V. — der Abgleich ist dann
    // nicht berechenbar, und genau das muss der Dienst sagen (statt zu
    // raten). Der Fall MIT A.V. steht im letzten Test.
    expect(
      body.saldoabgleich.berechenbar,
      'ohne A.V. darf der Abgleich nicht behauptet werden',
    ).toBe(false);
    expect(body.saldoabgleich.hinweis).toContain('nicht moeglich');
  });

  // =========================================================================
  it('zweites Abschließen → 409 (kein Zurücksetzen)', async () => {
    await allesAufraeumen();
    await saetzeAnlegen(true);
    const id = await abschlussAnlegen();
    const erst = await fetch(`${BASE}/api/jahresabschluss/${id}/finalize?mandantId=${mid}`, {
      method: 'POST', headers: headers(), body: JSON.stringify({}),
    });
    expect(erst.status).toBe(201);

    const zweit = await fetch(`${BASE}/api/jahresabschluss/${id}/finalize?mandantId=${mid}`, {
      method: 'POST', headers: headers(), body: JSON.stringify({}),
    });
    const text = await zweit.text();
    expect(zweit.status, `zweites Abschliessen: ${text.slice(0, 140)}`).toBe(409);
    expect(text).toMatch(/Zuruecksetzen|zurück|abgeschlossen/i);
  });

  // =========================================================================
  it('Saldoabgleich: eine Abweichung wird GEMELDET, nicht gesperrt', async () => {
    await allesAufraeumen();
    await saetzeAnlegen(true);
    // A.V. = 999, GuV-Ergebnis = 1000 -> Abweichung 1 EUR.
    //
    // WICHTIG: Das Kapital wird auf 1 gesetzt, damit die Bilanz dabei
    // AUSGEGLICHEN bleibt (Aktiva 1000 = Passiva 1 + 999). Erster Entwurf:
    // Kapital 500 + A.V. 999 -> Passiva 1499, und der Bilanz-Check hat
    // korrekt mit 409 geblockt. Der Test pruefte damit die falsche Sperre.
    const bilanz = await prisma.bilanz.findFirst({
      where: { mandantId: mid, geschaeftsjahr: JAHR },
      include: { positionen: true },
    });
    const kapital = bilanz!.positionen.find((p) => p.kontonummer === 'A.I.');
    await prisma.bilanzPosition.update({
      where: { id: kapital!.id },
      data: { betragAktuell: '1' },
    });
    await prisma.bilanzPosition.create({
      data: {
        bilanzId: bilanz!.id,
        seite: 'PASSIVA',
        kontonummer: 'A.V.',
        bezeichnung: 'Jahresueberschuss',
        betragAktuell: '999',
        reihenfolge: 9,
      },
    });

    const id = await abschlussAnlegen();
    const res = await fetch(`${BASE}/api/jahresabschluss/${id}/finalize?mandantId=${mid}`, {
      method: 'POST', headers: headers(), body: JSON.stringify({}),
    });
    expect(res.status, 'die Abweichung darf NICHT sperren — Eigenkapitalbewegungen sind nicht modelliert').toBe(201);
    const body = (await res.json()) as {
      warnungen: Array<{ meldung: string }>;
      saldoabgleich: { abweichung: number | null; hinweis: string };
    };
    expect(body.saldoabgleich.abweichung).not.toBeNull();
    expect(
      body.warnungen.some((w) => w.meldung.includes('Abweichung')),
      'die Abweichung muss gemeldet werden',
    ).toBe(true);
  });
});
