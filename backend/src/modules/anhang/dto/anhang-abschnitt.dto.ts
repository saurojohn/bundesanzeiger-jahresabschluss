import {
  IsInt,
  IsString,
  Length,
  Min,
} from 'class-validator';

/**
 * Einzelner Abschnitt eines Anhangs.
 *
 * `inhalt` darf Markdown enthalten (Renderer im Frontend).
 */
export class AnhangAbschnittDto {
  @IsString()
  @Length(1, 250, { message: 'titel muss zwischen 1 und 250 Zeichen lang sein' })
  titel!: string;

  /**
   * Leerer Inhalt ist erlaubt, leerer Titel nicht.
   *
   * Bugfix 2026-10-03: `inhalt` war `@Length(1, 50_000)` — Pflichttext. Die
   * Oberfläche legt beim Öffnen eines Anhangs aber bewusst die fünf
   * Standardabschnitte mit LEEREM Inhalt an (`STANDARD_TITEL`), damit der
   * Anwender sie ausfüllt. Jedes Speichern scheiterte deshalb mit HTTP 400
   * "inhalt muss zwischen 1 und 50000 Zeichen lang sein" — der Anhang war
   * nicht speicherbar, solange die Abschnitte leer waren. Das ist der
   * Normalzustand eines Entwurfs, kein Fehler des Anwenders.
   */
  @IsString()
  @Length(0, 50_000, { message: 'inhalt darf hoechstens 50000 Zeichen lang sein' })
  inhalt!: string;

  @IsInt({ message: 'reihenfolge muss eine Ganzzahl sein' })
  @Min(0)
  reihenfolge!: number;
}