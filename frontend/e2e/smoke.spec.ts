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

/**
 * Speichern eines BESTEHENDEN Datensatzes in der Oberfläche.
 *
 * Befund 2026-10-03: `GuvListView`/`AnhangListView`/`BilanzForm` schicken beim
 * Speichern eines bestehenden Satzes `mandantId` weder in die Query noch in
 * den Body — nur der `x-mandant-id`-Header von `apiFetch`. Die Controller
 * lasen aber nur Query/Body, warfen einen nackten `Error` und antworteten mit
 * HTTP 500. In der Oberfläche hieß das: Formular auf, "Speichern" geklickt,
 * rotes Fehlerband, Datenstand verloren.
 *
 * Der Test klickt den Weg, den ein Anwender geht: Liste → "Bearbeiten" →
 * "Speichern". Geprüft wird die tatsächliche Netzwerkkette (PATCH-Statuscode),
 * nicht ein Zustand im Frontend.
 */
test.describe('Speichern bestehender Datensätze', () => {
  test.beforeEach(async ({ page }) => {
    await assertBackendLoginWorks();
    await login(page);
    await page.waitForURL(`**/${LOCALE}/dashboard`, { timeout: 30_000 });
  });

  /**
   * Sorgt dafür, dass die Liste mindestens einen Datensatz zeigt.
   *
   * Der Vorauswahl-Mandant nach dem Login kommt aus `/api/mandant`; im Seed
   * hat er Bestand, das ist aber nicht garantiert (die Mandantenliste ist nach
   * firmenname sortiert). Deshalb wird bei leerer Liste ueber den
   * Mandanten-Switcher auf einen Mandanten mit Bestand gewechselt — der Weg,
   * den ein Anwender geht.
   *
   * Hinweis: `<option>`-Elemente haben fuer Playwright keine sichtbare Box,
   * `toBeVisible()` gilt nur fuer das `<select>` selbst.
   */
  async function listeMitBestandOeffnen(
    page: Page,
    seite: string,
    apiPfad: string,
  ): Promise<void> {
    await page.goto(`/${LOCALE}/${seite}`);
    await page.waitForTimeout(2000);
    const bearbeiten = page.getByRole('button', { name: 'Bearbeiten' });
    if ((await bearbeiten.count()) > 0) return;

    await page.goto(`/${LOCALE}/dashboard`);
    await page.waitForTimeout(1500);
    const switcher = page.locator('#mandant-switcher');
    await expect(switcher, 'der Mandanten-Switcher muss sichtbar sein').toBeVisible();

    // Wichtig: ALLE Kandidaten in einem einzigen page.evaluate pruefen. Ein
    // selectOption loest window.location.reload() aus und macht den Locator
    // stale — ein Loop ueber Locators bricht dann mitten im Lauf ab.
    const kandidat = await page.evaluate(async (pfad: string) => {
      const token = localStorage.getItem('accessToken');
      const select = document.querySelector('#mandant-switcher') as HTMLSelectElement | null;
      if (!token || !select) return null;
      for (const option of Array.from(select.options)) {
        const mid = option.value;
        if (!mid) continue;
        const r = await fetch(pfad, {
          headers: { Authorization: `Bearer ${token}`, 'x-mandant-id': mid },
        });
        if (!r.ok) continue;
        const body = (await r.json()) as unknown[];
        if (Array.isArray(body) && body.length > 0) return mid;
      }
      return null;
    }, apiPfad);

    if (!kandidat) {
      throw new Error(
        `${seite}: kein Mandant mit Bestand gefunden (${apiPfad}) — Seed-Daten prüfen`,
      );
    }

    await page.selectOption('#mandant-switcher', kandidat);
    // handleChange ruft window.location.reload() — auf das Neuladen warten.
    await page.waitForLoadState('load');
    await page.goto(`/${LOCALE}/${seite}`);
    await page.waitForTimeout(2000);
    if ((await bearbeiten.count()) > 0) return;
    throw new Error(
      `${seite}: nach dem Mandantenwechsel weiterhin keine Datensätze in der Liste`,
    );
  }

  for (const [seite, bearbeiten, pfad, listePfad] of [
    ['guv', 'Bearbeiten', '/api/guv/', '/api/guv?mandantId='],
    ['anhang', 'Bearbeiten', '/api/anhang/', '/api/anhang?mandantId='],
  ] as const) {
    test(`${seite}: bestehenden Datensatz speichern → kein 5xx`, async ({ page }) => {
      await listeMitBestandOeffnen(page, seite, listePfad);

      // Ohne Datensatz lässt sich der Pfad nicht gehen — der Test würde
      // stillschweigend nichts prüfen. Also sichtbar scheitern.
      const bearbeitenButtons = page.getByRole('button', { name: bearbeiten });
      await expect(
        bearbeitenButtons.first(),
        `${seite}: es muss mindestens einen bestehenden Datensatz zum Bearbeiten geben`,
      ).toBeVisible();

      await bearbeitenButtons.first().click();
      await expect(
        page.getByRole('heading', { name: /bearbeiten/i }),
        `${seite}: das Formular muss sich öffnen`,
      ).toBeVisible();

      // PATCH-Statuscode mitschreiben. `waitForResponse` VOR dem Klick
      // registrieren — der React-onClick feuert synchron (AGENTS.md §12).
      const antworten: Array<{ url: string; status: number }> = [];
      const warteAufPatch = page.waitForResponse(
        (r) =>
          r.request().method() === 'PATCH' && r.url().includes(pfad),
        { timeout: 20_000 },
      );
      await page.getByRole('button', { name: /^Speichern$/ }).click();
      const patch = await warteAufPatch;
      antworten.push({ url: patch.url(), status: patch.status() });

      expect(
        patch.status(),
        `PATCH ${patch.url()} muss 2xx liefern, war ${patch.status()}`,
      ).toBeGreaterThanOrEqual(200);
      expect(
        patch.status(),
        `PATCH ${patch.url()} darf kein 500 sein`,
      ).toBeLessThan(500);

      // Und die Oberflaeche darf keinen Fehler anzeigen. Geprueft wird der
      // TEXT, nicht die Anzahl der Elemente: `role="alert"` wird auch als
      // leere Live-Region fuer Screenreader gerendert (Text = '').
      await page.waitForTimeout(1500);
      const fehlerTexte = (await page
        .locator('.bg-red-50, [role="alert"]')
        .allInnerTexts())
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
      expect(
        fehlerTexte,
        `${seite}: nach dem Speichern darf kein Fehlertext stehen`,
      ).toHaveLength(0);
    });
  }
});

