import { expect, test, type Page } from '@playwright/test';
import { authenticator } from 'otplib';

/**
 * MFA-Einrichtung in der Oberfläche.
 *
 * BEFUND 2026-10-19 (Nachtrag 48, TODO-8.20): Die TOTP-Routen des
 * Backends waren vorhanden, korrekt abgesichert — und von der Oberfläche
 * aus **nicht erreichbar**. `grep -rn "totp" frontend/src` fand nur die
 * Verwendung im Login.
 *
 * Dieser Test geht den ganzen Weg:
 *   1. Status "Nicht aktiv"
 *   2. "MFA einrichten" → QR-Code + Secret erscheinen
 *   3. ein falscher Code wird abgewiesen
 *   4. ein **gültiger** Code + Passwort aktiviert MFA
 *   5. der Status wechselt auf "Aktiv"
 *   6. "MFA deaktivieren" mit Passwort + Code stellt den Ausgangszustand her
 *
 * Der Code wird mit **derselben Bibliothek** berechnet, mit der das Backend
 * prüft (`otplib@^12`, in beiden Paketen gepinnt). Eine eigene
 * TOTP-Nachbaut wäre genau die Falle aus Nachtrag 54: „wer eine Funktion
 * nachbaut, misst die Nachbildung."
 */

async function anmelden(page: Page, email = 'wp@kanzlei.de') {
  await page.goto('http://localhost:3001/de-DE/login');
  await page.getByLabel(/e-?mail/i).fill(email);
  await page.getByLabel(/passwort/i).fill('Demo123!');
  await page.getByRole('button', { name: /anmelden/i }).click();
  await page.waitForURL('**/de-DE/dashboard', { timeout: 30_000 });
}

test.describe('MFA lässt sich in der Oberfläche einrichten', () => {
  test('einrichten und wieder deaktivieren', async ({ page }) => {
    test.setTimeout(90_000);
    await anmelden(page);

    await page.goto('http://localhost:3001/de-DE/einstellungen/sicherheit');
    await page.waitForTimeout(2500);

    const status = page.getByTestId('mfa-status');
    await expect(
      status,
      'die Seite muss den MFA-Status anzeigen — sonst ist die Funktion ' +
        'weiterhin nur ueber die API erreichbar',
    ).toBeVisible();
    await expect(status, 'der Ausgangszustand ist "nicht aktiv"').toHaveText(
      'Nicht aktiv',
    );

    // (2) Einrichten öffnen
    await page.getByTestId('mfa-einrichten').click();
    await expect(
      page.locator('input[type="file"]'),
      'der Dialog muss die P12-/QR-Angaben zeigen',
    ).toHaveCount(0);
    const qr = page.locator('img[alt*="QR-Code"]');
    await expect(qr, 'der QR-Code muss erscheinen').toBeVisible({ timeout: 20_000 });

    // Das Secret steht als Text neben dem QR-Code.
    const secret = (await page.locator('.font-mono').first().innerText()).trim();
    expect(secret.length, 'das Secret muss angezeigt werden').toBeGreaterThan(15);

    // (3) Ein falscher Code wird abgewiesen.
    await page.locator('#mfa-code').fill('000000');
    await page.locator('#mfa-password').fill('Demo123!');
    await page.getByTestId('mfa-absenden').click();
    await expect(
      page.getByRole('alert'),
      'ein falscher Code muss abgewiesen werden',
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      status,
      'der Status darf sich nicht aendern',
    ).toHaveText('Nicht aktiv');

    // (4) Der echte Code aktiviert MFA.
    await page.locator('#mfa-code').fill(authenticator.generate(secret));
    await page.getByTestId('mfa-absenden').click();
    await expect(
      status,
      'nach dem Aktivieren muss der Status "Aktiv" sein',
    ).toHaveText('Aktiv', { timeout: 30_000 });

    // (5) Und wieder deaktivieren.
    await page.getByTestId('mfa-deaktivieren').click();
    await page.locator('#mfa-code').fill(authenticator.generate(secret));
    await page.locator('#mfa-password').fill('Demo123!');
    await page.getByTestId('mfa-absenden').click();
    await expect(
      status,
      'nach dem Deaktivieren muss der Ausgangszustand wiederhergestellt sein',
    ).toHaveText('Nicht aktiv', { timeout: 30_000 });
  });
});
