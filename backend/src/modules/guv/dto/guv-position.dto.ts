import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Min,
} from 'class-validator';
import {
  GUV_KATEGORIEN,
  type GuVKategorie,
} from '../constants/hgb-guv.constants';

/**
 * Einzelne Position einer GuV.
 */
export class GuVPositionDto {
  @IsString()
  @Length(1, 20, { message: 'kontonummer muss zwischen 1 und 20 Zeichen lang sein' })
  kontonummer!: string;

  @IsString()
  @Length(1, 250, { message: 'bezeichnung muss zwischen 1 und 250 Zeichen lang sein' })
  bezeichnung!: string;

  @IsEnum(GUV_KATEGORIEN, {
    message: `kategorie muss eine von ${GUV_KATEGORIEN.join(', ')} sein`,
  })
  kategorie!: GuVKategorie;

  @IsOptional()
  @IsNumber(
    { allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 },
    { message: 'betragVorjahr muss eine Zahl mit max. 2 Nachkommastellen sein' },
  )
  betragVorjahr?: number;

  @IsNumber(
    { allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 },
    { message: 'betragAktuell muss eine Zahl mit max. 2 Nachkommastellen sein' },
  )
  betragAktuell!: number;

  @IsInt({ message: 'reihenfolge muss eine Ganzzahl sein' })
  @Min(0)
  reihenfolge!: number;

  @IsOptional()
  @IsString()
  @Length(0, 500, { message: 'bemerkung max 500 Zeichen' })
  bemerkung?: string;
}