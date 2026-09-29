import { test, expect, type Page } from '@playwright/test';

/**
 * Frontend-Smoke-E2E.
 *
 * Diese Tests fahren den PRODUKTIONS-Build (`next start`) gegen das echte
 * Backend. Sie prüfen bewusst die Hauptpfade, die ein Anwender täglich
 * sieht — Login, Mandantenwechsel, Fachseiten, Audit.
 *
 * Kein Mock: Wenn hier etwas grün wird, ist die Kette
 * Browser → Next.js-Rewrite → NestJS → PostgreSQL tatsächlich intakt.
 * Genau diese Kette war vor dem 2026-09-29 defekt: elf Aufrufe landeten
 * unter `/api/api/...`, und `apiFetch` wurde fälschlich als `Response`
 * behandelt — beides fällt hier sofort auf.
 */

const LOCALE = 'de-DE';
const SEED_USER = {
  email: 'steuerberater@kanzlei.de',
  password: 'Demo123!',
};

/** Meldet sich an und legt den Token in localStorage ab (wie LoginForm). */
async function login(page: Page, email = SEED_USER.email, password = SEED_USER.password) {
  await page.goto(`/${LOCALE}/login`);
  await page.getByLabel(/e-?mail/i).fill(email);
  await page.getByLabel(/passwort/i).fill(password);
  await page.getByRole('button', { name: /anmelden|login/i }).click();
}

test.describe('Anmeldung', () => {
  test('Login-Seite rendert auf Deutsch', async ({ page }) => {
    await page.goto(`/${LOCALE}/login`);
    await expect(page).toHaveTitle(/Bundesanzeiger/i);
    // UI muss durchgehend deutsch sein (AGENTS.md §2.1)
    const body = await page.locator('body').innerText();
    expect(body).not.toMatch(/\b(Sign in|Log in|Email|Password|Dashboard|Loading)\b/);
  });

  test('gültige Anmeldung landet im Dashboard und speichert das Token', async ({ page }) => {
    await login(page);
    await page.waitForURL(`**/${LOCALE}/dashboard`, { timeout: 20_000 });

    const token = await page.evaluate(() => localStorage.getItem('accessToken'));
    expect(token, 'accessToken muss nach dem Login in localStorage stehen').toBeTruthy();
    await expect(page.locator('body')).toContainText(/Übersicht/i);
  });

  test('ungültiges Passwort führt nicht ins Dashboard', async ({ page }) => {
    await login(page, SEED_USER.email, 'FALSCHES-PASSWORT');
    // Kein Token darf entstehen
    await page.waitForTimeout(2500);
    const token = await page.evaluate(() => localStorage.getItem('accessToken'));
    expect(token).toBeFalsy();
    await expect(page).toHaveURL(new RegExp(`${LOCALE}/login`));
  });

  test('geschützte Seite ohne Session wird zur Anmeldung umgeleitet', async ({ page }) => {
    await page.goto(`/${LOCALE}/bilanz`);
    await page.waitForTimeout(1500);
    await expect(page).toHaveURL(new RegExp(`${LOCALE}/login`));
  });
});

test.describe('Fachseiten (mit Session)', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.waitForURL(`**/${LOCALE}/dashboard`, { timeout: 20_000 });
  });

  for (const [pfad, erwartet] of [
    ['bilanz', /Bilanz/i],
    ['guv', /GuV/i],
    ['anhang', /Anhang/i],
    ['audit', /Audit/i],
    ['jahresabschluss', /Jahresabschluss/i],
  ] as const) {
    test(`${pfad} lädt und rendert deutsch`, async ({ page }) => {
      const resp = await page.goto(`/${LOCALE}/${pfad}`);
      expect(resp?.status(), `${pfad} muss HTTP 200 liefern`).toBe(200);
      // Kein Next.js-Error-Overlay
      await expect(page.locator('body')).not.toContainText('Application error');
      await expect(page.locator('body')).toContainText(erwartet);
    });
  }

  test('API-Proxy erreicht das Backend (kein /api/api/…)', async ({ page }) => {
    // Der Bug von 2026-09-28: apiFetch('/api/auth/me') erzeugte '/api/api/auth/me'.
    // Diese Seite ruft /auth/me auf; ein Fehler fiele als "Laden hängt".
    await page.goto(`/${LOCALE}/dashboard`);
    await page.waitForTimeout(3000);

    const failed = await page.evaluate(() =>
      performance
        .getEntriesByType('resource')
        .map((e) => e.name)
        .filter((n) => n.includes('/api/api/')),
    );
    expect(failed, 'Es darf keine Anfrage unter /api/api/… gehen').toHaveLength(0);

    const apiCalls = await page.evaluate(() =>
      performance
        .getEntriesByType('resource')
        .map((e) => e.name)
        .filter((n) => n.includes('/api/')),
    );
    expect(apiCalls.length, 'Dashboard muss Backend-Aufrufe machen').toBeGreaterThan(0);
  });
});
