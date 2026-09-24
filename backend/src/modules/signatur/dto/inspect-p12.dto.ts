import { IsString } from 'class-validator';

/**
 * DTO für /api/signatur/inspect-p12.
 *
 * Liefert ausschließlich Metadaten (Subject, Issuer, Gültigkeit) —
 * NIEMALS den Private-Key.
 */
export class InspectP12Dto {
  @IsString()
  p12Base64!: string;

  @IsString()
  p12Password!: string;
}