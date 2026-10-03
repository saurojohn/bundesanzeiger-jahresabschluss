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
import { AnhangAbschnittDto } from './anhang-abschnitt.dto';

/**
 * Body für POST /api/anhang.
 */
export class CreateAnhangDto {
  @IsUUID('4', { message: 'mandantId muss eine gültige UUID sein' })
  mandantId!: string;

  @IsInt({ message: 'geschaeftsjahr muss eine Ganzzahl sein' })
  @Min(2000)
  @Max(2100)
  geschaeftsjahr!: number;

  @IsOptional()
  @IsString()
  @Length(0, 10_000, { message: 'bilanzierungsMethoden max 10000 Zeichen' })
  bilanzierungsMethoden?: string;

  @IsOptional()
  @IsString()
  @Length(0, 10_000, { message: 'bewertungsMethoden max 10000 Zeichen' })
  bewertungsMethoden?: string;

  @IsOptional()
  @IsString()
  @Length(0, 10_000, { message: 'sonstigePflichtangaben max 10000 Zeichen' })
  sonstigePflichtangaben?: string;

  @IsArray()
  @ArrayMinSize(0)
  @ValidateNested({ each: true })
  @Type(() => AnhangAbschnittDto)
  // Pflicht, auch ohne `@IsOptional()`: die Validierung laesst das Feld zu.
  // Das `?` stand hier vorher ohne Deckung im DTO-Typ — der Compiler liess
  // Aufrufer glauben, das Feld sei optional, der Request scheiterte dann mit
  // 400 "abschnitte must be an array". (UpdateAnhangDto hat `@IsOptional()`,
  // dort ist das `?` berechtigt.)
  abschnitte!: AnhangAbschnittDto[];
}