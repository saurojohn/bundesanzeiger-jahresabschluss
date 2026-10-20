import { IsOptional, IsString, Length } from 'class-validator';

/**
 * Body für POST /api/jahresabschluss/:id/finalize.
 */
export class FinalizeJahresabschlussDto {
  /**
   * Freitext für die Abschluss-Notiz (wird im Audit-Trail mitgeführt).
   */
  @IsOptional()
  @IsString()
  @Length(0, 2000, { message: 'zusammenfassung max 2000 Zeichen' })
  zusammenfassung?: string;

  /**
   * Schriftliche Begründung fuer die Freigabe einer **Abweichung** im
   * Saldoabgleich Bilanz/GuV.
   *
   * ENTSCHEIDUNG 2026-10-20 (Nachtrag 59, Entscheidung 1): Der
   * Saldoabgleich ist von einer Meldung zu einer **Sperre** geworden. Die
   * Abweichung zwischen `A.V.` (Bilanz) und dem GuV-Ergebnis darf den
   * Abschluss nicht mehr ungefragt passieren: eine Bilanzaussage, die
   * nicht aufgeht, ist keine Bilanzaussage.
   *
   * Die Sperre hat aber einen **Ausweg**, weil es einen realen Grund fuer
   * die Abweichung gibt: Kapitalerhoehungen und Entnahmen verschieben den
   * Saldo, ohne in der GuV zu erscheinen — das Produkt erfasst solche
   * Eigenkapitalbewegungen nicht. Wer das weiss, kann die Abweichung
   * **schriftlich begruenden**; die Begruendung geht in den Audit-Trail
   * und ist damit spaeter nachvollziehbar.
   *
   * Die Begruendung gilt **ausschliesslich** fuer den Saldoabgleich.
   * Die anderen Sperren (Bilanz geht nicht auf, GuV fehlt, Anhang mit
   * Platzhaltern, Saetze in Bearbeitung) sind unabhaengig davon und
   * lassen sich nicht begruenden.
   *
   * Mindestens 20 Zeichen: ein Weggeben ohne Begruendung waere eine
   * Begruendung, die niemanden erreicht.
   */
  @IsOptional()
  @IsString()
  @Length(20, 2000, {
    message:
      'begruendung muss zwischen 20 und 2000 Zeichen lang sein — ' +
      'eine Freigabe ohne schriftliche Begruendung ist keine Begruendung',
  })
  begruendung?: string;
}

/**
 * Ergebnis der Vollständigkeitsprüfung.
 *
 * `pruefungen` sind die **Sperren** — jede muss bestehen, sonst wird der
 * Abschluss nicht abgeschlossen. `warnungen` sind Abweichungen, die
 * **nicht** blockieren (siehe unten).
 */
export interface VollstaendigkeitsPruefung {
  /** Der geprüfte Gegenstand. */
  gegenstand: string;
  /** Besteht? */
  bestanden: boolean;
  /** Meldung — bei `bestanden: false` der Grund der Ablehnung. */
  meldung: string;
}

export interface FinalizeErgebnisDto {
  id: string;
  status: string;
  finalisiertAm: string | null;
  /** Die harten Prüfungen, alle bestanden (sonst wäre 409 gekommen). */
  pruefungen: VollstaendigkeitsPruefung[];
  /**
   * Abweichungen, die **gemeldet**, aber nicht blockiert wurden.
   *
   * Warum das der Saldoabgleich ist: `A.V.` (Jahresueberschuss in der
   * Bilanz) ist nicht zwangsläufig das GuV-Ergebnis — Kapitalerhoehungen
   * und Entnahmen verschieben den Saldo, ohne in der GuV zu erscheinen.
   * Das Produkt modelliert solche Eigenkapitalbewegungen nicht (keine
   * Entität, kein Feld). Deshalb gibt es fuer diese **eine** Abweichung
   * den Ausweg einer schriftlichen Begruendung — und keine fuer die
   * anderen Sperren.
   */
  warnungen: VollstaendigkeitsPruefung[];
  /** Die Abweichung zwischen A.V. und GuV-Ergebnis, falls berechenbar. */
  saldoabgleich: {
    berechenbar: boolean;
    bilanzJahresueberschuss: number | null;
    guvJahresergebnis: number | null;
    abweichung: number | null;
    hinweis: string;
    /**
     * Wurde die Abweichung mit einer schriftlichen Begruendung freigegeben?
     *
     * `true` heisst: der Abschluss wurde **trotz** der Abweichung
     * abgeschlossen. Das ist eine Ausnahme, die im Audit-Trail steht —
     * sie muss fuer einen Auditor sichtbar sein.
     */
    freigegeben: boolean;
    /** Die Begruendung, mit der freigegeben wurde. */
    begruendung?: string;
  };
}
