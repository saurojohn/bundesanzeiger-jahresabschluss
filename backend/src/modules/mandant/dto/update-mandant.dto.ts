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
import {
  GROESSENKLASSEN,
  PUBLISH_CHANNELS,
  AdresseDto,
  GeschaeftsfuehrerDto,
  type Groessenklasse,
  type PublishChannel,
} from './create-mandant.dto';

/**
 * PATCH-DTO — alle Felder sind optional.
 *
 * Manuell implementiert (ohne `@nestjs/mapped-types`), um die
 * Abhängigkeitsliste schlank zu halten. Struktur exakt wie
 * CreateMandantDto, jedes Feld jedoch mit @IsOptional().
 */
export class UpdateMandantDto {
  @IsOptional() @IsString() @Length(2, 200)
  firmenname?: string;

  @IsOptional() @IsString() @Length(2, 100)
  rechtsform?: string;

  @IsOptional() @IsString() @Length(0, 50)
  handelsregister?: string;

  /**
   * Steuernummer des Finanzamts, z. B. "12/345/67890". Pflicht für die
   * E-Bilanz — fehlt sie, bricht der XBRL-Export ab, statt eine Nummer zu
   * erfinden oder die Handelsregisternummer zu verwenden.
   */
  @IsOptional() @IsString() @Length(0, 50)
  steuernummer?: string;

  @IsOptional() @IsString() @Length(0, 20)
  ustId?: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => AdresseDto)
  adresse?: AdresseDto;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => GeschaeftsfuehrerDto)
  geschaeftsfuehrer?: GeschaeftsfuehrerDto[];

  @IsOptional() @IsDateString()
  gruendungsdatum?: string;

  @IsOptional() @IsString()
  bilanzsummeVorjahr?: string;

  @IsOptional() @IsString()
  umsatzVorjahr?: string;

  @IsOptional() @IsInt() @Min(0)
  mitarbeiterAnzahl?: number;

  @IsOptional() @IsEnum(GROESSENKLASSEN)
  groessenklasse?: Groessenklasse;

  @IsOptional() @IsEnum(PUBLISH_CHANNELS)
  publishChannel?: PublishChannel;
}
