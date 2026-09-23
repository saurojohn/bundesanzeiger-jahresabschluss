import {
  ArrayMinSize,
  IsArray,
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
import { BilanzPositionDto } from './bilanz-position.dto';

/**
 * Body für POST /api/bilanz.
 *
 * `mandantId` wird zusätzlich vom MandantGuard geprüft (via
 * @RequireMandant). Hier explizit im DTO, damit der Service nicht
 * raten muss.
 */
export class CreateBilanzDto {
  @IsUUID('4', { message: 'mandantId muss eine gültige UUID sein' })
  mandantId!: string;

  @IsInt({ message: 'geschaeftsjahr muss eine Ganzzahl sein' })
  @Min(2000, { message: 'geschaeftsjahr muss >= 2000 sein' })
  @Max(2100, { message: 'geschaeftsjahr muss <= 2100 sein' })
  geschaeftsjahr!: number;

  @IsOptional()
  @IsString()
  @Length(0, 2000, { message: 'hinweise max 2000 Zeichen' })
  hinweise?: string;

  @IsArray()
  @ArrayMinSize(0, { message: 'positionen ist optional, aber Array' })
  @ValidateNested({ each: true })
  @Type(() => BilanzPositionDto)
  positionen!: BilanzPositionDto[];
}