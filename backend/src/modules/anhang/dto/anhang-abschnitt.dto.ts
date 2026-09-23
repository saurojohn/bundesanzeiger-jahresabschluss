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

  @IsString()
  @Length(1, 50_000, { message: 'inhalt muss zwischen 1 und 50000 Zeichen lang sein' })
  inhalt!: string;

  @IsInt({ message: 'reihenfolge muss eine Ganzzahl sein' })
  @Min(0)
  reihenfolge!: number;
}