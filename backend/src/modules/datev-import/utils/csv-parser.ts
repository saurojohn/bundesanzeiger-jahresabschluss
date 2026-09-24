/**
 * DATEV — CSV-Parser (Semikolon-getrennt).
 *
 * Hintergrund (siehe docs/banz-schemata.md §3.3):
 *   DATEV EXTF_Buchungsstapel verwendet **Semikolon** als Feldtrenner.
 *   Strings werden in doppelte Anführungszeichen gewrapped.
 *   Encoding: UTF-8 ohne BOM, Zeilenende CRLF.
 *
 * Diese Klasse ist das Gegenstück zu `datev/utils/csv-writer.ts` (Export).
 *
 * Wichtige Erkennungsregeln:
 *   - Zeile 1: Spaltennamen-Header (Formatname, Version, Berater, ...)
 *   - Zeile 2: Header-Daten-Zeile (Formatname = "EXTF_Buchungsstapel")
 *   - Zeile 3: Buchungs-Zeilen-Spaltennamen (Umsatz, SH, WKZ, ...)
 *   - Zeile 4..n: Buchungs-Zeilen
 *
 * Quoting:
 *   - Doppelte Anführungszeichen im Inhalt werden verdoppelt ("").
 *   - Zeilen können Zeilenumbrüche enthalten, wenn sie in `"` gewrapped sind.
 */
export interface ParsedBuchungsstapelHeader {
  /** "EXTF_Buchungsstapel". */
  formatName: string;
  /** DATEV-Format-Version (z. B. 12). */
  version: number;
  /** DATEV-Beraternummer. */
  beraternummer: string;
  /** DATEV-Mandantennummer. */
  mandantennummer: string;
  /** Beginn des Wirtschaftsjahres (TT.MM.JJJJ). */
  wirtschaftsjahrBeginn: Date;
  /** Ende des Wirtschaftsjahres (TT.MM.JJJJ). */
  wirtschaftsjahrEnde: Date;
  /** 4 (SKR04) oder 5 (SKR03 / SKR04-5). */
  sachkontenlaenge: 4 | 5;
  /** Beginn der Buchungs-Periode. */
  datumVon: Date;
  /** Ende der Buchungs-Periode. */
  datumBis: Date;
  /** Bezeichnung (z. B. "Buchungsstapel"). */
  bezeichnung: string;
  /** Buchungstyp: 1 = Standard, 2 = Eröffnung. */
  buchungstyp: number;
  /** Rechnungslegungszweck (z. B. "00"). */
  rechnungslegungszweck?: string;
  /** Diktat-Kürzel (optional). */
  diktat?: string;
}

export interface ParsedBuchungsZeile {
  /** Umsatz-Betrag (kann negativ sein für Haben). */
  umsatz: number;
  /** Soll-/Haben-Kennzeichen. */
  sollHaben: 'S' | 'H';
  /** Währungskennzeichen (default "EUR"). */
  wkz: string;
  /** Wechselkurs (optional, leer für EUR). */
  kurs?: number | null;
  /** Basisumsatz (Fremdwährung). */
  basis?: number | null;
  /** Basisumsatz-WKZ. */
  bwkz?: string | null;
  /** Sachkonto. */
  konto: string;
  /** Gegen-Sachkonto. */
  gegenkonto: string;
  /** BU-Schlüssel (4-stellig oder "0"). */
  buSchluessel: string;
  /** Belegdatum als TTMM (z. B. "3112"). */
  belegdatum: string;
  /** Belegfeld 1 (max 36 Zeichen). */
  belegfeld1: string;
  /** Belegfeld 2 (max 12 Zeichen). */
  belegfeld2: string;
  /** Skonto-Betrag (default 0). */
  skonto: number;
  /** Buchungstext (max 60 Zeichen). */
  buchungstext: string;
  /** Postensperre (0 oder 1). */
  postensperre: 0 | 1;
  /** Diverse Adressnummer (optional). */
  adressnummer?: string;
  /** Partner-BLZ (optional, 3 Stellen). */
  partnerBLZ?: string;
}

