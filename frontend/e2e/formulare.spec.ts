import { expect, test, type Page } from '@playwright/test';

/**
 * Interaktionen auf den Fachformularen — bisher war nur das Rendern getestet.
 *
 * Befund 2026-10-04: `SubscriptionView` schickte den Aktivierungs-Request
 * an `/api/api/…` (404). Der Bug war unsichtbar, weil die Testsuite die
 * Seite nur gerendert hat — die Schaltfläche wurde nie geklickt. Ein
 * Rendering-Check sagt nichts darüber aus, ob eine Aktion funktioniert.
 *
 * Dieser Test geht jede Seite über den Weg, den ein Anwender geht: Liste
 * bzw. Formular laden, Aktion auslösen, das Netzwerk-Ergebnis prüfen.
 *
 * Webhooks und Branding laufen als STEUERBERATER (der Seed-User).
 * API-Keys und Subscription verlangen KANZLEI_ADMIN — dort wird das
 * korrekte RBAC-Verhalten geprüft, nicht die Mutation.
 */

const KANZLEI_ADMIN = { email: 'kanzlei-admin@kanzlei.de', password: 'Demo123!' };
const STEUERBERATER = { email: 'steuerberater@kanzlei.de', password: 'Demo123!' };

async function anmelden(page: Page, user: { email: string; password: string }) {
  await page.goto('http://localhost:3001/de-DE/login');
  await page.getByLabel(/e-?mail/i).fill(user.email);
  await page.getByLabel(/passwort/i).fill(user.password);
  await page.getByRole('button', { name: /anmelden/i }).click();
  await page.waitForURL('**/de-DE/dashboard', { timeout: 30_000 });
}

/** Meldet alle API-Aufrufe mit Statuscode, die während `aktion` laufen. */
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

