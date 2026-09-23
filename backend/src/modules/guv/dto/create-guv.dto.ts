import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  GUV_VERFAHREN,
  type GuVVerfahren,
} from '../constants/hgb-guv.constants';
import { GuVPositionDto } from './guv-position.dto';

/**
 * Body für POST /api/guv.
 */
export class CreateGuVDto {
  @IsUUID('4', { message: 'mandantId muss eine gültige UUID sein' })
  mandantId!: string;

  @IsInt({ message: 'geschaeftsjahr muss eine Ganzzahl sein' })
  @Min(2000)
  @Max(2100)
  geschaeftsjahr!: number;

  @IsEnum(GUV_VERFAHREN, {
    message: `verfahren muss eine von ${GUV_VERFAHREN.join(', ')} sein`,
  })
  verfahren!: GuVVerfahren;

  @IsOptional()
  @IsString()
  @Length(0, 2000, { message: 'hinweise max 2000 Zeichen' })
  hinweise?: string;

  @IsArray()
  @ArrayMinSize(0)
  @ValidateNested({ each: true })
  @Type(() => GuVPositionDto)
  positionen!: GuVPositionDto[];
}