/**
 * SKR04 — Ertragskonten (4400-4999).
 *
 * Standard-Kontenrahmen 04 für Erträge:
 *   4400-4799  Umsatzerlöse und Erlöse aus Beteiligungen
 *   4800-4999  Sonstige betriebliche Erträge (neutrale Erträge)
 *
 * Mapping: Erträge werden in der GuV als POSITIVE Beträge geführt. Die
 * DATEV-Buchung erfolgt: Soll: Bankkonto (1800), Haben: Ertragskonto.
 */
import type { SkrKonto } from './skr04-hgb.types';

/**
 * Ertragskonten SKR04.
 *
 * USt-Schlüssel:
 *   - "1" = 19% (Standard-Umsatzsteuer)
 *   - "3" = 7% (ermäßigt)
 *   - "0" = keine / steuerfrei
 */
export const SKR04_ERTRAG: readonly SkrKonto[] = [
  {
    konto: '4400',
    bezeichnung: 'Erlöse aus Beratung (19% USt)',
    kontoTyp: 'ERTRAG',
    umsatzsteuerCode: '1',
    buschluesselDefault: '0',
    hgbKategorien: ['UMSATZERLOESE'],
    hgbKontonummern: ['Umsatzerlöse', '1.'],
  },
  {
    konto: '4410',
    bezeichnung: 'Erlöse aus Honoraren (19% USt)',
    kontoTyp: 'ERTRAG',
    umsatzsteuerCode: '1',
    buschluesselDefault: '0',
    hgbKategorien: ['UMSATZERLOESE'],
    hgbKontonummern: ['Umsatzerlöse', '1.'],
  },
  {
    konto: '4500',
    bezeichnung: 'Sonstige Erlöse (19% USt)',
    kontoTyp: 'ERTRAG',
    umsatzsteuerCode: '1',
    buschluesselDefault: '0',
    hgbKategorien: ['UMSATZERLOESE'],
    hgbKontonummern: ['Umsatzerlöse', '1.'],
  },
  {
    konto: '4700',
    bezeichnung: 'Erlöse aus Beteiligungen (steuerfrei § 8b KStG)',
    kontoTyp: 'ERTRAG',
    umsatzsteuerCode: '0',
    buschluesselDefault: '0',
    hgbKategorien: ['BETEILIGUNGSERTRAG'],
    hgbKontonummern: ['13.', 'Beteiligungserträge'],
  },
  {
    konto: '4720',
    bezeichnung: 'Erträge aus Beteiligungen (steuerfrei)',
    kontoTyp: 'ERTRAG',
    umsatzsteuerCode: '0',
    buschluesselDefault: '0',
    hgbKategorien: ['BETEILIGUNGSERTRAG'],
    hgbKontonummern: ['13.', 'Beteiligungserträge'],
  },
  {
    konto: '4800',
    bezeichnung: 'Sonstige betriebliche Erträge (nicht steuerpflichtig)',
    kontoTyp: 'ERTRAG',
    umsatzsteuerCode: '0',
    buschluesselDefault: '0',
    hgbKategorien: ['SONSTIGE_ERTRAEGE'],
    hgbKontonummern: ['Sonstige betriebliche Erträge', '11.'],
  },
  {
    konto: '4830',
    bezeichnung: 'Erträge aus Anlagenabgang',
    kontoTyp: 'ERTRAG',
    umsatzsteuerCode: '0',
    buschluesselDefault: '0',
    hgbKategorien: ['SONSTIGE_ERTRAEGE'],
    hgbKontonummern: ['Sonstige betriebliche Erträge', '11.'],
  },
  {
    konto: '4840',
    bezeichnung: 'Erträge aus Währungsumrechnung',
    kontoTyp: 'ERTRAG',
    umsatzsteuerCode: '0',
    buschluesselDefault: '0',
    hgbKategorien: ['FINANZERTRAG'],
    hgbKontonummern: ['12.', 'Finanzerträge'],
  },
];