import { IsNotEmpty, IsString, Length } from 'class-validator';

/**
 * Body für POST /api/jahresabschluss/:id/einreichen.
 *
 * BEFUND 2026-10-20 (Nachtrag 62, TODO-8.10): `SIGNED -> SUBMITTED ->
 * PUBLISHED` hatten Beschriftung und Typ, aber **keinen Schreibpfad**.
 * `banzBestellnummer` und `veroeffentlichtAm` blieben unbeschrieben, und die
 * Tabelle `banz_submission` war leer.
 *
 * Die Bestellnummer ist **Pflicht**. Sie ist der einzige Beleg, dass die
 * Einreichung beim Bundesanzeiger angekommen ist — ohne sie waere der
 * Statuswechsel eine Behauptung. Der Bundesanzeiger weist die Nummer nach
 * der Einreichung zu; die Kanzlei traegt sie hier ein.
 */
export class EinreichenJahresabschlussDto {
  /**
   * Die BAnz-Bestellnummer (Vorgangsnummer) aus dem Portal.
   *
   * Sie muss **eindeutig** sein: zwei Jahresabschluesse auf denselben
   * Vorgang waeren ein Datenfehler, kein Zufall. Die Datenbank erzwingt das
   * ueber `UNIQUE`; der Service gibt bei einem Treffer 409.
   */
  @IsString()
  @IsNotEmpty()
  @Length(5, 100, {
    message:
      'banzBestellnummer muss zwischen 5 und 100 Zeichen lang sein — sie ist ' +
      'der einzige Beleg fuer die Einreichung',
  })
  banzBestellnummer!: string;
}

/**
 * Antwort nach dem Melden einer Einreichung.
 *
 * Der Hash des eingereichten Dokuments steht mit drin: er belegt, **was**
 * eingereicht wurde — unabhaengig davon, was der Storage spaeter noch
 * enthaelt.
 */
export interface EinreichenErgebnisDto {
  id: string;
  status: string;
  eingereichtAm: string;
  /** Die BAnz-Bestellnummer (Vorgangsnummer) aus dem Portal. */
  banzBestellnummer: string;
  /** Der Kanal des Mandanten (PDF_DIRECT | XML_XBRL | EBILANZ_TAXONOMIE). */
  channel: string;
  /** Der angelegte `BanzSubmission`-Datensatz. */
  submissionId: string;
  /** SHA-256 der eingereichten Nutzlast. */
  payloadHash: string;
  /**
   * Das Format der eingereichten Nutzlast.
   *
   * BEFUND 2026-10-22 (Nachtrag 86): Der Wert stand vorher nicht in der
   * Antwort. Der Beleg speicherte zwar `payloadFormat`, die API sagte es
   * aber nicht — bei einem XML-Kanal war die gespeicherte Nutzlast (das
   * PDF) damit nur im Datenbankzweig sichtbar.
   */
  payloadFormat: string;
}

/** Antwort nach dem Melden der Veroeffentlichung. */
export interface VeroeffentlichenErgebnisDto {
  id: string;
  status: string;
  veroeffentlichtAm: string | null;
  banzBestellnummer: string | null;
}
