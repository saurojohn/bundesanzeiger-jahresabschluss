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
const BACKEND = join(process.cwd(), '..', 'backend', 'src', 'modules');

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

/**
 * Liest die tatsächlichen Backend-Routen aus dem Quellbaum.
 *
 * BEFUND 2026-10-17: Diese Liste war vorher **handgepflegt**:
 *
 *     // Die Backend-Routen sind zur Compile-Zeit nicht verfügbar;
 *     // die Liste wird bewusst gepflegt und im selben Commit geändert.
 *     const bekannteRouten = ['/mandant', '/bilanz', ...];
 *
 * Die Begründung stimmt nicht — die Routen sind statisch im Quelltext
 * lesbar. Und die Liste war bereits veraltet: `/jahresabschluss` fehlte,
 * obwohl der Controller existierte. Der Wächter meldete daraufhin einen
 * Fehler, den es nicht gab, und der erste Impuls war "Liste ergänzen".
 *
 * Genau das ist das Problem: **eine handgepflegte Liste kann einen echten
 * und einen erfundenen Fehler nicht unterscheiden.** Sie erzeugt Falsch-
 * Alarme (laut) und Falsch-Bestätigungen (leise) — und die Stille ist der
 * teure Fall. Nachtrag 27/28 ist genau so entstanden: `GET
 * /api/jahresabschluss` fehlte, die Oberfläche zeigte eine leere Liste,
 * und kein Wächter sagte etwas, weil er die Liste nicht kannte.
 *
 * Deshalb wird sie jetzt aus den `@Controller(...)`-Deklarationen
 * abgeleitet. Der Wächter kann nicht mehr hinter der Implementierung
 * zurückbleiben, weil er aus ihr besteht.
 */
function backendRouten(): Set<string> {
  const routen = new Set<string>();
  for (const datei of alleDateien(BACKEND)) {
    if (!datei.endsWith('.controller.ts')) continue;
    const inhalt = readFileSync(datei, 'utf8');
    // `@Controller('mandant')` und `@Controller({ path: 'v1', ... })`
    const muster = /@Controller\(\s*(?:'([^']*)'|\{\s*path:\s*'([^']*)')/g;
    let m: RegExpExecArray | null;
    while ((m = muster.exec(inhalt)) !== null) {
      const pfad = m[1] ?? m[2] ?? '';
      if (pfad) routen.add(`/${pfad}`);
    }
  }
  return routen;
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
    const bekannteRouten = backendRouten();

    // Fail-closed: eine leere Menge wuerde jeden Aufruf melden, ein
    // falscher Quellpfad wuerde `readdirSync` werfen. Beides ist laut —
    // aber die ausdrueckliche Zusicherung macht die Ursache benennbar,
    // statt sie im Fehlerbild zu verstecken.
    expect(
      bekannteRouten.size,
      'aus dem Backend-Quellbaum wurden keine Routen gelesen — ' +
        'der Wächter vergleicht dann nichts und schweigt',
    ).toBeGreaterThan(15);

    const treffer: string[] = [];
    for (const datei of alleDateien(SRC)) {
      const inhalt = readFileSync(datei, 'utf8');
      // BEFUND 2026-10-17: Das alte Muster verlangte nach dem ersten
      // Pfadsegment ein `` ` ``, `'` oder `/`:
      //
      //     /apiFetch…\(\s*[`'](\/[a-z][a-z0-9-]*)[`'/]/gi
      //
      // Damit wurde **jeder Aufruf mit Query-String übersehen**, denn dort
      // folgt auf das Segment ein `?`. Gemessen an fünf Formen:
      //
      //     apiFetch('/mandant')                       GEFUNDEN
      //     apiFetch(`/jahresabschluss/${id}/…`)        GEFUNDEN
      //     apiFetch(`/bilanz?mandantId=${m}`)          ÜBERSEHEN
      //     apiFetch(`/jahresabschlussTYPO?mandantId=…`) ÜBERSEHEN
      //     apiFetch('/mandanten')                     GEFUNDEN
      //
      // Der Wächter blieb bei genau der Fehlerklasse blind, für die er
      // geschrieben wurde — und Query-Strings sind hier die häufigste
      // Form. Der Terminator ist überflüssig: der erste Pfadabschnitt ist
      // das Prüfziel, der Rest des Strings ist egal.
      const muster = /apiFetch(?:<[^>]*>)?\(\s*[`'"](\/[a-z][a-z0-9-]*)/gi;
      let m: RegExpExecArray | null;
      while ((m = muster.exec(inhalt)) !== null) {
        const wurzel = `/${m[1].slice(1)}`;
        if (!bekannteRouten.has(wurzel)) {
          const zeile = inhalt.slice(0, m.index).split('\n').length;
          treffer.push(
            `${datei.replace(`${process.cwd()}/`, '')}:${zeile} → ${m[1]} (kein @Controller im Backend)`,
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

/**
 * Zweite Wächter-Instanz: rohe `fetch('/api/…')`-Aufrufe.
 *
 * Der erste Wächter prüft nur `apiFetch`. In fünf Stellen wird aber direkt
 * `fetch` benutzt — dort entfällt `BASE_API` automatisch, und ein
 * doppeltes `/api` fällt nicht mehr auf. Genau so entstanden schon zwei
 * Fehler (`/api/api/subscription/…` und `/mandanten`).
 */
test.describe('Rohe fetch-Aufrufe', () => {
  test('kein doppeltes /api in fetch-Aufrufen', () => {
    const treffer: string[] = [];
    for (const datei of alleDateien(SRC)) {
      const inhalt = readFileSync(datei, 'utf8');
      const muster = /fetch\(\s*[`'"](\/api[^`'"]*)[`'"]/g;
      let m: RegExpExecArray | null;
      while ((m = muster.exec(inhalt)) !== null) {
        const pfad = m[1];
        if (pfad.startsWith('/api/api/')) {
          const zeile = inhalt.slice(0, m.index).split('\n').length;
          treffer.push(`${datei.replace(`${process.cwd()}/`, '')}:${zeile} → ${pfad}`);
        }
      }
    }
    expect(treffer, 'ein doppeltes /api erzeugt /api/api/…:\n' + treffer.join('\n')).toHaveLength(0);
  });

  test('kein /api-Prefix in apiFetch-Aufrufen (Wächter 1, hier gegengeprüft)', () => {
    const treffer: string[] = [];
    for (const datei of alleDateien(SRC)) {
      const inhalt = readFileSync(datei, 'utf8');
      // apiFetch verdoppelt NICHT — es setzt BASE_API davor. Ein hier
      // enthaltenes '/api' wäre ein Fehler (siehe /tmp/oauth-Sonden).
      const muster = /apiFetch(?:<[^>]*>)?\(\s*[`'"]\/api\//g;
      if (muster.test(inhalt)) {
        const zeile = inhalt.slice(0, muster.exec(inhalt)!.index).split('\n').length;
        treffer.push(`${datei.replace(`${process.cwd()}/`, '')}:${zeile}`);
      }
    }
    expect(treffer, 'apiFetch setzt /api selbst voran:\n' + treffer.join('\n')).toHaveLength(0);
  });
});
