import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

/**
 * Setzt die Datenbank vor dem Playwright-Lauf in einen definierten
 * Ausgangszustand — genau wie `backend/e2e/global-setup.ts` es fuer die
 * Vitest-Suite tut.
 *
 * BEFUND 2026-10-07 (belegt, nicht vermutet):
 * Die Frontend-Suite hatte KEIN `globalSetup`. Mehrere Specs legen
 *_FIXTURES_ an, die einen eindeutigen Platz beanspruchen — in
 * `konsolidierung.spec.ts` etwa ein freies Geschäftsjahr aus 2090-2109.
 * Nach jedem Lauf blieb das Jahr belegt. Nach rund 20 Läufen war die
 * Suite DAUERHAFT rot:
 *
 *   geschaeftsjahr muss <= 2100 sein
 *   Konflikt-Fixture konnte nicht gebaut werden
 *
 * Ein Testlauf, der den Zustand des vorherigen Laufs veraendert, ist
 * kein Test — er ist eine Messung mit Speicher. Und genau diese
 * Nicht-Reproduzierbarkeit hat in dieser Audit-Runde schon einmal eine
 * Fehldeutung produziert.
 *
 * Wichtig: Der laufende Backend-Prozess (:3000) darf dabei NICHT
 * neu gestartet werden. Er haelt keine fachlichen Zustands-Caches,
 * die nach einem Reseed veraltet wären — die Kanzlei-/Mandant-Daten
 * werden bei jedem Request neu gelesen.
 */
export default async function globalSetup(): Promise<void> {
  const backendDir = join(process.cwd(), '..', 'backend');

  try {
    execFileSync('npx', ['prisma', 'db', 'seed'], {
      cwd: backendDir,
      stdio: 'pipe',
      // Der Seed braucht DATABASE_URL aus der Umgebung. In CI ist sie
      // gesetzt; lokal wird sie aus /tmp/bzenv.sh bezogen, falls der
      // Aufrufer sie nicht selbst exportiert hat.
      env: { ...process.env },
    });
    console.log('[global-setup] DB-Seed abgeschlossen.');
  } catch (fehler) {
    const detail =
      fehler instanceof Error ? fehler.message : String(fehler);
    throw new Error(
      'Playwright-globalSetup: `prisma db seed` fehlgeschlagen. Ohne ' +
        'definierten DB-Anfangszustand ist die Frontend-Suite nicht ' +
        'wiederholbar.\n\n' +
        (process.env['DATABASE_URL']
          ? ''
          : 'Hinweis: DATABASE_URL ist in dieser Shell nicht gesetzt. Die ' +
            'Frontend-Suite spricht zwar ueber HTTP mit dem Backend auf ' +
            ':3000, der Seed braucht aber einen direkten Datenbankzugang. ' +
            'Gleiches gilt fuer jedes lokale `npm start` im Backend.\n\n') +
        `Details: ${detail}`,
    );
  }
}
