import { expect, test, type Page } from '@playwright/test';

/**
 * Mandant-Stammdaten: anlegen → löschen, beide nur für KANZLEI_ADMIN.
 *
 * Zwei Schreibpfade, bisher ausschließlich rendernd geprüft. Der
 * Löschpfad ist heikel: er löscht Stammdaten, deshalb prüft der Test
 * zusätzlich, dass der Dialog wirklich bestätigt werden muss — ein
 * `window.confirm`, das stillschweigend mit „Abbrechen" beantwortet wird,
 * würde den Test grün melden, ohne dass etwas gelöscht wurde.
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

/** Formular vollständig ausfüllen — Pflichtfelder laut CreateMandantDto. */
async function mandantAnlegen(page: Page, firmenname: string) {
  await page.getByLabel(/firmenname/i).fill(firmenname);
  await page.getByLabel(/straße|strasse/i).fill('Teststraße 1');
  await page.getByLabel(/plz|postleitzahl/i).fill('80331');
  await page.getByLabel(/ort/i).fill('München');
  // Geschäftsführer ist Pflicht ("mindestens ein Geschäftsführer
  // erforderlich"). Das Feld heisst "Name *" und steht im Abschnitt
  // Geschäftsführer.
  //
  // NICHT `getByLabel('Name *')`: Playwright matcht Teilstrings, und
  // "Firmenname *" enthält ebenfalls "Name *" — `.first()` traf dadurch das
  // Firmenname-Feld, die Geschäftsführer-Liste blieb leer und der Server
  // antwortete 400. Selektiert wird über die ID, die eindeutig ist.
  const gfName = page.locator('#gf-name-0');
  await expect(gfName, 'das Geschäftsführer-Feld muss vorhanden sein').toBeVisible();
  await gfName.fill('E2E Geschäftsführer');

  const post = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().endsWith('/api/mandant'),
    { timeout: 20_000 },
  );
  await page.getByRole('button', { name: 'Mandant anlegen' }).click();
  return post;
}

test('Mandant: anlegen → löschen (mit Bestätigungsdialog)', async ({ page }) => {
  await anmelden(page);
  const aufrufe = aufzeichnung(page);
  await page.goto('http://localhost:3001/de-DE/mandant');
  await page.waitForTimeout(2500);

  // --- Anlegen
  const firmenname = `E2E Testmandant ${Date.now()}`;
  const post = await mandantAnlegen(page, firmenname);
  const body = (await post.json().catch(() => ({}))) as { message?: string; firmenname?: string };
  console.log('POST /mandant →', post.status(), body.message ?? body.firmenname ?? '');
  expect(post.status(), `Anlegen schlug fehl: ${body.message ?? ''}`).toBeLessThan(400);
  expect(body.firmenname, 'der neue Mandant muss zurückkommen').toBeTruthy();
  await page.waitForTimeout(2500);

  // --- Löschen
  //
  // Selektor: die Zeile ist ein <tr>. `page.locator('tr, li, div', {hasText})`
  // mit `.last()` traf ein INNERES div der Zeile — darin gibt es keinen
  // Knopf, der Test scheiterte an "Lösch-Aktion nicht gefunden".
  const zeile = page.locator('tr', { hasText: firmenname }).first();
  const loeschen = zeile.getByRole('button', { name: /löschen|delete/i }).first();
  await expect(loeschen, `der neue Mandant braucht eine Lösch-Aktion`).toBeVisible();

  // Dialog bewusst ablehnen und prüfen, dass NICHTS gelöscht wurde —
  // sonst könnte ein stillschweigend abgelehnter confirm als Erfolg
  // durchgehen.
  let dialogBestaetigt = false;
  page.once('dialog', (d) => {
    dialogBestaetigt = true;
    void d.dismiss();
  });
  await loeschen.click();
  await page.waitForTimeout(2000);
  console.log('DIALOG abgelehnt, bestätigt:', dialogBestaetigt);
  expect(dialogBestaetigt, 'das Löschen muss einen Bestätigungsdialog zeigen').toBe(true);
  expect(
    await page.locator('body').innerText(),
    'nach dem Abbrechen darf der Mandant nicht verschwunden sein',
  ).toContain(firmenname);

  // Jetzt wirklich löschen
  const del = page.waitForResponse(
    (r) => r.request().method() === 'DELETE' && r.url().includes('/api/mandant/'),
    { timeout: 20_000 },
  );
  page.once('dialog', (d) => void d.accept());
  const loeschen2 = zeile.getByRole('button', { name: /löschen|delete/i }).first();
  await loeschen2.click();
  const delResp = await del;
  const delBody = (await delResp.json().catch(() => ({}))) as { message?: string };
  console.log('DELETE /mandant/:id →', delResp.status(), delBody.message ?? '');
  expect(delResp.status(), `Löschen schlug fehl: ${delBody.message ?? ''}`).toBeLessThan(400);
  await page.waitForTimeout(2000);

  expect(
    await page.locator('body').innerText(),
    'der Mandant muss nach dem Löschen verschwunden sein',
  ).not.toContain(firmenname);

  const schreibzugriffe = aufrufe.filter((a) => a.methode !== 'GET');
  console.log('SCHREIBZUGRIFFE:', JSON.stringify(schreibzugriffe));
});

test('Mandant: STEUERBERATER darf nicht anlegen', async ({ page }) => {
  await anmelden(page, 'steuerberater@kanzlei.de');
  const aufrufe = aufzeichnung(page);
  await page.goto('http://localhost:3001/de-DE/mandant');
  await page.waitForTimeout(2500);

  const anlegen = page.getByRole('button', { name: /neuer mandant|mandant anlegen|anlegen/i }).first();
  const anzahl = await anlegen.count();
  console.log('Anlege-Knopf für STEUERBERATER sichtbar:', anzahl);
  if (anzahl > 0) {
    await page.getByLabel(/firmenname/i).fill('Sollte scheitern');
    const post = await mandantAnlegen(page, `Sollte scheitern ${Date.now()}`);
    const body = (await post.json().catch(() => ({}))) as { message?: string };
    console.log('POST als STEUERBERATER →', post.status(), body.message ?? '');
    // Ein abgelehnter Schreibversuch ist hier das GEWOLLTE Ergebnis, kein
    // Fehler: entscheidend ist der Statuscode, nicht dass gar nichts
    // gesendet wurde.
    expect(post.status(), 'STEUERBERATER darf keinen Mandanten anlegen').toBe(403);
  } else {
    console.log('HINWEIS: für STEUERBERATER ist kein Anlege-Knopf sichtbar — Sperre greift in der UI');
  }
  // Es darf auf keinen Fall einen erfolgreichen Schreibvorgang gegeben haben.
  for (const a of aufrufe.filter((x) => x.methode !== 'GET')) {
    expect(a.status, `${a.methode} ${a.url} → ${a.status}`).toBeGreaterThanOrEqual(400);
  }
});
