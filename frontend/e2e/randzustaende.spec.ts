import { expect, test } from '@playwright/test';

/**
 * Randzustände der Fachseiten — die Klasse, die heute acht Produktionsbugs
 * hervorgebracht hat.
 *
 * Abgedeckt sind die Befunde aus der systematischen Prüfung vom
 * 2026-10-05, soweit sie echte Daten brauchen (nicht simuliert):
 *
 *  - Schema-Vertrag: `/bilanz/schema` und `/guv/schema` liefern ein FLACHES
 *    Array. Das Frontend erwartete die Objektform — Bilanz crashte mit
 *    englischem TypeError, GuV legte einen leeren Datensatz an.
 *  - Gesperrte Datensätze: Positionen/Titel waren editierbar, obwohl der
 *    PATCH sie weglässt → stiller Datenverlust bei gemeldetem Erfolg.
 *  - Ausfall ist nicht Leerzustand: `.catch(() => [])` machte jeden
 *    Serverfehler zu „gibt es noch nicht".
 *  - 401 führt zum Login statt in eine tote Sitzung.
 */
async function anmelden(page: import('@playwright/test').Page) {
  await page.goto('http://localhost:3001/de-DE/login');
  await page.getByLabel(/e-?mail/i).fill('steuerberater@kanzlei.de');
  await page.getByLabel(/passwort/i).fill('Demo123!');
  await page.getByRole('button', { name: /anmelden/i }).click();
  await page.waitForURL('**/de-DE/dashboard', { timeout: 30_000 });
}

async function mandantMitBilanz(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(async () => {
    const t = localStorage.getItem('accessToken');
    const l = (await (await fetch('/api/mandant', {
      headers: { Authorization: `Bearer ${t}` },
    })).json()) as Array<{ id: string }>;
    for (const m of l) {
      const b = (await (await fetch(`/api/bilanz?mandantId=${m.id}`, {
        headers: { Authorization: `Bearer ${t}`, 'x-mandant-id': m.id },
      })).json()) as unknown[];
      if (Array.isArray(b) && b.length > 0) return m.id;
    }
    return l[0]?.id ?? '';
  });
}

test('Neue Bilanz: Formular zeigt die HGB-Positionen (kein TypeError)', async ({ page }) => {
  await anmelden(page);
  const mid = await mandantMitBilanz(page);
  await page.evaluate((m) => localStorage.setItem('activeMandantId', m), mid);

  await page.goto('http://localhost:3001/de-DE/bilanz');
  await page.waitForTimeout(2000);
  await page.getByRole('button', { name: /neue bilanz/i }).first().click();
  await page.waitForTimeout(2500);

  const fehler = (await page.locator('.bg-red-50, [role=alert]').allInnerTexts())
    .map((t) => t.trim())
    .filter(Boolean);
  const zeilen = await page.locator('table tbody tr').count();

  console.log(`Neue Bilanz: ${zeilen} Positionszeilen, Fehlerband ${JSON.stringify(fehler)}`);
  expect(fehler, 'kein englischer TypeError in der deutschen Oberfläche').toHaveLength(0);
  expect(zeilen, 'die HGB-Positionen müssen erscheinen').toBeGreaterThan(40);
});

test('Neue GuV: Formular zeigt die GuV-Positionen (nicht leer)', async ({ page }) => {
  await anmelden(page);
  const mid = await mandantMitBilanz(page);
  await page.evaluate((m) => localStorage.setItem('activeMandantId', m), mid);

  await page.goto('http://localhost:3001/de-DE/guv');
  await page.waitForTimeout(2000);
  await page.getByRole('button', { name: /neue guv/i }).first().click();
  await page.waitForTimeout(2500);

  const zeilen = await page.locator('table tbody tr').count();
  console.log(`Neue GuV: ${zeilen} Positionszeilen`);
  expect(zeilen, 'eine leere GuV würde ohne Fehlermeldung gespeichert').toBeGreaterThan(15);
});

test('Gesperrte GuV: Betragsfelder sind deaktiviert (kein stiller Datenverlust)', async ({ page }) => {
  await anmelden(page);
  const ziel = await page.evaluate(async () => {
    const t = localStorage.getItem('accessToken');
    const l = (await (await fetch('/api/mandant', {
      headers: { Authorization: `Bearer ${t}` },
    })).json()) as Array<{ id: string }>;
    for (const m of l) {
      const g = (await (await fetch(`/api/guv?mandantId=${m.id}`, {
        headers: { Authorization: `Bearer ${t}`, 'x-mandant-id': m.id },
      })).json()) as Array<{ id: string; geschaeftsjahr: number; status: string }>;
      // Nur einen gesperrten GuV MIT Positionen nehmen: ohne Positionen
      // gibt es keine Betragsfelder, und der Test liefe leerlich grün
      // (im Bestand existiert ein VALIDATED GuV mit 0 Positionen).
      for (const x of g) {
        if (x.status === 'DRAFT') continue;
        const d = (await (await fetch(`/api/guv/${x.id}?mandantId=${m.id}`, {
          headers: { Authorization: `Bearer ${t}`, 'x-mandant-id': m.id },
        })).json()) as { positionen?: unknown[] };
        if ((d.positionen?.length ?? 0) > 0) {
          return { mandantId: m.id, jahr: x.geschaeftsjahr, positionen: d.positionen!.length };
        }
      }
    }
    return null;
  });
  test.skip(ziel === null, 'kein gesperrter GuV im Datenbestand');
  await page.evaluate((m) => localStorage.setItem('activeMandantId', m), ziel!.mandantId);

  await page.goto('http://localhost:3001/de-DE/guv');
  await page.waitForTimeout(2000);
  // Gezielt die Zeile des gesperrten GuV öffnen. `Bearbeiten` ohne
  // Einschränkung öffnete den ersten Eintrag (meist DRAFT) und der Test
  // lief ins Leere, ohne den Sperrpfad zu beruehren.
  const zeile = page.locator('tr', { hasText: String(ziel!.jahr) }).first();
  await zeile.getByRole('button', { name: 'Bearbeiten' }).first().click();
  await page.waitForTimeout(2500);

  const gesperrt = await page.getByTestId('guv-positionen-gesperrt').count();
  expect(
    gesperrt,
    'der geoeffnete GuV muss gesperrt sein — sonst prueft der Test nichts',
  ).toBeGreaterThan(0);
  const gesamtFelder = await page.locator('table tbody input[type=number]').count();
  expect(
    gesamtFelder,
    'der gesperrte GuV muss Betragsfelder anzeigen — sonst prüft der Test nichts',
  ).toBeGreaterThan(0);
  const aktiveFelder = await page
    .locator('table tbody input[type=number]:not([disabled])')
    .count();
  console.log(
    `Gesperrter GuV (${ziel!.positionen} Positionen): ${gesamtFelder} Betragsfelder, davon ${aktiveFelder} editierbar`,
  );
  expect(
    aktiveFelder,
    'gesperrte Positionen dürfen nicht editierbar sein — die Änderung würde verworfen',
  ).toBe(0);
});

test('401 führt zum Login statt in eine tote Sitzung', async ({ page }) => {
  await page.goto('http://localhost:3001/de-DE/login');
  // Absichtlich ungültiges Token setzen, dann eine Fachseite aufrufen
  await page.evaluate(() => localStorage.setItem('accessToken', 'ungültig-abgelaufen'));
  await page.goto('http://localhost:3001/de-DE/guv');
  await page.waitForTimeout(3500);
  const url = page.url();
  console.log('URL nach 401:', url);
  expect(url, 'der Benutzer muss zum Login geführt werden').toContain('/login');
});
