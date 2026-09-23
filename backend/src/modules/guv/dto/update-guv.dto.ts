import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  GUV_STATUS,
  GUV_VERFAHREN,
  type GuVStatus,
  type GuVVerfahren,
} from '../constants/hgb-guv.constants';
import { GuVPositionDto } from './guv-position.dto';

/**
 * PATCH-DTO für /api/guv/:id.
 */
export class UpdateGuVDto {
  @IsOptional()
  @IsString()
  @Length(0, 2000, { message: 'hinweise max 2000 Zeichen' })
  hinweise?: string;

  @IsOptional()
  @IsEnum(GUV_STATUS, {
    message: `status muss eine von ${GUV_STATUS.join(', ')} sein`,
  })
  status?: GuVStatus;

  @IsOptional()
  @IsEnum(GUV_VERFAHREN)
  verfahren?: GuVVerfahren;

  @IsOptional()
  @IsNumber(
    { allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 },
    { message: 'ergebnis muss eine Zahl mit max. 2 Nachkommastellen sein' },
  )
  ergebnis?: number;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(0)
  @ValidateNested({ each: true })
  @Type(() => GuVPositionDto)
  positionen?: GuVPositionDto[];
}