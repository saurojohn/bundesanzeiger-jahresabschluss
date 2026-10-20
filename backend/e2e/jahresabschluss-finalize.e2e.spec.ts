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
 *   7. Saldoabgleich Bilanz/GuV                 -> 409, FREIGABE per Begründung
 *
 * ENTSCHEIDUNG 2026-10-20 (Nachtrag 59, Entscheidung 1): Punkt 7 war die
 * bewusste Offenheit — `A.V.` ist nicht zwangsläufig das GuV-Ergebnis
 * (Kapitalerhöhungen, Entnahmen), und solche Bewegungen modelliert das
 * Produkt nicht, deshalb wurde der Abgleich nur **gemeldet**.
 *
 * Jetzt **sperrt** er. Der Grund fuer die damalige Offenheit bleibt aber
 * real — und deshalb gibt es den Ausweg: wer die Abweichung schriftlich
 * **begründet** (mindestens 20 Zeichen), darf den Abschluss freigeben. Die
 * Begründung geht in den Audit-Trail, damit ein Auditor die Ausnahme
 * sieht.
 *
 * Die Begründung gilt **ausschließlich** für den Saldoabgleich. Die
 * anderen Sperren (Bilanz geht nicht auf, Anhang mit Platzhaltern, Sätze in
 * Bearbeitung) lassen sich nicht begründen.
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
    // BEFUND 2026-10-17: Dieser Aufruf erwartete 201 Created — so gab Nest
    // es zurueck. Abschliessen ist ein Uebergang auf einem vorhandenen
    // Aggregat, keine Erstellung; 37 andere Aktions-Routen des Projekts
    // antworten mit `@HttpCode(HttpStatus.OK)`. Der Endpunkt ist jetzt
    // angeglichen, und **diese** Erwartung wurde mitgeaendert.
    //
    // Das ist eine bewusste Vertragsaenderung, kein Test, der sich der
    // Implementierung beugt: die Aenderung ist im Nachtrag 35 begruendet
    // und der Endpunkt liefert nachweislich 200.
      body: JSON.stringify({ zusammenfassung: 'Vollstaendig geprueft.' }),
    });
    const text = await res.text();
    expect(res.status, `Abschliessen: ${text}`).toBe(200);
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
    expect(erst.status).toBe(200);

    const zweit = await fetch(`${BASE}/api/jahresabschluss/${id}/finalize?mandantId=${mid}`, {
      method: 'POST', headers: headers(), body: JSON.stringify({}),
    });
    const text = await zweit.text();
    expect(zweit.status, `zweites Abschliessen: ${text.slice(0, 140)}`).toBe(409);
    expect(text).toMatch(/Zuruecksetzen|zurück|abgeschlossen/i);
  });

  // =========================================================================
  // ENTSCHEIDUNG 2026-10-20 (Nachtrag 59, Entscheidung 1)
  // =========================================================================

  /**
   * Legt die Abweichung zwischen `A.V.` (Bilanz) und dem GuV-Ergebnis an.
   *
   * WICHTIG: Das Kapital wird auf 1 gesetzt, damit die Bilanz dabei
   * AUSGEGLICHEN bleibt (Aktiva 1000 = Passiva 1 + 999). Erster Entwurf:
   * Kapital 500 + A.V. 999 -> Passiva 1499, und der Bilanz-Check hat
   * korrekt mit 409 geblockt. Der Test pruefte damit die falsche Sperre.
   */
  async function saldoabgleichHerstellen(): Promise<void> {
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
  }

  it('Saldoabgleich: eine Abweichung SPERRRT — ohne Begruendung 409', async () => {
    await allesAufraeumen();
    await saetzeAnlegen(true);
    // A.V. = 999, GuV-Ergebnis = 1000 -> Abweichung 1 EUR.
    await saldoabgleichHerstellen();

    const id = await abschlussAnlegen();
    const res = await fetch(`${BASE}/api/jahresabschluss/${id}/finalize?mandantId=${mid}`, {
      method: 'POST', headers: headers(), body: JSON.stringify({}),
    });
    const text = await res.text();
    expect(
      res.status,
      'eine Abweichung zwischen Bilanz und GuV darf den Abschluss nicht mehr ' +
        'ohne weiteres durchgehen lassen',
    ).toBe(409);
    const body = JSON.parse(text) as {
      message?: string;
      pruefungen?: Array<{ gegenstand: string; bestanden: boolean; meldung: string }>;
      abweichung?: number;
      begruendungErforderlich?: boolean;
    };
    expect(body.begruendungErforderlich, 'der Server muss den Weg zur Freigabe nennen').toBe(true);
    // A.V. 999 minus GuV-Ergebnis 1000 = **-1**. Der erste Entwurf dieses
    // Tests erwartete 1 — die Vorzeichen waren vertauscht, nicht der Code.
    expect(body.abweichung, 'die Abweichung muss benannt werden').toBe(-1);
    expect(
      body.pruefungen?.some(
        (p) => p.gegenstand === 'Saldoabgleich Bilanz/GuV' && !p.bestanden,
      ),
      'die Meldung muss den Saldoabgleich als Grund nennen',
    ).toBe(true);
    expect(body.message).toContain('Begruendung');
  });

  it('mit schriftlicher Begruendung → 200, FINALIZED, Begruendung im Audit-Trail', async () => {
    await allesAufraeumen();
    await saetzeAnlegen(true);
    await saldoabgleichHerstellen();

    const id = await abschlussAnlegen();
    const begruendung =
      'Kapitalerhoehung vom 15.03. ueber 500 EUR, im Produkt nicht erfasst.';
    const res = await fetch(`${BASE}/api/jahresabschluss/${id}/finalize?mandantId=${mid}`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ begruendung }),
    });
    const text = await res.text();
    expect(res.status, `Freigabe mit Begruendung: ${text.slice(0, 200)}`).toBe(200);
    const body = JSON.parse(text) as {
      status: string;
      warnungen: Array<{ meldung: string }>;
      saldoabgleich: {
        abweichung: number | null;
        freigegeben: boolean;
        begruendung?: string;
      };
    };
    expect(body.status).toBe('FINALIZED');
    expect(
      body.saldoabgleich.freigegeben,
      'die Antwort muss sagen, dass die Abweichung freigegeben wurde',
    ).toBe(true);
    expect(body.saldoabgleich.begruendung).toBe(begruendung);
    expect(
      body.warnungen.some((w) => w.meldung.includes('FREIGEGEBEN')),
      'die Freigabe muss in den Warnungen stehen',
    ).toBe(true);

    // **Und der entscheidende Teil:** die Begruendung muss im Audit-Trail
    // stehen. Ein Abschluss, der trotz einer Abweichung durchging, ist eine
    // Ausnahme — fuer einen Auditor unsichtbar waere sie wertlos.
    const eintraege = await prisma.auditLog.findMany({
      where: { entityType: 'Jahresabschluss', entityId: id },
      orderBy: { createdAt: 'desc' },
    });
    const abschlussEintrag = eintraege.find(
      (e) => (e.newState as { status?: string } | null)?.status === 'FINALIZED',
    );
    expect(abschlussEintrag, 'der Abschluss muss auditiert sein').toBeTruthy();
    const newState = abschlussEintrag!.newState as {
      saldoabgleichFreigegeben?: { abweichung?: number; begruendung?: string };
    };
    expect(
      newState.saldoabgleichFreigegeben?.begruendung,
      'die Begruendung muss im Audit-Trail stehen',
    ).toBe(begruendung);
  });

  it('eine zu kurze Begruendung wird abgewiesen (Mindestlaenge)', async () => {
    await allesAufraeumen();
    await saetzeAnlegen(true);
    await saldoabgleichHerstellen();
    const id = await abschlussAnlegen();

    const res = await fetch(`${BASE}/api/jahresabschluss/${id}/finalize?mandantId=${mid}`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ begruendung: 'kapital' }),
    });
    const text = await res.text();
    expect(res.status, `zu kurze Begruendung: ${text.slice(0, 160)}`).toBe(400);
    expect(text).toContain('begruendung');
  });
});
