import { IsEmail, IsOptional, IsString, IsUUID, Length } from 'class-validator';

/**
 * Login-Anfrage.
 *
 * Bei aktivem TOTP muss der 6-stellige Code übergeben werden.
 * `mandantId` ist optional und dient nur zur Information — die
 * Mandant-Auswahl erfolgt nach Login über die Session.
 */
export class LoginDto {
  @IsEmail({}, { message: 'email muss eine gültige E-Mail-Adresse sein' })
  email!: string;

  @IsString({ message: 'password muss ein String sein' })
  @Length(8, 200, { message: 'password muss zwischen 8 und 200 Zeichen lang sein' })
  password!: string;

  @IsOptional()
  @IsString({ message: 'totpCode muss ein String sein' })
  @Length(6, 6, { message: 'totpCode muss 6 Zeichen lang sein' })
  totpCode?: string;

  @IsOptional()
  @IsUUID('4', { message: 'mandantId muss eine gültige UUID sein' })
  mandantId?: string;
}
