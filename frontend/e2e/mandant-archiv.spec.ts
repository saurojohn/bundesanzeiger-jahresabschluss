import { test, expect, type Page } from '@playwright/test';

/**
 * Mandant-Archivierung — der von der Löschsperre verdrängte Weg.
 *
 * BEFUND 2026-10-09: `DELETE /api/mandant/:id` weist Mandanten mit
 * Buchhaltungsbestand mit 409 ab (§ 147 AO). Ersatzweise gibt es die
 * Archivierung — sie war im Frontend nie erreichbar, `archiviertAt` war
 * nicht einmal im Typ der Listenansicht.
 *
 * Der Test prüft deshalb beide Seiten des Vertrags:
 *   1. Ein Mandant lässt sich archivieren.
 *   2. Ein archiviertes Mandant wird gekennzeichnet und lässt sich
 *      wieder zurücksetzen.
 *
 * Bewusst OHNE Buchhaltungsdaten: die Sperre auf Bestand ist ein
 * eigener Vertrag (der Backend-Test deckt sie ab). Dieser Test prüft die
 * Bedienbarkeit.
 */

async function anmelden(page: Page): Promise<void> {
  await page.goto('http://localhost:3001/de-DE/login');
  await page.getByLabel(/e-?mail/i).fill('kanzlei-admin@kanzlei.de');
  await page.getByLabel(/passwort/i).fill('Demo123!');
  await page.getByRole('button', { name: /anmelden/i }).click();
  // Auf das DASHBOARD warten, nicht auf ein generisches Muster:
  // `**/de-DE/**` trifft auch die Login-Seite selbst — der Test waere
  // dann naemlich sofort "fertig" und die Folgeschritte liefe ins Leere.
  await page.waitForURL('**/de-DE/dashboard', { timeout: 30_000 });
}

/** Legt einen frischen Mandanten an und öffnet die Verwaltung. */
async function mandantAnlegen(page: Page, firmenname: string): Promise<void> {
  await page.goto('http://localhost:3001/de-DE/mandant');
  // Die Pflichtfelder laut CreateMandantDto. Ohne sie antwortet der
  // Server mit 400 und es entstuende ein Mandant, den es nicht gibt.
  await page.getByLabel(/firmenname/i).fill(firmenname);
  await page.getByLabel(/straße|strasse/i).fill('Teststraße 1');
  await page.getByLabel(/plz|postleitzahl/i).fill('80331');
  await page.getByLabel(/ort/i).fill('München');
  // Ueber die ID, nicht ueber den Label: "Name *" ist ein Teilstring von
  // "Firmenname *", und `.first()` traegt das falsche Feld.
  const gf = page.locator('#gf-name-0');
  await expect(gf, 'das Geschäftsführer-Feld muss vorhanden sein').toBeVisible();
  await gf.fill('E2E Geschäftsführer');

  const post = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().endsWith('/api/mandant'),
    { timeout: 20_000 },
  );
  await page.getByRole('button', { name: /mandant anlegen/i }).click();
  await post;
  await page.waitForTimeout(800);
}

test('Mandant archivieren und Archiv aufheben', async ({ page }) => {
  test.slow();

  await anmelden(page);

  const firmenname = `E2E Archiv ${Date.now()}`;
  await mandantAnlegen(page, firmenname);

  // 1) Das Anlegen muss den Dialog sauber geschlossen haben, sonst ist der
  //    naechste Schritt nicht eindeutig.
  await expect(
    page.getByRole('row', { name: new RegExp(firmenname) }),
    'der neue Mandant muss in der Liste stehen',
  ).toBeVisible({ timeout: 20_000 });

  // 2) Archivieren — mit Bestaetigungsdialog.
  const zeile = page.getByRole('row', { name: new RegExp(firmenname) });
  page.once('dialog', (d) => void d.accept());
  await zeile.getByRole('button', { name: /archivieren/i }).click();

  await expect(
    zeile.getByText(/archiviert/i),
    'der Mandant muss als archiviert gekennzeichnet sein',
  ).toBeVisible({ timeout: 20_000 });

  // 3) Der Status ist nach dem Neuladen persistent — nicht nur UI-Zustand.
  await page.reload();
  await page.waitForTimeout(1500);
  await expect(
    page.getByRole('row', { name: new RegExp(firmenname) }).getByText(/archiviert/i),
  ).toBeVisible({ timeout: 20_000 });

  // 4) Archiv aufheben.
  const zeile2 = page.getByRole('row', { name: new RegExp(firmenname) });
  page.once('dialog', (d) => void d.accept());
  await zeile2.getByRole('button', { name: /archiv aufheben/i }).click();

  await expect(
    zeile2.getByRole('button', { name: /^archivieren$/i }),
    'nach dem Aufheben muss wieder "Archivieren" angeboten werden',
  ).toBeVisible({ timeout: 20_000 });

  // 5) Aufraeumen. Der Mandant hat keine Buchhaltungsdaten, also ist das
  //    Loeschen zulaessig.
  page.once('dialog', (d) => void d.accept());
  await page
    .getByRole('row', { name: new RegExp(firmenname) })
    .getByRole('button', { name: /löschen/i })
    .click();

  await expect(
    page.getByRole('row', { name: new RegExp(firmenname) }),
    'der Mandant muss nach dem Loeschen verschwunden sein',
  ).toHaveCount(0, { timeout: 20_000 });
});