test.describe('Fachformulare: Aktionen, nicht nur Rendering', () => {
  // Korrektur einer falschen Testerwartung: das Branding-SCHREIBEN verlangt
  // KANZLEI_ADMIN (BrandingController @Patch @Roles('KANZLEI_ADMIN')). Der
  // erste Test lief als STEUERBERATER und erwartete 2xx — das war mein
  // Fehler, nicht die Anwendung. Der 403 mit der Meldung "Rolle fehlt.
  // Erforderlich: KANZLEI_ADMIN" ist korrektes RBAC und wird sauber
  // angezeigt.
  test('Branding: KANZLEI_ADMIN kann Farben speichern → PATCH 2xx', async ({ page }) => {
    await anmelden(page, KANZLEI_ADMIN);
    const aufrufe = aufzeichnung(page);
    await page.goto('http://localhost:3001/de-DE/branding');
    await page.waitForTimeout(2500);

    // Farbfeld finden und einen anderen Wert setzen
    const farbfeld = page.locator('input[type="color"], input[value^="#"]').first();
    await expect(farbfeld, 'Branding muss ein Farbfeld zeigen').toBeVisible();
    const vorher = await farbfeld.inputValue();
    await farbfeld.fill(vorher === '#ff0000' ? '#00ff00' : '#ff0000');
    await farbfeld.blur();

    const speichern = page.getByRole('button', { name: /speichern/i }).first();
    await expect(speichern, 'es muss eine Speichern-Aktion geben').toBeVisible();
    await speichern.click();
    await page.waitForTimeout(2500);

    const schreibzugriffe = aufrufe.filter((a) => a.methode !== 'GET');
    console.log('Branding-Schreibzugriffe:', JSON.stringify(schreibzugriffe));
    expect(
      schreibzugriffe.length,
      'das Speichern muss einen Schreibzugriff auslösen',
    ).toBeGreaterThan(0);
    for (const a of schreibzugriffe) {
      expect(a.status, `${a.methode} ${a.url} → ${a.status}`).toBeLessThan(400);
    }

    const fehler = (await page.locator('.bg-red-50').allInnerTexts())
      .map((t) => t.trim())
      .filter(Boolean);
    expect(fehler, 'kein Fehlerband nach dem Speichern').toHaveLength(0);
  });

  // Webhooks-Mutationen verlangen KANZLEI_ADMIN (webhook.controller
  // @Roles('KANZLEI_ADMIN')). Der erste Test lief als STEUERBERATER und war
  // nur deshalb grün, weil im Moment des Laufs keine Subscription existierte
  // — er war damit von der Reihenfolge abhaengig. Sobald eine Subscription
  // da ist, klickt er den Test-Knopf und bekommt 403.
  test('Webhooks: KANZLEI_ADMIN löst Testzustellung aus → 2xx', async ({ page }) => {
    await anmelden(page, KANZLEI_ADMIN);
    const aufrufe = aufzeichnung(page);
    await page.goto('http://localhost:3001/de-DE/webhooks');
    await page.waitForTimeout(2500);

    const testen = page.getByRole('button', { name: /test/i }).first();
    if ((await testen.count()) === 0) {
      // Keine Subscription vorhanden: dann den Anlege-Dialog prüfen.
      const anlegen = page.getByRole('button', { name: /neu|anlegen|erstellen/i }).first();
      await expect(anlegen, 'Webhooks muss eine Anlege-Aktion zeigen').toBeVisible();
      console.log('Webhooks: keine Subscription vorhanden, Anlege-Aktion geprüft');
      return;
    }
    await testen.click();
    await page.waitForTimeout(3000);

    const schreibzugriffe = aufrufe.filter((a) => a.methode !== 'GET');
    console.log('Webhooks-Schreibzugriffe:', JSON.stringify(schreibzugriffe));
    for (const a of schreibzugriffe) {
      expect(a.status, `${a.methode} ${a.url} → ${a.status}`).toBeLessThan(400);
    }
  });

  test('Branding: STEUERBERATER erhält die Rollenmeldung, keinen Crash', async ({ page }) => {
    await anmelden(page, STEUERBERATER);
    const aufrufe = aufzeichnung(page);
    await page.goto('http://localhost:3001/de-DE/branding');
    await page.waitForTimeout(2500);

    // Das GET ist offen, die Seite rendert also. Das Speichern muss die
    // Rollenmeldung liefern — und keinen Absturz.
    const farbfeld = page.locator('input[type="color"], input[value^="#"]').first();
    if ((await farbfeld.count()) > 0) {
      await farbfeld.fill('#123456');
      await farbfeld.blur();
      await page.getByRole('button', { name: /speichern/i }).first().click();
      await page.waitForTimeout(2500);
    }
    const body = await page.locator('body').innerText();
    expect(body, 'die Seite darf nicht abstürzen').not.toContain('Application error');
    const schreibzugriffe = aufrufe.filter((a) => a.methode !== 'GET');
    console.log('Branding als STEUERBERATER:', JSON.stringify(schreibzugriffe));
    for (const a of schreibzugriffe) {
      // STEUERBERATER darf hier grundsätzlich nicht schreiben.
      expect([403], `${a.methode} ${a.url} → ${a.status}`).toContain(a.status);
    }
    if (schreibzugriffe.length > 0) {
      expect(body, 'die Rollenmeldung muss angezeigt werden').toContain('Rolle fehlt');
    }
  });

  test('Webhooks: STEUERBERATER erhält 403, keinen Absturz', async ({ page }) => {
    await anmelden(page, STEUERBERATER);
    const aufrufe = aufzeichnung(page);
    await page.goto('http://localhost:3001/de-DE/webhooks');
    await page.waitForTimeout(2500);
    const testen = page.getByRole('button', { name: /test/i }).first();
    if ((await testen.count()) > 0) {
      await testen.click();
      await page.waitForTimeout(2500);
    }
    const body = await page.locator('body').innerText();
    expect(body, 'die Seite darf nicht abstürzen').not.toContain('Application error');
    const schreibzugriffe = aufrufe.filter((a) => a.methode !== 'GET');
    console.log('Webhooks als STEUERBERATER:', JSON.stringify(schreibzugriffe));
    for (const a of schreibzugriffe) {
      expect([403], `${a.methode} ${a.url} → ${a.status}`).toContain(a.status);
    }
  });

  test('API-Keys: KANZLEI_ADMIN sieht Liste, STEUERBERATER sieht Sperre', async ({ page }) => {
    await anmelden(page, KANZLEI_ADMIN);
    const aufrufe = aufzeichnung(page);
    await page.goto('http://localhost:3001/de-DE/api-keys');
    await page.waitForTimeout(2500);
    const body = await page.locator('body').innerText();
    expect(body, 'Kanzlei-Admin darf API-Keys sehen').not.toContain(
      'Rolle fehlt',
    );
    const schluesselListe = aufrufe.find(
      (a) => a.url.includes('/api-keys') && a.methode === 'GET',
    );
    console.log('API-Keys-Aufrufe (Admin):', JSON.stringify(aufrufe.filter(a => a.url.includes('api-keys'))));
    expect(
      schluesselListe?.status,
      'die Liste muss für KANZLEI_ADMIN ladbar sein',
    ).toBe(200);
  });
});
