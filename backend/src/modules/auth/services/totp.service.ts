import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { authenticator } from 'otplib';
import * as qrcode from 'qrcode';
import { EncryptionService } from './encryption.service';

export interface TotpSetupResult {
  /** Base32-encoded TOTP secret (nicht verschlüsselt — nur für Setup-Anzeige) */
  secret: string;
  /** otpauth://-URL für QR-Code */
  otpauthUrl: string;
  /** QR-Code als Data-URL (PNG, base64) */
  qrCodeDataUrl: string;
}

/**
 * TOTP-Service für Zeitbasierte Einmal-Passwörter (RFC 6238).
 *
 * Setup: generateSecret() → secret + QR.
 * Enable: enableTotp() verifiziert den ersten Code und persistiert den
 *         verschlüsselten Secret dauerhaft.
 */
@Injectable()
export class TotpService {
  private readonly logger = new Logger(TotpService.name);
  private readonly issuer: string;
  private readonly window: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly encryptionService: EncryptionService,
  ) {
    this.issuer = this.configService.get<string>(
      'TOTP_ISSUER',
      'Bundesanzeiger-Jahresabschluss',
    );
    this.window = Number(this.configService.get<string>('TOTP_WINDOW', '1'));
    authenticator.options = { window: this.window };
  }

  /**
   * Generiert ein neues TOTP-Secret (Base32, 20 Zeichen).
   * Persistiert nichts — der Aufrufer muss den zurückgegebenen Wert
   * dem User anzeigen und `enableTotp()` aufrufen, sobald der erste
   * Code verifiziert wurde.
   */
  generateSecret(): string {
    return authenticator.generateSecret();
  }

  /**
   * Erzeugt den otpauth://-URL und QR-Code (PNG Data-URL).
   */
  async generateQrCodeDataUrl(secret: string, email: string): Promise<string> {
    const otpauthUrl = authenticator.keyuri(email, this.issuer, secret);
    return qrcode.toDataURL(otpauthUrl, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 256,
    });
  }

  /**
   * Aktiviert TOTP für einen User nach erfolgreicher Verifikation.
   * Liefert den verschlüsselten Secret zur Persistierung.
   */
  enableTotp(plainSecret: string, code: string): string {
    this.verifyCodeOrThrow(plainSecret, code);
    return this.encryptionService.encrypt(plainSecret);
  }

  /**
   * Verifiziert einen TOTP-Code gegen einen (verschlüsselten) Secret.
   */
  verify(encryptedSecret: string, code: string): boolean {
    let plain: string;
    try {
      plain = this.encryptionService.decrypt(encryptedSecret);
    } catch (err) {
      this.logger.warn(
        `TOTP decrypt fehlgeschlagen: ${(err as Error).message}`,
      );
      return false;
    }
    try {
      return authenticator.verify({ token: code, secret: plain });
    } catch {
      return false;
    }
  }

  private verifyCodeOrThrow(secret: string, code: string): void {
    const ok = authenticator.verify({ token: code, secret });
    if (!ok) {
      throw new Error('Ungültiger TOTP-Code');
    }
  }
}
