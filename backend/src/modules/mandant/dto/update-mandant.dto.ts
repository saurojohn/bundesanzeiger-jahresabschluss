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
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { BETRAG_STRING_PATTERN, INT4_MAX } from '../../../common/utils/betrag-grenzen';
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
  @Matches(BETRAG_STRING_PATTERN, {
    message: 'bilanzsummeVorjahr muss eine Zahl mit max. 2 Nachkommastellen sein (z.B. "12345.67")',
  })
  bilanzsummeVorjahr?: string;

  @IsOptional() @IsString()
  @Matches(BETRAG_STRING_PATTERN, {
    message: 'umsatzVorjahr muss eine Zahl mit max. 2 Nachkommastellen sein (z.B. "12345.67")',
  })
  umsatzVorjahr?: string;

  @IsOptional() @IsInt() @Min(0)
  @Max(INT4_MAX, { message: 'mitarbeiterAnzahl darf hoechstens 2147483647 sein' })
  mitarbeiterAnzahl?: number;

  @IsOptional() @IsEnum(GROESSENKLASSEN)
  groessenklasse?: Groessenklasse;

  @IsOptional() @IsEnum(PUBLISH_CHANNELS)
  publishChannel?: PublishChannel;
}
