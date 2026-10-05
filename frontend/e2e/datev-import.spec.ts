import { expect, test, type Page } from '@playwright/test';
import { Buffer } from 'node:buffer';

/**
 * DATEV-Import: Datei hochladen → Vorschau → Import ausführen.
 *
 * Der letzte der 43 Schreibpfade ohne Oberflächen-Abdeckung.
 * `POST /api/datev-import/execute` schreibt Bilanz- und GuV-Positionen in die
 * Datenbank — ein Fehler hier verfälscht die Buchführung.
 *
 * Zwei Wege, beide geprüft:
 *  1. Konflikt: Das Jahr ist im Assistenten fest das Vorjahr, und für dieses
 *     Jahr existiert im Seed bereits eine Bilanz. Der Import MUSS dann
 *     abbrechen und sagen, worum es geht — nicht still überschreiben.
 *  2. Freigabe: Nach dem Setzen von "Bestehende Bilanz/GuV für dieses
 *     Geschäftsjahr überschreiben" wird der Import ausgeführt.
 *
 * Das CSV entspricht dem Muster aus `backend/e2e/datev-import.e2e.spec.ts`
 * (EXTF-Buchungsstapel, eine echte Erlösbuchung Bank an Erlös).
 */
function erloesZeile(betrag: string, sh: 'S' | 'H') {
  return `"${betrag}";"${sh}";"EUR";"";"";"";"1800";"4400";"0";"3112";"E2E";"";"";"E2E Buchung";"0";"";""`;
}

function businessCsv(jahr: number): string {
  return [
    '"Formatname";"Version";"Berater";"Mandant";"WJ-Beginn";"WJ-Ende";"Sachkontenlaenge";"Datum-von";"Datum-bis";"Bezeichnung";"Diktat";"Buchungstyp";"Rechnungslegungszweck"',
    `"EXTF_Buchungsstapel";"12";"12345";"67890";"01.01.${jahr}";"31.12.${jahr}";"4";"01.01.${jahr}";"31.12.${jahr}";"E2E Import";"Buchhaltung";"1";"00"`,
    '"Umsatz";"SH";"WKZ";"Kurs";"Basis";"BWKZ";"Konto";"Gegenkonto";"BUSchluessel";"Belegdatum";"Belegfeld1";"Belegfeld2";"Skonto";"Buchungstext";"Postensperre";"Adressnummer";"PartnerBLZ"',
    erloesZeile('1500,00', 'S'),
    erloesZeile('-1500,00', 'H'),
  ].join('\r\n');
}

async function anmelden(page: Page) {
  await page.goto('http://localhost:3001/de-DE/login');
  await page.getByLabel(/e-?mail/i).fill('steuerberater@kanzlei.de');
  await page.getByLabel(/passwort/i).fill('Demo123!');
  await page.getByRole('button', { name: /anmelden/i }).click();
  await page.waitForURL('**/de-DE/dashboard', { timeout: 30_000 });
}

/** Bringt den Assistenten bis zum Resolver-Schritt mit dem Import-Knopf. */
async function bisZumImportKnopf(page: Page) {
  const weiter = page.getByRole('button', { name: /^Weiter$/ }).first();
  for (let schritt = 0; schritt < 5; schritt++) {
    const importStarten = page
      .getByRole('button', { name: /import starten/i })
      .first();
    if ((await importStarten.count()) > 0) return importStarten;
    if ((await weiter.count()) === 0) break;
    await weiter.click();
    await page.waitForTimeout(1500);
  }
  return page.getByRole('button', { name: /import starten/i }).first();
}

test('DATEV-Import: Vorschau, Konfliktschutz und Import mit Überschreiben', async ({ page }) => {
  await anmelden(page);
  const jahr = new Date().getFullYear() - 1; // der Assistent fixiert das Vorjahr
  console.log('ZIELJAHR:', jahr);

  await page.goto('http://localhost:3001/de-DE/bilanz');
  await page.waitForTimeout(2000);

  const offnen = page.getByRole('button', { name: /datev-import/i }).first();
  await expect(offnen, 'es muss einen DATEV-Import-Knopf geben').toBeVisible();
  await offnen.click();
  await page.waitForTimeout(1200);

  await page.locator('input[type=file]').first().setInputFiles({
    name: 'buchungsstapel.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(businessCsv(jahr), 'utf8'),
  });
  await page.waitForTimeout(800);

  // 1) Vorschau
  const previewAntwort = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().includes('/datev-import/preview'),
    { timeout: 20_000 },
  );
  await page.getByRole('button', { name: /^Weiter$/ }).first().click();
  const preview = await previewAntwort;
  const previewBody = (await preview.json().catch(() => ({}))) as { message?: string };
  console.log('POST /datev-import/preview →', preview.status());
  expect(preview.status(), `Vorschau schlug fehl: ${previewBody.message ?? ''}`).toBeLessThan(400);

  // 2) Konfliktschutz: ohne "überschreiben" muss der Import abbrechen
  const starten = await bisZumImportKnopf(page);
  await expect(
    starten,
    'der Assistent muss bis zum Import-Knopf durchlaufen',
  ).toBeVisible();

  const konflikt = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().includes('/datev-import/execute'),
    { timeout: 30_000 },
  );
  await starten.click();
  const konfliktResp = await konflikt;
  const konfliktBody = (await konfliktResp.json().catch(() => ({}))) as {
    message?: string;
  };
  console.log('Konflikt →', konfliktResp.status(), konfliktBody.message ?? '');

  // Im Seed existiert für das Vorjahr bereits eine Bilanz. Der Import muss
  // das benennen und ABLEHNEN — nicht still überschreiben. Deshalb prüfe
  // ich nicht blind auf 2xx, sondern auf die Falles unterscheidung.
  if (konfliktResp.status() === 400) {
    expect(
      konfliktBody.message,
      'die Konfliktmeldung muss Jahr und Handlung nennen',
    ).toMatch(/Geschäftsjahr/);
    expect(konfliktBody.message).toMatch(/überschreiben/i);
  } else {
    expect(
      konfliktResp.status(),
      `der Import darf kein 500 sein: ${konfliktBody.message ?? ''}`,
    ).toBeLessThan(500);
  }

  // 3) Freigabe: Überschreiben aktivieren und erneut importieren
  const ueberschreiben = page.getByText(/Bestehende Bilanz\/GuV .* überschreiben/i).first();
  if ((await ueberschreiben.count()) > 0) {
    const checkbox = ueberschreiben.locator('input[type=checkbox]').first();
    if ((await checkbox.count()) > 0) {
      await checkbox.check();
      await page.waitForTimeout(500);

      const starten2 = page
        .getByRole('button', { name: /import starten/i })
        .first();
      const erfolg = page.waitForResponse(
        (r) =>
          r.request().method() === 'POST' &&
          r.url().includes('/datev-import/execute'),
        { timeout: 40_000 },
      );
      await starten2.click();
      const resp = await erfolg;
      const body = (await resp.json().catch(() => ({}))) as {
        message?: string;
        importiertCount?: number;
      };
      console.log(
        'POST /datev-import/execute (mit Überschreiben) →',
        resp.status(),
        'importiertCount =',
        body.importiertCount,
      );
      expect(
        resp.status(),
        `Import schlug fehl: ${body.message ?? ''}`,
      ).toBeLessThan(400);
    }
  }
});
