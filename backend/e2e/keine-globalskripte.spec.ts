import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import * as ts from 'typescript';

/**
 * Regression gegen die Globalskript-Falle (2026-10-13).
 *
 * BEFUND: In 16 von 18 e2e-Specs stand ein `beforeAll`, der eine
 * Nest-Application baute und nie benutzte. Mit ihr verschwanden beim
 * Aufräumen die `import`-Zeilen — und eine Datei ohne jeden `import` oder
 * `export` ist für TypeScript **kein Modul mehr, sondern ein Globalskript**.
 * Ihre Top-Level-Namen landen dann im globalen Scope und kollidieren
 * dateiübergreifend:
 *
 *     e2e/bilanz.e2e.spec.ts(26,7): error TS2451:
 *       Cannot redeclare block-scoped variable 'BASE'.
 *
 * Das war lokal unsichtbar, weil `npx tsc --noEmit` die zweite Projektdatei
 * der CI (`tsconfig.test.json`, umfasst e2e) nicht prüft.
 *
 * ZWEITE, TIEFERE FOLGE desselben Mechanismus: `pdf.e2e` und `signatur.e2e`
 * BENUTZTEN `LoginResponse`, deklarierten es aber nirgends — sie bekamen den
 * Typ aus dem globalen Scope einer dritten Datei. Als die zum Modul wurde,
 * brach die CI mit `Cannot find name 'LoginResponse'`.
 *
 * Dieser Test verhindert die erste Variante strukturell. Die zweite ist
 * damit ausgeschlossen, weil jede Datei ihren eigenen Scope hat.
 *
 * Warum der TypeScript-Parser und nicht eine Regex:
 * Eine Regex auf den Quelltext errät. Gemessen an elf Fällen lag sie bei
 * dreien daneben, und alle drei sind exakt die Dateien, die dieser Wächter
 * aufspüren soll:
 *
 *   - `export`/`import` in einem Blockkommentar  → Regex: Modul, TS: Script
 *   - dynamisches `import(...)` (kein Deklarat)  → Regex: Modul, TS: Script
 *   - `export` in einem Template-Literal         → Regex: Modul, TS: Script
 *
 * `ts.isExternalModule` entscheidet nach derselben Regel, nach der der
 * Compiler den Scope festlegt — es gibt keine zweite Wahrheit daneben.
 */

/** Wurzeln, die durchsucht werden. */
const WURZELN = ['src', 'e2e'];

/** Verzeichnisse, die nicht durchsucht werden. */
const AUSGENOMMEN = new Set(['node_modules', 'dist', 'generated', '__fixtures__']);

/** Ist die Datei ein Modul — im Sinne des Compilers, nicht im Sinne einer Regex? */
function istModul(quelle: string): boolean {
  const datei = ts.createSourceFile('probe.ts', quelle, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  return ts.isExternalModule(datei);
}

function sammleTsDateien(wurzel: string): string[] {
  const gefunden: string[] = [];
  const durchlaufen = (dir: string) => {
    for (const eintrag of readdirSync(dir)) {
      if (AUSGENOMMEN.has(eintrag)) continue;
      const voll = join(dir, eintrag);
      if (statSync(voll).isDirectory()) durchlaufen(voll);
      else if (eintrag.endsWith('.ts')) gefunden.push(voll);
    }
  };
  durchlaufen(wurzel);
  return gefunden;
}

describe('Struktur: keine .ts-Datei darf ein Globalskript sein', () => {
  for (const wurzel of WURZELN) {
    it(`alle Dateien unter ${wurzel}/ sind explizite Module`, () => {
      // Diese Spec liegt in `backend/e2e/` — dieselbe Basis wie global-setup.ts.
      const basis = resolve(__dirname, '..', wurzel);

      const skripte = sammleTsDateien(basis).filter((p) => {
        // `.d.ts` sind per Definition ambient. Gemessen: `ts.isExternalModule`
        // meldet sie als Script, weil sie weder importieren noch exportieren —
        // dort wäre ein `export {}` nicht nur überflüssig, sondern semantisch
        // falsch (die Datei beschreibt fremde Module).
        if (p.endsWith('.d.ts')) return false;
        return !istModul(readFileSync(p, 'utf-8'));
      });

      expect(
        skripte.map((p) => relative(basis, p)),
        'Diese Dateien haben weder import noch export und teilen damit ' +
          'ihren Top-Level-Scope mit allen anderen. Das erzeugt TS2451 ' +
          '(Cannot redeclare) und versteckte Typkopplungen. Notlösung: ' +
          'ein echtes importieren ODER `export {};` am Dateiende.',
      ).toEqual([]);
    });
  }

  /**
   * Der Wächter muss nachweisen, dass er Fälle erkennt, die er nicht erkennt
   * zu sein glaubt. Diese Fälle sind deshalb separat als Daten festgeschrieben,
   * weil jeder von ihnen schon einmal eine falsche Antwort produziert hat.
   */
  it('erkennt die Formen, an denen eine Regex scheitert', () => {
    expect(istModul('const BASE = 1;\nvoid BASE;\n')).toBe(false);
    expect(istModul('/*\nexport {}\n*/\nconst B = 1;\nvoid B;\n')).toBe(false);
    expect(istModul('const B = 1;\nimport(B).then(() => 0);\n')).toBe(false);
    expect(istModul('const s = `\nexport {} as const\n`;\nvoid s;\n')).toBe(false);
    expect(istModul('const s = "export";\nvoid s;\n')).toBe(false);
    expect(istModul('// export {}\nconst t = 1;\nvoid t;\n')).toBe(false);

    expect(istModul('import { x } from "./a";\nexport const y = x;\n')).toBe(true);
    expect(istModul('export default 1;\n')).toBe(true);
    expect(istModul('import type { A } from "./a";\nexport type { A };\n')).toBe(true);
    expect(istModul('import fs = require("node:fs");\nvoid fs;\n')).toBe(true);
  });
});
