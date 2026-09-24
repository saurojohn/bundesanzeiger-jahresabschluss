import { Type } from 'class-transformer';
import { IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator';
import { EbilanzPreparerDto } from './ebilanz-preparer.dto';

/**
 * Body für POST /api/ebilanz/generate.
 *
 * Verknüpft Bilanz + GuV + Anhang (alle aus dem selben Mandanten) zu
 * einer einzigen E-Bilanz-XBRL-Instance.
 */
export class GenerateEbilanzDto {
  /** ID der Bilanz (mandant-gefiltert). */
  @IsUUID()
  bilanzId!: string;

  /** ID der GuV (mandant-gefiltert). */
  @IsUUID()
  guvId!: string;

  /** ID des Anhangs (mandant-gefiltert). */
  @IsUUID()
  anhangId!: string;

  /** Optionale Beraterstammdaten (default: leer). */
  @IsOptional()
  @ValidateNested()
  @Type(() => EbilanzPreparerDto)
  preparer?: EbilanzPreparerDto;
}

/**
 * Body für POST /api/ebilanz/validate.
 *
 * Erwartet ein base64-kodiertes XBRL-Dokument und liefert ein
 * Validation-Ergebnis (siehe `validation-result.dto.ts`).
 */
export class ValidateEbilanzDto {
  /** Base64-kodiertes XBRL-Dokument. */
  @IsString()
  xbrlBase64!: string;
}

/**
 * Body für GET /api/ebilanz/preview/...
 *
 * Preview-Request zur Anzeige des Mappings vor der Generierung.
 */
export class PreviewMappingDto {
  /** ID der Bilanz. */
  @IsUUID()
  bilanzId!: string;

  /** ID der GuV. */
  @IsUUID()
  guvId!: string;

  /** ID des Anhangs. */
  @IsUUID()
  anhangId!: string;
}