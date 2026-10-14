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
const P12_BASE64 = readFileSync(P12_PATH).toString('base64');

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

/**
 * ENTSCHEIDUNG 2026-10-14: Das Signieren sperrt nicht, aber die Oberflaeche
 * muss zeigen, wann die angezeigten Daten NICHT mehr der signierten Fassung
 * entsprechen.
 *
 * Abgrenzung: Der P12-Dialog ist im Test oberhalb bereits abgedeckt. Hier geht
 * es ausschliesslich um das BADGE — der erste Entwurf steuerte den ganzen
 * Dialog nach und behauptete danach "Signatur erfolgreich" gesehen zu
 * haben. Das war eine Fehldeutung: der Selektor traf den Dialog-Titel, es
 * wurde nie signiert, und die DB blieb bei 0 Signature-Records. Der Test
 * pruefte damit nichts.
 *
 * Der Zustand wird deshalb bewusst per API gesetzt. Geprueft wird, was diese
 * Aenderung in der Oberflaeche bewirkt — nicht ein zweites Mal der Dialog.
 */
test('Signatur-Status: Badge erscheint und warnt nach einer Aenderung', async ({ page }) => {
  test.setTimeout(90_000);
  await anmelden(page);

  // Mandant mit Bilanz-Bestand bestimmen (wie im Test oberhalb).
  const mid = await page.evaluate(async () => {
    const t = localStorage.getItem('accessToken');
    const liste = (await (await fetch('/api/mandant', {
      headers: { Authorization: `Bearer ${t}` },
    })).json()) as Array<{ id: string }>;
    for (const m of liste) {
      const b = (await (await fetch(`/api/bilanz?mandantId=${m.id}`, {
        headers: { Authorization: `Bearer ${t}`, 'x-mandant-id': m.id },
      })).json()) as Array<{ id: string }>;
      if (Array.isArray(b) && b.length > 0) return m.id;
    }
    return liste[0]?.id ?? '';
  });
  await page.evaluate((m) => localStorage.setItem('activeMandantId', m), mid);

  // Signatur per API setzen — aus dem Browser-Kontext, damit derselbe
  // Token und derselbe Mandanten-Kontext gelten wie in der Oberflaeche.
  const signiert = await page.evaluate(async ({ mandantId, p12B64, pw }) => {
    const t = localStorage.getItem('accessToken');
    const h = { Authorization: `Bearer ${t}`, 'content-type': 'application/json', 'x-mandant-id': mandantId };
    const liste = (await (await fetch(`/api/bilanz?mandantId=${mandantId}`, { headers: h })).json()) as Array<{ id: string }>;
    const bilanzId = liste[0]?.id;
    if (!bilanzId) return { ok: false, grund: 'keine Bilanz' };

    // Das P12 muss als Argument uebergeben werden: `page.evaluate` laeuft im
    // Browser-Kontext und sieht keine Node-Konstanten.
    const r = await fetch('/api/signatur/sign-bilanz', {
      method: 'POST',
      headers: h,
      body: JSON.stringify({ bilanzId, mandantId, p12Base64: p12B64, p12Password: pw }),
    });
    return { ok: r.ok, status: r.status, bilanzId };
  }, { mandantId: mid, p12B64: P12_BASE64, pw: P12_PASSWORD });
  expect(signiert.ok, `Signatur per API: ${JSON.stringify(signiert)}`).toBe(true);

  await page.goto('http://localhost:3001/de-DE/bilanz');
  await page.waitForTimeout(4000);

  // (1) Badge "Signiert"
  await expect(
    page.getByTestId('signatur-status-signiert').first(),
    'nach dem Signieren muss die Zeile als signiert gekennzeichnet sein',
  ).toBeVisible({ timeout: 20_000 });

  // (2) Aenderung -> Warnung
  const geaendert = await page.evaluate(async (mandantId) => {
    const t = localStorage.getItem('accessToken');
    const h = { Authorization: `Bearer ${t}`, 'content-type': 'application/json', 'x-mandant-id': mandantId };
    const liste = (await (await fetch(`/api/bilanz?mandantId=${mandantId}`, { headers: h })).json()) as Array<{ id: string }>;
    const r = await fetch(`/api/bilanz/${liste[0]!.id}?mandantId=${mandantId}`, {
      method: 'PATCH',
      headers: h,
      // `hinweise` (Plural) ist der Feldname im Update-DTO. Mit `hinweis`
      // antwortet die ValidationPipe korrekt mit 400 "property hinweis should
      // not exist" — ein erster Entwurf scheiterte genau daran.
      body: JSON.stringify({ hinweise: 'Geaendert nach der Signatur' }),
    });
    return r.status;
  }, mid);
  expect(geaendert, 'die Aenderung muss moeglich sein — Signieren sperrt nicht').toBe(200);

  await page.goto('http://localhost:3001/de-DE/bilanz');
  await page.waitForTimeout(4000);
  await expect(
    page.getByTestId('signatur-status-abweichend').first(),
    'nach der Aenderung muss die Zeile warnen: Daten ≠ signierte Fassung',
  ).toBeVisible({ timeout: 20_000 });
});
