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

/**
 * Backend-Vorabtest — trennt „Backend nicht erreichbar/kein Login" von
 * „Frontend navigiert nicht".
 *
 * Motivation: In den CI-Läufen am 2026-09-30 erschienen zwei völlig
 * verschiedene Ursachen als GLEICHE Fehlermeldung (`waitForURL: Timeout`):
 *   * 12:13 — CORS verweigerte die Origin, jeder Login scheiterte
 *   * weitere Läufe — Varianten davon
 * Wer nur auf `waitForURL` wartet, erfährt nicht, ob das Backend tot ist,
 * der Login abgelehnt wird oder der Router hängt. Dieser Vorabtest macht das
 * unterscheidbar: er schlägt mit einer Meldung fehl, die die Ursache nennt.
 */
async function assertBackendLoginWorks(): Promise<void> {
  const url = `${process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:3000'}/api/auth/login`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(SEED_USER),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new Error(
      `VORABTEST FEHLGESCHLAGEN: Backend unter ${url} nicht erreichbar (${(err as Error).message}). ` +
        'Ursache ist das Backend/Netzwerk, NICHT der Next-Router.',
    );
  }
  if (response.status !== 200) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `VORABTEST FEHLGESCHLAGEN: POST ${url} antwortete ${response.status} — ` +
        `Body: ${body.slice(0, 220)}. Häufigste Ursache: CORS (FRONTEND_URL im Job-Env ` +
        'fehlt oder enthält die Origin des Frontends nicht).',
    );
  }
}

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
    // Erst das Backend prüfen. Sonst ist ein Timeout nicht interpretierbar.
    await assertBackendLoginWorks();
    await login(page);
    await page.waitForURL(`**/${LOCALE}/dashboard`, { timeout: 30_000 });

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
    await assertBackendLoginWorks();
    await login(page);
    await page.waitForURL(`**/${LOCALE}/dashboard`, { timeout: 30_000 });
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

  test('Mandanten-Kontext wird mitgesendet (kein 403 "mandantId erforderlich")', async ({ page }) => {
    // Befund 2026-10-03, zwei gestaffelte Ursachen:
    //
    // (a) `MandantSwitcher` setzte den Vorauswahl-Mandanten nur im
    //     React-State, nicht in localStorage. Geschrieben wurde nur beim
    //     manuellen Wechseln über das Dropdown.
    // (b) `apiFetch` hat den `x-mandant-id`-Header nie aus localStorage
    //     gesetzt — obwohl `MandantGuard` ihn an Position 2 der
    //     Auflösungsreihenfolge auswertet.
    //
    // Folge: 16 Aufrufe in fünf Komponenten (Bilanz/GuV/Anhang-Detail,
    // Mutation, WP) liefen in 403 "mandantId erforderlich". Löschen,
    // Speichern und Laden der Detailansicht waren im UI nicht möglich.
    await page.goto(`/${LOCALE}/dashboard`);
    await page.waitForTimeout(2000);

    // Der aktive Mandant muss nach dem ersten Laden persistiert sein —
    // sonst ist jeder Folgeaufruf ohne explizites mandantId ein 403.
    const mandant = await page.evaluate(() =>
      localStorage.getItem('activeMandantId'),
    );
    expect(mandant, 'activeMandantId muss nach dem Login gesetzt sein').toBeTruthy();

    // Und mit diesem Header muss ein mandantgebundener Aufruf 200 liefern.
    const status = await page.evaluate(async () => {
      const token = localStorage.getItem('accessToken');
      const mid = localStorage.getItem('activeMandantId');
      if (!token || !mid) return 'voraussetzung-fehlt';
      const r = await fetch('/api/mandant', {
        headers: { Authorization: `Bearer ${token}`, 'x-mandant-id': mid },
      });
      return String(r.status);
    });
    expect(status, 'Aufruf mit x-mandant-id muss 200 liefern').toBe('200');

    // Die Bilanzliste darf keinen 403er erzeugen.
    const codes: number[] = [];
    page.on('response', (r) => {
      if (r.url().includes('/api/')) codes.push(r.status());
    });
    await page.goto(`/${LOCALE}/bilanz`);
    await page.waitForTimeout(2500);
    expect(
      codes.filter((c) => c === 403),
      'Die Bilanzliste darf keinen 403 erzeugen',
    ).toHaveLength(0);
  });
});
