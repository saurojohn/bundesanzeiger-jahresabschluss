/**
 * Vitest globalSetup — setzt die Datenbank vor JEDEM Testlauf in einen
 * definierten Ausgangszustand.
 *
 * Warum das nötig ist (Audit-Befund 2026-09-28):
 *   Die e2e-Specs legen Buchungen mit FESTEN Geschäftsjahren an (2024/2025).
 *   Die Tabellen haben einen Unique-Constraint auf (mandantId, geschaeftsjahr).
 *   Ein zweiter `vitest run` auf derselben DB kollidiert deshalb mit
 *     400 "Für diesen Mandanten existiert bereits eine Bilanz für das
 *        Geschäftsjahr 2024."
 *   und die Fehlerzahl wächst von Lauf zu Lauf (gemessen: 104/22 im ersten
 *   Lauf, 112/14 im zweiten). Eine grüne Zahl war damit ein Artefakt des
 *   DB-Zustands und nicht des Codes — der schlimmste Fall, weil sie aussieht
 *   wie Fortschritt.
 *
 * Was wir tun:
 *   `prisma db seed` ausführen. Der Seed macht seit dem Fix einen vollständigen
 *   TRUNCATE ... CASCADE über alle Tabellen und legt danach die Demo-Daten an
 *   (Kanzlei, 3 Mandanten, 5 User, Bilanz/GuV/Anhang GJ 2025, IDW-Regeln).
 *   Damit startet jeder Lauf aus demselben Zustand.
 *
 * Voraussetzung: Postgres läuft und ist migriert (siehe run-local.sh).
 * Läuft der Test ohne DB, bricht der Lauf hier verständlich ab — das ist
 * deutlich besser als 110 "grüne" Tests, die nichts geprüft haben.
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

export default async function setup(): Promise<void> {
  const backendDir = resolve(__dirname, '..');
  console.log('[globalSetup] DB wird in definierten Ausgangszustand versetzt (prisma db seed) …');

  try {
    execFileSync('npx', ['prisma', 'db', 'seed'], {
      cwd: backendDir,
      stdio: 'pipe',
      env: process.env,
    });
    console.log('[globalSetup] DB-Reset abgeschlossen.');
  } catch (err) {
    const e = err as { status?: number | null; stderr?: Buffer; stdout?: Buffer };
    const detail = (e.stderr?.toString() || e.stdout?.toString() || '').trim();
    throw new Error(
      'globalSetup: `prisma db seed` fehlgeschlagen ' +
        `(exit ${e.status}).\n${detail}\n\n` +
        'Läuft Postgres? Sind die Migrationen angewendet?\n' +
        '→ cd /workspace/bundesanzeiger && ./run-local.sh',
    );
  }
}

export async function teardown(): Promise<void> {
  // Die DB bleibt nach dem Lauf bestehen, damit der Zustand inspiziert
  // werden kann (z.B. mit psql). Ein Aufräumen hier würde den nächsten
  // Lauf zwar nicht stören (globalSetup setzt ohnehin zurück), aber es würde
  // die Fehlersuche unnötig erschweren.
}
