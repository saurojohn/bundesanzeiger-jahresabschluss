/**
 * Konstanten für Konzern-Konsolidierung (PublG §11, HGB §§ 301–306).
 *
 * - `KONSOLIDIERUNGS_AR`: Art der Konsolidierung
 *   (Vollkonsolidierung, Quotenkonsolidierung, at-equity).
 * - `KONSOLIDIERUNGS_BUCHUNGSARTEN`: vordefinierte Eliminations-
 *   Buchungsarten mit HGB-Referenz und Default-SKR04-Konten.
 * - `KONSOLIDIERUNG_STATUS`: Lifecycle-Status einer
 *   Konsolidierungs-Einheit.
 */

export type KonsolidierungsArt = 'VOLLKONSOLIDIERUNG' | 'QUOTAL' | 'AT_EQUITY';

export const KONSOLIDIERUNGS_AR = [
  'VOLLKONSOLIDIERUNG',
  'QUOTAL',
  'AT_EQUITY',
] as const;

export type KonsolidierungsBuchungsArtCode =
  | 'KAPITAL_KONSOLIDIERUNG'
  | 'SCHULDEN_KONSOLIDIERUNG'
  | 'ZWISCHENERGEBNIS'
  | 'AUFWAND_ERTRAG'
  | 'LATENTE_STEUERN';

export const KONSOLIDIERUNGS_BUCHUNGS_ARTEN = [
  'KAPITAL_KONSOLIDIERUNG',
  'SCHULDEN_KONSOLIDIERUNG',
  'ZWISCHENERGEBNIS',
  'AUFWAND_ERTRAG',
  'LATENTE_STEUERN',
] as const;

export interface KonsolidierungsBuchungsArtDef {
  art: KonsolidierungsBuchungsArtCode;
  beschreibung: string;
  hgbReferenz: string; // z.B. "§ 301 HGB"
  defaultKontoSoll: string; // SKR04
  defaultKontoHaben: string; // SKR04
}

/**
 * Vordefinierte Eliminations-Buchungsarten.
 *
 * Die SKR04-Konten sind Standard-Beispiele für Pilot-Szenarien und
 * können im Frontend vom WP überschrieben werden.
 */
export const KONSOLIDIERUNGS_BUCHUNGSARTEN: KonsolidierungsBuchungsArtDef[] = [
  {
    art: 'KAPITAL_KONSOLIDIERUNG',
    beschreibung:
      'Eliminierung der Mutter-Beteiligung gegen Tochter-Eigenkapital (§ 301 HGB)',
    hgbReferenz: '§ 301 HGB',
    defaultKontoSoll: '2000', // Gezeichnetes Kapital (Tochter)
    defaultKontoHaben: '0500', // Beteiligungen (Mutter)
  },
  {
    art: 'SCHULDEN_KONSOLIDIERUNG',
    beschreibung:
      'Eliminierung konzerninterner Forderungen/Verbindlichkeiten (§ 303 HGB)',
    hgbReferenz: '§ 303 HGB',
    defaultKontoSoll: '3300', // Verbindlichkeiten aus L+L (Mutter)
    defaultKontoHaben: '1400', // Forderungen aus L+L (Tochter)
  },
  {
    art: 'ZWISCHENERGEBNIS',
    beschreibung:
      'Eliminierung konzerninterner Gewinne aus Lieferungen (§ 304 HGB)',
    hgbReferenz: '§ 304 HGB',
    defaultKontoSoll: '8500', // Materialaufwand
    defaultKontoHaben: '1000', // Vorräte
  },
  {
    art: 'AUFWAND_ERTRAG',
    beschreibung:
      'Eliminierung konzerninterner Umsatzerlöse (§ 305 HGB)',
    hgbReferenz: '§ 305 HGB',
    defaultKontoSoll: '4400', // Umsatzerlöse (Tochter)
    defaultKontoHaben: '5000', // Materialaufwand (Mutter)
  },
  {
    art: 'LATENTE_STEUERN',
    beschreibung:
      'Latente Steuern aus Konsolidierungsdifferenzen (§ 306 HGB)',
    hgbReferenz: '§ 306 HGB',
    defaultKontoSoll: '7600', // Steuern
    defaultKontoHaben: '3800', // Passive latente Steuern
  },
];

/**
 * Status-Lifecycle einer Konsolidierungs-Einheit.
 *
 *   DRAFT       – angelegt, noch keine Buchungen berechnet
 *   IN_PROGRESS – Buchungen erfasst, Konzern-Bilanz/GuV noch nicht erzeugt
 *   COMPLETED   – Konzern-Bilanz + GuV erfolgreich konsolidiert
 *   VALIDATED   – durch WP geprüft und freigegeben
 */
export const KONSOLIDIERUNG_STATUS = [
  'DRAFT',
  'IN_PROGRESS',
  'COMPLETED',
  'VALIDATED',
] as const;

export type KonsolidierungStatus = (typeof KONSOLIDIERUNG_STATUS)[number];