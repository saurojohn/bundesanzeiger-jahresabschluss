import { expect, test, type Page } from '@playwright/test';

/**
 * Beträge werden in deutscher Schreibweise eingegeben.
 *
 * BEFUND 2026-10-15: Alle Betragsfelder waren `<input type="number">`.
 * Gemessen im Browser, Tastendruck für Tastendruck:
 *
 *   "1.500"     -> gespeichert als 1,5      (Faktor 1000 daneben)
 *   "150000,50" -> das Dezimalkomma wird verworfen
 *
 * `type="number"` kann das nicht auflösen: "1.500" ist dort ein gültiger
 * Wert, und die Absicht des Tippenden ist nicht erkennbar.
 *
 * Dieser Test prüft den GESPEICHERTEN Wert, nicht die Anzeige. Ein Test, der
 * nur prüft, was im Feld steht, würde einen Fix belohnen, der die Zahl nur
 * anzeigt und beim Speichern wieder verliert.
 */

async function anmelden(page: Page) {
  await page.goto('http://localhost:3001/de-DE/login');
  await page.getByLabel(/e-?mail/i).fill('steuerberater@kanzlei.de');
  await page.getByLabel(/passwort/i).fill('Demo123!');
  await page.getByRole('button', { name: /anmelden/i }).click();
  await page.waitForURL('**/de-DE/dashboard', { timeout: 30_000 });
}

/** Mandant mit Bilanz-Bestand (Reihenfolge ist nicht zugesagt). */
async function mandantMitBilanz(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const t = localStorage.getItem('accessToken');
    const liste = (await (await fetch('/api/mandant', {
      headers: { Authorization: `Bearer ${t}` },
    })).json()) as Array<{ id: string }>;
    for (const m of liste) {
      const b = (await (await fetch(`/api/bilanz?mandantId=${m.id}`, {
        headers: { Authorization: `Bearer ${t}`, 'x-mandant-id': m.id },
      })).json()) as unknown[];
      if (Array.isArray(b) && b.length > 0) return m.id;
    }
    return liste[0]?.id ?? '';
  });
}

/**
 * Eigene Bilanz fuer den Test.
 *
 * BEFUND 2026-10-15: `wp-strecke.spec.ts` schliesst am Ende eine
 * WP-Pruefung ab — und `finalizePruefung` setzt dabei
 * `bilanz.status = 'APPROVED'`. Danach ist der Bilanz gesperrt (alles
 * ausser DRAFT ist nicht mehr bearbeitbar). Jede spaetere Spec, die den
 * geseedeten Bilanz der Demo GmbH oeffnen wollte, scheiterte dann — je nach
 * Dateireihenfolge des Laufs, also **flaky**: im Gesamtlauf rot, einzeln
 * gruen, im naechsten Gesamtlauf wieder gruen.
 *
 * Diese Spec legt darum ihren eigenen Satz an und raeumt ihn ab. Sie
 * haengt damit nicht mehr am Zustand, den eine andere Spec hinterlaesst.
 */
