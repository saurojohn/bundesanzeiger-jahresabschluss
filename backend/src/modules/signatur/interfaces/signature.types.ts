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
  /**
   * WORM-Key des RFC-3161-Tokens (`application/timestamp-reply`).
   *
   * Das Token wird nicht ins PDF eingebettet, sondern als eigenes Beweisobjekt
   * mit Object-Lock COMPLIANCE abgelegt. Erst dadurch ist der Zeitstempel
   * überhaupt prüfbar — bis 2026-10-01 wurden die Token-Bytes direkt nach dem
   * Abruf verworfen.
   */
  timestampTokenWormKey?: string;
  /** SHA-256 über das Token (entspricht dem Manifest-Eintrag im WORM-Storage). */
  timestampTokenSha256?: string;
  /** Seriennummer des Zeitstempels, wie von der TSA vergeben. */
  timestampSerialNumber?: string | null;
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
/**
 * Rechtliche Wirksamkeitsstufe einer Signatur.
 *
 * Warum das noetig ist: `valid: boolean` allein sagt nicht, OB eine
 * Signatur fuer eine Pflichtveroeffentlichung genuegt. Im Pilot laeuft der
 * Signaturpfad mit einem Mock-TSA (`TSA_URL` leer) — es entsteht also ein
 * Schatten mit `valid: true` und `timestampValid: false`. Ein Client konnte
 * daraus nicht ableiten, ob er ein BAnz-Dokument vorlegen darf.
 *
 * - `VOLLSTAENDIG`    Signatur + Zertifikat + Zeitstempel geprueft.
 * - `OHNE_ZEITSTEMPEL`  Signatur und Zertifikat sind echt und geprueft, der
 *                      Zeitstempel ist es nicht (Mock-TSA oder TSA nicht
 *                      erreichbar). Rechtlich NICHT ausreichend.
 * - `UNGUELTIG`        Signatur selbst ist ungueltig.
 */
export type LegalValidity = 'VOLLSTAENDIG' | 'OHNE_ZEITSTEMPEL' | 'UNGUELTIG';

export interface ValidationResult {
  valid: boolean;
  /**
   * Feinere Aussage als `valid`: unterscheidet eine rechtlich vollstaendige
   * Signatur von einer echten, aber zeitstempellosen. Bei `OHNE_ZEITSTEMPEL`
   * darf das Dokument NICHT eingereicht werden.
   */
  legalValidity: LegalValidity;
  signatureCount: number;
  signedBy: string | null;
  issuerTrusted: boolean;
  certificateExpired: boolean;
  timestampValid: boolean;
  documentIntegrity: boolean;
  warnings: string[];
  errors: string[];
}