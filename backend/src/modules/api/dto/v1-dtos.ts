import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import {
  PaginationInputDto,
  type PaginatedResult,
} from '../../../common/dto/pagination.dto';

/**
 * Reduced Mandant-DTO für die Public-API (M4 Sprint 1).
 *
 * Bewusst schlanker als das interne `Mandant`-Modell — keine Bilanzsummen,
 * keine Geschäftsführer-Adressen (Datenschutz). Nur Stammdaten, die ein
 * ERP-System für die Anzeige braucht.
 */
export class PublicMandantDto {
  @ApiProperty({ description: 'Mandant-UUID' })
  id!: string;

  @ApiProperty({ description: 'Firmenname', example: 'Muster GmbH' })
  firmenname!: string;

  @ApiProperty({ description: 'Rechtsform', example: 'GmbH' })
  rechtsform!: string;

  @ApiProperty({ description: 'Handelsregister-Nr.', nullable: true, required: false })
  handelsregister!: string | null;

  @ApiProperty({ description: 'USt-IdNr.', nullable: true, required: false })
  ustId!: string | null;

  @ApiProperty({ description: 'Größenklasse (§ 267 HGB)', example: 'MITTEL' })
  groessenklasse!: string;

  @ApiProperty({ description: 'Publish-Channel', example: 'XML_XBRL' })
  publishChannel!: string;

  @ApiProperty({ description: 'Anschrift (Straße, PLZ, Ort, Land)' })
  adresse!: {
    strasse: string;
    plz: string;
    ort: string;
    land: string;
  };
}

/**
 * Public-API-DTO für Bilanz-Listen (Header ohne Positionen).
 */
export class PublicBilanzDto {
  @ApiProperty({ description: 'Bilanz-UUID' })
  id!: string;

  @ApiProperty({ description: 'Mandant-UUID' })
  mandantId!: string;

  @ApiProperty({ description: 'Geschäftsjahr', example: 2025 })
  geschaeftsjahr!: number;

  @ApiProperty({ description: 'Bilanz-Status', example: 'VALIDATED' })
  status!: string;

  @ApiProperty({ description: 'Erstellt am' })
  createdAt!: Date;

  @ApiProperty({ description: 'Aktualisiert am' })
  updatedAt!: Date;
}

/**
 * Public-API-Query-Parameter für GET /api/v1/mandanten/:id/bilanzen.
 */
export class ListPublicBilanzenDto extends PaginationInputDto {
  @ApiProperty({
    description: 'Optional: Filter auf Geschäftsjahr',
    required: false,
    example: 2025,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'geschaeftsjahr muss eine Ganzzahl sein' })
  @Min(1900)
  @Max(2100)
  geschaeftsjahr?: number;
}

/**
 * Public-API-DTO für GuV (analog zu PublicBilanzDto).
 */
export class PublicGuVDto {
  @ApiProperty({ description: 'GuV-UUID' })
  id!: string;

  @ApiProperty({ description: 'Mandant-UUID' })
  mandantId!: string;

  @ApiProperty({ description: 'Geschäftsjahr', example: 2025 })
  geschaeftsjahr!: number;

  @ApiProperty({ description: 'Verfahren: GKV | UKV', example: 'GKV' })
  verfahren!: string;

  @ApiProperty({ description: 'Status', example: 'VALIDATED' })
  status!: string;
}

/**
 * Public-API-DTO für Anhang.
 */
export class PublicAnhangDto {
  @ApiProperty({ description: 'Anhang-UUID' })
  id!: string;

  @ApiProperty({ description: 'Mandant-UUID' })
  mandantId!: string;

  @ApiProperty({ description: 'Geschäftsjahr', example: 2025 })
  geschaeftsjahr!: number;

  @ApiProperty({ description: 'Status', example: 'VALIDATED' })
  status!: string;
}

/**
 * Public-API-DTO für Jahresabschluss (Orchestrierung).
 */
export class PublicJahresabschlussDto {
  @ApiProperty({ description: 'Jahresabschluss-UUID' })
  id!: string;

  @ApiProperty({ description: 'Mandant-UUID' })
  mandantId!: string;

  @ApiProperty({ description: 'Geschäftsjahr', example: 2025 })
  geschaeftsjahr!: number;

