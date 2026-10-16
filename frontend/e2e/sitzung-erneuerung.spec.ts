import { expect, test, type Page } from '@playwright/test';

/**
 * Sitzung überlebt das Ablaufen des Access-Tokens.
 *
 * BEFUND 2026-10-16: `POST /api/auth/refresh` existierte im Backend und
 * wurde von **keiner** Stelle der Oberfläche aufgerufen. Gemessen:
 * `expiresIn: 900`. Der Benutzer wurde also alle 15 Minuten zum Login
 * geschickt — mitten in einer Abschlussarbeit. Der 401-Zweig behauptete
 * zudem, der Refresh-Mechanismus nutze ein `refreshToken`-Cookie; **das
 * gibt es nicht**, der Token liegt in `localStorage`.
 *
 * Der Test bildet die Lage nach, die vorher als "Sitzung abgelaufen"
 * behandelt wurde: **gültiger Refresh-Token, ungültiger Access-Token**.
 * Erwartet wird, dass die Fachseite ohne erneute Anmeldung geladen wird.
 */

async function anmelden(page: Page, email: string) {
  await page.goto('http://localhost:3001/de-DE/login');
  await page.getByLabel(/e-?mail/i).fill(email);
  await page.getByLabel(/passwort/i).fill('Demo123!');
  await page.getByRole('button', { name: /anmelden/i }).click();
  await page.waitForURL('**/de-DE/dashboard', { timeout: 30_000 });
}

test('Sitzung wird beim 401 erneuert statt den Benutzer auszuloggen', async ({ page }) => {
  test.setTimeout(60_000);
  await anmelden(page, 'steuerberater@kanzlei.de');

  // Der Refresh-Token ist da (aus dem Login), der Access-Token wird
  // absichtlich unbrauchbar gemacht — das ist der 15-Minuten-Fall.
  const refreshVorhanden = await page.evaluate(() =>
    Boolean(localStorage.getItem('refreshToken')),
  );
  expect(refreshVorhanden, 'der Login muss einen Refresh-Token abgelegt haben').toBe(true);

  await page.evaluate(() =>
    localStorage.setItem('accessToken', 'abgelaufen-unbrauchbar'),
  );

  // Jetzt eine Fachseite aufrufen. Ohne die Erneuerung landet man hier im
  // Login; mit ihr bleibt die Sitzung bestehen.
  await page.goto('http://localhost:3001/de-DE/bilanz');
  await page.waitForTimeout(4000);

  await expect(
    page,
    'die Sitzung hätte erneuert werden müssen — stattdessen Redirect zum Login',
  ).not.toHaveURL(/\/login/);

  const neuerToken = await page.evaluate(() => localStorage.getItem('accessToken'));
  expect(
    neuerToken,
    'der Access-Token muss durch einen neuen ersetzt worden sein',
  ).not.toBe('abgelaufen-unbrauchbar');

  // Und die Sitzung muss wirklich BENUTZBAR sein — nicht nur "nicht umgeleitet".
  // Der erste Entwurf prüfte auf eine Tabelle und scheiterte: der
  // Vorauswahl-Mandant (nach der zugesagten Sortierung "Beispiel GmbH") hat
  // keine Bilanz, die Liste ist also leer. Die Behauptung war falsch, nicht
  // der Fix.
  //
  // Belastbar ist: ein echter Fachabruf mit dem NEUEN Token gelingt.
  const fachabruf = await page.evaluate(async () => {
    const t = localStorage.getItem('accessToken');
    const mid = localStorage.getItem('activeMandantId') ?? '';
    const r = await fetch(`/api/mandant?mandantId=${mid}`, {
      headers: { Authorization: `Bearer ${t}`, 'x-mandant-id': mid },
    });
    return r.status;
  });
  expect(
    fachabruf,
    'mit dem erneuerten Token muss ein Fachabruf gelingen',
  ).toBe(200);
});

test('ohne Refresh-Token führt ein 401 weiterhin zum Login', async ({ page }) => {
  test.setTimeout(60_000);
  await anmelden(page, 'steuerberater@kanzlei.de');

  // Gegenprobe: Der Refresh-Mechanismus darf NICHT jede 401-Umleitung
  // verschlucken. Wer eine ungültige Sitzung ohne Refresh-Token hat, muss
  // weiterhin herausfallen.
  await page.evaluate(() => {
    localStorage.setItem('accessToken', 'ungueltig');
    localStorage.removeItem('refreshToken');
  });

  await page.goto('http://localhost:3001/de-DE/bilanz');
  await page.waitForTimeout(3500);

  await expect(
    page,
    'ohne Refresh-Token muss der Benutzer zum Login gefuehrt werden',
  ).toHaveURL(/\/login/);
});
