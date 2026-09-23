import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Adresse eines Mandanten (Kanzlei oder GmbH-Sitz).
 */
export class AdresseDto {
  @IsString()
  @Length(2, 200, { message: 'strasse muss zwischen 2 und 200 Zeichen lang sein' })
  strasse!: string;

  @IsString()
  @Length(3, 12, { message: 'plz muss zwischen 3 und 12 Zeichen lang sein' })
  plz!: string;

  @IsString()
  @Length(2, 120, { message: 'ort muss zwischen 2 und 120 Zeichen lang sein' })
  ort!: string;

  @IsString()
  @Length(2, 2, { message: 'land muss ein 2-stelliger ISO-Code sein (z.B. "DE")' })
  land!: string;
}

/**
 * Eintrag im Geschäftsführungs-Verzeichnis.
 */
export class GeschaeftsfuehrerDto {
  @IsString()
  @Length(2, 200, { message: 'name muss zwischen 2 und 200 Zeichen lang sein' })
  name!: string;

  @IsDateString({}, { message: 'geburtsdatum muss ISO-8601 sein' })
  geburtsdatum!: string;

  @IsInt({ message: 'anteilProzent muss eine Ganzzahl sein' })
  @Min(0)
  anteilProzent!: number;
}

/**
 * Größenklasse nach § 267 HGB.
 */
export const GROESSENKLASSEN = ['KLEINST', 'KLEIN', 'MITTEL', 'GROSS'] as const;
export type Groessenklasse = (typeof GROESSENKLASSEN)[number];

/**
 * Bundesanzeiger-Submission-Kanal.
 */
export const PUBLISH_CHANNELS = [
  'PDF_DIRECT',
  'XML_XBRL',
  'EBILANZ_TAXONOMIE',
] as const;
export type PublishChannel = (typeof PUBLISH_CHANNELS)[number];

/**
 * Body für POST /api/mandant.
 *
 * `kanzleiId` wird vom Service implizit aus dem User gesetzt und ist
 * NICHT Teil dieses DTOs (Mandant-Trennung).
 */
export class CreateMandantDto {
  @IsString()
  @Length(2, 200, { message: 'firmenname muss zwischen 2 und 200 Zeichen lang sein' })
  firmenname!: string;

  @IsString()
  @Length(2, 100, { message: 'rechtsform muss zwischen 2 und 100 Zeichen lang sein' })
  rechtsform!: string;

  @IsOptional()
  @IsString()
  @Length(0, 50, { message: 'handelsregister max 50 Zeichen' })
  handelsregister?: string;

  @IsOptional()
  @IsString()
  @Length(0, 20, { message: 'ustId max 20 Zeichen' })
  ustId?: string;

  @IsObject()
  @ValidateNested()
  @Type(() => AdresseDto)
  adresse!: AdresseDto;

  @IsArray()
  @ArrayMinSize(1, { message: 'mindestens ein Geschäftsführer erforderlich' })
  @ValidateNested({ each: true })
  @Type(() => GeschaeftsfuehrerDto)
  geschaeftsfuehrer!: GeschaeftsfuehrerDto[];

  @IsOptional()
  @IsDateString({}, { message: 'gruendungsdatum muss ISO-8601 sein' })
  gruendungsdatum?: string;

  @IsOptional()
  @IsString()
  bilanzsummeVorjahr?: string; // Decimal als String (Prisma)

  @IsOptional()
  @IsString()
  umsatzVorjahr?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  mitarbeiterAnzahl?: number;

  @IsEnum(GROESSENKLASSEN, {
    message: `groessenklasse muss eine von ${GROESSENKLASSEN.join(', ')} sein`,
  })
  groessenklasse!: Groessenklasse;

  @IsEnum(PUBLISH_CHANNELS, {
    message: `publishChannel muss eine von ${PUBLISH_CHANNELS.join(', ')} sein`,
  })
  publishChannel!: PublishChannel;
}
