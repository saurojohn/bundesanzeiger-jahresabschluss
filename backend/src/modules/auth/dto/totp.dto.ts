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

  /**
   * Passwort des aufrufenden Users — **erneute Authentifizierung**.
   *
   * BEFUND 2026-10-19 (Nachtrag 48): Das Aktivieren verlangte bisher
   * **kein** Passwort, waehrend das Deaktivieren (`TotpDisableRequestDto`)
   * Passwort **und** Code verlangt. Diese Asymmetrie ist der Defekt:
   *
   * Wer ein gueltiges JWT hat (Session-Hijack, gestohlener Token, geteiltes
   * Geraet), konnte `/totp/setup` aufrufen, das Secret selbst erzeugen und
   * `/totp/enable` mit einem daraus selbst berechneten Code aufrufen —
   * 200. Gemessen:
   *
   *     (1) /totp/setup                       -> 200, Secret geliefert
   *     (2) /totp/enable (selbst erzeugt)     -> 200, TOTP aktiviert
   *     (3) /totp/disable, Opfer ohne Secret  -> 401 "TOTP-Code ungueltig"
   *     (4) /totp/disable, Code des Angreifers-> 200
   *
   * Das Opfer kennt sein Passwort, aber nicht das Secret — es ist
   **dauerhaft aus seinem eigenen MFA ausgesperrt**, waehrend der
   Angreifer es jederzeit abschalten kann. Aus einer (begrenzten)
   Session-Uebernahme wird eine dauerhafte.
   *
   * Das Aktivieren eines zweiten Faktors ist ein Step-up; die
   * Branche-uebliche Regel (und die Regel desselben Controllers beim
   * Deaktivieren) verlangt dafuer das Passwort. Hier wird **nichts
   * erfunden**, sondern die im Haus bereits geltende Regel auf die
   * Schwester-Route angewandt.
   */
  @IsString({ message: 'password muss ein String sein' })
  @Length(8, 200, { message: 'password muss zwischen 8 und 200 Zeichen lang sein' })
  password!: string;
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
