import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Signaturziel: Die qeS-Signatur muss auf die EntityType der gerade
 * angezeigten Seite gehen — nicht auf die erste vorhandene ID.
 *
 * Bugfix 2026-10-05: `P12UploadDialog` leitete das Ziel aus einer
 * Prioritaetskette ab (abschluss → anhang → guv → bilanz). `BilanzForm`
 * uebergibt neben der Bilanz auch `guvId` und `anhangId` — fuer den
 * DATEV-Export derselben Jahresabschluss-Strecke. Ein Klick auf
 * "PDF signieren" haette damit die **GuV** signiert, waehrend der Anwender
 * die Bilanz vor sich hat. Bei einer Signatur nach § 126 AO ist das kein
 * Anzeigefehler, sondern ein falsch signiertes Dokument.
 *
 * Der Test geht daher alle drei Routen einzeln an und prueft, dass die
 * aufgerufene URL zur Seite passt.
 */
const P12_PATH = join(
  process.cwd(),
  '..',
  'backend',
  'tmp',
  'test-certs',
  'test-token.p12',
);
const P12_PASSWORD = 'Test1234!';

async function anmelden(page: Page) {
  await page.goto('http://localhost:3001/de-DE/login');
  await page.getByLabel(/e-?mail/i).fill('steuerberater@kanzlei.de');
  await page.getByLabel(/passwort/i).fill('Demo123!');
  await page.getByRole('button', { name: /anmelden/i }).click();
  await page.waitForURL('**/de-DE/dashboard', { timeout: 30_000 });
}

function aufzeichnung(page: Page) {
  const aufrufe: Array<{ methode: string; url: string; status: number }> = [];
  page.on('response', (r) => {
    if (r.url().includes('/api/')) {
      aufrufe.push({
        methode: r.request().method(),
        url: r.url().replace(/^https?:\/\/[^/]+/, '').split('?')[0],
        status: r.status(),
      });
    }
  });
  return aufrufe;
}

const FAELLE = [
  { seite: 'bilanz', route: '/api/signatur/sign-bilanz' },
  { seite: 'guv', route: '/api/signatur/sign-guv' },
  { seite: 'anhang', route: '/api/signatur/sign-anhang' },
] as const;

for (const { seite, route } of FAELLE) {
  test(`Signatur auf der ${seite}-Seite trifft ${route}`, async ({ page }) => {
    await anmelden(page);
    const aufrufe = aufzeichnung(page);
    const p12 = readFileSync(P12_PATH);

    // Mandant wählen, der für diese Ressource Bestand hat
    const mid = await page.evaluate(async (res: string) => {
      const t = localStorage.getItem('accessToken');
      const liste = (await (await fetch('/api/mandant', {
        headers: { Authorization: `Bearer ${t}` },
      })).json()) as Array<{ id: string }>;
      for (const m of liste) {
        const b = (await (await fetch(`/api/${res}?mandantId=${m.id}`, {
          headers: { Authorization: `Bearer ${t}`, 'x-mandant-id': m.id },
        })).json()) as unknown[];
        if (Array.isArray(b) && b.length > 0) return m.id;
      }
      return liste[0]?.id ?? '';
    }, seite);
    await page.evaluate((m) => localStorage.setItem('activeMandantId', m), mid);

    await page.goto(`http://localhost:3001/de-DE/${seite}`);
    await page.waitForTimeout(2500);

    const signatur = page
      .locator('button', { hasText: /^PDF signieren$/ })
      .first();
    await expect(
      signatur,
      `${seite}: es muss eine Signatur-Aktion geben`,
    ).toBeVisible();
    await signatur.click();
    await page.waitForTimeout(1500);

    const dialog = page.locator('div.fixed.inset-0').last();
    await dialog.locator('input[type=file]').setInputFiles({
      name: 'test-token.p12',
      mimeType: 'application/x-pkcs12',
      buffer: p12,
    });
    await page.waitForTimeout(1000);

    const pw = dialog.locator('input[type=password]').first();
    if (await pw.isVisible().catch(() => false)) await pw.fill(P12_PASSWORD);

    const pruefen = dialog.getByRole('button', { name: /token prüfen/i }).first();
    await expect(pruefen, 'der Dialog muss den Token prüfen').toBeVisible();
    await pruefen.click();
    await page.waitForTimeout(2500);

    const sign = dialog
      .locator('button', { hasText: /^PDF signieren$/ })
      .first();
    await expect(sign, 'nach der Token-Prüfung muss der Signatur-Knopf da sein').toBeVisible();

    const antwort = page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().includes('/signatur/sign-'),
      { timeout: 40_000 },
    );
    await sign.click();
    const resp = await antwort;
    const body = (await resp.json().catch(() => ({}))) as { message?: string };
    const aufgerufen = resp.url().replace('http://localhost:3001', '');
    console.log(`${seite} →`, aufgerufen, resp.status());

    // Der Kern der Regression: die Route muss zur Seite passen.
    expect(
      aufgerufen,
      `die ${seite}-Seite muss ${route} aufrufen`,
    ).toBe(route);
    expect(resp.status(), `Signieren schlug fehl: ${body.message ?? ''}`).toBeLessThan(400);

    const schreibzugriffe = aufrufe.filter((a) => a.methode !== 'GET');
    for (const a of schreibzugriffe) {
      expect(a.status, `${a.methode} ${a.url} → ${a.status}`).toBeLessThan(400);
    }
  });
}
