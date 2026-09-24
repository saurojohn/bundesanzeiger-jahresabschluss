/**
 * Typ-Definitionen für das Signatur-Modul.
 *
 * Konventionen:
 *   - eIDAS-konform: QUALIFIZIERT > FORTGESCHRITTEN > EINFACH
 *   - PKCS#7 / PAdES / XAdES sind gängige Signatur-Formate; M2 unterstützt PKCS7
 *   - TSA-Auswahl ist konfigurierbar — DigiStamp ist Standard im Pilot
 */

export type SignatureType = 'EINFACH' | 'FORTGESCHRITTEN' | 'QUALIFIZIERT';
export type SignatureFormat = 'PKCS7' | 'PAdES' | 'XAdES';
export type TimestampAuthority = 'DIGISTAMP' | 'GLOBALTRUST' | 'DFN';

/**
 * Metadaten eines P12-Tokens (ohne Private-Key).
 *
 * `subject` und `issuer` werden als Distinguished-Name-Strings gespeichert.
 * `fingerprintSha256` ist der Hash des DER-codierten Zertifikats (nicht des
 * Private-Keys).
 */
export interface P12Metadata {
  subject: string;
  issuer: string;
  serialNumber: string;
  validFrom: Date;
  validTo: Date;
  signatureType: SignatureType;
  fingerprintSha256: string;
}

/**
 * Vollständiges Ergebnis eines Signatur-Vorgangs.
 *
 * `signedPdfBytes` ist der finale Buffer (PDF/A-3-Container mit eingebetteter
 * Signatur). `signedPdfWormKey` ist der Object-Key im WORM-Storage.
 *
 * `hashBefore` und `hashAfter` dienen der Integritätsprüfung.
 */
export interface SignatureResult {
  signatureId: string;
  signedPdfBytes: Buffer;
  signedPdfWormKey: string;
  certificateMetadata: P12Metadata;
  timestampAuthority?: string;
  timestamp?: Date;
  hashBefore: string;
  hashAfter: string;
  isValid: boolean;
  warnings: string[];
}

/**
 * Ergebnis einer Signatur-Validierung.
 *
 * Vier boolesche Integritäts-Flags (issuerTrusted, certificateExpired,
 * timestampValid, documentIntegrity) plus aggregierte `valid`-Ableitung
 * und `warnings` / `errors` für Detail-Diagnose.
 */
export interface ValidationResult {
  valid: boolean;
  signatureCount: number;
  signedBy: string | null;
  issuerTrusted: boolean;
  certificateExpired: boolean;
  timestampValid: boolean;
  documentIntegrity: boolean;
  warnings: string[];
  errors: string[];
}