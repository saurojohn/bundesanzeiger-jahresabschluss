import { IsIn, IsUUID } from 'class-validator';

/**
 * Signatur-Übersicht für eine signierte Entität (Bilanz/GuV/Anhang).
 *
 * Zweck: die `signatureId`, die `POST /api/signatur/sign-*` zurückgibt, war
 * bis 2026-10-13 ein toter Verweis — sie war in keinem `signature`-Datensatz
 * auffindbar, während das Frontend sie als „Signatur-ID" anzeigte. Seit der
 * Korrektur existiert der Datensatz; dieser Endpunkt macht ihn abrufbar.
 *
 * Die Dekoratoren sind Pflicht, nicht Formsache: die globale ValidationPipe
 * laeuft mit `whitelist: true` und `forbidNonWhitelisted: true`. Eine Klasse
 * OHNE Dekoratoren wird dabei komplett geleert — der Controller bekäme ein
 * leeres Objekt und waere auf die Fehlermeldung des Service angewiesen,
 * statt eine Eingabe zu pruefen.
 */
export class SignaturListeQueryDto {
  /** Entitätentyp. Nur die vier signierbaren Typen sind zulässig. */
  @IsIn(['Bilanz', 'GuV', 'Anhang', 'Abschluss'])
  entityType!: 'Bilanz' | 'GuV' | 'Anhang' | 'Abschluss';

  /** UUID der Entität. */
  @IsUUID('4')
  entityId!: string;
}

/** Ein Signatur-Eintrag in der Listenansicht. */
export interface SignaturEintragDto {
  id: string;
  entityType: string | null;
  entityId: string | null;
  jahresabschlussId: string | null;
  signaturTyp: string;
  /** ISO-8601 — der Zeitpunkt ist belegt oder `null`, niemals geraten. */
  zeitstempel: string | null;
  zeitstempelIssuer: string | null;
  rolle: string;
  userId: string;
  zertifikatSubject: string | null;
  zertifikatIssuer: string | null;
  zertifikatSeriennummer: string | null;
  zertifikatGueltigAb: string | null;
  zertifikatGueltigBis: string | null;
  hashVorher: string;
  hashNachher: string;
  signaturFormat: string;
  createdAt: string;
}
