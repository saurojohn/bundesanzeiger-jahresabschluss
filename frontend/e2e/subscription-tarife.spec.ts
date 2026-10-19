import { expect, test, type Page } from '@playwright/test';

/**
 * Subscription-Seite: die Tarife müssen sichtbar sein.
 *
 * BEFUND 2026-10-19 (Nachtrag 50): `GET /api/subscription/tiers` ist die
 * **öffentliche Pricing-Seite** — der Controller-Kommentar sagt es
 * ausdrücklich („Pricing-Page (öffentlich)"). Der Dekorator `@Public()`
 * stand aber nicht da, und `JwtAuthGuard` läuft global.
 *
 * Gemessen: `GET /api/subscription/tiers` → **401**.
 *
 * Und das ist nicht nur ein toter Endpunkt: `SubscriptionView` ruft die
 * Route **innerhalb eines try-Blocks** auf. Der 401 bricht damit den
 * **gesamten** Ladevorgang ab — `setTiers` wird nie erreicht, und
 * `setSubscription` (das direkt danach folgt) auch nicht. Die Seite
 * zeigt also **weder Tarife noch den aktuellen Vertrag**, sondern nur
 * eine Fehlermeldung.
 *
 * Der bestehende `subscription.spec.ts` prüft den Checkout und den
 * Kündigen-Button — **die Tarife selbst prüft er nicht**. Deshalb blieb
 * der Defekt unbemerkt.
 */

const TARIFE = ['PILOT', 'STANDARD', 'PREMIUM'];

/** Anmeldung — ohne sie laeuft die Seite in die Anmeldemaske. */
async function anmelden(page: Page, email = 'kanzlei-admin@kanzlei.de') {
  await page.goto('http://localhost:3001/de-DE/login');
  await page.getByLabel(/e-?mail/i).fill(email);
  await page.getByLabel(/passwort/i).fill('Demo123!');
  await page.getByRole('button', { name: /anmelden/i }).click();
  await page.waitForURL('**/de-DE/dashboard', { timeout: 30_000 });
}

test.describe('Subscription: Tarife werden geladen', () => {
  test('die Pricing-Seite liefert die Tarife', async ({ page }) => {
    const antworten: Array<{ url: string; status: number }> = [];
    page.on('response', (r) => {
      const u = r.url();
      if (u.includes('/api/subscription/tiers')) {
        antworten.push({ url: u, status: r.status() });
      }
    });

    await anmelden(page);
    await page.goto('http://localhost:3001/de-DE/einstellungen/subscription');
    await page.waitForTimeout(3000);

    // Der Aufruf muss durchkommen — ohne Token ist die Route sowieso
    // nicht erreichbar, mit Token umso mehr.
    const aufruf = antworten[0];
    expect(
      aufruf,
      'die Seite hat /api/subscription/tiers gar nicht aufgerufen',
    ).toBeTruthy();
    expect(
      aufruf!.status,
      `GET /api/subscription/tiers -> ${aufruf!.status}. ` +
        'Ein 401 bricht im SubscriptionView den gesamten Ladevorgang ab: ' +
        'weder Tarife noch der aktuelle Vertrag werden angezeigt.',
    ).toBe(200);

    // Und die Tarife müssen auch wirklich dastehen.
    const text = await page.locator('main').first().innerText();
    const gefunden = TARIFE.filter((t) => text.includes(t));
    expect(
      gefunden,
      `die Seite zeigt keine Tarife. Sichtbarer Text war:\n${text.slice(0, 400)}`,
    ).not.toHaveLength(0);
  });
});
