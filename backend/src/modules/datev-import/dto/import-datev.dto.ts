import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

/** Unterstützte Kontenrahmen für den Import. */
export const IMPORT_KONTENRAHMEN = ['SKR03', 'SKR04'] as const;
export type ImportKontenrahmen = (typeof IMPORT_KONTENRAHMEN)[number];

/**
 * Body für POST /api/datev-import/execute.
 *
 * Führt den tatsächlichen Import in die DB durch:
 *   - parseCsv
 *   - calculateSaldovortrag
 *   - applyMapping (mit User-bestätigtem Mapping für unmapped Konten)
 *   - Create/Update Bilanz + GuV
 *   - AuditService.record(IMPORT)
 */
export class ImportDatevDto {
  /** Base64-kodierte CSV-Datei. */
  @IsString()
  csvBase64!: string;

  /** Mandant (für den Import). */
  @IsUUID()
  mandantId!: string;

  /** Geschäftsjahr. */
  @IsInt()
  @Min(1900)
  @Max(2100)
  geschaeftsjahr!: number;

  /**
   * Kontenrahmen der DATEV-Datei. PFLICHT.
   *
   * BEFUND 2026-10-10: Das Feld fehlte, und die Import-Auflösung kannte nur
   * die SKR04-Tabelle. Eine SKR03-Datei wurde dadurch durch die SKR04-Tabelle
   * geschickt. Bei Konten, die in beiden Rahmen vorkommen und dort etwas
   * anderes bedeuten, war das ein still falsch gebuchter Betrag:
   *
   *   7300  SKR03 "Zinsaufwendungen" -> 13. Zinsen und ähnliche Aufwendungen
   *         SKR04 "Versicherungen"    ->  8. Sonstige betriebliche Aufwendungen
   *
   * Optional mit Default „SKR04" waere nur eine andere Tarnung desselben
   * Fehlers: ein Aufrufer, der den Rahmen nicht kennt, wuerde raten — und
   * genau das Raten ist der Befund. Lieber 400 mit klarer Meldung.
   */
  @IsEnum(IMPORT_KONTENRAHMEN, {
    message: `skrPlan muss einer von ${IMPORT_KONTENRAHMEN.join(', ')} sein`,
  })
  skrPlan!: ImportKontenrahmen;

  /**
   * Optionale User-Overrides für unmapped Konten.
   * Map: datevKonto → hgbPosition (z. B. "4500" → "4." für Sonstige Erträge).
   */
  @IsOptional()
  userMappingOverrides?: Record<string, string>;

  /**
   * Bestätigung, dass eine bestehende Bilanz/GuV für das GJ überschrieben werden darf.
   * Required: true, wenn bereits eine Bilanz für das GJ existiert.
   */
  @IsOptional()
  overwriteExisting?: boolean;
}