/**
 * Fachseiten mit Bestand — der Test, dessen Fehlen drei Crashes durchgelassen hat.
 *
 * Befund 2026-10-03: Die Smoke-Tests öffneten jede Fachseite, prüften aber nur
 * "rendert auf Deutsch". Der Vorauswahl-Mandant nach dem Login hat im Seed
 * keine Datensätze — eine leere Liste rendert problemlos. Die Abstürze traten
 * ausschließlich bei Mandanten MIT Bestand auf:
 *
 *   - Anhang-Liste: `a.abschnitte.length` → TypeError (Liste liefert keine)
 *   - Bilanz-Liste: `b.positionen.filter(...)` → TypeError (Liste liefert
 *     keine Positionen)
 *   - GuV-/Anhang-/Bilanz-Liste: React #300 beim Öffnen (Hook hinter Return)
 *
 * "Rendert" und "rendert mit Daten" sind verschiedene Zusicherungen. Dieser
 * Test sichert die zweite.
 */
test.describe('Fachseiten mit Bestand', () => {
  test.beforeEach(async ({ page }) => {
    await assertBackendLoginWorks();
    await login(page);
    await page.waitForURL(`**/${LOCALE}/dashboard`, { timeout: 30_000 });
  });

  for (const [seite, apiPfad, erwartet] of [
    ['bilanz', '/api/bilanz?mandantId=', /Bilanz/i],
    ['guv', '/api/guv?mandantId=', /GuV/i],
    ['anhang', '/api/anhang?mandantId=', /Anhang/i],
  ] as const) {
    test(`${seite}: Mandant mit Bestand rendert ohne Absturz`, async ({ page }) => {
      const pageErrors: string[] = [];
      page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 200)));

      // Mandanten mit Bestand wählen. localStorage ist der schnellste Weg —
      // der Switcher löst window.location.reload() aus und macht Locators stale.
      const mandant = await page.evaluate(async (pfad: string) => {
        const token = localStorage.getItem('accessToken');
        if (!token) return null;
        const liste = (await (await fetch('/api/mandant', {
          headers: { Authorization: `Bearer ${token}` },
        })).json()) as Array<{ id: string }>;
        for (const m of liste) {
          const r = await fetch(pfad + m.id, {
            headers: { Authorization: `Bearer ${token}`, 'x-mandant-id': m.id },
          });
          if (!r.ok) continue;
          const body = (await r.json()) as unknown[];
          if (Array.isArray(body) && body.length > 0) return m.id;
        }
        return null;
      }, apiPfad);
      expect(mandant, `${seite}: Seed muss einen Mandanten mit Bestand enthalten`).toBeTruthy();
      await page.evaluate((m) => localStorage.setItem('activeMandantId', m), mandant as string);

      const resp = await page.goto(`/${LOCALE}/${seite}`);
      expect(resp, `${seite}: Seite muss antworten`).toBeTruthy();
      await page.waitForTimeout(2500);

      // Next.js blendet den Fehler als "Application error: a client-side
      // exception has occurred" aus — genau das war der Absturz.
      const body = await page.locator('body').innerText();
      expect(
        body,
        `${seite}: Client-seitiger Absturz (pageerror: ${pageErrors.join(' | ')})`,
      ).not.toContain('Application error');
      expect(pageErrors, `${seite}: keine pageerror`).toHaveLength(0);
      await expect(page.locator('body')).toContainText(erwartet);
    });
  }
});

