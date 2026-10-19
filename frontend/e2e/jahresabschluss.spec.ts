import { expect, test, type Page } from '@playwright/test';

/**
 * Jahresabschluss in der Oberflaeche: anlegen und abschliessen.
 *
 * BEFUND 2026-10-17: Es gab keinen Jahresabschluss, also auch keine
 * Bedienoberflaeche dafuer. Die Seite zeigte einen Leerzustand, der aus
 * einem verschluckten 404 stammte (Nachtrag 28).
 *
 * Zwei Wege, und beide gehoeren zusammen:
 *
 *   1. Der Weg, der klappt: drei Saetze anlegen, auf VALIDATED setzen,
 *      Jahresabschluss anlegen, abschliessen -> FINALIZED.
 *
 *   2. Der Weg, der scheitern MUSS: dieselben drei Saetze auf DRAFT
 *      belassen und abschliessen klicken. Der Server antwortet 409, und
 *      die Oberflaeche muss das **als Fehlschlag** zeigen.
 *
 * Weg 2 ist nicht Kosmetik. Genau dort lag ein Befund: die Oberflaeche
 * zeigte bei einer Ablehnung durch den Server die Ueberschrift "Alle
 * Pflichtangaben erfuellt." und gruene Haekchen neben den gescheiterten
 * Pruefungen. Ein GoBD-Bildschirm, der ein Scheitern als Erfolg
 * darstellt, ist gefaehrlicher als keiner.
 */

/**
 * BEFUND 2026-10-20 (Nachtrag 57, TODO-8.12): Das Login ist jetzt
 * parameterisiert. Die Signatur des **Jahresabschlusses** ist die
 * Endabnahme und ausschliesslich dem Wirtschaftspruefer vorbehalten
 * (`@Roles('WIRTSCHAFTSPRUEFER')` an `POST /api/signatur/sign-abschluss`).
 * Der Test, der den Signier-Knopf prueft, muss deshalb als
 * Wirtschaftspruefer angemeldet sein — als STEUERBERATER sieht er den
 * Knopf nicht mehr, und genau das ist der Gegenbeweis.
 */
async function anmelden(page: Page, email = 'steuerberater@kanzlei.de') {
  await page.goto('http://localhost:3001/de-DE/login');
  await page.getByLabel(/e-?mail/i).fill(email);
  await page.getByLabel(/passwort/i).fill('Demo123!');
  await page.getByRole('button', { name: /anmelden/i }).click();
  await page.waitForURL('**/de-DE/dashboard', { timeout: 30_000 });
}

/**
 * Legt Bilanz + GuV + Anhang fuer ein Jahr an und stellt sie optional auf
 * VALIDATED.
 *
 * BEFUND 2026-10-17: Das urspruengliche Fixture legte die drei Saetze an
 * und rief sofort `finalize`. Der Server antwortete zu Recht mit 409 —
 * alle drei standen noch auf DRAFT und koennten sich damit noch aendern.
 *
 * Der urspruengliche Test war also nicht "flaky", er beschrieb einen
 * Abschluss, den es so nicht geben kann. `BILANZ_STATUS` =
 * DRAFT|VALIDATED|ARCHIVED, VALIDATED ist per API setzbar.
 */
