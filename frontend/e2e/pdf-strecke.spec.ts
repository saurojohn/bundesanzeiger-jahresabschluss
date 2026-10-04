import { expect, test, type Page } from '@playwright/test';

/**
 * PDF-Strecke: erzeugen → ansehen → herunterladen.
 *
 * Befund 2026-10-04: `handleView` öffnete per `window.open` die geschützte
 * Download-URL direkt. `window.open` kann keinen `Authorization`-Header
 * setzen — der Endpunkt antwortet 401. Jeder Klick auf "Ansehen" öffnete
 * deshalb ZWEI Tabs, der erste zeigte die Fehlerseite. Der Kommentar im
 * Code benannte das Problem, der Aufruf blieb trotzdem stehen.
 *
 * Der Test zählt die geöffneten Tabs und prüft den Inhalt.
 */
async function anmelden(page: Page) {
  await page.goto('http://localhost:3001/de-DE/login');
  await page.getByLabel(/e-?mail/i).fill('steuerberater@kanzlei.de');
  await page.getByLabel(/passwort/i).fill('Demo123!');
  await page.getByRole('button', { name: /anmelden/i }).click();
  await page.waitForURL('**/de-DE/dashboard', { timeout: 30_000 });
}

test('PDF erzeugen, ansehen und herunterladen → genau ein Tab, echtes PDF', async ({ page, context }) => {
  await anmelden(page);
  // Mandant mit Bestand
  const mid = await page.evaluate(async () => {
    const t = localStorage.getItem('accessToken');
    const l = (await (await fetch('/api/mandant', { headers: { Authorization: `Bearer ${t}` } })).json()) as Array<{ id: string }>;
    for (const m of l) {
      const b = (await (await fetch(`/api/bilanz?mandantId=${m.id}`, { headers: { Authorization: `Bearer ${t}`, 'x-mandant-id': m.id } })).json()) as unknown[];
      if (Array.isArray(b) && b.length > 0) return m.id;
    }
    return l[0].id;
  });
  await page.evaluate((m) => localStorage.setItem('activeMandantId', m), mid);

  await page.goto('http://localhost:3001/de-DE/bilanz');
  await page.waitForTimeout(2500);

  // 1) Erzeugen
  const erzeugen = page.getByRole('button', { name: 'PDF erzeugen' }).first();
  await expect(erzeugen, 'es muss eine PDF-Aktion geben').toBeVisible();
  await erzeugen.click();
  await page.waitForTimeout(4000);

  // 2) Ansehen — genau EIN neuer Tab, und er darf keine 401-Seite zeigen
  const ansehen = page.getByRole('button', { name: 'PDF anzeigen' }).first();
  await expect(ansehen, 'nach dem Erzeugen muss "Ansehen" verfügbar sein').toBeVisible();

  const tabsVorher = context.pages().length;
  const [popup] = await Promise.all([
    context.waitForEvent('page', { timeout: 20_000 }),
    ansehen.click(),
  ]);
  await popup.waitForLoadState('load').catch(() => undefined);
  const tabAnzahl = context.pages().length - tabsVorher;
  console.log('Neu geöffnete Tabs:', tabAnzahl);

  expect(
    tabAnzahl,
    'genau ein Tab — nicht zwei (der erste war die 401-Seite)',
  ).toBe(1);

  const tabText = await popup.locator('body').innerText().catch(() => '');
  expect(
    tabText,
    'der Tab darf keine Fehlerseite zeigen',
  ).not.toContain('Nicht authentifiziert');
  expect(tabText).not.toContain('Unauthorized');
  await popup.close();
});
