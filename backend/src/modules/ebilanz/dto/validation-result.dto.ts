/**
 * Validation-Result-DTO für POST /api/ebilanz/validate.
 */
export interface ValidationIssue {
  /** Maschinenlesbarer Fehler-/Warnungs-Code. */
  code: string;
  /** Menschenlesbare Beschreibung (deutsch). */
  message: string;
  /** Optionaler Verweis auf das betroffene Konzept. */
  conceptCode?: string;
}

export interface ValidationResultDto {
  /** Ist die XBRL-Datei insgesamt gültig? */
  valid: boolean;
  /** Liste der schweren Fehler (Validierung nicht bestanden). */
  errors: ValidationIssue[];
  /** Liste der Warnungen (Best Practice). */
  warnings: ValidationIssue[];
}

/**
 * E-Bilanz-Metadata (Response für POST /api/ebilanz/generate).
 */
export interface EbilanzMetadata {
  /** Verwendete Taxonomie-Version. */
  taxonomieVersion: string;
  /** Bilanz-Aktiva-Summe (zur Plausibilitäts-Prüfung). */
  aktivaSumme: number;
  /** Bilanz-Passiva-Summe. */
  passivaSumme: number;
  /** Saldo-Saldo. */
  saldostimmt: boolean;
  /** Jahresüberschuss/-fehlbetrag aus GuV. */
  netIncome: number;
  /** Erlöse-Summe. */
  erloeseSumme: number;
  /** Aufwand-Summe. */
  aufwandSumme: number;
  /** Größe der XBRL-Datei in Bytes. */
  sizeBytes: number;
  /** Anzahl gefundener Facts. */
  anzahlFacts: number;
  /** Geschäftsjahr (aus Bilanz). */
  geschaeftsjahr: number;
  /** Firmenname. */
  firmenname: string;
}

/**
 * Response für POST /api/ebilanz/generate.
 */
export interface GenerateEbilanzResponse {
  /** Base64-kodierte XBRL-Datei. */
  xbrlBase64: string;
  /** Metadaten zur Generierung. */
  metadata: EbilanzMetadata;
}

/**
 * MappingPreviewEntry — beschreibt ein Mapping zwischen Bilanz/GuV-Position
 * und Taxonomie-Konzept.
 */
export interface MappingPreviewEntry {
  /** Quell-Position (z.B. "B.IV." oder "5a."). */
  source: {
    kontonummer: string;
    bezeichnung: string;
    betragAktuell: number;
  };
  /** Ziel-Taxonomie-Code. */
  target: {
    code: string;
    namespace: string;
    labelDe: string;
    calculationSign: '+1' | '-1';
  };
}

export interface MappingPreviewResponse {
  bilanzAktivaMappings: MappingPreviewEntry[];
  bilanzPassivaMappings: MappingPreviewEntry[];
  guvMappings: MappingPreviewEntry[];
  anhangMappings: MappingPreviewEntry[];
  unMapped: Array<{
    source: string;
    kontonummer: string;
    bezeichnung: string;
    betragAktuell: number;
    reason: string;
  }>;
}