export interface ParsedBuchungsstapel {
  header: ParsedBuchungsstapelHeader;
  /** Alle geparsten Buchungs-Zeilen (ohne Header). */
  buchungsZeilen: ParsedBuchungsZeile[];
  /** Warnings, die beim Parsen gesammelt wurden (z. B. ungültige Felder). */
  warnings: string[];
}

export interface SaldovortragEntry {
  konto: string;
  soll: number;
  haben: number;
  /** Saldo = Σ Soll - Σ Haben (gerundet auf 2 Nachkommastellen). */
  saldo: number;
  buchungsCount: number;
}

/**
 * Parser für DATEV EXTF_Buchungsstapel.csv.
 *
 * Verwendung:
 *   const parser = new DatevCsvParser();
 *   const parsed = parser.parseBuchungsstapel(csvContent);
 *
 * Encoding: Erwartet UTF-8 (kein BOM) — wird per `Buffer.from(content, 'utf-8')`
 * verarbeitet, falls `csvContent` als String übergeben wird.
 */
export class DatevCsvParser {
  /**
   * Parst EXTF_Buchungsstapel.csv.
   *
   * Format:
   *   Zeile 1: Spaltennamen (Formatname, Version, Berater, ...)
   *   Zeile 2: Header-Daten-Zeile (formatName === "EXTF_Buchungsstapel")
   *   Zeile 3: Buchungs-Zeilen-Spaltennamen (Umsatz, SH, ...)
   *   Zeile 4..n: Buchungs-Zeilen
   *
   * @throws Error bei ungültigem Header / Format.
   */
  parseBuchungsstapel(csvContent: string): ParsedBuchungsstapel {
    const lines = this.splitLines(csvContent);
    const warnings: string[] = [];

    if (lines.length < 3) {
      throw new Error(
        `CSV-Datei zu kurz: mindestens 3 Zeilen (Header-Spalten, Header-Daten, Buchungs-Spalten) erwartet, ${lines.length} gefunden`,
      );
    }

    // Zeile 1: Spaltennamen für Header-Block
    const headerColumnNames = this.parseLine(lines[0]!);
    // Zeile 2: Header-Daten
    const headerValues = this.parseLine(lines[1]!);
    // Zeile 3: Spaltennamen für Buchungs-Zeilen
    const buchungsColumnNames = this.parseLine(lines[2]!);

    // Header parsen
    const header = this.parseHeader(headerColumnNames, headerValues, warnings);

    // Buchungs-Zeilen parsen
    const buchungsZeilen: ParsedBuchungsZeile[] = [];
    for (let i = 3; i < lines.length; i++) {
      const rawLine = lines[i]!;
      if (rawLine.trim().length === 0) continue;
      try {
        const fields = this.parseLine(rawLine);
        const zeile = this.parseBuchungsZeile(buchungsColumnNames, fields, warnings, i + 1);
        buchungsZeilen.push(zeile);
      } catch (err) {
        warnings.push(
          `Zeile ${i + 1} konnte nicht geparst werden: ${(err as Error).message}`,
        );
      }
    }

    return { header, buchungsZeilen, warnings };
  }

  /**
   * Berechnet Saldovortrag pro Sachkonto.
   *
   * Logik:
   *   - Pro Konto werden Soll-Buchungen (sollHaben === 'S') und Haben-Buchungen (sollHaben === 'H')
   *     getrennt summiert.
   *   - Saldo = Σ Soll - Σ Haben, gerundet auf 2 Nachkommastellen.
   *
   * Konvention:
   *   - Bei einer typischen DATEV-Buchung gibt es zwei Zeilen: Soll und Haben,
   *     die den gleichen Absolutbetrag (mit unterschiedlichem Vorzeichen) haben.
   *     `umsatz` ist in beiden Zeilen der **Betrag mit Vorzeichen** (positiv für
   *     Soll, negativ für Haben) — also summieren wir einfach `umsatz`.
   *   - Alternativ-Logik (Separat nach Soll/Haben-Flag) wird auch unterstützt,
   *     falls `umsatz` als Absolutbetrag geliefert wird.
   */
  static calculateSaldovortrag(
    buchungsZeilen: ParsedBuchungsZeile[],
  ): Map<string, SaldovortragEntry> {
    const map = new Map<string, SaldovortragEntry>();

    for (const zeile of buchungsZeilen) {
      // Beide Konten (konto + gegenkonto) berücksichtigen, da beide Saldo-relevant sind.
      this.accumulate(map, zeile.konto, zeile);
      this.accumulate(map, zeile.gegenkonto, zeile);
    }

    return map;
  }