/**
 * ALLE Fachseiten mit dem mandantenstärksten Datenbestand.
 *
 * Befund 2026-10-04: `WPView` rief `/mandanten` (Plural) auf, der Endpoint
 * heißt `/mandant`. Der 404 threw in der Ladefunktion, `setLoading(false)`
 * wurde nie erreicht — die komplette Wirtschaftsprüfung blieb dauerhaft auf
 * "Wird geladen …", mit leerem Mandanten-Picker. Ein Tippfehler im Pfad, und
 * eine ganze Fachseite war lahm.
 *
 * Warum es durchrutschte: die Einzeltests prüften jede Seite auf "rendert
 * auf Deutsch". "Wird geladen …" ist Deutsch und rendert. Dieser Test
 * prüft die Vollständigkeit der Ladung: keine `pageerror` und der
 * Ladeindikator ist verschwunden.
 *
 * Er nutzt den Mandanten mit dem MEISTEN Bestand — mit einem leeren
 * Mandanten bleibt die Hälfte der Oberfläche ungeprüft (siehe
 * "Fachseiten mit Bestand").
 */
test.describe('Alle Fachseiten mit Bestand', () => {
  const SEITEN = [
    'dashboard',
    'bilanz',
    'guv',
    'anhang',
    'jahresabschluss',
    'konsolidierung',
    'mandant',
    'webhooks',
    'branding',
    'api-keys',
    'audit',
    'wp',
    'einstellungen/subscription',
  ] as const;

  test.beforeEach(async ({ page }) => {
    await assertBackendLoginWorks();
    await login(page);
    await page.waitForURL(`**/${LOCALE}/dashboard`, { timeout: 30_000 });

    // Mandant mit dem stärksten Bestand wählen. localStorage statt des
    // Selectors: `selectOption` löst window.location.reload() aus und macht
    // Locators stale.
    const mandant = await page.evaluate(async () => {
      const token = localStorage.getItem('accessToken');
      if (!token) return null;
      const liste = (await (await fetch('/api/mandant', {
        headers: { Authorization: `Bearer ${token}` },
      })).json()) as Array<{ id: string }>;
      let best: string | null = null;
      let bestCount = -1;
      for (const m of liste) {
        let count = 0;
        for (const pfad of [
          '/api/bilanz?mandantId=',
          '/api/guv?mandantId=',
          '/api/anhang?mandantId=',
        ]) {
          const body = (await (await fetch(pfad + m.id, {
            headers: { Authorization: `Bearer ${token}`, 'x-mandant-id': m.id },
          })).json()) as unknown[];
          if (Array.isArray(body)) count += body.length;
        }
        if (count > bestCount) {
          bestCount = count;
          best = m.id;
        }
      }
      return best;
    });
    expect(mandant, 'es muss mindestens einen Mandanten geben').toBeTruthy();
    await page.evaluate((m) => localStorage.setItem('activeMandantId', m), mandant as string);
  });

  for (const seite of SEITEN) {
    test(`${seite}: lädt vollständig (kein pageerror, kein Hängenbleiben)`, async ({ page }) => {
      const pageErrors: string[] = [];
      page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 200)));

      await page.goto(`/${LOCALE}/${seite}`);

      // Auf den Ladeindikator warten statt eine feste Zeit zu schlafen.
      // Die 2,5 s aus der ersten Fassung waren unter Last des vollen
      // Laufs (53 Tests, ein Browser) nicht immer ausreichend — der Test
      // schlug dann fehl, obwohl die Seite in Ordnung war. Ein Flake, der
      // als Produktionsfehler aussieht, ist selbst ein Defekt an der
      // Testsuite.
      await page
        .locator('text=/Wird geladen|Loading\.\.\./i')
        .first()
        .waitFor({ state: 'detached', timeout: 15_000 })
        .catch(() => {
          // Bleibt der Indikator stehen, greift die Assertion weiter unten.
        });

      // 1) Kein client-seitiger Absturz.
      const body = await page.locator('body').innerText();
      expect(body, `${seite}: Client-seitiger Absturz`).not.toContain('Application error');
      expect(pageErrors, `${seite}: unerwartete pageerror`).toHaveLength(0);

      // 2) Die Seite darf nicht im Ladezustand hängen bleiben. Genau daran
      //    ist die WP-Seite mit dem Tippfehler gescheitert: Sie rendert
      //    "Wird geladen …" — sauberes Deutsch, aber nie fertig.
      const haengt = /Wird geladen|Loading\.\.\.|^\s*Lädt/i.test(body);
      expect(
        haengt,
        `${seite}: hängt im Ladezustand. pageerror: ${pageErrors.join(' | ')}`,
      ).toBe(false);
    });
  }
});

