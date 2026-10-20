import { IsIn, IsUUID } from 'class-validator';

/**
 * Signatur-Status einer Entität.
 *
 * ENTSCHEIDUNG der Fachverantwortlichen vom 2026-10-14:
 *   „Soll das Signieren die Bilanz/GuV/Anhang gegen Änderung sperren?"
 *   -> Nein. Ein Korrekturvorgang erzeugt zwingend eine neue Signatur, und der
 *      alte WORM-Satz darf nicht gelöscht werden. Stattdessen muss SICHTBAR
 *      sein, wenn die vorgelegten Daten nicht mehr der signierten Fassung
 *      entsprechen.
 *
 * Ohne diese Auskunft sieht der Leser einen signierten Satz und kann nicht
 * wissen, ob er noch der signierte ist.
 */
export type SignaturStatus = 'UNSIGNIERT' | 'SIGNIERT' | 'ABWEICHEND';

export class SignaturStatusQueryDto {
  @IsIn(['Bilanz', 'GuV', 'Anhang', 'Abschluss'])
  entityType!: 'Bilanz' | 'GuV' | 'Anhang' | 'Abschluss';

  @IsUUID('4')
  entityId!: string;
}

export interface SignaturStatusDto {
  entityType: string;
  entityId: string;

  /**
   * `UNSIGNIERT` — nie signiert.
   * `SIGNIERT`    — signiert, seither unverändert.
   * `ABWEICHEND`  — signiert, seither geändert. Die vorgelegten Daten sind
   *                 dann NICHT die signierte Fassung; die signierte Fassung
   *                 liegt unverändert im WORM-Speicher.
   */
  status: SignaturStatus;

  /** Zeitpunkt der jüngsten Signatur (DB-Zeitpunkt des Signatur-Records). */
  signiertAm: string | null;
  signiertVon: string | null;
  signaturTyp: string | null;

  /** SHA-256 des signierten Dokuments. */
  hashNachher: string | null;

  /** WORM-Schlüssel des signierten Dokuments, falls ermittelbar. */
  signedPdfWormKey: string | null;

  /** Zeitpunkt der letzten Änderung an der Entität. */
  entitaetGeaendertAm: string | null;

  /** true, wenn die Entität nach der Signatur geändert wurde. */
  geaendertNachSignatur: boolean;

  /** Anzahl aller Signaturen dieser Entität (Korrekturen erzeugen mehrere). */
  anzahlSignaturen: number;

  /**
   * Was die massgebliche Signatur bescheinigt.
   *
   * BEFUND 2026-10-20 (Nachtrag 60, TODO-8.15): Ohne diese Angabe war eine
   * Komponentensignatur von einer Abschluss-Signatur nicht unterscheidbar.
   * Ein Auditor las „der Jahresabschluss ist signiert", obwohl nur die GuV
   * geprueft war.
   *
   *   * "ABSCHLUSS"   — der Jahresabschluss selbst wurde signiert (Endabnahme)
   *   * "BESTANDTEIL" — ein Bestandteil wurde geprueft
   */
  signaturEbene: 'ABSCHLUSS' | 'BESTANDTEIL';

  /**
   * Anzahl der **geprueften Bestandteile** dieses Jahresabschlusses.
   *
   * Relevant nur fuer `entityType === 'Abschluss'`: dort sagen Komponenten-
   * signaturen nichts ueber die Endabnahme aus, gehoeren aber in die
   * Anzeige — sie sind ein Teil des Pruefprotokolls.
   */
  anzahlBestandteilPruefungen: number;

  /**
   * Menschenlesbare Erläuterung. Steht hier, weil der Unterschied in der
   * Oberfläche nicht in einem Status-Enum verloren gehen darf.
   */
  hinweis: string;
}
