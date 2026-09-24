/**
 * Response-DTOs für Konsolidierungs-Endpoints.
 *
 * Serialisierungs-Format mit ISO-Dates und number-Beträgen (statt
 * Prisma.Decimal) für die API-Konsumenten.
 */

/** Eine einzelne Konsolidierungs-Buchung. */
export interface KonsolidierungsBuchungDto {
  id: string;
  einheitId: string;
  buchungsArt: string;
  beschreibung: string;
  kontoSoll: string;
  kontoHaben: string;
  /** Betrag in EUR (number, 2 Nachkommastellen). */
  betrag: number;
  mandantId: string | null;
  bezugId: string | null;
  reihenfolge: number;
  istAutomatisch: boolean;
}

/** Aggregierte Konsolidierungs-Einheit. */
export interface KonsolidierungEinheitDto {
  id: string;
  kanzleiId: string;
  mutterMandantId: string;
  tochterMandantIds: string[];
  geschaeftsjahr: number;
  beteiligungsquote: number;
  anschaffungskosten: number;
  eigenkapitalTochter: number;
  jahresueberschussTochter: number;
  konsolidierungsArt: string;
  status: string;
  konzernBilanzId: string | null;
  konzernGuvId: string | null;
  erstellungsdatum: string;
  finalisiertAm: string | null;
  buchungen: KonsolidierungsBuchungDto[];
}

/** Berechnete Konzern-Salden (Aktiva/Passiva/GuV-Aggregat). */
export interface KonzernSaldenDto {
  konzernAktivaSumme: number;
  konzernPassivaSumme: number;
  /** |Aktiva - Passiva|; im Idealfall 0. */
  konzernBilanzDifferenz: number;
  /** Saldo der Konzern-GuV (Erlöse - Aufwendungen). */
  konzernGuVErgebnis: number;
  /** Eigenkapitalquote in Prozent (EK / Bilanzsumme * 100). */
  eigenkapitalQuoteKonzern: number;
  /** Passive Differenz aus Kapitalkonsolidierung (Goodwill). */
  goodwill: number;
  /** Aktive Differenz aus Kapitalkonsolidierung (Badwill). */
  badwill: number;
}

/** Response von POST /apply. */
export interface ApplyKonsolidierungResponseDto {
  konzernBilanzId: string;
  konzernGuvId: string;
  salden: KonzernSaldenDto;
  anzahlBuchungen: number;
}