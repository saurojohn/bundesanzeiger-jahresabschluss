/**
 * SKR03 — Standard-Kontenrahmen 03 (verkürzte Variante).
 *
 * Im Gegensatz zu SKR04 (typischerweise 4-stellige Konten) verwendet SKR03
 * eine andere Nummerierungs-Logik. Für die wichtigsten Konten hier eine
 * verkürzte Variante, die als Fallback dient, wenn der Mandant SKR03 als
 * Kontenplan konfiguriert hat.
 *
 * Quelle: DATEV-Kontenplan 03 (Standardkontenrahmen für ältere Kanzleien).
 *
 * Hinweis: In M3 wird die SKR03-Tabelle erweitert, sobald konkret
 * SKR03-Mandanten an Bord sind.
 */
import type { SkrKonto, SkrPlan } from './skr04-hgb.types';

/**
 * SKR03-Ertragskonten (verkürzte Auswahl der wichtigsten Konten).
 */
export const SKR03_ERTRAG: readonly SkrKonto[] = [
  {
    konto: '8000',
    bezeichnung: 'Erlöse (SKR03)',
    kontoTyp: 'ERTRAG',
    umsatzsteuerCode: '1',
    buschluesselDefault: '0',
    hgbKategorien: ['UMSATZERLOESE'],
    hgbKontonummern: ['Umsatzerlöse', '1.'],
  },
  {
    konto: '8050',
    bezeichnung: 'Erlöse aus Beteiligungen (SKR03, steuerfrei)',
    kontoTyp: 'ERTRAG',
    umsatzsteuerCode: '0',
    buschluesselDefault: '0',
    hgbKategorien: ['BETEILIGUNGSERTRAG'],
    hgbKontonummern: ['13.'],
  },
  {
    konto: '8100',
    bezeichnung: 'Sonstige betriebliche Erträge (SKR03)',
    kontoTyp: 'ERTRAG',
    umsatzsteuerCode: '0',
    buschluesselDefault: '0',
    hgbKategorien: ['SONSTIGE_ERTRAEGE'],
    hgbKontonummern: ['11.', 'Sonstige betriebliche Erträge'],
  },
];

/**
 * SKR03-Aufwandskonten (verkürzte Auswahl).
 */
export const SKR03_AUFWAND: readonly SkrKonto[] = [
  {
    konto: '5000',
    bezeichnung: 'Materialaufwand (SKR03)',
    kontoTyp: 'AUFWAND',
    buschluesselDefault: '0',
    hgbKategorien: ['MATERIAL'],
    hgbKontonummern: ['5a.'],
  },
  {
    konto: '6000',
    bezeichnung: 'Personalaufwand (SKR03)',
    kontoTyp: 'AUFWAND',
    buschluesselDefault: '0',
    hgbKategorien: ['PERSONAL'],
    hgbKontonummern: ['6a.', '6b.'],
  },
  {
    konto: '6200',
    bezeichnung: 'Abschreibungen (SKR03)',
    kontoTyp: 'AUFWAND',
    buschluesselDefault: '0',
    hgbKategorien: ['ABSCHREIBUNG'],
    hgbKontonummern: ['7a.'],
  },
  {
    konto: '7000',
    bezeichnung: 'Sonstige betriebliche Aufwendungen (SKR03)',
    kontoTyp: 'AUFWAND',
    buschluesselDefault: '0',
    hgbKategorien: ['SONSTIGE'],
    hgbKontonummern: ['8.'],
  },
  {
    konto: '7300',
    bezeichnung: 'Zinsaufwendungen (SKR03)',
    kontoTyp: 'AUFWAND',
    buschluesselDefault: '0',
    hgbKategorien: ['FINANZAUFWAND'],
    hgbKontonummern: ['12.'],
  },
  {
    konto: '7600',
    bezeichnung: 'Steuern vom Einkommen und Ertrag (SKR03)',
    kontoTyp: 'AUFWAND',
    buschluesselDefault: '0',
    hgbKategorien: ['STEUER'],
    hgbKontonummern: ['14.'],
  },
];

/**
 * SKR03-Bankkonto (Standard-Gegenkonto in SKR03).
 */
export const STANDARD_BANK_KONTO_SKR03 = '1200';

/**
 * Aggregierte SKR03-Konten.
 */
export const SKR03_KONTEN: readonly SkrKonto[] = [
  ...SKR03_ERTRAG,
  ...SKR03_AUFWAND,
];

/**
 * Lookup-Map für SKR03-Konten.
 */
export const SKR03_BY_KONTO: ReadonlyMap<string, SkrKonto> = (() => {
  const map = new Map<string, SkrKonto>();
  for (const konto of SKR03_KONTEN) {
    map.set(konto.konto, konto);
  }
  return map;
})();

/**
 * Bankkonto für einen gegebenen Kontenplan.
 */
export function standardBankKonto(plan: SkrPlan): string {
  return plan === 'SKR03' ? STANDARD_BANK_KONTO_SKR03 : '1800';
}

/**
 * Lookup für SKR03-Konten (verkürzte Variante).
 */
export function getSkr03Konto(konto: string): SkrKonto | null {
  return SKR03_BY_KONTO.get(konto) ?? null;
}