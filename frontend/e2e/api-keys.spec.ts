import { expect, test, type Page } from '@playwright/test';

/**
 * API-Schlüssel: anlegen → widerrufen.
 *
 * Zwei Schreibpfade, bisher nur rendergeprüft. Der Anlegepfad ist mehrstufig:
 * Er ermittelt die kanzleiId erst über `/mandant` + `/mandant/:id` (Pilot-
 * Annahme: erster Mandant) und sendet dann erst den Schlüssel. Ein Fehler
 * in dieser Kette fällt auf, wenn man sie klickt, nicht wenn man sie liest.
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

test('API-Schlüssel anlegen und widerrufen', async ({ page }) => {
  await anmelden(page);
  const aufrufe = aufzeichnung(page);
  await page.goto('http://localhost:3001/de-DE/api-keys');
  await page.waitForTimeout(2500);

  await page.getByRole('button', { name: '+ Neuen API-Schlüssel' }).click();
  await page.waitForTimeout(1200);

  await page.getByLabel('Name').fill(`E2E-Testschlüssel ${Date.now()}`);
  // Mindestens ein Scope ist Pflicht (handleSubmit prüft scopes.length === 0).
  // Die Beschriftung der Checkbox ist der Scope-Key selbst (`mandant:read`),
  // NICHT der übersetzte Text aus den Nachrichten — `apiKeys.scopes` wird im
  // Formular nicht verwendet (ApiKeysView:351 rendert <code>{s}</code>).
  await page.locator('main input[type=checkbox]').first().check();
  await page.waitForTimeout(300);

  const post = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().endsWith('/api-keys'),
    { timeout: 20_000 },
  );
  await page.getByRole('button', { name: /erstellen|anlegen|api-schlüssel/i }).last().click();
  const resp = await post;
  const body = (await resp.json().catch(() => ({}))) as { message?: string; key?: string };
  console.log('POST /api-keys →', resp.status(), Object.keys(body).join(','));
  expect(resp.status(), `Anlegen schlug fehl: ${body.message ?? ''}`).toBeLessThan(400);
  await page.waitForTimeout(2000);

  // Der Schlüssel wird genau einmal angezeigt (Token-Anzeige) — danach
  // verschwindet der Klartext. Das prüfen wir, bevor wir weiterklicken.
  const seite = await page.locator('main').first().innerText();
  console.log('SEITE NACH ANLEGEN:', seite.replace(/\n+/g, ' | ').slice(0, 260));

  // BUGFIX 2026-10-07: Das Modal MUSS geschlossen werden.
  //
  // `ApiKeysView` laedt die Liste erst in `onClose` des
  // `PlaintextSecretModal` (`void loadKeys()`). Vorher wird gar keine
  // Tabelle gerendert — bei `keys.length === 0` steht dort
  // `apiKeys.empty`. Dieser Test hat das Modal nie geschlossen und
  // ist trotzdem oft genug durchgelaufen: In der Datenbank lag aus
  // einem VORHERIGEN Lauf noch ein Key, also war `keys.length > 0`
  // und die Tabelle samt „Widerrufen" stand schon da.
  //
  // Sobald die Suite die Datenbank zuruecksetzt (mein `globalSetup`),
  // gibt es keinen Rest-Key mehr — und der Test schlaegt zuverlaessig
  // fehl. Er war also nie gruen, sondern nur zufaellig gruen.
  const modalFertig = page.getByRole('button', { name: /verstanden|fertig|ok/i });
  await expect(
    modalFertig,
    'die Token-Anzeige muss sich schliessen lassen',
  ).toBeVisible();
  await modalFertig.click();

  // Jetzt erst existiert die Liste.
  await expect(
    page.getByRole('button', { name: 'Widerrufen' }).first(),
    'nach dem Schliessen der Token-Anzeige muss die Liste erscheinen',
  ).toBeVisible({ timeout: 15_000 });

  // --- Widerrufen
  const widerrufen = page.getByRole('button', { name: 'Widerrufen' }).first();
  await expect(widerrufen, 'der neue Schlüssel muss eine Widerruf-Aktion haben').toBeVisible();

  page.once('dialog', (d) => void d.accept());
  const del = page.waitForResponse(
    (r) => r.request().method() === 'DELETE' && r.url().includes('/api-keys/'),
    { timeout: 20_000 },
  );
  await widerrufen.click();
  const delResp = await del;
  const delBody = (await delResp.json().catch(() => ({}))) as { message?: string };
  expect(delResp.status(), `Widerrufen schlug fehl: ${delBody.message ?? ''}`).toBeLessThan(400);
  await page.waitForTimeout(2000);

  const schreibzugriffe = aufrufe.filter((a) => a.methode !== 'GET');
  console.log('SCHREIBZUGRIFFE:', JSON.stringify(schreibzugriffe));
  for (const a of schreibzugriffe) {
    expect(a.status, `${a.methode} ${a.url} → ${a.status}`).toBeLessThan(400);
  }
  // Beide Pfade müssen wirklich gelaufen sein.
  const pfade = schreibzugriffe.map((a) => `${a.methode} ${a.url}`).join(' | ');
  expect(pfade).toContain('POST /api/api-keys');
  expect(pfade).toMatch(/DELETE \/api\/api-keys\//);
});
