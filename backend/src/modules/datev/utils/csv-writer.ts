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
      if (f === null || f === undefined) return '';
      const s = String(f);
      // Quote, wenn Komma, Anführungszeichen, Newline, Tabs oder Semikolon.
      // DATEV verwendet Semikolon als Trenner — daher MUSS dieses Zeichen
      // ebenfalls zum Quoting führen.
      if (
        s.includes(',') ||
        s.includes('"') ||
        s.includes('\n') ||
        s.includes('\r') ||
        s.includes('\t') ||
        s.includes(';')
      ) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
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