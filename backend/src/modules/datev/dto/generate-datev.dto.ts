import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
} from 'class-validator';

/**
 * DATEV-Berater-/Mandantennummer: 5 bis 8 Ziffern (DATEV-Spezifikation).
 *
 * Bugfix 2026-10-06: Vorher genuegte `@IsString()`, wodurch ein leerer
 * String und beliebige Sonderzeichen durchkamen — die Nummer geht in
 * den DATEV-Dateinamen ein.
 */
const DATEV_NUMMER_PATTERN = /^\d{5,8}$/;
const DATEV_NUMMER_MESSAGE = (feld: string): string =>
  `${feld} muss 5 bis 8 Ziffern enthalten (ohne Leer- oder Sonderzeichen)`;

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
  @Matches(DATEV_NUMMER_PATTERN, { message: DATEV_NUMMER_MESSAGE('beraternummer') })
  beraternummer!: string;

  /** DATEV-Mandant-Nummer (5-8 Stellen). */
  @IsString()
  @Matches(DATEV_NUMMER_PATTERN, { message: DATEV_NUMMER_MESSAGE('mandantennummer') })
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
 *
 * Eingabevalidierung (Bugfix 2026-10-06). Vorher waren hier nur
 * Typprüfungen. Empirisch belegte Folgen gegen die laufende Instanz:
 *
 *   usedKonten: []            -> 200, `anzahlKonten: 0`, nur Kopfzeile
 *   usedKonten: '0400'        -> 200, 4 Zeilen: "0", "4", "0", "0"
 *                               (String wurde zeichenweise iteriert)
 *   usedKonten: ['HACKER; DROP TABLE', '<xml/>', '', '   ']
 *                            -> 200, landet woertlich in der CSV
 *   beraternummer: ''         -> Dateiname `EXTF_…__7654321.csv`
 *   beraternummer: '../etc/passwd' -> landet im Dateinamen
 *
 * Ein Sachkonto ist in DATEV eine reine Ziffernfolge; die Kontenrahmen
 * in diesem Projekt (SKR03 und SKR04) verwenden ausschliesslich
 * vierstellige Nummern. Zulaessig sind 3–5 Stellen, damit auch ein
 * noch nicht im Projekt hinterlegtes Sachkonto durchgereicht werden
 * kann — nichtnumerische Werte sind es nie.
 */
export class GenerateSachkontenDto {
  /** Liste der im Export verwendeten Konten (mindestens eines). */
  @IsArray()
  @ArrayMinSize(1, { message: 'usedKonten muss mindestens ein Konto enthalten' })
  @ArrayMaxSize(2000, { message: 'usedKonten darf hoechstens 2000 Konten enthalten' })
  @IsString({ each: true })
  @Matches(/^\d{3,5}$/, {
    each: true,
    message: 'usedKonten-Eintraege muessen 3- bis 5-stellige Ziffernfolgen sein',
  })
  usedKonten!: string[];

  /** Kontenplan (SKR03 oder SKR04). */
  @IsIn(['SKR03', 'SKR04'])
  skrPlan!: 'SKR03' | 'SKR04';

  /** DATEV-Berater-Nummer (5-8 Stellen, frei definierbar). */
  @IsString()
  @Matches(DATEV_NUMMER_PATTERN, { message: DATEV_NUMMER_MESSAGE('beraternummer') })
  beraternummer!: string;

  /** DATEV-Mandant-Nummer (5-8 Stellen). */
  @IsString()
  @Matches(DATEV_NUMMER_PATTERN, { message: DATEV_NUMMER_MESSAGE('mandantennummer') })
  mandantennummer!: string;
}