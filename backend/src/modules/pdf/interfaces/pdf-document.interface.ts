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
  /**
   * Ist der Bestand ein **Arbeitsstand** (DRAFT)?
   *
   * BEFUND 2026-10-20 (Nachtrag 61, TODO-8.9): Ohne diese Unterscheidung
   * landete auch ein Entwurf im Beweis-Archiv — mit 10-Jahres-Object-Lock
   * COMPLIANCE. Ein Entwurf ist aber ein Arbeitsstand: er wird geaendert,
   * verworfen, neu erzeugt. Unwiderruflich archiviert waere er ein
   * "Beweis" fuer einen Stand, den niemand freigegeben hat.
   *
   * ENTSCHEIDUNG 2026-10-20: Entwuerfe bekommen einen eigenen
   * `entityType`, einen eigenen Key-Praefix und **keinen** Object-Lock.
   */
  istEntwurf: boolean;
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
  /**
   * War das PDF ein Entwurf (Arbeitsstand) oder ein Beweisobjekt?
   *
   * BEFUND 2026-10-20 (Nachtrag 61, TODO-8.9): Die Anwenderin muss sehen
   * koennen, dass sie einen Entwurf hat — und nicht einen 10 Jahre
   * gesperrten Beweis.
   */
  istEntwurf: boolean;
  sha256Hash: string;
  sizeBytes: number;
  uploadedAt: Date;
  retentionExpiresAt: Date;
  /** Relativer Download-Pfad (für Frontend). */
  downloadUrl: string;
}