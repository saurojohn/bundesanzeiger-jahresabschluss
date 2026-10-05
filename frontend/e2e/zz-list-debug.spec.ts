import { test } from '@playwright/test';
test('Mandant-Liste: Struktur', async ({ page }) => {
  await page.goto('http://localhost:3001/de-DE/login');
  await page.getByLabel(/e-?mail/i).fill('kanzlei-admin@kanzlei.de');
  await page.getByLabel(/passwort/i).fill('Demo123!');
  await page.getByRole('button', { name: /anmelden/i }).click();
  await page.waitForURL('**/de-DE/dashboard', { timeout: 30000 });
  await page.goto('http://localhost:3001/de-DE/mandant');
  await page.waitForTimeout(2500);
  const html = await page.locator('main').first().innerHTML();
  const i = html.indexOf('E2E Testmandant');
  console.log('MANDANT IM HTML?', i >= 0);
  if (i >= 0) console.log('AUSSCHNITT:', html.slice(Math.max(0, i - 400), i + 500).replace(/\s+/g, ' '));
  console.log('ALLE LÖSCHEN-BUTTONS:', await page.getByRole('button', { name: /löschen/i }).count());
});
