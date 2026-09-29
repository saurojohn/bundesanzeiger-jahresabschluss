/**
 * DATEV — CSV-Writer (Semikolon-getrennt).
 *
 * Hintergrund (siehe docs/banz-schemata.md §3.3):
 *   DATEV verwendet im EXTF-Format **Semikolon** (`;`) als Feldtrenner,
 *   NICHT Komma. Strings werden in Anführungszeichen gewrapped.
 *
 * Encoding:
 *   - UTF-8 ohne BOM
 *   - Zeilenende `\r\n`
 *
 * Quoting-Regel:
 *   - Felder, die `,`, `"`, `\n`, `\r`, `\t` oder `;` enthalten, MÜSSEN
 *     in Anführungszeichen gewrapped werden.
 *   - Doppelte Anführungszeichen im Inhalt werden verdoppelt ("").
 *
 * Diese Klasse ist intern — nicht Teil der öffentlichen API des Moduls.
 */
export class DatevCsvWriter {
  private lines: string[] = [];

  /**
   * Schreibt eine einzelne Zeile.
   *
   * @param fields Felder in DATEV-Reihenfolge. null/undefined werden als leerer String geschrieben.
   */
  writeRow(fields: (string | number | null | undefined)[]): void {
    const escaped = fields.map((f) => {
      if (f === null || f === undefined) return '""';
      const s = String(f);
      // Bugfix 2026-09-28: Es wurde nur dann gequotet, wenn der Wert selbst
      // ein Trenn-/Sonderzeichen enthielt. Damit lieferte der Export z.B.
      //   Formatname;Version;Berater;Mandant
      // statt der DATEV-EXTF-Schreibweise
      //   "Formatname";"Version";"Berater";"Mandant"
      // Zwei Konsequenzen: (1) die Exporte waren nicht konform — DATEV/
      // Addison/lexware erwarten die Header-Spaltennamen in Anfuehrungszeichen;
      // (2) der eigene Import-Parser (datev-import/utils/csv-parser.ts) liest
      // die Datei zwar tolerant ein, aber der Round-Trip war inkonsistent.
      // Jetzt wird JEDES Feld gequotet, wie es der DATEV-Datenformat-Standard
      // vorsieht. Der Parser strippt die Quotes wieder sauber ab.
      return `"${s.replace(/"/g, '""')}"`;
    });
    this.lines.push(escaped.join(';'));
  }

  /**
   * Liefert einen UTF-8-Buffer mit `\r\n`-Zeilenenden.
   */
  toBuffer(): Buffer {
    const content = this.lines.length > 0 ? this.lines.join('\r\n') + '\r\n' : '';
    return Buffer.from(content, 'utf-8');
  }

  /**
   * Liefert die Zeilen als Array (für Test-Zwecke / Preview).
   */
  getLines(): string[] {
    return [...this.lines];
  }

  /**
   * Anzahl geschriebener Zeilen.
   */
  get lineCount(): number {
    return this.lines.length;
  }
}