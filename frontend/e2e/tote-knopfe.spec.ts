import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

/**
 * Wächter gegen tote Schaltflächen.
 *
 * BEFUND 2026-10-17 (Nachtrag 38): Der Knopf „Jahresabschluss signieren"
 * hatte **keinen `onClick`**. Ein Klick tat nichts — ohne Rückmeldung,
 * ohne Fehlermeldung, ohne Network-Request. Die Schaltfläche sah aus wie
 * eine Funktion.
 *
 * Und das war die **Wiederholung** eines Fehlers, den das Projekt am
 * 2026-10-05 für GuV und Anhang gefunden und behoben hatte:
 *
 *     // Bugfix 2026-10-05: Die GuV war über die Oberfläche nicht
 *     // signierbar — `POST /signatur/sign-guv` existiert im Backend,
 *     // hatte aber keinen Bedienweg.
 *
 * `formulare.spec.ts` heißt ausdrücklich „Fachformulare: Aktionen, nicht nur
 * Rendering", prüft aber nur Branding, Webhooks, API-Keys und Audit — vier
 * der acht Fachseiten. **Nicht** Bilanz, GuV, Anhang, Jahresabschluss.
 *
 * ## Warum ein statischer Wächter und kein Browser-Test
 *
 * Ein Browser-Test müsste jede Schaltfläche anklicken und prüfen, ob sich
 * etwas ändert. Das ist nicht automatisiert machbar — man wüsste nicht, was
 * sich ändern *muss*. Ein Knopf ohne `onClick` hat per Definition keinen
 * Handler, und das steht im Quelltext.
 *
 * ## Keine Ausnahmeliste
 *
 * Der Wächter kennt **keine Ausnahmen**. Als er geschrieben wurde, gab es
 * fünf Kandidaten — allesamt Vorschau-Muster im Branding-Editor
 * („Beispiel Primärfarbe"), die nie klickbar waren:
 *
 *     <button type="button" className="rounded px-3 py-1.5 …">
 *       {t('branding.preview.samplePrimary')}
 *     </button>
 *
 * Zwei Wege waren offen: eine Ausnahmeliste führen — oder die Muster so
 * rendern, wie sie gemeint sind. Sie sind **Vorschauen**, keine Aktionen,
 * also sind sie jetzt `<span>`. Damit ist die Regel ohne Ausnahme
 * durchsetzbar.
 *
 * **Das ist der Punkt:** Eine Ausnahmeliste wird wie jede handgepflegte
 * Liste veralten und stillschweigend Falsch-Bestätigungen liefern
 * (Nachtrag 32). Eine Regel, die keine Ausnahme braucht, kann das nicht.
 *
 * ## Was dieser Wächter nicht behauptet
 *
 * Er sagt **nichts** darüber, ob ein `onClick` das Richtige tut. Ein Knopf
 * mit `onClick={() => setNichts()}` gilt ihm als belegt. Er findet nur das,
 * was man im Quelltext sehen kann: gar nichts.
 */

const SRC = join(process.cwd(), 'src');

function alleDateien(dir: string): string[] {
  const gefunden: string[] = [];
  for (const eintrag of readdirSync(dir)) {
    const voll = join(dir, eintrag);
    if (statSync(voll).isDirectory()) {
      gefunden.push(...alleDateien(voll));
    } else if (/\.tsx$/.test(eintrag)) {
      gefunden.push(voll);
    }
  }
  return gefunden;
}

/**
 * Öffnende `<button …>`-Tags, auch über mehrere Zeilen.
 *
 * `[^>]*` bricht an einem `>` innerhalb eines Attributwerts. Das ist hier
 * unkritisch: die Alternative wäre ein echter Parser, und ein zu kurzer
 * Greffer erzeugt Falsch-Negative — die schlimmere Richtung.
 */
const BUTTON = /<button\b[^>]*>/g;

test('keine Schaltfläche ohne Handler', () => {
  const treffer: string[] = [];
  let gesamt = 0;

  for (const datei of alleDateien(SRC)) {
    const inhalt = readFileSync(datei, 'utf8');
    for (const m of inhalt.matchAll(BUTTON)) {
      gesamt += 1;
      const tag = m[0];
      if (tag.includes('onClick') || tag.includes('type="submit"')) continue;
      const zeile = inhalt.slice(0, m.index).split('\n').length;
      treffer.push(
        `${datei.replace(`${process.cwd()}/`, '')}:${zeile} → ` +
          'ein <button> ohne onClick und ohne type="submit" — ' +
          'der Knopf sieht wie eine Funktion aus und tut nichts',
      );
    }
  }

  // Fail-closed: sieht der Wächter nichts, ist das kein „alles in Ordnung",
  // sondern ein defekter Wächter. Ein Scan, der 0 Buttons findet, würde
  // jede Zusicherung oben trivial erfüllen. Dasselbe Argument wie bei
  // `api-pfade` (Nachtrag 32).
  expect(
    gesamt,
    'der Wächter hat keine <button>-Elemente gefunden — er prüft dann nichts ' +
      'und meldet trotzdem „grün"',
  ).toBeGreaterThan(50);

  expect(
    treffer,
    'Schaltflächen ohne Wirkung:\n' + treffer.join('\n'),
  ).toHaveLength(0);
});
