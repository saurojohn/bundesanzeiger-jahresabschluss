import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

/**
 * AES-256-GCM Encryption für TOTP-Secrets.
 *
 * Dev-akzeptabel; wird in M2 durch ein dediziertes KMS (z.B. HashiCorp Vault
 * Transit) ersetzt. Master-Key wird aus JWT_SECRET per scrypt abgeleitet —
 * 32 Bytes Output für AES-256.
 *
 * Format: base64(iv).base64(authTag).base64(cipherText)
 */
@Injectable()
export class EncryptionService {
  private readonly logger = new Logger(EncryptionService.name);
  private readonly key: Buffer;

  constructor(configService: ConfigService) {
    const secret = configService.get<string>('JWT_SECRET');
    if (!secret) {
      throw new Error('JWT_SECRET nicht konfiguriert — TOTP-Encryption nicht möglich');
    }
    // Salt fest im Code — bewusst, weil in M2 durch KMS ersetzt.
    const salt = 'banz-jahresabschluss-totp-salt-v1';
    this.key = scryptSync(secret, salt, 32);
    this.logger.log('EncryptionService initialisiert (AES-256-GCM)');
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return `${iv.toString('base64')}.${authTag.toString('base64')}.${encrypted.toString('base64')}`;
  }

  decrypt(payload: string): string {
    const parts = payload.split('.');
    if (parts.length !== 3) {
      throw new Error('Ungültiges Encryption-Format');
    }
    const iv = Buffer.from(parts[0] ?? '', 'base64');
    const authTag = Buffer.from(parts[1] ?? '', 'base64');
    const cipherText = Buffer.from(parts[2] ?? '', 'base64');
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(cipherText), decipher.final()]);
    return decrypted.toString('utf8');
  }
}
