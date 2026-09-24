import { IsOptional, IsString } from 'class-validator';

/**
 * DTO für /api/signatur/validate.
 *
 * Der Client schickt das signierte PDF als Base64-codierten String (kein
 * Multipart-Upload nötig). Optional kann die erwartete Signierer-Email
 * geprüft werden (Subject-Check).
 */
export class ValidateSignatureDto {
  @IsString()
  signedPdfBase64!: string;

  @IsOptional()
  @IsString()
  expectedSignerEmail?: string;
}