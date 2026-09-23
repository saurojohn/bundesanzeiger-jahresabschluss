/**
 * PDF-Generation Interfaces.
 *
 * Domain-DTOs für die PDF-Generierung. Bewusst getrennt von Storage-
 * Interfaces, damit PDF-Service ohne Storage-Coupling testbar bleibt.
 */

/** Domain-Entities, die als PDF gerendert werden können. */
export type PdfEntityType = 'BILANZ' | 'GUV' | 'ANHANG' | 'ABSCHLUSS';

/**
 * Input für die PDF-Generierung (vom Controller).
 *
 * `entityType`/`entityId`/`mandantId` bestimmen die Quelle,
 * `metadata` liefert Anzeige-Daten (Firmenname etc.).
 */
export interface PdfGenerationRequest {
  entityType: PdfEntityType;
  entityId: string;
  mandantId: string;
  metadata?: {
    firmenname: string;
    geschaeftsjahr: number;
    rechtsform: string;
    bilanzsumme?: string;
    status: string;
  };
}

/**
 * Metadata für das WORM-PDF (Header, Footer).
 *
 * Wird vom PDF-Service aus den Domain-Daten + PdfGenerationRequest
 * zusammengesetzt.
 */
export interface PdfDocumentMetadata {
  firmenname: string;
  rechtsform: string;
  handelsregister?: string | null;
  geschaeftsjahr: number;
  bilanzsumme?: string;
  status: string;
  erstelltAm: Date;
  erstelltVonEmail: string;
  wormObjectKey: string;
  /** SHA-256-Hash (Hex) — wird auch ins PDF-Body gedruckt. */
  sha256Hash: string;
}

/**
 * Response nach PDF-Generation + WORM-Upload.
 *
 * Wird vom Controller an das Frontend zurückgegeben.
 */
export interface PdfGenerationResponse {
  wormObjectKey: string;
  sha256Hash: string;
  sizeBytes: number;
  uploadedAt: Date;
  retentionExpiresAt: Date;
  /** Relativer Download-Pfad (für Frontend). */
  downloadUrl: string;
}