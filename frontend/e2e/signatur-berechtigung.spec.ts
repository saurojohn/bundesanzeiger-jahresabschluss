import { expect, test, type Page } from '@playwright/test';

/**
 * Signier-Knöpfe: sichtbar nur, wo die Rolle es erlaubt.
 *
 * BEFUND 2026-10-20 (Nachtrag 57, TODO-8.12): Der Signier-Knopf war an
 * **5 Stellen** sichtbar, ohne dass die Rolle geprueft wurde. Ein
 * STEUERBERATER konnte den P12 hochladen, das Passwort eingeben — und
 * bekam dann **403** vom Server. Nach der ganzen Arbeit.
 *
 * ## Die Rollenbindung, wie sie wirklich ist
 *
 * TODO-8.12 behauptete, `POST /api/signatur/*` sei durchgehend auf
 * Wirtschaftspruefer beschraenkt. **Gemessen am Controller** ist das
 * nur fuer `sign-abschluss` richtig:
 *
 * | Route                    | `@Roles(...)`                              |
 * |--------------------------|--------------------------------------------|
 * | `sign-bilanz`            | WIRTSCHAFTSPRUEFER, STEUERBERATER          |
 * | `sign-guv`               | WIRTSCHAFTSPRUEFER, STEUERBERATER          |
 * | `sign-anhang`            | WIRTSCHAFTSPRUEFER, STEUERBERATER          |
 * | `sign-abschluss`         | WIRTSCHAFTSPRUEFER **nur**                 |
 * | `inspect-p12`            | WIRTSCHAFTSPRUEFER, STEUERBERATER          |
 *
 * Die Oberflaeche bildet genau das ab — und **mandantenbezogen**, genau
 * wie der `RolesGuard` (Nachtrag 40): eine Rolle aus einem anderen
 * Mandanten berechtigt nicht.
 *
 * Die Zustaendigkeit liegt jetzt an **einer** Stelle (`lib/session.ts`).
 * Vorher stand sie als Prop `canSign` bei vier Aufrufstellen — und war
 * dort an allen vier falsch.
 */

async function anmelden(page: Page, email: string) {
  await page.goto('http://localhost:3001/de-DE/login');
  await page.getByLabel(/e-?mail/i).fill(email);
  await page.getByLabel(/passwort/i).fill('Demo123!');
  await page.getByRole('button', { name: /anmelden/i }).click();
  await page.waitForURL('**/de-DE/dashboard', { timeout: 30_000 });
}

/** Der Knopf, um einen Bestandteil (Bilanz/GuV/Anhang) zu signieren. */
const signierKnopf = (page: Page) =>
  page.getByRole('button', { name: 'PDF signieren' });

/**
 * Der Block "Exporte & Einreichung" — er enthaelt den Signier-Knopf.
 *
 * **Die Gegenprobe.** Ein Test, der nur prueft "der Signier-Knopf ist
 * nicht da", ist gruen, wenn **gar nichts** da ist: leere Liste, falsche
 * Seite, kaputter Render. Das war der erste Fehlschlag dieses Tests — der
 * KANZLEI_ADMIN-Test war gruen, weil die GuV-Liste des aktiven Mandanten
 * leer war und die `ExportActions` gar nicht gerendert wurden.
 *
 * Deshalb wird zuerst geprueft, dass der Block da ist, und **erst dann**,
 * dass der Signier-Knopf fehlt.
 */
const exportBlock = (page: Page) =>
  page.getByRole('button', { name: 'DATEV-CSV generieren' });

/**
 * Wechselt auf den Mandanten, auf dem der Seed eine GuV angelegt hat.
 *
 * BEFUND: Nach dem Login ist der aktive Mandant der **erste** Mandant des
 * Users ("Beispiel GmbH") — und dort gibt es keine GuV. Die Seed-Daten
 * liegen auf "Demo GmbH". Ohne diesen Schritt prueft der Test eine leere
 * Liste.
 */
async function mandantDemoGmbH(page: Page) {
  const gesetzt = await page.evaluate(async () => {
    const t = localStorage.getItem('accessToken');
    if (!t) return false;
    const mandanten = (await (
      await fetch('/api/mandant', { headers: { Authorization: `Bearer ${t}` } })
    ).json()) as Array<{ id: string; firmenname: string }>;
    const m = mandanten.find((x) => x.firmenname === 'Demo GmbH');
    if (!m) return false;
    localStorage.setItem('activeMandantId', m.id);
    return true;
  });
  expect(gesetzt, 'der Mandant "Demo GmbH" muss gefunden werden').toBe(true);
  await page.reload();
  await page.waitForTimeout(2500);
}

test.describe('Signier-Knopf fuer Bestandteile (Bilanz/GuV/Anhang)', () => {
  test('ein STEUERBERATER sieht ihn — sign-guv erlaubt STEUERBERATER', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await anmelden(page, 'steuerberater@kanzlei.de');

    await page.goto('http://localhost:3001/de-DE/guv');
    await mandantDemoGmbH(page);

    await expect(
      exportBlock(page).first(),
      'der Exportblock muss gerendert sein — sonst prueft der Test eine leere Seite',
    ).toBeVisible({ timeout: 20_000 });

    await expect(
      signierKnopf(page).first(),
      'ein STEUERBERATER darf eine GuV signieren (sign-guv: WIRTSCHAFTSPRUEFER, ' +
        'STEUERBERATER) — der Knopf muss sichtbar sein',
    ).toBeVisible({ timeout: 20_000 });
  });

  test('ein KANZLEI_ADMIN sieht ihn nicht — er hat keine Signaturrolle', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await anmelden(page, 'kanzlei-admin@kanzlei.de');

    await page.goto('http://localhost:3001/de-DE/guv');
    await mandantDemoGmbH(page);

    // Die Gegenprobe zuerst: der Block ist da, der Signier-Knopf nicht.
    await expect(
      exportBlock(page).first(),
      'der Exportblock muss gerendert sein — sonst waere die Abwesenheit des ' +
        'Signier-Knopfes bedeutungslos (leere Liste statt fehlender Rolle)',
    ).toBeVisible({ timeout: 20_000 });

    await expect(
      signierKnopf(page),
      'ein KANZLEI_ADMIN hat keine Signaturrolle — der Knopf darf gar nicht ' +
        'erscheinen, sonst laeuft der Anwender in einen 403, den er nicht ' +
        'ausloesen kann',
    ).toHaveCount(0);
  });

  test('ein WIRTSCHAFTSPRUEFER sieht ihn', async ({ page }) => {
    test.setTimeout(60_000);
    await anmelden(page, 'wp@kanzlei.de');

    await page.goto('http://localhost:3001/de-DE/guv');
    await mandantDemoGmbH(page);

    await expect(
      exportBlock(page).first(),
      'der Exportblock muss gerendert sein — sonst prueft der Test eine leere Seite',
    ).toBeVisible({ timeout: 20_000 });

    await expect(
      signierKnopf(page).first(),
      'ein WIRTSCHAFTSPRUEFER darf signieren — der Knopf muss sichtbar sein',
    ).toBeVisible({ timeout: 20_000 });
  });
});
