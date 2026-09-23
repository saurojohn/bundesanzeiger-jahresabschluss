import { IsEmail, IsOptional, IsString, Length } from 'class-validator';

export class TotpSetupRequestDto {
  @IsOptional()
  @IsString()
  _unused?: never; // DTO ohne Felder — Reservierung für spätere Erweiterungen
}

export class TotpEnableRequestDto {
  /**
   * Base32-Secret aus /auth/totp/setup (Client-State, nicht persistiert).
   */
  @IsString({ message: 'secret muss ein String sein' })
  @Length(16, 64, { message: 'secret muss zwischen 16 und 64 Zeichen lang sein' })
  secret!: string;

  @IsString({ message: 'code muss ein String sein' })
  @Length(6, 6, { message: 'code muss 6 Zeichen lang sein' })
  code!: string;
}

export class TotpDisableRequestDto {
  @IsEmail({}, { message: 'email muss eine gültige E-Mail-Adresse sein' })
  email!: string;

  @IsString({ message: 'password muss ein String sein' })
  @Length(8, 200, { message: 'password muss zwischen 8 und 200 Zeichen lang sein' })
  password!: string;

  @IsString({ message: 'code muss ein String sein' })
  @Length(6, 6, { message: 'code muss 6 Zeichen lang sein' })
  code!: string;
}
