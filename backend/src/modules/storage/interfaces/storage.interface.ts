/**
 * Storage-Interfaces (WORM / Object-Lock).
 *
 * WORM = Write-Once-Read-Many. GoBD § 147 AO verlangt eine 10-jährige
 * unveränderliche Aufbewahrung von Jahresabschlüssen. Wir setzen das
 * via S3 Object Lock im `COMPLIANCE`-Mode um.
 */

/**
 * Input-Optionen für `StorageService.uploadToWorm()`.
 *
 * Der Aufrufer liefert den vollständigen Buffer + Schlüssel. Der
 * Service kümmert sich um SHA-256-Hash, Header und Retention-Datum.
 */
export interface WormStorageOptions {
  /** S3-Objekt-Key (z.B. `mandant/<uuid>/bilanz/<gj>/<run>.pdf`). */
  objectKey: string;
  /** Domain-Typ des Quell-Datensatzes (für Audit + Manifest). */
  entityType: string; // "BILANZ_PDF" | "GUV_PDF" | "ANHANG_PDF" | "ABSCHLUSS_PDF" | ...
  /** ID des Quelldatensatzes (UUID). */
  entityId: string;
  /** Mandant, dem das Objekt zugeordnet ist (Mandant-Trennung). */
  mandantId: string;
  /** Inhalt (PDF-Bytes o.ä.). */
  data: Buffer;
  /** MIME-Type, default `application/pdf`. */
  contentType?: string;
  /**
   * Aufbewahrungsdauer in Tagen. Default 3650 (10 Jahre, GoBD § 147 AO).
   */
  retentionDays?: number;
}

/**
 * Result-Metadaten eines Uploads — wird im `WormObject`-Modell persistiert.
 */
export interface WormObjectMetadata {
  objectKey: string;
  sha256Hash: string;
  sizeBytes: number;
  uploadedAt: Date;
  retentionExpiresAt: Date;
}

/**
 * Ergebnis einer `checkObjectLock()`-Anfrage.
 */
export interface ObjectLockStatus {
  locked: boolean;
  /** Gesetzlicher Hold aktiv? */
  legalHold?: boolean;
  /** Retention-Datum (COMPLIANCE / GOVERNANCE). */
  retentionUntil?: Date;
  /** Mode ('COMPLIANCE' | 'GOVERNANCE' | undefined). */
  mode?: string;
}