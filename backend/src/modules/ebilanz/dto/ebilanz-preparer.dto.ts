import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Beraterstammdaten (preparer.* in der HGB-Kerntaxonomie).
 *
 * Optional — wenn nicht angegeben, werden die Stammdaten aus dem
 * Mandanten-Firmenstamm abgeleitet (default: leer).
 */
export class EbilanzPreparerDto {
  /** Name des Steuerberaters / der Kanzlei (genInfo.preparer.name). */
  @IsString()
  @MaxLength(255)
  name!: string;

  /** Beraternummer (genInfo.preparer.memberNumber). */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  beraternummer?: string;

  /** Mandantennummer (genInfo.preparer.clientNumber). */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  mandantennummer?: string;

  /** Telefon (genInfo.preparer.telefon). */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  telefon?: string;

  /** E-Mail (genInfo.preparer.email). */
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;
}