/**
 * Speichern je Status — der nicht-DRAFT-Fall war unmöglich.
 *
 * Befund 2026-10-04: Das Backend lässt Positions-/Abschnittsänderungen
 * ausschließlich im DRAFT zu (`BilanzService.update` u. a., sonst HTTP 400
 * "Positionen können nur in DRAFT-Phase geändert werden"). Die drei
 * Formulare sandten `positionen`/`abschnitte` aber IMMER mit — jeder
 * VALIDATED-, APPROVED- oder ARCHIVED-Satz war damit grundsätzlich nicht
 * speicherbar, und die Oberfläche erklärte den Grund nicht.
 *
 * Korrektur einer falschen Annahme: die VALIDATED-/APPROVED-Sätze, die ich
 * beim Suchen in der Datenbank sah, waren KEINE Seed-Daten, sondern
 * Rückstände früherer Testläufe gegen meine Entwicklungsdatenbank. Auf
 * einem frisch geseedeten System (CI) existiert ausschließlich DRAFT. Die
 * Fixture wird deshalb vom Test selbst erzeugt.
 */
test.describe('Speichern je Status', () => {
  /**
   * Liefert eine Bilanz im gewünschten Status und legt sie bei Bedarf selbst
   * an.
   *
   * Wichtig: der Test darf KEINEN Seed-Datensatz voraussetzen. Der erste
   * Versuch tat das ("Seed muss eine Bilanz im Status VALIDATED enthalten")
   * und fiel in CI fehl — die einzigen VALIDATED-/APPROVED-Sätze in meiner
   * Entwicklungsdatenbank waren Rückstände früherer Testläufe, nicht Seed-
   * Daten. Ein frisch geseedetes CI-System hat ausschliesslich DRAFT-Sätze.
   *
   * Deshalb: anlegen (als DRAFT), dann per PATCH auf den Zielstatus setzen.
   * `status` ist in UpdateBilanzDto aenderbar, das Backend akzeptiert den
   * Uebergang hier als Betriebssystem-Aktion.
   */
  async function bilanzMitStatus(
    page: import('@playwright/test').Page,
    art: 'DRAFT' | 'NICHT_DRAFT',
  ): Promise<{ mandantId: string; geschaeftsjahr: number }> {
    const ziel = await page.evaluate(async (willNichtDraft: boolean) => {
      const token = localStorage.getItem('accessToken');
      if (!token) return null;
      const header = { 'content-type': 'application/json' };
      const auth = { ...header, Authorization: `Bearer ${token}` };
      const liste = (await (await fetch('/api/mandant', { headers: auth })).json()) as
        Array<{ id: string }>;

      for (const m of liste) {
        const mandHeader = { ...auth, 'x-mandant-id': m.id };
        if (!willNichtDraft) {
          // DRAFT genügt — den legt der Seed/der vorige Testlauf bereits an.
          const bl = (await (await fetch(`/api/bilanz?mandantId=${m.id}`, {
            headers: mandHeader,
          })).json()) as Array<{ geschaeftsjahr: number; status: string }>;
          const treffer = bl.find((b) => b.status === 'DRAFT');
          if (treffer) return { mandantId: m.id, geschaeftsjahr: treffer.geschaeftsjahr };
          continue;
        }
        // Freies Geschäftsjahr suchen: das Backend lehnt Dubletten je
        // Mandant ab (Unique-Constraint). `Math.random()` war naiv — ein
        // Retry-Lauf traf erneut auf dasselbe Jahr.
        let jahr = 0;
        for (let k = 2090; k < 2110; k++) {
          const probe = await fetch(`/api/bilanz?mandantId=${m.id}&geschaeftsjahr=${k}`, {
            headers: mandHeader,
          });
          const treffer = (await probe.json()) as unknown[];
          if (Array.isArray(treffer) && treffer.length === 0) {
            jahr = k;
            break;
          }
        }
        // Kein freies Jahr bei DIESEM Mandanten → nächsten versuchen.
        if (jahr === 0) continue;
        // Nicht-DRAFT selbst erzeugen: anlegen, dann Status setzen.
        const angelegt = await fetch(`/api/bilanz?mandantId=${m.id}`, {
          method: 'POST',
          headers: mandHeader,
          body: JSON.stringify({
            mandantId: m.id,
            geschaeftsjahr: jahr,
            positionen: [
              { seite: 'AKTIVA', kontonummer: 'B.IV.', bezeichnung: 'Kasse', betragAktuell: 1000, reihenfolge: 1 },
              { seite: 'PASSIVA', kontonummer: 'A.I.', bezeichnung: 'Kapital', betragAktuell: 1000, reihenfolge: 1 },
            ],
          }),
        });
        if (!angelegt.ok) continue;
        // Die POST-Antwort ist gewrappt: `{ bilanz: {...}, validierung: {...} }`.
        // Mit `.id` wurde daraus `/api/bilanz/undefined` → PATCH 400.
        const angelegtId = ((await angelegt.json()) as { bilanz: { id: string } })
          .bilanz.id;
        const gesetzt = await fetch(`/api/bilanz/${angelegtId}`, {
          method: 'PATCH',
          headers: mandHeader,
          body: JSON.stringify({ status: 'VALIDATED' }),
        });
        if (!gesetzt.ok) continue;
        return { mandantId: m.id, geschaeftsjahr: jahr };
      }
      return null;
    }, art === 'NICHT_DRAFT');
    expect(ziel, 'Fixture konnte nicht angelegt werden').toBeTruthy();
    await page.evaluate((m) => localStorage.setItem('activeMandantId', m), ziel!.mandantId);
    return ziel!;
  }

  for (const [label, art] of [
    ['DRAFT', 'DRAFT'],
    ['VALIDATED/ARCHIVED', 'NICHT_DRAFT'],
  ] as const) {
    test(`Bilanz im Status ${label} speichern → 2xx`, async ({ page }) => {
      await assertBackendLoginWorks();
      await login(page);
      await page.waitForURL(`**/${LOCALE}/dashboard`, { timeout: 30_000 });

      const ziel = await bilanzMitStatus(page, art);

      await page.goto(`/${LOCALE}/bilanz`);
      await page.waitForTimeout(2500);

      // Gezielt die Zeile des gewaehlten Satzes oeffnen.
      const zeile = page.locator('tr', { hasText: String(ziel.geschaeftsjahr) }).first();
      await zeile.getByRole('button', { name: 'Bearbeiten' }).click();
      await page.waitForTimeout(2000);

      const gesperrt = await page.getByTestId('bilanz-positionen-gesperrt').count();
      if (art === 'DRAFT') {
        expect(gesperrt, 'im DRAFT darf kein Sperrhinweis stehen').toBe(0);
      } else {
        expect(gesperrt, 'außerhalb des DRAFT muss der Sperrhinweis stehen').toBeGreaterThan(0);
      }

      const patch = page.waitForResponse(
        (r) => r.request().method() === 'PATCH' && r.url().includes('/api/bilanz'),
        { timeout: 20_000 },
      );
      await page.getByRole('button', { name: /^Speichern$/ }).click();
      const antwort = await patch;

      expect(
        antwort.status(),
        `PATCH muss 2xx liefern, war ${antwort.status()} — auch ausserhalb des DRAFT`,
      ).toBeGreaterThanOrEqual(200);
      expect(antwort.status(), 'kein 4xx/5xx').toBeLessThan(400);

      await page.waitForTimeout(1500);
      const fehlerTexte = (await page.locator('.bg-red-50').allInnerTexts())
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      expect(fehlerTexte, 'nach dem Speichern darf kein Fehlerband stehen').toHaveLength(0);
    });
  }
});