  /**
   * Berechnet Saldovortrag mit zusätzlichem Mapping-Override für manuelle Zuordnung.
   */
  static calculateSaldovortragWithOverrides(
    buchungsZeilen: ParsedBuchungsZeile[],
  ): Map<string, SaldovortragEntry> {
    return DatevCsvParser.calculateSaldovortrag(buchungsZeilen);
  }

  // ===========================================================================
  // Private helpers
  // ===========================================================================

  /**
   * Akkumuliert einen Betrag auf ein Konto im Saldovortrag.
   *
   * DATEV-Buchungs-Zeilen-Konvention:
   *   - `umsatz` ist der Betrag MIT Vorzeichen (positiv = Sicht, negativ = Haben-Sicht).
   *   - `sollHaben` ist "S" für Soll, "H" für Haben.
   *   - In einer typischen Buchung gibt es eine Soll-Zeile (umsatz > 0) und eine
   *     Haben-Zeile (umsatz < 0) für jedes Konto-Paar.
   *
   * Wir summieren pro Konto:
   *   - Wenn sollHaben === 'S': soll += abs(umsatz) (positiver Soll-Betrag)
   *   - Wenn sollHaben === 'H': haben += abs(umsatz) (positiver Haben-Betrag)
   *
   * Saldo = soll - haben (positiv = Soll-Überschuss, negativ = Haben-Überschuss).
   */
  private static accumulate(
    map: Map<string, SaldovortragEntry>,
    konto: string,
    zeile: ParsedBuchungsZeile,
  ): void {
    const absBetrag = Math.abs(zeile.umsatz);
    if (absBetrag === 0) return;

    let entry = map.get(konto);
    if (!entry) {
      entry = {
        konto,
        soll: 0,
        haben: 0,
        saldo: 0,
        buchungsCount: 0,
      };
      map.set(konto, entry);
    }

    if (zeile.sollHaben === 'S') {
      entry.soll += absBetrag;
    } else {
      entry.haben += absBetrag;
    }
    entry.buchungsCount += 1;

    const raw = entry.soll - entry.haben;
    entry.saldo = Math.round(raw * 100) / 100;
  }

