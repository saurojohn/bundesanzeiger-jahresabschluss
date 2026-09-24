import { IsIn, IsOptional, IsString, IsUUID, Matches } from 'class-validator';

/**
 * Body für POST /api/datev/generate-buchungsstapel.
 *
 * Generiert einen DATEV-Buchungsstapel (CSV) aus einer GuV eines Mandanten.
 * RBAC: STEUERBERATER, KANZLEI_ADMIN, WIRTSCHAFTSPRUEFER.
 */
export class GenerateDatevDto {
  /** ID der GuV (mandant-gefiltert, nicht optional — GuV ist Pflicht). */
  @IsUUID()
  guvId!: string;

  /** Optionale Bilanz-ID (für Saldovortrag-Buchungen — derzeit ungenutzt). */
  @IsOptional()
  @IsUUID()
  bilanzId?: string;

  /** DATEV-Kontenplan: SKR04 (default) oder SKR03. */
  @IsOptional()
  @IsIn(['SKR03', 'SKR04'])
  skrPlan?: 'SKR03' | 'SKR04';

  /** DATEV-Berater-Nummer (5-8 Stellen, frei definierbar). */
  @IsString()
  beraternummer!: string;

  /** DATEV-Mandant-Nummer (5-8 Stellen). */
  @IsString()
  mandantennummer!: string;

  /** Sachkonten-Länge: 4 (default) oder 5. */
  @IsOptional()
  @IsIn([4, 5])
  sachkontenlaenge?: 4 | 5;

  /** Buchungs-Periode Beginn (TT.MM.JJJJ). Default: 01.01. des Geschäftsjahres. */
  @IsOptional()
  @Matches(/^\d{2}\.\d{2}\.\d{4}$/, {
    message: 'vonDatum muss dem Format TT.MM.JJJJ entsprechen',
  })
  vonDatum?: string;

  /** Buchungs-Periode Ende (TT.MM.JJJJ). Default: 31.12. des Geschäftsjahres. */
  @IsOptional()
  @Matches(/^\d{2}\.\d{2}\.\d{4}$/, {
    message: 'bisDatum muss dem Format TT.MM.JJJJ entsprechen',
  })
  bisDatum?: string;
}

/**
 * Body für POST /api/datev/generate-sachkonten.
 *
 * Generiert DATEV-Sachkontenbeschriftungen (EXTF_Sachkontobeschriftungen.csv)
 * für die im Export verwendeten Konten.
 */
export class GenerateSachkontenDto {
  /** Liste der im Export verwendeten Konten. */
  @IsString({ each: true })
  usedKonten!: string[];

  /** Kontenplan (SKR03 oder SKR04). */
  @IsIn(['SKR03', 'SKR04'])
  skrPlan!: 'SKR03' | 'SKR04';

  /** DATEV-Berater-Nummer. */
  @IsString()
  beraternummer!: string;

  /** DATEV-Mandant-Nummer. */
  @IsString()
  mandantennummer!: string;
}