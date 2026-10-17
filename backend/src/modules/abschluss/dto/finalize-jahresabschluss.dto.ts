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
   * Abweichungen, die **gemeldet**, aber nicht blockiert werden.
   *
   * Warum nicht blockieren: `A.V.` (Jahresüberschuss in der Bilanz) ist
   * nicht zwangsläufig das GuV-Ergebnis — Kapitalerhöhungen und Entnahmen
   * verschieben den Saldo, ohne in der GuV zu erscheinen. Das Produkt
   * modelliert solche Eigenkapitalbewegungen nicht (keine Entität, kein
   * Feld). Eine harte Sperre würde berechtigte Abschlüsse blockieren; die
   * Abweichung gehört dem Wirtschaftsprüfer gemeldet.
   */
  warnungen: VollstaendigkeitsPruefung[];
  /** Die Abweichung zwischen A.V. und GuV-Ergebnis, falls berechenbar. */
  saldoabgleich: {
    berechenbar: boolean;
    bilanzJahresueberschuss: number | null;
    guvJahresergebnis: number | null;
    abweichung: number | null;
    hinweis: string;
  };
}
