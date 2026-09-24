import { IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

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