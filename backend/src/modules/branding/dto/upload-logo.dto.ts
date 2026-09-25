import {
  IsIn,
  IsString,
  Length,
  Matches,
} from 'class-validator';

/**
 * Erlaubte MIME-Types für Kanzlei-Logos.
 *
 * Bewusst eingeschränkt: PNG (primär), JPEG (Fotos) und SVG (Vektor).
 * Andere Formate (GIF, WebP, BMP) werden abgelehnt — sie sind nicht
 * für professionelle Firmen-Logos geeignet und könnten für XSS in
 * Browser-Previews missbraucht werden.
 */
export const ALLOWED_LOGO_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/svg+xml',
] as const;

export type AllowedLogoMimeType = (typeof ALLOWED_LOGO_MIME_TYPES)[number];

/**
 * Body für POST /api/branding/:kanzleiId/logo.
 *
 * Logo wird als Base64-codierter String übertragen (NICHT multipart).
 * Vorteil: Einfacheres Handling, JSON-Only-Pfad, keine File-Upload-
 * Middleware erforderlich. Nachteil: 33% Overhead — bei max 5MB
 * akzeptabel (Base64 → ~6.6MB JSON-Payload).
 */
export class UploadLogoDto {
  @IsString()
  @Length(1, 8_000_000, {
    message:
      'logoBase64 darf max. ~6MB Base64-kodierte Daten enthalten (≈ 5MB Binär)',
  })
  // Whitespace + Base64-Alphabet
  @Matches(/^[A-Za-z0-9+/=]+$/, {
    message: 'logoBase64 muss Base64-kodiert sein',
  })
  logoBase64!: string;

  @IsString()
  @IsIn(ALLOWED_LOGO_MIME_TYPES, {
    message: `mimeType muss einer der folgenden Werte sein: ${ALLOWED_LOGO_MIME_TYPES.join(', ')}`,
  })
  mimeType!: AllowedLogoMimeType;

  @IsString()
  @Length(1, 200, { message: 'filename darf max. 200 Zeichen lang sein' })
  @Matches(/^[A-Za-z0-9._-]+$/, {
    message:
      'filename darf nur Buchstaben, Ziffern, Punkte, Unter- und Bindestriche enthalten',
  })
  filename!: string;
}