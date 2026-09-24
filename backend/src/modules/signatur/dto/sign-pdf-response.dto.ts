/**
 * Re-Export der API-Response-Typen aus dem Interface-Modul.
 *
 * Convenience-Pfad, damit Controller und Clients `SignatureResultDto`
 * importieren können, ohne den interfaces/-Pfad zu kennen.
 */
export type { SignatureResult, P12Metadata, ValidationResult } from '../interfaces/signature.types';

import type { SignatureResult as SignatureResultBase } from '../interfaces/signature.types';

/**
 * HTTP-Variante von `SignatureResult` — `signedPdfBytes` wird als Base64-
 * String transportiert (JSON-Transport).
 */
export interface SignatureResultDto extends Omit<SignatureResultBase, 'signedPdfBytes'> {
  signedPdfBase64: string;
}