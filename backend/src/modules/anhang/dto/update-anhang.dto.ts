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
  ANHANG_STATUS,
  type AnhangStatus,
} from '../constants/anhang.constants';
import { AnhangAbschnittDto } from './anhang-abschnitt.dto';

/**
 * PATCH-DTO für /api/anhang/:id.
 */
export class UpdateAnhangDto {
  @IsOptional()
  @IsString()
  @Length(0, 10_000)
  bilanzierungsMethoden?: string;

  @IsOptional()
  @IsString()
  @Length(0, 10_000)
  bewertungsMethoden?: string;

  @IsOptional()
  @IsString()
  @Length(0, 10_000)
  sonstigePflichtangaben?: string;

  @IsOptional()
  @IsEnum(ANHANG_STATUS, {
    message: `status muss eine von ${ANHANG_STATUS.join(', ')} sein`,
  })
  status?: AnhangStatus;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(0)
  @ValidateNested({ each: true })
  @Type(() => AnhangAbschnittDto)
  abschnitte?: AnhangAbschnittDto[];
}