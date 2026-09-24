/**
 * SKR04 — Aktiv- und Passiv-Konten (0001-3999).
 *
 * Diese Konten sind NICHT für GuV-Buchungen relevant, sondern für
 * Saldovortrag-Buchungen (Saldo-Vortrag aus Bilanz-Salden wird in M3
 * als separate Funktion behandelt).
 *
 * SKR04-Bilanzkonten-Bereiche:
 *   0001-0999   Anlage- und Kapitalkonten (Aktiva + Passiva gemischt)
 *   1000-1399   Umlaufvermögen
 *   1400-1799   Forderungen
 *   1800-1899   Liquide Mittel (Bank, Kasse)
 *   1900-1999   Rechnungsabgrenzungsposten aktiv
 *   2000-2999   Eigenkapital
 *   3000-3999   Rückstellungen + Verbindlichkeiten + RAP passiv
 */
import type { SkrKonto } from './skr04-hgb.types';

/**
 * Aktiv-Konten (Bestandskonten der Aktiva-Seite).
 */
export const SKR04_AKTIV: readonly SkrKonto[] = [
  {
    konto: '0010',
    bezeichnung: 'Grundstücke, grundstücksgleiche Rechte',
    kontoTyp: 'AKTIV',
    buschluesselDefault: '0',
    hgbKategorien: ['SACHANLAGEN'],
    hgbKontonummern: ['A.II.1.'],
  },
  {
    konto: '0080',
    bezeichnung: 'Geschäfts- oder Firmenwert',
    kontoTyp: 'AKTIV',
    buschluesselDefault: '0',
    hgbKategorien: ['IMMATERIELL'],
    hgbKontonummern: ['A.I.3.'],
  },
  {
    konto: '0100',
    bezeichnung: 'Technische Anlagen und Maschinen',
    kontoTyp: 'AKTIV',
    buschluesselDefault: '0',
    hgbKategorien: ['SACHANLAGEN'],
    hgbKontonummern: ['A.II.2.'],
  },
  {
    konto: '0200',
    bezeichnung: 'Andere Anlagen, Betriebs- und Geschäftsausstattung',
    kontoTyp: 'AKTIV',
    buschluesselDefault: '0',
    hgbKategorien: ['SACHANLAGEN'],
    hgbKontonummern: ['A.II.4.'],
  },
  {
    konto: '0500',
    bezeichnung: 'Anteile an verbundenen Unternehmen',
    kontoTyp: 'AKTIV',
    buschluesselDefault: '0',
    hgbKategorien: ['FINANZANLAGEN'],
    hgbKontonummern: ['A.III.1.'],
  },
  {
    konto: '1000',
    bezeichnung: 'Roh-, Hilfs- und Betriebsstoffe',
    kontoTyp: 'AKTIV',
    buschluesselDefault: '0',
    hgbKategorien: ['VORRAETE'],
    hgbKontonummern: ['B.I.1.'],
  },
  {
    konto: '1100',
    bezeichnung: 'Unfertige Erzeugnisse',
    kontoTyp: 'AKTIV',
    buschluesselDefault: '0',
    hgbKategorien: ['VORRAETE'],
    hgbKontonummern: ['B.I.2.'],
  },
  {
    konto: '1200',
    bezeichnung: 'Fertige Erzeugnisse und Waren',
    kontoTyp: 'AKTIV',
    buschluesselDefault: '0',
    hgbKategorien: ['VORRAETE'],
    hgbKontonummern: ['B.I.3.'],
  },
  {
    konto: '1400',
    bezeichnung: 'Forderungen aus Lieferungen und Leistungen',
    kontoTyp: 'AKTIV',
    buschluesselDefault: '0',
    hgbKategorien: ['FORDERUNGEN'],
    hgbKontonummern: ['B.II.1.'],
  },
  {
    konto: '1500',
    bezeichnung: 'Sonstige Vermögensgegenstände',
    kontoTyp: 'AKTIV',
    buschluesselDefault: '0',
    hgbKategorien: ['FORDERUNGEN'],
    hgbKontonummern: ['B.II.4.'],
  },
  {
    konto: '1600',
    bezeichnung: 'Kassenbestand',
    kontoTyp: 'AKTIV',
    buschluesselDefault: '0',
    hgbKategorien: ['LIQUIDE_MITTEL'],
    hgbKontonummern: ['B.IV.'],
  },
  {
    konto: '1800',
    bezeichnung: 'Guthaben bei Kreditinstituten (Bank)',
    kontoTyp: 'NEUTRAL',
    buschluesselDefault: '0',
    hgbKategorien: ['LIQUIDE_MITTEL'],
    hgbKontonummern: ['B.IV.'],
  },
  {
    konto: '1900',
    bezeichnung: 'Rechnungsabgrenzungsposten (aktiv)',
    kontoTyp: 'AKTIV',
    buschluesselDefault: '0',
    hgbKategorien: ['RAP'],
    hgbKontonummern: ['C.'],
  },
];

