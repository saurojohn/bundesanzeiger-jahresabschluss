import {
  IsOptional,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { KONSOLIDIERUNGS_AR } from '../constants/konsolidierung.constants';

/**
 * Body für POST /api/konsolidierung/einheiten.
 *
 * Erstellt eine neue Konsolidierungs-Einheit (Mutter + n Tochtern).
 * Mutter und Tochtern müssen in derselben Kanzlei liegen — dies wird
 * im Service geprüft.
 *
 * Beispiel:
 * {
 *   "mutterMandantId": "uuid",
 *   "tochterMandantIds": ["uuid", "uuid"],
 *   "geschaeftsjahr": 2025,
 *   "beteiligungsquote": 100.0,
 *   "konsolidierungsArt": "VOLLKONSOLIDIERUNG"
 * }
 */
export class CreateKonsolidierungEinheitDto {
  /** Mandant-ID der Muttergesellschaft. */
  @IsUUID('4', { message: 'mutterMandantId muss eine gültige UUID sein' })
  mutterMandantId!: string;

  /**
   * Liste der Tochtermandanten (mindestens 1).
   * Pilot: 1 Mutter + 1 Tochter — keine komplexen Topologien.
   */
  @IsArray()
  @ArrayMinSize(1, {
    message: 'Mindestens ein Tochtermandant erforderlich',
  })
  @IsUUID('4', { each: true, message: 'tochterMandantIds müssen gültige UUIDs sein' })
  tochterMandantIds!: string[];

  @IsInt({ message: 'geschaeftsjahr muss eine Ganzzahl sein' })
  @Min(2000, { message: 'geschaeftsjahr muss >= 2000 sein' })
  @Max(2100, { message: 'geschaeftsjahr muss <= 2100 sein' })
  geschaeftsjahr!: number;

  /** Beteiligungsquote in Prozent (0–100). */
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'beteiligungsquote muss eine Zahl sein (max 2 Nachkommastellen)' },
  )
  @Min(0, { message: 'beteiligungsquote muss >= 0 sein' })
  @Max(100, { message: 'beteiligungsquote muss <= 100 sein' })
  beteiligungsquote!: number;

  @IsIn(KONSOLIDIERUNGS_AR, {
    message: `konsolidierungsArt muss eine der folgenden Werte sein: ${KONSOLIDIERUNGS_AR.join(', ')}`,
  })
  konsolidierungsArt!: 'VOLLKONSOLIDIERUNG' | 'QUOTAL' | 'AT_EQUITY';

  // ------------------------------------------------------------------------
  // Kapitalkonsolidierung (§ 301 HGB)
  //
  // Bugfix 2026-10-07: Diese drei Felder existierten im Schema, wurden
  // aber fest auf 0 geschrieben und hatten keinen Schreibpfad. Damit
  // konnte `if (ak > 0 || ekTochter > 0)` nie zutreffen, es wurde nie
  // eine Kapitalkonsolidierungsbuchung erzeugt und der Geschäfts- oder
  // Firmenwert blieb immer 0. Das Eigenkapital der Tochter blieb
  // uneliminiert im Konzern-EK, die Beteiligung stand doppelt.
  //
  // Sie sind jetzt OPTIONAL: ohne Angaben findet keine
  // Kapitalkonsolidierung statt (Differenzrechnung über Konzern-EK),
  // mit Angaben wird sie durchgeführt und der Goodwill/Badwill
  // ausgewiesen.

  /** Anschaffungskosten der Beteiligung (§ 301 Abs. 1 HGB). */
  @IsOptional()
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'anschaffungskosten muss eine Zahl sein (max 2 Nachkommastellen)' },
  )
  @Min(0, { message: 'anschaffungskosten muss >= 0 sein' })
  anschaffungskosten?: number;

  /** Eigenkapital der Tochter zum Stichtag (§ 301 Abs. 1 HGB). */
  @IsOptional()
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'eigenkapitalTochter muss eine Zahl sein (max 2 Nachkommastellen)' },
  )
  eigenkapitalTochter?: number;

  /** Jahresüberschuss/-fehlbetrag der Tochter für das Geschäftsjahr. */
  @IsOptional()
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'jahresueberschussTochter muss eine Zahl sein (max 2 Nachkommastellen)' },
  )
  jahresueberschussTochter?: number;
}