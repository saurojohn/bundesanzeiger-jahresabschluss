import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright-Konfiguration (Frontend-E2E).
 *
 * Warum diese Datei erst 2026-09-29 existiert: `package.json` enthielt zwar
 * `@playwright/test` und ein `test:e2e`-Skript, es gab aber weder eine
 * Konfiguration noch einen einzigen Test. `AGENTS.md §6` verlangt für M4
 * 90 % E2E-Coverage — der Wert war bisher 0.
 *
 * Voraussetzungen (siehe ../run-local.sh und README):
 *   - Backend  auf :3000  (migriert + geseedet)
 *   - Frontend auf :3001  (`npm run build && npx next start -p 3001`)
 *
 * Startet der Frontend-Server nicht selbst — das ist Absicht: der Production-
 * Build (`next start`) ist das, was deployed würde, und genau das soll hier
 * geprüft werden. `webServer` startet ihn nur, wenn er nicht schon läuft.
 */
export default defineConfig({
  testDir: './e2e',
  // DB vor jedem Lauf in einen definierten Ausgangszustand versetzen.
  //
  // Ohne das ist die Suite NICHT wiederholbar: `konsolidierung.spec.ts`
  // beansprucht ein freies Geschäftsjahr und gibt es nie wieder frei —
  // nach ~20 Läufen war der Lauf dauerhaft rot. Siehe
  // `e2e/global-setup.ts` für die Belege.
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list']],
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3001',
    // CI-Runner sind gemeinsam; 20 s war dort knapp. 45 s laesst echte
    // Langsamkeit zu, ohne haengende Tests zu verdecken.
    actionTimeout: 45_000,
    navigationTimeout: 45_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: {
    command: 'npx next start -p 3001',
    url: 'http://localhost:3001/de-DE/login',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
