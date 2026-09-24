import type { ParsedBuchungsstapelHeader, SaldovortragEntry } from '../utils/csv-parser';
import type { MappedPosition } from '../mappings/skr04-reverse.types';

/**
 * Response für POST /api/datev-import/preview.
 *
 * Liefert:
 *   - parsed: Geparste CSV-Header-Daten
 *   - saldovortrag: Saldovortrag pro Sachkonto (Soll/Haben/Saldo)
 *   - mappedPositionen: Mapping-Vorschlag (Auto + ggf. Override)
 *   - unmappedKonten: Liste der Konten, die manuell zugeordnet werden müssen
 *   - warnings: Parser- und Mapping-Warnungen
 */
export interface ImportPreviewDto {
  parsed: ParsedBuchungsstapelHeader;
  saldovortrag: SaldovortragEntry[];
  mappedPositionen: MappedPosition[];
  unmappedKonten: string[];
  warnings: string[];
}

/**
 * Response für POST /api/datev-import/execute.
 *
 * Liefert:
 *   - importedCount: Anzahl importierter Positionen
 *   - skippedCount: Anzahl übersprungener (unmapped + Skonto=0 etc.)
 *   - bilanzId: ID der erzeugten/aktualisierten Bilanz (oder null, falls nur GuV)
 *   - guvId: ID der erzeugten/aktualisierten GuV (oder null, falls nur Bilanz)
 *   - warnings: Warnungen
 *   - overwriteWarned: true, wenn eine bestehende Bilanz/GuV überschrieben wurde
 */
export interface ImportResultDto {
  importedCount: number;
  skippedCount: number;
  bilanzId: string | null;
  guvId: string | null;
  warnings: string[];
  overwriteWarned: boolean;
}