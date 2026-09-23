import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  BILANZ_STATUS,
  type BilanzStatus,
} from '../constants/hgb-bilanz.constants';
import { BilanzPositionDto } from './bilanz-position.dto';

/**
 * PATCH-DTO für /api/bilanz/:id.
 *
 * `geschaeftsjahr` und `mandantId` sind NICHT änderbar — ein neuer
 * Geschäftsjahresdatensatz muss separat angelegt werden.
 */
export class UpdateBilanzDto {
  @IsOptional()
  @IsString()
  @Length(0, 2000, { message: 'hinweise max 2000 Zeichen' })
  hinweise?: string;

  @IsOptional()
  @IsEnum(BILANZ_STATUS, {
    message: `status muss eine von ${BILANZ_STATUS.join(', ')} sein`,
  })
  status?: BilanzStatus;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(0)
  @ValidateNested({ each: true })
  @Type(() => BilanzPositionDto)
  positionen?: BilanzPositionDto[];
}