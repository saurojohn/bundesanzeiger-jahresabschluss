/**
 * SKR04 — Aufwandskonten (5000-7999).
 *
 * Standard-Kontenrahmen 04 für Aufwendungen:
 *   5000-5999   Materialaufwand, Wareneinsatz, bezogene Leistungen
 *   6000-6999   Personalaufwand, Abschreibungen, sonstige Aufwendungen
 *   7000-7999   Steuern, Rückstellungen, sonstige Aufwendungen
 *
 * Mapping: Aufwendungen werden in der GuV als POSITIVE Beträge geführt (Beträge
 * sind betragsmäßig immer positiv — die Kategorie entscheidet, ob es Soll oder
 * Haben ist). Die DATEV-Buchung erfolgt: Soll: Aufwandskonto, Haben: Bankkonto (1800).
 */
import type { SkrKonto } from './skr04-hgb.types';

/**
 * Aufwandskonten SKR04.
 */
export const SKR04_AUFWAND: readonly SkrKonto[] = [
  {
    konto: '5000',
    bezeichnung: 'Materialaufwand',
    kontoTyp: 'AUFWAND',
    buschluesselDefault: '0',
    hgbKategorien: ['MATERIAL'],
    hgbKontonummern: ['5a.', 'Materialaufwand'],
  },
  {
    konto: '5100',
    bezeichnung: 'Wareneinsatz',
    kontoTyp: 'AUFWAND',
    buschluesselDefault: '0',
    hgbKategorien: ['MATERIAL'],
    hgbKontonummern: ['5a.', 'Materialaufwand'],
  },
  {
    konto: '5200',
    bezeichnung: 'Bezogene Leistungen',
    kontoTyp: 'AUFWAND',
    buschluesselDefault: '0',
    hgbKategorien: ['MATERIAL'],
    hgbKontonummern: ['5b.', 'Bezogene Leistungen'],
  },
  {
    konto: '6000',
    bezeichnung: 'Personalaufwand',
    kontoTyp: 'AUFWAND',
    buschluesselDefault: '0',
    hgbKategorien: ['PERSONAL'],
    hgbKontonummern: ['6a.', 'Personalaufwand'],
  },
  {
    konto: '6010',
    bezeichnung: 'Löhne',
    kontoTyp: 'AUFWAND',
    buschluesselDefault: '0',
    hgbKategorien: ['PERSONAL'],
    hgbKontonummern: ['6a.', 'Löhne'],
  },
  {
    konto: '6020',
    bezeichnung: 'Gehälter',
    kontoTyp: 'AUFWAND',
    buschluesselDefault: '0',
    hgbKategorien: ['PERSONAL'],
    hgbKontonummern: ['6a.', 'Gehälter'],
  },
  {
    konto: '6030',
    bezeichnung: 'Soziale Abgaben',
    kontoTyp: 'AUFWAND',
    buschluesselDefault: '0',
    hgbKategorien: ['PERSONAL'],
    hgbKontonummern: ['6b.', 'Soziale Abgaben'],
  },
  {
    konto: '6040',
    bezeichnung: 'Altersversorgung',
    kontoTyp: 'AUFWAND',
    buschluesselDefault: '0',
    hgbKategorien: ['PERSONAL'],
    hgbKontonummern: ['6b.', 'Altersversorgung'],
  },
  {
    konto: '6200',
    bezeichnung: 'Abschreibungen',
    kontoTyp: 'AUFWAND',
    buschluesselDefault: '0',
    hgbKategorien: ['ABSCHREIBUNG'],
    hgbKontonummern: ['7a.', 'Abschreibungen'],
  },
  {
    konto: '6210',
    bezeichnung: 'Abschreibungen auf Sachanlagen',
    kontoTyp: 'AUFWAND',
    buschluesselDefault: '0',
    hgbKategorien: ['ABSCHREIBUNG'],
    hgbKontonummern: ['7a.', 'Abschreibungen auf Sachanlagen'],
  },
  {
    konto: '6300',
    bezeichnung: 'Sonstige Raumkosten',
    kontoTyp: 'AUFWAND',
    buschluesselDefault: '0',
    hgbKategorien: ['SONSTIGE'],
    hgbKontonummern: ['8.', 'Sonstige betriebliche Aufwendungen'],
  },
  {
    konto: '6310',
    bezeichnung: 'Miete',
    kontoTyp: 'AUFWAND',
    buschluesselDefault: '0',
    hgbKategorien: ['SONSTIGE'],
    hgbKontonummern: ['8.', 'Miete'],
  },
  {
    konto: '6320',
    bezeichnung: 'Pacht',
    kontoTyp: 'AUFWAND',
    buschluesselDefault: '0',
    hgbKategorien: ['SONSTIGE'],
    hgbKontonummern: ['8.', 'Pacht'],
  },
  {
    konto: '6400',
    bezeichnung: 'Energiekosten',
    kontoTyp: 'AUFWAND',
    buschluesselDefault: '0',
    hgbKategorien: ['SONSTIGE'],
    hgbKontonummern: ['8.', 'Energiekosten'],
  },
  {
    konto: '6500',
    bezeichnung: 'Kfz-Kosten',
    kontoTyp: 'AUFWAND',
    buschluesselDefault: '0',
    hgbKategorien: ['SONSTIGE'],
    hgbKontonummern: ['8.', 'Kfz-Kosten'],
  },
  {
    konto: '6800',
    bezeichnung: 'Bürobedarf',
    kontoTyp: 'AUFWAND',
    buschluesselDefault: '0',
    hgbKategorien: ['SONSTIGE'],
    hgbKontonummern: ['8.', 'Bürobedarf'],
  },
  {
    konto: '7000',
    bezeichnung: 'Werbekosten',
    kontoTyp: 'AUFWAND',
    buschluesselDefault: '0',
    hgbKategorien: ['SONSTIGE'],
    hgbKontonummern: ['8.', 'Werbekosten'],
  },
  {
    konto: '7100',
    bezeichnung: 'Reisekosten',
    kontoTyp: 'AUFWAND',
    buschluesselDefault: '0',
    hgbKategorien: ['SONSTIGE'],
    hgbKontonummern: ['8.', 'Reisekosten'],
  },
  {
    konto: '7500',
    bezeichnung: 'Zinsaufwendungen',
    kontoTyp: 'AUFWAND',
    buschluesselDefault: '0',
    hgbKategorien: ['FINANZAUFWAND'],
    hgbKontonummern: ['12.', 'Zinsaufwendungen'],
  },
  {
    konto: '7600',
    bezeichnung: 'Steuern vom Einkommen und Ertrag',
    kontoTyp: 'AUFWAND',
    buschluesselDefault: '0',
    hgbKategorien: ['STEUER'],
    hgbKontonummern: ['14.', 'Steuern vom Einkommen und Ertrag'],
  },
  {
    konto: '7700',
    bezeichnung: 'Sonstige Steuern',
    kontoTyp: 'AUFWAND',
    buschluesselDefault: '0',
    hgbKategorien: ['STEUER'],
    hgbKontonummern: ['15.', 'Sonstige Steuern'],
  },
  {
    konto: '7800',
    bezeichnung: 'Rückstellungszuführungen',
    kontoTyp: 'AUFWAND',
    buschluesselDefault: '0',
    hgbKategorien: ['SONSTIGE'],
    hgbKontonummern: ['9.', 'Sonstige Aufwendungen'],
  },
];