async function eigeneBilanz(page: Page, mid: string): Promise<number> {
  const jahr = 2078; // in keiner anderen Spec belegt
  await page.evaluate(
    async ({ mandantId, geschaeftsjahr }) => {
      const t = localStorage.getItem('accessToken');
      const r = await fetch(`/api/bilanz?mandantId=${mandantId}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: `Bearer ${t}`,
          'x-mandant-id': mandantId,
        },
        body: JSON.stringify({
          mandantId,
          geschaeftsjahr,
          hinweise: 'Signatur-Spec-Fixture',
          positionen: [
            { seite: 'AKTIVA', kontonummer: 'B.IV.', bezeichnung: 'Kasse', betragAktuell: 1000, reihenfolge: 1 },
            { seite: 'PASSIVA', kontonummer: 'A.I.', bezeichnung: 'Kapital', betragAktuell: 1000, reihenfolge: 1 },
          ],
        }),
      });
      if (!r.ok) throw new Error(`Bilanz-Fixture fehlgeschlagen: ${r.status}`);
    },
    { mandantId: mid, geschaeftsjahr: jahr },
  );
  return jahr;
}

async function bilanzPositionen(page: Page, mandantId: string, jahr: number) {
  return page.evaluate(async ({ mid, geschaeftsjahr }) => {
    const t = localStorage.getItem('accessToken');
    const liste = (await (await fetch(
      `/api/bilanz?mandantId=${mid}&geschaeftsjahr=${geschaeftsjahr}`,
      { headers: { Authorization: `Bearer ${t}`, 'x-mandant-id': mid } },
    )).json()) as Array<{ id: string; geschaeftsjahr: number }>;
    const bilanz = liste[0];
    const detail = await (await fetch(`/api/bilanz/${bilanz!.id}?mandantId=${mid}`, {
      headers: { Authorization: `Bearer ${t}`, 'x-mandant-id': mid },
    })).json() as {
      // Die Detail-Antwort IST der Datensatz, nicht `{ bilanz: … }` —
      // erster Entwurf nahm die falsche Form.
      positionen: Array<{ id: string; bezeichnung: string; betragAktuell: number }>;
    };
    return detail.positionen;
  }, { mid: mandantId, geschaeftsjahr: jahr });
}

test('Betrag: deutsche Schreibweise wird korrekt gespeichert', async ({ page }) => {
  test.setTimeout(90_000);
  await anmelden(page);

  const mid = await mandantMitBilanz(page);
  expect(mid, 'es muss einen Mandanten mit Bilanz geben').not.toBe('');
  await page.evaluate((m) => localStorage.setItem('activeMandantId', m), mid);

  const jahr = await eigeneBilanz(page, mid);
  try {
    await page.goto(`http://localhost:3001/de-DE/bilanz?jahr=${jahr}`);
    await page.waitForTimeout(2500);
    await page
      .locator('tr', { hasText: String(jahr) })
      .first()
      .getByRole('button', { name: 'Bearbeiten' })
      .first()
      .click();
    await page.waitForTimeout(2000);

  const feld = page.locator('input[inputmode="decimal"][required]').first();
  await expect(feld, 'es muss ein Pflicht-Betragsfeld geben').toBeVisible();

  // `pressSequentially` tippt an der Cursor-Position; ein zweites Mal muss
  // deshalb vorher geleert werden, sonst wird an den ersten Wert angehaengt.
  // Erster Entwurf: "1.500,00" + "1234,56" -> "121.500,00".
  await feld.fill('');

  // --- Fall 1: Tausendertrennzeichen, der Faktor-1000-Fehler -------------
  await feld.pressSequentially('1.500', { delay: 20 });
  await feld.blur();
  await page.waitForTimeout(300);
  await expect(
    feld,
    'nach dem Verlassen muss 1.500 als 1.500,00 dastehen (= 1500)',
  ).toHaveValue('1.500,00');

  // --- Fall 2: Dezimalkomma ----------------------------------------------
  await feld.fill('');
  await feld.pressSequentially('1234,56', { delay: 20 });
  await feld.blur();
  await page.waitForTimeout(300);
  await expect(
    feld,
    'nach dem Verlassen muss 1234,56 als 1.234,56 dastehen',
  ).toHaveValue('1.234,56');

  // --- Speichern und den GESPEICHERTEN Wert prüfen -----------------------
  const speichern = page.getByRole('button', { name: /^Speichern$/ });
  await expect(speichern, 'das Formular muss speichern können').toBeVisible();
  await speichern.click();
  await page.waitForTimeout(3500);

    const gespeichert = await bilanzPositionen(page, mid, jahr);
    const aktueller = gespeichert.find((p) => Number(p.betragAktuell) === 1234.56);

    expect(
      aktueller,
      'der gespeicherte Betrag muss 1234,56 sein — nicht 123456, nicht 1.234',
    ).toBeTruthy();
  } finally {
    // Aufraeumen: eigene Bilanz, damit sie keinen anderen Stoert.
    await page.evaluate(
      async ({ mandantId, geschaeftsjahr }) => {
        const t = localStorage.getItem('accessToken');
        const liste = (await (await fetch(
          `/api/bilanz?mandantId=${mandantId}&geschaeftsjahr=${geschaeftsjahr}`,
          { headers: { Authorization: `Bearer ${t}`, 'x-mandant-id': mandantId } },
        )).json()) as Array<{ id: string }>;
        for (const b of liste) {
          await fetch(`/api/bilanz/${b.id}?mandantId=${mandantId}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${t}`, 'x-mandant-id': mandantId },
          });
        }
      },
      { mandantId: mid, geschaeftsjahr: jahr },
    );
  }
});