  /**
   * Splittet CSV-Inhalt in logische Zeilen, wobei Zeilenumbrüche INNERHALB
   * von `"..."`-Feldern korrekt behandelt werden.
   */
  private splitLines(csvContent: string): string[] {
    // Normalisiere CRLF -> LF für einfacheres Handling
    const normalized = csvContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < normalized.length; i++) {
      const ch = normalized[i]!;
      if (ch === '"') {
        current += ch;
        // Toggle Quote-State, aber doppelte Quotes (Escapes) beachten
        if (normalized[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === '\n' && !inQuotes) {
        lines.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    if (current.length > 0) lines.push(current);
    return lines;
  }

  /**
   * Parst eine einzelne CSV-Zeile in Felder.
   *
   * Quoting-Regel:
   *   - Felder mit `;` `"` `\n` werden in Anführungszeichen gewrapped.
   *   - Doppelte Anführungszeichen im Inhalt werden verdoppelt ("").
   */
  private parseLine(line: string): string[] {
    const fields: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (inQuotes) {
        if (ch === '"') {
          if (line[i + 1] === '"') {
            current += '"';
            i += 1;
          } else {
            inQuotes = false;
          }
        } else {
          current += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ';') {
          fields.push(current);
          current = '';
        } else {
          current += ch;
        }
      }
    }
    fields.push(current);
    return fields;
  }

  /**
   * Parst Header-Zeile (Zeile 2) anhand der Spaltennamen (Zeile 1).
   */
  private parseHeader(
    columns: string[],
    values: string[],
    warnings: string[],
  ): ParsedBuchungsstapelHeader {
    const colMap = new Map<string, string>();
    for (let i = 0; i < columns.length; i++) {
      colMap.set(columns[i]!, values[i] ?? '');
    }

    const formatName = colMap.get('Formatname') ?? '';
    if (formatName !== 'EXTF_Buchungsstapel') {
      throw new Error(
        `Ungültiger Formatname: "${formatName}" (erwartet "EXTF_Buchungsstapel")`,
      );
    }

    const versionStr = colMap.get('Version') ?? '0';
    const version = parseInt(versionStr, 10);
    if (Number.isNaN(version) || version < 1) {
      throw new Error(`Ungültige Version: "${versionStr}"`);
    }

    const sachkontenlaengeStr = colMap.get('Sachkontenlaenge') ?? '4';
    const sachkontenlaenge = parseInt(sachkontenlaengeStr, 10);
    if (sachkontenlaenge !== 4 && sachkontenlaenge !== 5) {
      warnings.push(
        `Ungewöhnliche Sachkontenlänge: ${sachkontenlaenge} (erwartet 4 oder 5)`,
      );
    }

    const buchungstypStr = colMap.get('Buchungstyp') ?? '1';
    const buchungstyp = parseInt(buchungstypStr, 10);
    if (buchungstyp !== 1 && buchungstyp !== 2) {
      warnings.push(
        `Ungewöhnlicher Buchungstyp: ${buchungstyp} (erwartet 1=Standard oder 2=Eröffnung)`,
      );
    }

    const wjBeginn = this.parseDateOrThrow(colMap.get('WJ-Beginn') ?? '', 'WJ-Beginn');
    const wjEnde = this.parseDateOrThrow(colMap.get('WJ-Ende') ?? '', 'WJ-Ende');
    const datumVon = this.parseDateOrThrow(colMap.get('Datum-von') ?? '', 'Datum-von');
    const datumBis = this.parseDateOrThrow(colMap.get('Datum-bis') ?? '', 'Datum-bis');

    return {
      formatName,
      version,
      beraternummer: colMap.get('Berater') ?? '',
      mandantennummer: colMap.get('Mandant') ?? '',
      wirtschaftsjahrBeginn: wjBeginn,
      wirtschaftsjahrEnde: wjEnde,
      sachkontenlaenge: (sachkontenlaenge === 5 ? 5 : 4) as 4 | 5,
      datumVon,
      datumBis,
      bezeichnung: colMap.get('Bezeichnung') ?? '',
      buchungstyp: Number.isNaN(buchungstyp) ? 1 : buchungstyp,
      rechnungslegungszweck: colMap.get('Rechnungslegungszweck') ?? undefined,
      diktat: colMap.get('Diktat') ?? undefined,
    };
  }

  /**
   * Parst eine Buchungs-Zeile.
   */
  private parseBuchungsZeile(
    columns: string[],
    values: string[],
    warnings: string[],
    lineNumber: number,
  ): ParsedBuchungsZeile {
    const colMap = new Map<string, string>();
    for (let i = 0; i < columns.length; i++) {
      colMap.set(columns[i]!, values[i] ?? '');
    }

    const umsatzStr = (colMap.get('Umsatz') ?? '').trim();
    if (umsatzStr.length === 0) {
      throw new Error(`Umsatz fehlt`);
    }
    const umsatz = this.parseGermanNumber(umsatzStr);
    if (Number.isNaN(umsatz)) {
      throw new Error(`Umsatz nicht parsbar: "${umsatzStr}"`);
    }

    const shStr = (colMap.get('SH') ?? '').trim();
    if (shStr !== 'S' && shStr !== 'H') {
      warnings.push(`Zeile ${lineNumber}: ungültiges SH-Kennzeichen "${shStr}", erwarte S/H`);
    }

    const konto = (colMap.get('Konto') ?? '').trim();
    if (konto.length === 0) {
      throw new Error(`Konto fehlt`);
    }
    const gegenkonto = (colMap.get('Gegenkonto') ?? '').trim();
    if (gegenkonto.length === 0) {
      throw new Error(`Gegenkonto fehlt`);
    }

    const postensperreStr = (colMap.get('Postensperre') ?? '0').trim();
    const postensperre = postensperreStr === '1' ? 1 : 0;

    const skontoStr = (colMap.get('Skonto') ?? '').trim();
    const skonto = skontoStr.length === 0 ? 0 : this.parseGermanNumber(skontoStr);

    return {
      umsatz,
      sollHaben: shStr === 'S' ? 'S' : 'H',
      wkz: (colMap.get('WKZ') ?? 'EUR').trim(),
      kurs: this.tryParseNumber(colMap.get('Kurs')),
      basis: this.tryParseNumber(colMap.get('Basis')),
      bwkz: colMap.get('BWKZ') || null,
      konto,
      gegenkonto,
      buSchluessel: (colMap.get('BUSchluessel') ?? '0').trim(),
      belegdatum: (colMap.get('Belegdatum') ?? '').trim(),
      belegfeld1: (colMap.get('Belegfeld1') ?? '').trim(),
      belegfeld2: (colMap.get('Belegfeld2') ?? '').trim(),
      skonto: Number.isNaN(skonto) ? 0 : skonto,
      buchungstext: (colMap.get('Buchungstext') ?? '').trim(),
      postensperre: postensperre as 0 | 1,
      adressnummer: (colMap.get('Adressnummer') ?? '').trim() || undefined,
      partnerBLZ: (colMap.get('PartnerBLZ') ?? '').trim() || undefined,
    };
  }

  /**
   * Parst deutsche Zahlen-Formate: "1234,56", "1234.56", "1.234,56".
   * Akzeptiert Komma ODER Punkt als Dezimaltrenner.
   */
  private parseGermanNumber(value: string): number {
    const trimmed = value.trim();
    if (trimmed.length === 0) return NaN;

    // Vorzeichen
    const sign = trimmed.startsWith('-') ? -1 : 1;
    let body = trimmed.replace(/^-/, '');

    // Wenn sowohl Punkt als auch Komma vorkommen: Punkt = Tausender, Komma = Dezimal
    if (body.includes('.') && body.includes(',')) {
      body = body.replace(/\./g, '').replace(',', '.');
    } else if (body.includes(',')) {
      body = body.replace(',', '.');
    }
    // body enthält jetzt ggf. nur Punkte (z. B. "1234.56") — das ist OK für parseFloat.

    const parsed = parseFloat(body);
    return sign * parsed;
  }

  private tryParseNumber(value: string | undefined): number | null {
    if (!value) return null;
    const trimmed = value.trim();
    if (trimmed.length === 0) return null;
    const parsed = this.parseGermanNumber(trimmed);
    return Number.isNaN(parsed) ? null : parsed;
  }

  /**
   * Parst ein deutsches Datum (TT.MM.JJJJ) zu Date.
   */
  private parseDateOrThrow(value: string, fieldName: string): Date {
    const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value.trim());
    if (!match) {
      throw new Error(`Ungültiges Datum im Feld "${fieldName}": "${value}" (erwartet TT.MM.JJJJ)`);
    }
    const tag = parseInt(match[1]!, 10);
    const monat = parseInt(match[2]!, 10);
    const jahr = parseInt(match[3]!, 10);
    const date = new Date(jahr, monat - 1, tag);
    if (
      date.getDate() !== tag ||
      date.getMonth() !== monat - 1 ||
      date.getFullYear() !== jahr
    ) {
      throw new Error(
        `Ungültiges Datum im Feld "${fieldName}": "${value}" (kein valides Kalenderdatum)`,
      );
    }
    return date;
  }
}