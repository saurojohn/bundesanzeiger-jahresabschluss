import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';
import type { SignatureType } from '../interfaces/signature.types';

const SIGNATURE_TYPES = ['EINFACH', 'FORTGESCHRITTEN', 'QUALIFIZIERT'] as const;

/**
 * DTO für /api/signatur/sign-bilanz (analog sign-guv / sign-anhang /
 * sign-abschluss).
 *
 * Mindestens EINE der vier Entity-IDs muss gesetzt sein — die Controller
 * validieren das je nach Endpoint. `p12Base64` wird in Base64 transportiert
 * und im Service zu einem Buffer decodiert (NIE persistiert).
 */
export class SignPdfDto {
  @IsOptional()
  @IsString()
  bilanzId?: string;

  @IsOptional()
  @IsString()
  guvId?: string;

  @IsOptional()
  @IsString()
  anhangId?: string;

  @IsOptional()
  @IsString()
  jahresabschlussId?: string;

  @IsString()
  mandantId!: string;

  @IsString()
  p12Base64!: string;

  @IsString()
  p12Password!: string;

  @IsOptional()
  @IsIn(SIGNATURE_TYPES as readonly string[])
  signatureType?: SignatureType;

  @IsOptional()
  @IsBoolean()
  includeTimestamp?: boolean;
}