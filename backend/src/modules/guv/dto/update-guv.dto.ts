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

  // BEFUND 2026-10-11: `ergebnis` war hier als @IsNumber-Feld gesetzt und
  // wurde ungeprueft uebernommen (`let ergebnis = dto.ergebnis`), sofern
  // keine Positionen mitgeschickt wurden. `CreateGuVDto` hatte das Feld
  // nicht — die Asymmetrie ist der Befund.
  //
  // Live gemessen: PATCH { ergebnis: 999999.99 } -> HTTP 200, DB 999999.99.
  // Der Wert fliesst von dort in das GuV-PDF (guv.template.ts:167), in das
  // Abschluss-PDF (abschluss.template.ts:330) und in die E-Bilanz-XBRL als
  // `netIncome` (xbrl-generator.service.ts:187). Das PDF geht in den
  // WORM-Storage und ist qeS-signierbar.
  //
  // `ergebnis` ist ABGELEITET: Jahresueberschuss/-fehlbetrag = Erloese minus
  // Aufwendungen. Ein Client, der ihn setzen kann, schreibt in das
  // Abschlussergebnis. Das Feld gehoert deshalb nicht in einen Eingabe-DTO.
  //
  // Durch das Entfernen wird jeder Versuch über `forbidNonWhitelisted` mit
  // 400 abgelehnt — fail-closed, ohne Sonderlogik im Service.

  @IsOptional()
  @IsArray()
  @ArrayMinSize(0)
  @ValidateNested({ each: true })
  @Type(() => GuVPositionDto)
  positionen?: GuVPositionDto[];
}