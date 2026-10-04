import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

/**
 * Statische Wächter für die API-Pfade im Frontend.
 *
 * Zwei Fehlerklassen, die beide per Zufall gefunden wurden und beide in der
 * Oberfläche unbrauchbare Aktionen erzeugten:
 *
 * 1. Doppelter `/api`-Prefix. `apiFetch` setzt `BASE_API = '/api'` selbst
 *    davor. Ein Aufruf mit hart kodiertem `/api` landet auf
 *    `/api/api/...` → 404. Betroffen war `SubscriptionView`
 *    (mock-activate), also der Dev-/Pilot-Betrieb.
 * 2. Falscher Pfad. `WPView` rief `/mandanten` (Plural); der Endpoint heißt
 *    `/mandant`. Der 404 beendete die Ladefunktion, die Seite blieb für
 *    immer auf "Wird geladen …".
 *
 * Ein Test, der nur EINE Seite besucht, sieht beide nicht. Diese Wächter
 * laufen über den gesamten Quellbaum.
 */
const SRC = join(process.cwd(), 'src');

function alleDateien(dir: string): string[] {
  const gefunden: string[] = [];
  for (const eintrag of readdirSync(dir)) {
    const voll = join(dir, eintrag);
    if (statSync(voll).isDirectory()) {
      gefunden.push(...alleDateien(voll));
    } else if (/\.(ts|tsx)$/.test(eintrag)) {
      gefunden.push(voll);
    }
  }
  return gefunden;
}

test.describe('API-Pfade im Quellbaum', () => {
  test('kein apiFetch-Aufruf mit hart kodiertem /api-Praefix', () => {
    const treffer: string[] = [];
    for (const datei of alleDateien(SRC)) {
      const inhalt = readFileSync(datei, 'utf8');
      // apiFetch(...) mit '/api...' als erstem Argument.
      // `\/api(?=\/|[`'"])` statt `\/api…`: sonst matcht auch
      // `/api-keys` (Pfad `/api` + `/api-keys`), was KEIN doppelter
      // Prefix ist — der erste Wächter-Lauf schlug deshalb falsch an.
      const muster = /apiFetch(?:<[^>]*>)?\(\s*[`'"](\/api(?=\/|[`'"])[^`'"]*)[`'"]/g;
      let trefferMuster: RegExpExecArray | null;
      while ((trefferMuster = muster.exec(inhalt)) !== null) {
        const zeile = inhalt.slice(0, trefferMuster.index).split('\n').length;
        treffer.push(
          `${datei.replace(`${process.cwd()}/`, '')}:${zeile} → ${trefferMuster[1]}`,
        );
      }
    }
    expect(
      treffer,
      'apiFetch setzt /api bereits davor — ein Praefix erzeugt /api/api/...:\n' +
        treffer.join('\n'),
    ).toHaveLength(0);
  });

  test('kein Aufruf auf einen Pfad, den es im Backend nicht gibt', () => {
    // Die Backend-Routen sind zur Compile-Zeit nicht verfügbar; die Liste
    // wird bewusst gepflegt und im selben Commit mit dem Code geändert.
    const bekannteRouten = [
      '/mandant',
      '/bilanz',
      '/guv',
      '/anhang',
      '/audit',
      '/wp',
      '/konsolidierung',
      '/datev-import',
      '/branding',
      '/webhook-subscriptions',
      '/subscription',
      '/api-keys',
      '/dns',
      '/pdf',
      '/ebilanz',
      '/datev',
      '/signatur',
      '/auth',
    ];
    const treffer: string[] = [];
    for (const datei of alleDateien(SRC)) {
      const inhalt = readFileSync(datei, 'utf8');
      const muster = /apiFetch(?:<[^>]*>)?\(\s*[`'](\/[a-z][a-z0-9-]*)[`'/]/gi;
      let m: RegExpExecArray | null;
      while ((m = muster.exec(inhalt)) !== null) {
        const wurzel = `/${m[1].slice(1)}`;
        if (!bekannteRouten.includes(wurzel)) {
          const zeile = inhalt.slice(0, m.index).split('\n').length;
          treffer.push(
            `${datei.replace(`${process.cwd()}/`, '')}:${zeile} → ${m[1]} (unbekannter Präfix)`,
          );
        }
      }
    }
    expect(
      treffer,
      'Pfad ohne passende Backend-Route:\n' + treffer.join('\n'),
    ).toHaveLength(0);
  });
});