  @ApiProperty({
    description: 'Status (DRAFT | FINALIZED | SIGNED | SUBMITTED | PUBLISHED)',
    example: 'FINALIZED',
  })
  status!: string;

  @ApiProperty({ description: 'Finalisiert am', nullable: true })
  finalisiertAm!: Date | null;

  @ApiProperty({ description: 'Signiert am', nullable: true })
  signiertAm!: Date | null;

  @ApiProperty({ description: 'Eingereicht am', nullable: true })
  eingereichtAm!: Date | null;
}

/**
 * Public-API-DTO für BAnz-Submission (read-only über Public-API).
 */
export class PublicBanzSubmissionDto {
  @ApiProperty({ description: 'Submission-UUID' })
  id!: string;

  @ApiProperty({ description: 'Jahresabschluss-UUID' })
  jahresabschlussId!: string;

  @ApiProperty({ description: 'Mandant-UUID' })
  mandantId!: string;

  @ApiProperty({ description: 'Geschäftsjahr', example: 2025 })
  geschaeftsjahr!: number;

  @ApiProperty({ description: 'Channel', example: 'XML_XBRL' })
  channel!: string;

  @ApiProperty({ description: 'Status', example: 'PUBLISHED' })
  status!: string;

  @ApiProperty({ description: 'BAnz-Vorgangsnummer', nullable: true })
  banzVorgangsnummer!: string | null;

  @ApiProperty({ description: 'Eingereicht am', nullable: true })
  submittedAt!: Date | null;
}

/**
 * Body für POST /api/v1/banz-submissions — erzeugt eine neue Submission.
 */
export class CreatePublicBanzSubmissionDto {
  @ApiProperty({ description: 'Mandant-UUID', example: 'uuid' })
  @IsString()
  mandantId!: string;

  @ApiProperty({ description: 'Geschäftsjahr', example: 2025 })
  @IsInt({ message: 'geschaeftsjahr muss eine Ganzzahl sein' })
  @Min(1900)
  @Max(2100)
  geschaeftsjahr!: number;

  @ApiProperty({
    description: 'Publish-Channel',
    enum: ['PDF_DIRECT', 'XML_XBRL', 'EBILANZ_TAXONOMIE'],
    example: 'XML_XBRL',
  })
  @IsString()
  @Length(2, 30)
  publishChannel!: 'PDF_DIRECT' | 'XML_XBRL' | 'EBILANZ_TAXONOMIE';
}

/**
 * Typ-Alias für Paginated-Wrapper.
 */
export type PublicMandantenListResponse = PaginatedResult<PublicMandantDto>;
export type PublicBilanzenListResponse = PaginatedResult<PublicBilanzDto>;
export type PublicGuVListResponse = PaginatedResult<PublicGuVDto>;
export type PublicAnhangListResponse = PaginatedResult<PublicAnhangDto>;
export type PublicJahresabschlussListResponse = PaginatedResult<PublicJahresabschlussDto>;
export type PublicBanzSubmissionListResponse = PaginatedResult<PublicBanzSubmissionDto>;
export type PublicMandantArray = PublicMandantDto[];

/**
 * Marker für statische /-Listen-Endpoints, die kein Paginated-Response
 * liefern (Backwards-Compat für kleinere Pilot-Setups).
 */
export const EMPTY_LIST: never[] = [] as never[];

/**
 * Re-export für Listen ohne Pagination (Backwards-Compat).
 */
export type PublicMandantenSimpleResponse = PublicMandantDto[];

/**
 * Wrapper-Export — wird vom Controller verwendet, um Response-Arrays
 * dekoriert zu annotieren.
 */
export class ArrayResponse<T> {
  @ApiProperty({ type: [Object], description: 'Liste der Ressourcen' })
  items!: T[];
}

/**
 * Hilfs-Decorator-Klasse für Swagger (kann in Controller-Parametern
 * verwendet werden, wenn `IsArray` + Validierung gegen den Body-Type
 * gewünscht ist).
 */
export class IdArrayQueryDto {
  @ApiProperty({
    description: 'Liste von Mandant- oder Bilanz-UUIDs (für Batch-Operationen)',
    type: [String],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  ids?: string[];
}