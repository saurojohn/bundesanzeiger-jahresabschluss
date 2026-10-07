import { Type } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  ValidateNested,
} from 'class-validator';

/**
 * Body für POST /api/wp/pruefungen.
 */
export class StartWPPruefungDto {
  @IsUUID('4', { message: 'bilanzId muss eine gültige UUID sein' })
  bilanzId!: string;

  @IsOptional()
  @IsUUID('4', { message: 'guvId muss eine gültige UUID sein' })
  guvId?: string;

  @IsOptional()
  @IsString()
  @Length(0, 2000, {
    message: 'zusammenfassung darf maximal 2000 Zeichen lang sein',
  })
  zusammenfassung?: string;
}

/**
 * Body für POST /api/wp/pruefungen/:id/finalize.
 */
export class FinalizeWPPruefungDto {
  @IsIn(['APPROVED', 'REJECTED'], {
    message: 'status muss APPROVED oder REJECTED sein',
  })
  status!: 'APPROVED' | 'REJECTED';

  @IsString({ message: 'zusammenfassung muss ein String sein' })
  @Length(1, 2000, {
    message: 'zusammenfassung muss zwischen 1 und 2000 Zeichen lang sein',
  })
  zusammenfassung!: string;
}

/**
 * Response-DTO für eine einzelne Plausi-Regel-Auswertung.
 */
export class BilanzPruefungsResultDto {
  regelCode!: string;
  status!: 'PASSED' | 'WARNUNG' | 'KRITISCH';
  berechneterWert!: number;
  schwellwert!: number;
  meldung!: string;
  geprueftAm!: string;
}

/**
 * Response-DTO für eine WP-Notiz.
 */
export class WPNotizDto {
  id!: string;
  bilanzId!: string | null;
  guvId!: string | null;
  bilanzPositionId!: string | null;
  guvPositionId!: string | null;
  wpUserId!: string;
  notizText!: string;
  status!: 'PENDING' | 'APPROVED' | 'REJECTED' | 'NEEDS_REVISION';
  createdAt!: string;
  updatedAt!: string;
  acknowledgedAt!: string | null;
  acknowledgedById!: string | null;
}

/**
 * Response-DTO für eine WP-Prüfung inkl. aggregierter Ergebnisse.
 */
export class WPPruefungDto {
  id!: string;
  bilanzId!: string;
  guvId!: string | null;
  wpUserId!: string;
  status!: 'IN_PROGRESS' | 'APPROVED' | 'REJECTED';
  zusammenfassung!: string | null;
  startedAt!: string;
  completedAt!: string | null;

  /// Vier-Augen-Prinzip (Bugfix 2026-10-07): wer hat freigegeben?
  /// Ohne diese Felder laesst sich am Aufzeichnungsstand nicht
  /// feststellen, ob die Vier-Augen-Pruefung stattgefunden hat
  /// (§ 11 Abs. 2 WPO, IDW PS 880).
  freigegebenVonId!: string | null;
  freigegebenAm!: string | null;

  @ValidateNested({ each: true })
  @Type(() => BilanzPruefungsResultDto)
  pruefungsResults!: BilanzPruefungsResultDto[];

  @ValidateNested({ each: true })
  @Type(() => WPNotizDto)
  notizen!: WPNotizDto[];
}

/**
 * Response-DTO für WP-Bericht.
 */
export class WPPruefungsReportDto {
  pruefungId!: string;
  markdownReport!: string;
}