async function saetzeAnlegen(
  page: Page,
  jahr: number,
  validieren: boolean,
): Promise<void> {
  const ergebnis = await page.evaluate(
    async ({ jahr: j, validieren: v }) => {
      const t = localStorage.getItem('accessToken');
      const h = {
        'content-type': 'application/json',
        Authorization: `Bearer ${t}`,
        'x-mandant-id': '',
      };
      const mandanten = (await (
        await fetch('/api/mandant', { headers: { Authorization: `Bearer ${t}` } })
      ).json()) as Array<{ id: string; firmenname: string }>;
      const m = mandanten.find((x) => x.firmenname === 'Demo GmbH') ?? mandanten[0];
      if (!m) return { ok: false as const, grund: 'kein Mandant' };
      h['x-mandant-id'] = m.id;
      localStorage.setItem('activeMandantId', m.id);

      // BEFUND 2026-10-20 (Nachtrag 57, TODO-8.12): `POST /api/bilanz` ist
      // auf STEUERBERATER und KANZLEI_ADMIN beschraenkt — ein
      // Wirtschaftspruefer darf **nicht** anlegen, er darf pruefen und
      // signieren.
      //
      // Der Test "der Signier-Knopf ist belegt" laeuft aber als
      // Wirtschaftspruefer (die Endabnahme ist seine Sache). Die Saetze
      // entstehen deshalb mit einem **eigenen** Berater-Token, waehrend die
      // Browser-Sitzung die des Wirtschaftspruefers bleibt.
      //
      // Der erste Versuch lief komplett als Wirtschaftspruefer und scheiterte
      // an der Fixture: "Bilanz 403". Das war kein Testfehler, sondern die
      // Rollenbindung — sie gehoert in die Fixture, nicht in den Test.
      const beraterLogin = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'steuerberater@kanzlei.de',
          password: 'Demo123!',
        }),
      });
      if (beraterLogin.status !== 200) {
        return { ok: false as const, grund: `Berater-Login ${beraterLogin.status}` };
      }
      const beraterToken = (await beraterLogin.json()) as { accessToken: string };
      const bh = { ...h, Authorization: `Bearer ${beraterToken.accessToken}` };

      const bilanz = await fetch(`/api/bilanz?mandantId=${m.id}`, {
        method: 'POST',
        headers: bh,
        body: JSON.stringify({
          mandantId: m.id,
          geschaeftsjahr: j,
          positionen: [
            {
              seite: 'AKTIVA',
              kontonummer: 'B.IV.',
              bezeichnung: 'Kasse',
              betragAktuell: 1000,
              reihenfolge: 1,
            },
            {
              seite: 'PASSIVA',
              kontonummer: 'A.I.',
              bezeichnung: 'Kapital',
              betragAktuell: 1000,
              reihenfolge: 1,
            },
          ],
        }),
      });
      if (bilanz.status !== 201) {
        return { ok: false as const, grund: `Bilanz ${bilanz.status}` };
      }

      const guv = await fetch(`/api/guv?mandantId=${m.id}`, {
        method: 'POST',
        headers: bh,
        body: JSON.stringify({
          mandantId: m.id,
          geschaeftsjahr: j,
          verfahren: 'GKV',
          positionen: [
            {
              kontonummer: '1.',
              bezeichnung: 'Umsatzerloese',
              kategorie: 'ERLOES',
              betragAktuell: 1000,
              reihenfolge: 1,
            },
          ],
        }),
      });
      if (guv.status !== 201) return { ok: false as const, grund: `GuV ${guv.status}` };

      const anhang = await fetch(`/api/anhang?mandantId=${m.id}`, {
        method: 'POST',
        headers: bh,
        body: JSON.stringify({
          mandantId: m.id,
          geschaeftsjahr: j,
          abschnitte: [
            { titel: 'Allgemeine Angaben', reihenfolge: 1, inhalt: 'Sitz: Berlin' },
          ],
        }),
      });
      if (anhang.status !== 201) {
        return { ok: false as const, grund: `Anhang ${anhang.status}` };
      }

      if (!v) return { ok: true as const, mandantId: m.id };

      const b = (await bilanz.json()) as { bilanz?: { id: string } };
      const g = (await guv.json()) as { guv?: { id: string } };
      const a = (await anhang.json()) as { id?: string };
      if (!b.bilanz?.id) return { ok: false as const, grund: 'Bilanz-Antwort ohne id' };
      if (!g.guv?.id) return { ok: false as const, grund: 'GuV-Antwort ohne id' };
      if (!a.id) return { ok: false as const, grund: 'Anhang-Antwort ohne id' };

      for (const [url, id, name] of [
        ['/api/bilanz', b.bilanz.id, 'Bilanz'],
        ['/api/guv', g.guv.id, 'GuV'],
        ['/api/anhang', a.id, 'Anhang'],
      ] as const) {
        const r = await fetch(`${url}/${id}?mandantId=${m.id}`, {
          method: 'PATCH',
          headers: bh,
          body: JSON.stringify({ status: 'VALIDATED' }),
        });
        if (r.status !== 200) {
          return { ok: false as const, grund: `${name} auf VALIDATED: ${r.status}` };
        }
      }

      return { ok: true as const, mandantId: m.id };
    },
    { jahr, validieren },
  );
  expect(ergebnis.ok, `Fixture: ${JSON.stringify(ergebnis)}`).toBe(true);
}

/** Legt den Jahresabschluss ueber die Oberflaeche an und wartet auf die Zeile. */
async function abschlussAnlegen(page: Page, jahr: number) {
  await page.goto('http://localhost:3001/de-DE/jahresabschluss');
  await page.waitForTimeout(2000);

  // Das Jahr MUSS im Feld stehen, sonst legt der Knopf den Abschluss fuer
  // das Voreingestellte (2025) an und nicht fuer das Jahr des Fixtures.
  await page.getByLabel(/geschäftsjahr/i).first().fill(String(jahr));
  await page.getByTestId('jahresabschluss-anlegen').click();

  await expect(
    page.locator('tr', { hasText: String(jahr) }).first(),
    'der Jahresabschluss muss in der Liste stehen',
  ).toBeVisible({ timeout: 20_000 });
}

