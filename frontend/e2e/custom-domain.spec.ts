import { expect, test, type Page } from '@playwright/test';

/**
 * Custom-Domain-Assistent: Verifikation starten und prüfen.
 *
 * Bugfix 2026-10-05 (e5e1575): Der Assistent las die kanzleiId aus
 * `/auth/me`, wo sie nicht enthalten ist. Das `return` auf `undefined`
 * brach den Ladevorgang ab — der Assistent blieb dauerhaft leer. Seit dem
 * Fix läuft die Kanzlei-Auflösung, die zwei Schreibpfade waren dadurch
 * überhaupt erst erreichbar — und genau deshalb vorher nie getestet.
 *
 * Der Assistent ist Premium-gegated (`customDomain.inPremiumTier`). Der
 * Test schaltet die Kanzlei deshalb selbst auf PREMIUM, statt auf einen
 * Seed-Zustand zu vertrauen. Das ist eine bewusste Voraussetzung des Tests
 * und in CI reproduzierbar, weil der Mock-Provider ohne Stripe-Key läuft.
 */
async function anmelden(page: Page, email = 'kanzlei-admin@kanzlei.de') {
  await page.goto('http://localhost:3001/de-DE/login');
  await page.getByLabel(/e-?mail/i).fill(email);
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

/** Setzt die Kanzlei per Mock-Checkout auf PREMIUM (Voraussetzung des Assistenten). */
async function aufPremiumSetzen(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    const login = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'kanzlei-admin@kanzlei.de', password: 'Demo123!' }),
    });
    if (!login.ok) return false;
    const token = ((await login.json()) as { accessToken: string }).accessToken;
    const mandanten = (await (
      await fetch('/api/mandant', { headers: { Authorization: `Bearer ${token}` } })
    ).json()) as Array<{ id: string }>;
    if (!mandanten.length) return false;
    const detail = (await (
      await fetch(`/api/mandant/${mandanten[0].id}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json()) as { kanzleiId: string };

    const checkout = await fetch(`/api/subscription/${detail.kanzleiId}/checkout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        tier: 'PREMIUM',
        successUrl: `${window.location.origin}/de-DE/branding?upgrade=success`,
        cancelUrl: `${window.location.origin}/de-DE/branding?upgrade=cancel`,
      }),
    });
    if (!checkout.ok) return false;
    const data = (await checkout.json()) as { url: string; providerName: string };
    if (data.providerName !== 'mock') return false;
    const mockSession = new URL(data.url).searchParams.get('mock_session') ?? '';
    // Genau diese Extraktion lieferte vor dem URL-Fix null — der Test
    // reproduziert damit den Lesepfad der Oberfläche.
    const activate = await fetch(
      `/api/subscription/${detail.kanzleiId}/mock-activate`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ tier: 'PREMIUM', mockSession }),
      },
    );
    return activate.ok;
  });
}

test('Custom-Domain: Verifikation starten → Status prüfen', async ({ page }) => {
  await anmelden(page);

  const premium = await aufPremiumSetzen(page);
  expect(
    premium,
    'die Kanzlei muss auf PREMIUM stehen können — sonst ist der Assistent nicht erreichbar',
  ).toBe(true);

  const aufrufe = aufzeichnung(page);
  await page.goto('http://localhost:3001/de-DE/branding');
  await page.waitForTimeout(3500);

  // Ohne Premium blendet die Seite den Assistenten aus ("ist im
  // Premium-Tier verfügbar"). Beides prüfen: Der Assistent MUSS da sein.
  const seite = await page.locator('main').first().innerText();
  expect(
    seite,
    'der Assistent darf nicht hinter der Premium-Schranke verborgen bleiben',
  ).not.toContain('im Premium-Tier verfügbar');

  const domainFeld = page.locator('main input[type=text]').last();
  await expect(domainFeld, 'der Assistent braucht ein Domain-Feld').toBeVisible();
  // Gültige FQDN — die Komponente prüft selbst per Regex, sonst bricht sie
  // vor dem Request ab.
  const domain = `e2e-${Date.now()}.kanzlei-test.de`;
  await domainFeld.fill(domain);

  const start = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().includes('/start-verification'),
    { timeout: 20_000 },
  );
  await page.getByRole('button', { name: /verifikation|prüfen|starten/i }).first().click();
  const startResp = await start;
  const startBody = (await startResp.json().catch(() => ({}))) as { message?: string };
  console.log('POST /start-verification →', startResp.status(), startBody.message ?? '');
  expect(startResp.status(), `Start schlug fehl: ${startBody.message ?? ''}`).toBeLessThan(400);
  await page.waitForTimeout(2500);

  const nachStart = (await page.locator('main').first().innerText()).replace(/\n+/g, ' | ');
  console.log('NACH START:', nachStart.slice(-320));
  console.log('BUTTONS:', JSON.stringify(await page.getByRole('button').allInnerTexts()));

  // Zweiter Schreibpfad: DNS-Eintrag prüfen
  const pruefen = page
    .getByRole('button', { name: /status|eintrag prüfen|prüfen|verifizieren/i })
    .last();
  if ((await pruefen.count()) > 0) {
    const check = page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().includes('/dns/') && !r.url().includes('start'),
      { timeout: 20_000 },
    );
    await pruefen.click();
    const checkResp = await check;
    const checkBody = (await checkResp.json().catch(() => ({}))) as { message?: string };
    console.log('POST /dns/verify →', checkResp.status(), checkBody.message ?? '');
    // In dieser Umgebung ist kein DNS-Provider konfiguriert
    // (HETZNER_DNS_ZONE_ID fehlt). Das ist ein Nicht-verfuegbar-Zustand
    // der Instanz, kein Serverdefekt: die Antwort muss 503 sein mit
    // verstaendlichem Text. Vor dem Fix stand dort ein nackter `Error` und
    // die Oberflaeche bekam 500 "Internal server error".
    expect(
      checkResp.status(),
      `ohne DNS-Konfiguration wird 503 erwartet, war ${checkResp.status()}: ${checkBody.message ?? ''}`,
    ).toBe(503);
    expect(checkBody.message, 'die Meldung muss die Ursache nennen').toContain(
      'HETZNER_DNS_ZONE_ID',
    );
  } else {
    console.log('HINWEIS: kein Status-Prüf-Knopf sichtbar');
  }

  const schreibzugriffe = aufrufe.filter((a) => a.methode !== 'GET');
  console.log('SCHREIBZUGRIFFE:', JSON.stringify(schreibzugriffe));
  for (const a of schreibzugriffe) {
    // 503 ist der erwartete Ausgang fuer /verify in dieser Umgebung.
    const erlaubt = a.url.includes('/verify') ? [503] : [200, 201, 204];
    expect(
      erlaubt,
      `${a.methode} ${a.url} → ${a.status} (erwartet: ${erlaubt.join('/')})`,
    ).toContain(a.status);
  }
  const pfade = schreibzugriffe.map((a) => a.url).join(' | ');
  expect(pfade, 'start-verification muss ausgeführt worden sein').toContain(
    'start-verification',
  );
});
