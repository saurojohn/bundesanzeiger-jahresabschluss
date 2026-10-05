import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Qualifizierte Signatur: P12-Token prüfen und eine Bilanz signieren.
 *
 * Zwei Schreibpfade, bisher ungetestet: `POST /signatur/inspect-p12` und
 * `POST /signatur/sign-bilanz`. Die Signatur ist der GoBD-rechtliche Kern
 * (qeS nach § 126 AO) — ein Fehler hier ist kein Kosmetikproblem.
 *
 * Verwendet das Test-Zertifikat aus `backend/tmp/test-certs/`
 * (erzeugbar über `backend/scripts-gen-test-p12.ts`).
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

test('Signatur: P12 prüfen und Bilanz signieren', async ({ page }) => {
  const p12 = readFileSync(P12_PATH);
  await anmelden(page);
  const aufrufe = aufzeichnung(page);

  // Mandant mit Bilanz-Bestand wählen
  const mid = await page.evaluate(async () => {
    const t = localStorage.getItem('accessToken');
    const liste = (await (await fetch('/api/mandant', {
      headers: { Authorization: `Bearer ${t}` },
    })).json()) as Array<{ id: string }>;
    for (const m of liste) {
      const b = (await (await fetch(`/api/bilanz?mandantId=${m.id}`, {
        headers: { Authorization: `Bearer ${t}`, 'x-mandant-id': m.id },
      })).json()) as unknown[];
      if (Array.isArray(b) && b.length > 0) return m.id;
    }
    return liste[0]?.id ?? '';
  });
  await page.evaluate((m) => localStorage.setItem('activeMandantId', m), mid);
  await page.goto('http://localhost:3001/de-DE/bilanz');
  await page.waitForTimeout(2500);

  // Bestimmte Zeile oeffnen, nicht die erste: der Vorauswahl-Mandant kann
  // leere Listen haben, dann gibt es gar keinen "Bearbeiten"-Knopf und der
  // Klick lief in einen 30-s-Timeout.
  const zielZeile = page
    .locator('tr', { has: page.getByRole('button', { name: 'Bearbeiten' }) })
    .first();
  await expect(zielZeile, 'es muss eine Bilanz zum Bearbeiten geben').toBeVisible();

  // Der Signatur-Knopf (`canSign`) sitzt NICHT in der Liste, sondern im
  // Bilanz-Formular und nur, wenn `bilanzId && savedBilanzId` gesetzt sind
  // (BilanzForm:408) — also nach dem Speichern eines bestehenden Satzes.
  await zielZeile.getByRole('button', { name: 'Bearbeiten' }).first().click();
  await page.waitForTimeout(2000);
  const speichern = page.getByRole('button', { name: /^Speichern$/ });
  if (await speichern.isVisible().catch(() => false)) {
    await speichern.click();
    await page.waitForTimeout(2500);
  }

  const signatur = page.getByRole('button', { name: /signieren|signatur/i }).first();
  const anzahl = await signatur.count();
  console.log('Signatur-Knöpfe:', anzahl);
  expect(anzahl, 'es muss eine Signatur-Aktion geben').toBeGreaterThan(0);
  await signatur.first().click();
  await page.waitForTimeout(1500);
  console.log('BUTTONS IM DIALOG:', JSON.stringify(await page.getByRole('button').allInnerTexts()));

  // P12 hochladen
  const dateiFeld = page.locator('input[type=file]').first();
  await expect(dateiFeld, 'der Dialog braucht einen Datei-Upload').toBeVisible();
  await dateiFeld.setInputFiles({
    name: 'test-token.p12',
    mimeType: 'application/x-pkcs12',
    buffer: p12,
  });
  await page.waitForTimeout(1200);

  // Passwort + Prüfen
  const pw = page.locator('input[type=password]').first();
  if (await pw.isVisible().catch(() => false)) {
    await pw.fill(P12_PASSWORD);
  }
  const pruefen = page.getByRole('button', { name: /prüfen|inspect|token.*prüf/i }).first();
  if ((await pruefen.count()) > 0) {
    const inspect = page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().includes('/signatur/inspect-p12'),
      { timeout: 20_000 },
    );
    await pruefen.click();
    const resp = await inspect;
    const body = (await resp.json().catch(() => ({}))) as { message?: string; subject?: string };
    console.log('POST /signatur/inspect-p12 →', resp.status(), JSON.stringify(body).slice(0, 160));
    expect(resp.status(), `Token-Prüfung schlug fehl: ${body.message ?? ''}`).toBeLessThan(400);
    await page.waitForTimeout(1500);
  } else {
    console.log('HINWEIS: kein "Prüfen"-Knopf — der Dialog prüft automatisch');
  }

  const nachPruefen = (await page.locator('body').innerText()).replace(/\n+/g, ' | ');
  console.log('NACH PRÜFEN (Auszug):', nachPruefen.slice(-300));
  console.log('BUTTONS:', JSON.stringify(await page.getByRole('button').allInnerTexts()));

  // Signieren — die Beschriftung ist `exports.signatur.sign` = "PDF signieren".
  //
  // WICHTIG: auf den Dialog einschränken. Die Listen-Zeilen tragen nach
  // meinem Fix dieselbe Beschriftung ("PDF signieren" = oeffnet den Dialog).
  // Ohne Eingrenzung klickte der Test den Listen-Knopf, der Dialog wurde
  // nicht zum Signieren angestossen, und `waitForResponse` lief in einen
  // 30-s-Timeout.
  const dialog = page.locator('div.fixed.inset-0').last();
  const signieren = dialog
    .locator('button', { hasText: /^PDF signieren$/ })
    .first();
  if ((await signieren.count()) > 0) {
    const sign = page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().includes('/signatur/sign-'),
      { timeout: 30_000 },
    );
    await signieren.click();
    const resp = await sign;
    const body = (await resp.json().catch(() => ({}))) as { message?: string };
    console.log('POST /signatur/sign-* →', resp.status(), resp.url(), body.message ?? '');
    expect(resp.status(), `Signieren schlug fehl: ${body.message ?? ''}`).toBeLessThan(400);
    await page.waitForTimeout(2000);
  } else {
    throw new Error(
      'kein "PDF signieren"-Knopf sichtbar — der Dialog hat das Token geprüft, ' +
        'bietet aber das Signieren nicht an',
    );
  }

  const schreibzugriffe = aufrufe.filter((a) => a.methode !== 'GET');
  console.log('SCHREIBZUGRIFFE:', JSON.stringify(schreibzugriffe));
  for (const a of schreibzugriffe) {
    expect(a.status, `${a.methode} ${a.url} → ${a.status}`).toBeLessThan(400);
  }
  const pfade = schreibzugriffe.map((a) => a.url).join(' | ');
  expect(pfade, 'inspect-p12 muss ausgeführt worden sein').toContain('inspect-p12');
});