test('Jahresabschluss anlegen und abschliessen', async ({ page }) => {
  test.setTimeout(90_000);
  await anmelden(page);

  const jahr = 2079;
  await saetzeAnlegen(page, jahr, true);
  await abschlussAnlegen(page, jahr);

  await page
    .locator('tr', { hasText: String(jahr) })
    .first()
    .getByRole('button', { name: /abschlie/i })
    .click();

  const panel = page.getByTestId('jahresabschluss-pruefung');
  await expect(panel, 'das Pruefungsergebnis muss angezeigt werden').toBeVisible({
    timeout: 20_000,
  });

  // Reihenfolge ist Absicht: die SEMANTISCHEN Zusicherungen stehen vor der
  // Attributpruefung. Eine Negativprobe muss an ihnen scheitern — an einem
  // selbst erfundenen `data-*` zu scheitern beweist nichts, das war genau
  // der erste Fehlschlag dieses Tests.
  await expect(panel, 'der Weg hat geklappt: alle Pruefungen bestanden').toContainText(
    'Alle Pflichtangaben erfüllt',
  );
  await expect(panel, 'es darf keine gescheiterte Pruefung geben').not.toContainText('✗');
  await expect(panel).toHaveAttribute('data-ergebnis', 'vollstaendig');

  await expect(
    page.locator('tr', { hasText: String(jahr) }).first(),
    'der Status muss auf FINALIZED stehen',
  ).toContainText('Finalisiert', { timeout: 20_000 });
});

test('ein nicht vollstaendiger Abschluss wird als Fehlschlag gezeigt', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await anmelden(page);

  // Absichtlich OHNE VALIDATED: die drei Saetze bleiben auf DRAFT.
  const jahr = 2080;
  await saetzeAnlegen(page, jahr, false);
  await abschlussAnlegen(page, jahr);

  await page
    .locator('tr', { hasText: String(jahr) })
    .first()
    .getByRole('button', { name: /abschlie/i })
    .click();

  const panel = page.getByTestId('jahresabschluss-pruefung');
  await expect(panel, 'das Pruefungsergebnis muss angezeigt werden').toBeVisible({
    timeout: 20_000,
  });

  // 1) Die Erfolgsmeldung darf hier nicht stehen. Genau das war der Befund:
  //    "Alle Pflichtangaben erfuellt." ueber drei gescheiterten Pruefungen.
  //    Diese Zusicherung steht bewusst VOR der Attributpruefung, damit die
  //    Negativprobe an ihr scheitert und nicht an einem selbst erfundenen
  //    `data-*`.
  await expect(
    panel,
    'eine abgelehnte Pruefung darf nicht als Erfolg gemeldet werden',
  ).not.toContainText('Alle Pflichtangaben erfüllt');

  // 2) Die gescheiterten Pruefungen stehen als Fehlschlag drin, mit dem
  //    Grund, den der Server genannt hat.
  await expect(panel).toContainText('steht noch auf DRAFT');
  await expect(panel).toContainText('✗');

  // 3) Und das Ergebnis ist als offen gekennzeichnet.
  await expect(panel).toHaveAttribute('data-ergebnis', 'offen');

  // 4) Und der Abschluss ist unveraendert DRAFT geblieben.
  await expect(
    page.locator('tr', { hasText: String(jahr) }).first(),
    'ein abgelehnter Abschluss darf nicht als finalisiert erscheinen',
  ).toContainText('Entwurf');
});

// ---------------------------------------------------------------------------
// BEFUND 2026-10-17 (Nachtrag 38): Der Knopf „Jahresabschluss signieren" war
// ein **toter Knopf** — er hatte keinen `onClick`. Ein Klick tat nichts, ohne
// jede Rueckmeldung.
//
// Das ist derselbe Fehler, den das Projekt am 2026-10-05 fuer GuV und Anhang
// gefunden und behoben hat. Er wurde beim Bau dieser Ansicht wiederholt.
//
// `formulare.spec.ts` heisst „Fachformulare: Aktionen, nicht nur Rendering",
// deckt aber nur Branding, Webhooks, API-Keys und Audit ab — **nicht**
// Bilanz, GuV, Anhang oder Jahresabschluss. Deshalb konnte der Fehler
// wieder entstehen, ohne dass ein Wächter ihn sah.
// ---------------------------------------------------------------------------

