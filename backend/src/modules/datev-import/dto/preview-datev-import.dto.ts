import { IsEnum, IsInt, IsString, IsUUID, Max, Min } from 'class-validator';
import {
  IMPORT_KONTENRAHMEN,
  type ImportKontenrahmen,
} from './import-datev.dto';

/**
 * Body für POST /api/datev-import/preview.
 *
 * `skrPlan` ist hier genauso Pflicht wie beim Ausführen: Eine Vorschau, die
 * den falschen Kontenrahmen annimmt, zeigt eine Zuordnung an, die es beim
 * Import so nicht gibt — und läge damit genau das falsche Versprechen.
 */
export class PreviewDatevImportDto {
  @IsString()
  csvBase64!: string;

  @IsUUID()
  mandantId!: string;

  @IsInt()
  @Min(1900)
  @Max(2100)
  geschaeftsjahr!: number;

  /**
   * Kontenrahmen der DATEV-Datei (SKR03 | SKR04).
   *
   * Siehe `ImportDatevDto.skrPlan` für den Befund, warum das Pflicht ist.
   */
  @IsEnum(IMPORT_KONTENRAHMEN, {
    message: `skrPlan muss einer von ${IMPORT_KONTENRAHMEN.join(', ')} sein`,
  })
  skrPlan!: ImportKontenrahmen;
}