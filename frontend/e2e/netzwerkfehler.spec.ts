import { expect, test } from '@playwright/test';

test('Netzwerkfehler erscheint auf Deutsch, nicht als "Failed to fetch"', async ({ page }) => {
  await page.goto('http://localhost:3001/de-DE/login');
  await page.getByLabel(/e-?mail/i).fill('steuerberater@kanzlei.de');
  await page.getByLabel(/passwort/i).fill('Demo123!');
  // JEDEN /api-Aufruf abbrechen → simuliert Serverausfall
  await page.route('**/api/**', (route) => route.abort('connectionfailed'));
  await page.getByRole('button', { name: /anmelden/i }).click();
  await page.waitForTimeout(3000);
  const body = await page.locator('body').innerText();
  const sichtbar = /verbindung|server/i.test(body);
  console.log('SEITE:', body.replace(/\n+/g, ' | ').slice(0, 220));
  console.log('DEUTSCHE MELDUNG SICHTBAR:', sichtbar);
  console.log('ROHE MELDUNG "Failed to fetch":', body.includes('Failed to fetch'));
  expect(body, 'es darf keine englische Browser-Meldung erscheinen').not.toContain('Failed to fetch');
  expect(sichtbar, 'der Benutzer braucht eine verständliche Meldung').toBe(true);
});