test('der Signier-Knopf ist belegt und öffnet den P12-Dialog', async ({ page }) => {
  test.setTimeout(90_000);
  // **Wirtschaftspruefer**: die Signatur des Jahresabschlusses ist die
  // Endabnahme und steht nur diesem offen (Nachtrag 57).
  await anmelden(page, 'wp@kanzlei.de');

  const jahr = 2081;
  await saetzeAnlegen(page, jahr, true);
  await abschlussAnlegen(page, jahr);

  const zeile = page.locator('tr', { hasText: String(jahr) }).first();

  // Erst abschliessen — der Knopf ist bewusst nur bei FINALIZED sichtbar,
  // weil der Server eine Signatur ausschliesslich in diesem Zustand annimmt
  // (Nachtrag 35).
  await zeile.getByRole('button', { name: /abschlie/i }).click();
  await expect(zeile, 'der Status muss auf FINALIZED stehen').toContainText(
    'Finalisiert',
    { timeout: 20_000 },
  );

  const knopf = zeile.getByTestId('jahresabschluss-signieren');
  await expect(
    knopf,
    'nach dem Abschliessen muss der Signier-Knopf dastehen',
  ).toBeVisible();

  // Das ist die eigentliche Zusicherung: **der Knopf muss etwas tun.**
  // Ohne `onClick` bliebe das DOM unveraendert — der Test faellt dann an
  // genau der Stelle durch, an der der Anwender sonst nur Ratlosigkeit sieht.
  const dialog = page.getByRole('heading', { name: /zertifikat|signatur/i });
  await expect(
    dialog,
    'ein Klick auf "Jahresabschluss signieren" muss den P12-Dialog oeffnen',
  ).not.toBeVisible();

  await knopf.click();

  await expect(
    dialog,
    'der P12-Dialog hat sich nicht geoeffnet — der Knopf ist tot',
  ).toBeVisible({ timeout: 15_000 });

  // Und im Dialog muss die Dateiauswahl stehen, sonst waere es ein leerer
  // Dialog, der auch nichts koennte.
  await expect(
    page.locator('div.fixed input[type="file"]').first(),
    'der Dialog muss eine P12-Datei entgegennehmen',
  ).toBeAttached();
});

test('ein STEUERBERATER sieht den Signier-Knopf des Jahresabschlusses nicht', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await anmelden(page);

  // Abschluss auf FINALIZED bringen: der Knopf ist **nicht** wegen des
  // Status unsichtbar, sondern wegen der Rolle. Ohne FINALIZED waere der
  // Test nicht aussagekraeftig — der Knopf waere auch fuer einen
  // Wirtschaftspruefer weg.
  const jahr = 2083;
  await saetzeAnlegen(page, jahr, true);
  await abschlussAnlegen(page, jahr);

  const zeile = page.locator('tr', { hasText: String(jahr) }).first();
  await zeile.getByRole('button', { name: /abschlie/i }).click();
  await expect(zeile, 'der Status muss auf FINALIZED stehen').toContainText(
    'Finalisiert',
    { timeout: 20_000 },
  );

  await expect(
    zeile.getByTestId('jahresabschluss-signieren'),
    'ein STEUERBERATER darf den Jahresabschluss nicht signieren ' +
      '(sign-abschluss: nur WIRTSCHAFTSPRUEFER) — der Knopf darf nicht ' +
      'erscheinen, sonst laeuft der Anwender nach P12-Upload und Passwort ' +
      'in einen 403',
  ).toHaveCount(0);
});

test('bei DRAFT ist der Signier-Knopf nicht sichtbar', async ({ page }) => {
  test.setTimeout(90_000);
  await anmelden(page);

  // Absichtlich OHNE VALIDATED: der Abschluss bleibt DRAFT. Der Server
  // wuerde eine Signatur mit 409 abweisen — der Knopf darf den Anwender
  // nicht erst in einen Fehler laufen lassen, den er selbst nicht ausloesen
  // kann.
  const jahr = 2082;
  await saetzeAnlegen(page, jahr, false);
  await abschlussAnlegen(page, jahr);

  const zeile = page.locator('tr', { hasText: String(jahr) }).first();
  await expect(zeile).toContainText('Entwurf');
  await expect(
    zeile.getByTestId('jahresabschluss-signieren'),
    'ein DRAFT-Abschluss darf nicht signierbar aussehen',
  ).toHaveCount(0);
});