/**
 * Passiv-Konten (Bestandskonten der Passiva-Seite).
 */
export const SKR04_PASSIV: readonly SkrKonto[] = [
  {
    konto: '2000',
    bezeichnung: 'Gezeichnetes Kapital',
    kontoTyp: 'PASSIV',
    buschluesselDefault: '0',
    hgbKategorien: ['EIGENKAPITAL'],
    hgbKontonummern: ['A.I.'],
  },
  {
    konto: '2100',
    bezeichnung: 'Kapitalrücklage',
    kontoTyp: 'PASSIV',
    buschluesselDefault: '0',
    hgbKategorien: ['EIGENKAPITAL'],
    hgbKontonummern: ['A.II.'],
  },
  {
    konto: '2200',
    bezeichnung: 'Gewinnrücklagen',
    kontoTyp: 'PASSIV',
    buschluesselDefault: '0',
    hgbKategorien: ['EIGENKAPITAL'],
    hgbKontonummern: ['A.III.'],
  },
  {
    konto: '2300',
    bezeichnung: 'Jahresüberschuss / Jahresfehlbetrag',
    kontoTyp: 'PASSIV',
    buschluesselDefault: '0',
    hgbKategorien: ['EIGENKAPITAL'],
    hgbKontonummern: ['A.IV.'],
  },
  {
    konto: '3000',
    bezeichnung: 'Pensionsrückstellungen',
    kontoTyp: 'PASSIV',
    buschluesselDefault: '0',
    hgbKategorien: ['RUECKSTELLUNGEN'],
    hgbKontonummern: ['B.1.'],
  },
  {
    konto: '3100',
    bezeichnung: 'Steuerrückstellungen',
    kontoTyp: 'PASSIV',
    buschluesselDefault: '0',
    hgbKategorien: ['RUECKSTELLUNGEN'],
    hgbKontonummern: ['B.2.'],
  },
  {
    konto: '3200',
    bezeichnung: 'Sonstige Rückstellungen',
    kontoTyp: 'PASSIV',
    buschluesselDefault: '0',
    hgbKategorien: ['RUECKSTELLUNGEN'],
    hgbKontonummern: ['B.3.'],
  },
  {
    konto: '3300',
    bezeichnung: 'Verbindlichkeiten aus Lieferungen und Leistungen',
    kontoTyp: 'NEUTRAL',
    buschluesselDefault: '0',
    hgbKategorien: ['VERBINDLICHKEITEN'],
    hgbKontonummern: ['C.1.'],
  },
  {
    konto: '3500',
    bezeichnung: 'Sonstige Verbindlichkeiten',
    kontoTyp: 'PASSIV',
    buschluesselDefault: '0',
    hgbKategorien: ['VERBINDLICHKEITEN'],
    hgbKontonummern: ['C.7.'],
  },
  {
    konto: '3700',
    bezeichnung: 'Rechnungsabgrenzungsposten (passiv)',
    kontoTyp: 'PASSIV',
    buschluesselDefault: '0',
    hgbKategorien: ['RAP'],
    hgbKontonummern: ['D.'],
  },
  {
    konto: '3800',
    bezeichnung: 'Passive latente Steuern',
    kontoTyp: 'PASSIV',
    buschluesselDefault: '0',
    hgbKategorien: ['LATENTE_STEUERN'],
    hgbKontonummern: ['E.'],
  },
];