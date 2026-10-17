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

async function anmelden(page: Page) {
  await page.goto('http://localhost:3001/de-DE/login');
  await page.getByLabel(/e-?mail/i).fill('steuerberater@kanzlei.de');
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

      const bilanz = await fetch(`/api/bilanz?mandantId=${m.id}`, {
        method: 'POST',
        headers: h,
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
        headers: h,
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
        headers: h,
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
          headers: h,
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
