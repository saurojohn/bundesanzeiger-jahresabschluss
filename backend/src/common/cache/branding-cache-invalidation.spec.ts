import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * Wächter: Wer ein Branding-Feld schreibt, invalidiert den Branding-Cache.
 *
 * BEFUND 2026-10-22 (Nachtrag 84): `GET /api/branding/:kanzleiId` liefert
 * aus dem Cache (`branding:<kanzleiId>`, TTL 1 h). Die DNS-Verifikation
 * schreibt genau die Felder, die dieser Cache haelt (`customDomain`,
 * `customDomainVerified`) — invalidierte den Cache aber nicht.
 *
 * **Gemessen** an der laufenden API:
 *
 *     POST /api/dns/<id>/start-verification  {customDomain: "mess-cache-…"}
 *       -> HTTP 200
 *     SELECT "customDomain" FROM kanzlei
 *       -> "mess-cache-….example.de"
 *     GET /api/branding/<id>
 *       -> {"customDomain": null}          <- bis zu einer Stunde alt
 *
 * Der Fehler war nicht schwer zu finden, aber **leicht zu wiederholen**:
 * das Branding-Modell invalidiert an allen **drei** eigenen Schreibpfaden
 * (Farben/Domain, Logo-Upload, Logo-Loeschen) — nur der Schreibpfad
 * **ausserhalb** des Moduls blieb unberuecksichtigt.
 *
 * ## Warum ein Wächter und kein Einzelfalltest
 *
 * Der Einzelfalltest (der DNS-Service invalidiert) faellt nicht, wenn ein
 * **weiterer** Schreiber dazukommt. Der Wächter macht die Regel
 * durchsetzbar: jede Datei, die ein Branding-Feld der Kanzlei schreibt,
 * muss den Branding-Cache invalidieren.
 *
 * ## Keine Ausnahmeliste
 *
 * Es gibt keine Ausnahmeliste — die Regel ist unconditional. Wer ein
 * Branding-Feld schreibt, invalidiert den Cache; das ist an einer Stelle
 * eine Zeile.
 *
 * ## Was der Wächter prüft — und warum das kein Loch ist
 *
 * Geprüft wird die **Service-Schicht**: dort liegt die fachliche Verantwortung
 * für eine Mutation und damit auch für die Cache-Pflege. Ausgenommen sind
 * zwei Schichten, die per Definition nicht zuständig sind:
 *
 *   - `src/common/repositories/` — die Datenschicht. Sie schreibt, ohne die
 *     fachliche Bedeutung zu kennen, und kennt den Cache nicht. Die
 *     Invalidierung gehört dem Aufrufer — und der Aufrufer wird geprüft:
 *     ein Service, der ein Branding-Feld über das Repository schreibt,
 *     enthält den Schreibaufruf (`updateBranding(`) und wird damit erfasst.
 *   - die Routing-Schicht (`controllers/`). Sie ruft Services auf; die
 *     Schreibpfade stehen im Service. (Ein Controller, der direkt schreibt,
 *     wäre ohnehin ein Befund — der `auth`-Controller schreibt am User, nicht
 *     an Branding-Feldern.)
 *
 * Der Wächter kennt **keine Ausnahmeliste** für einzelne Dateien: die Regel
 * gilt für jede Datei der Service-Schicht.
 */
const SRC = join(process.cwd(), 'src');

/** Die Felder, die `KanzleiBrandingDto` aus der Kanzlei liest. */
const BRANDING_FELDER = [
  'logoUrl',
  'logoWormKey',
  'primaryColor',
  'accentColor',
  'customDomain',
  'customDomainVerified',
];

/**
 * Muster, die einen Schreibvorgang auf den Branding-Feldern anzeigen —
 * sowohl der direkte Prisma-Zugriff als auch der Weg ueber das Repository.
 *
 * Wer ueber das Repository schreibt, delegiert an die Datenschicht — die
 * **Invalidierung** bleibt beim Aufrufer, und der Aufrufer wird hier
 * erfasst.
 */
const SCHREIBMUSTER = [
  'prisma.kanzlei.update(',
  'prismaService.kanzlei.update(',
  'updateBranding(',
  'updateLogo(',
  'clearLogo(',
];

/**
 * Schichten, die nicht geprüft werden: die Datenschicht (Repository) und
 * die Routing-Schicht (Controller). Beide sind per Definition nicht
 * zustaendig fuer die Cache-Pflege — der Aufrufer (der Service) wird
 * geprueft.
 */
const AUSGENOMMENE_PFADE = ['src/common/repositories/', 'controllers/'];

function alleTsDateien(dir: string): string[] {
  const treffer: string[] = [];
  for (const eintrag of readdirSync(dir)) {
    const pfad = join(dir, eintrag);
    if (statSync(pfad).isDirectory()) {
      treffer.push(...alleTsDateien(pfad));
    } else if (eintrag.endsWith('.ts') && !eintrag.endsWith('.spec.ts')) {
      treffer.push(pfad);
    }
  }
  return treffer;
}

function istAusgenommen(datei: string): boolean {
  const relativ = datei.replace(process.cwd() + '/', '');
  // Beide Ausschluesse sind eindeutige Pfadbestandteile.
  return AUSGENOMMENE_PFADE.some((p) => relativ.includes(p));
}

describe('Branding-Cache: jeder Schreiber der Branding-Felder invalidiert ihn', () => {
  const dateien = alleTsDateien(SRC).filter((f) => !istAusgenommen(f));

  it('findet die Schreibpfade ueberhaupt (kein stiller Leerlauf)', () => {
    // Ohne diesen Test waere ein leerer Fund ("keine Datei schreibt ein
    // Branding-Feld") genauso gruen wie der echte Befund.
    const schreiber = dateien.filter((f) => {
      const code = readFileSync(f, 'utf-8');
      return SCHREIBMUSTER.some((m) => code.includes(m));
    });
    expect(schreiber.length, 'es muss Schreibpfade auf der Kanzlei geben').toBeGreaterThan(0);
  });

  it('invalidiert den Branding-Cache in jedem Schreibpfad', () => {
    const verstaesse: string[] = [];

    for (const datei of dateien) {
      const code = readFileSync(datei, 'utf-8');
      const schreibt = SCHREIBMUSTER.some((m) => code.includes(m));
      if (!schreibt) continue;

      // Beruehrt die Datei ueberhaupt ein Branding-Feld?
      const beruehrtBrandingFeld = BRANDING_FELDER.some((f) =>
        new RegExp(`\\b${f}\\b`).test(code),
      );
      if (!beruehrtBrandingFeld) continue;

      // Dann muss der Branding-Cache invalidiert werden.
      if (!code.includes('branding:')) {
        verstaesse.push(datei.replace(process.cwd() + '/', ''));
      }
    }

    expect(
      verstaesse,
      'diese Dateien schreiben ein Branding-Feld, invalidieren den ' +
        'Branding-Cache aber nicht: ' + verstaesse.join(', '),
    ).toEqual([]);
  });
});
