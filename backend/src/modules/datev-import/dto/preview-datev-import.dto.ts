import { IsInt, IsString, IsUUID, Max, Min } from 'class-validator';

/**
 * Body für POST /api/datev-import/preview.
 *
 * Parst eine CSV-Datei und liefert eine Vorschau (Saldovortrag, Mapping-Vorschlag,
 * unmapped Konten) — OHNE in die DB zu schreiben.
 */
export class PreviewDatevImportDto {
  /**
   * Base64-kodierte CSV-Datei (UTF-8 ohne BOM, Semikolon-getrennt).
   * Wird im Body übertragen, da kein File-Upload verwendet wird.
   */
  @IsString()
  csvBase64!: string;

  /** Mandant, für den der Import vorgemerkt ist. */
  @IsUUID()
  mandantId!: string;

  /** Geschäftsjahr (z. B. 2025). */
  @IsInt()
  @Min(1900)
  @Max(2100)
  geschaeftsjahr!: number;
}