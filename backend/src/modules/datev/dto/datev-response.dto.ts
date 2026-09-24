/**
 * Response-DTOs für DATEV-Endpoints.
 *
 * Alle CSV-Antworten werden base64-kodiert zurückgegeben (analog zum
 * bestehenden eBilanz-XBRL-Endpoint-Pattern), damit JSON-Encoding-
 * Probleme mit Zeilenumbrüchen und Sonderzeichen vermieden werden.
 */

/**
 * Response für POST /api/datev/generate-buchungsstapel.
 */
export interface GenerateDatevResponse {
  /** Base64-kodierte CSV-Datei. */
  csvBase64: string;
  /** Empfohlener Dateiname (zum Download). */
  filename: string;
  /** Metadata zur Generierung. */
  metadata: DatevMetadata;
}

/**
 * Response für POST /api/datev/generate-sachkonten.
 */
export interface GenerateSachkontenResponse {
  /** Base64-kodierte CSV-Datei. */
  csvBase64: string;
  /** Empfohlener Dateiname (zum Download). */
  filename: string;
  /** Anzahl enthaltener Konten. */
  anzahlKonten: number;
}

/**
 * Mapping-Preview-Response (GET /api/datev/preview/:guvId).
 *
 * Zeigt, welche GuV-Position auf welches DATEV-Konto gemappt wird.
 */
export interface DatevMappingPreviewResponse {
  /** Liste der Mappings. */
  mappings: Array<{
    source: {
      /** HGB-Kontenrahmen-Zeile (z.B. "1."). */
      kontonummer: string;
      /** GuV-Bezeichnung. */
      bezeichnung: string;
      /** Betrag (positiv für Aufwand und Ertrag). */
      betragAktuell: number;
      /** Kategorie: ERLOES / AUFWAND / etc. */
      kategorie: string;
    };
    target: {
      /** DATEV-Kontonummer (z.B. "4400"). */
      konto: string;
      /** Bezeichnung des DATEV-Kontos. */
      bezeichnung: string;
      /** Kontotyp. */
      kontoTyp: 'ERTRAG' | 'AUFWAND' | 'AKTIV' | 'PASSIV' | 'NEUTRAL';
      /** Standard-BU-Schlüssel. */
      buschluesselDefault: string;
    };
  }>;
  /** GuV-Positionen ohne Mapping (zur Korrektur). */
  unMapped: Array<{
    kontonummer: string;
    bezeichnung: string;
    betragAktuell: number;
    kategorie: string;
    reason: string;
  }>;
  /** Verwendeter Kontenplan. */
  skrPlan: 'SKR03' | 'SKR04';
}

/**
 * Metadata für DATEV-Buchungsstapel-Export.
 */
export interface DatevMetadata {
  /** Verwendeter Kontenplan. */
  skrPlan: 'SKR03' | 'SKR04';
  /** DATEV-Berater-Nummer. */
  beraternummer: string;
  /** DATEV-Mandant-Nummer. */
  mandantennummer: string;
  /** Sachkonten-Länge. */
  sachkontenlaenge: 4 | 5;
  /** Anzahl Buchungs-Zeilen. */
  buchungsZeilenCount: number;
  /** Anzahl verwendeter Konten. */
  verwendeteKontenCount: number;
  /** Liste der verwendeten Konten (für Audit). */
  verwendeteKonten: string[];
  /** Geschäftsjahr. */
  geschaeftsjahr: number;
  /** Mandant-Firmenname. */
  firmenname: string;
  /** Summe Erlöse (zur Plausibilitäts-Prüfung). */
  erloeseSumme: number;
  /** Summe Aufwand (zur Plausibilitäts-Prüfung). */
  aufwandSumme: number;
  /** Größe der CSV-Datei in Bytes. */
  csvSizeBytes: number;
  /** CSV-Encoding (immer "UTF-8"). */
  encoding: 'UTF-8';
}