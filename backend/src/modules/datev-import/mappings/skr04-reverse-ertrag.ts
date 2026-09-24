/**
 * SKR04 → HGB Reverse-Mapping — Ertragskonten (4400-4999).
 *
 * Konvention:
 *   - ERLOES (HGB §275 Position 1) — Umsatzerlöse
 *   - SONSTIGE_ERTRAG (HGB §275 Position 4) — Sonstige betriebliche Erträge
 *   - FINANZ (HGB §275 Position 9-13) — Finanzergebnis
 *
 * Confidence-Levels:
 *   - 1.0: Eindeutig (z. B. "1800 Bank" → B.IV.)
 *   - 0.9: Standard (z. B. "4400 Erlöse 19%" → "1. Umsatzerlöse")
 *   - 0.5-0.7: Mehrdeutig (z. B. "4500 Sonstige Erlöse" könnte auch "4." sein)
 */
import type { ReverseMapping } from './skr04-reverse.types';

export const SKR04_REVERSE_ERTRAG: readonly ReverseMapping[] = [
  {
    datevKonto: '4400',
    datevKontoName: 'Erlöse aus Beratung (19% USt)',
    hgbPosition: '1.',
    hgbKontoNr: 'Umsatzerlöse',
    kategorie: 'ERLOES',
    side: 'NEUTRAL',
    isPflicht: true,
    confidence: 0.95,
  },
  {
    datevKonto: '4410',
    datevKontoName: 'Erlöse aus Honoraren (19% USt)',
    hgbPosition: '1.',
    hgbKontoNr: 'Umsatzerlöse',
    kategorie: 'ERLOES',
    side: 'NEUTRAL',
    isPflicht: false,
    confidence: 0.9,
  },
  {
    datevKonto: '4500',
    datevKontoName: 'Sonstige Erlöse (19% USt)',
    hgbPosition: '4.',
    hgbKontoNr: 'Sonstige betriebliche Erträge',
    kategorie: 'SONSTIGE_ERTRAG',
    side: 'NEUTRAL',
    isPflicht: false,
    confidence: 0.6,
    notes: 'Kann auch als Umsatzerlöse interpretiert werden — manuell prüfen.',
  },
  {
    datevKonto: '4700',
    datevKontoName: 'Erlöse aus Beteiligungen (steuerfrei § 8b KStG)',
    hgbPosition: '13.',
    hgbKontoNr: 'Beteiligungserträge',
    kategorie: 'FINANZ',
    side: 'NEUTRAL',
    isPflicht: false,
    confidence: 0.95,
  },
  {
    datevKonto: '4720',
    datevKontoName: 'Erträge aus Beteiligungen (steuerfrei)',
    hgbPosition: '13.',
    hgbKontoNr: 'Beteiligungserträge',
    kategorie: 'FINANZ',
    side: 'NEUTRAL',
    isPflicht: false,
    confidence: 0.9,
  },
  {
    datevKonto: '4800',
    datevKontoName: 'Sonstige betriebliche Erträge',
    hgbPosition: '4.',
    hgbKontoNr: 'Sonstige betriebliche Erträge',
    kategorie: 'SONSTIGE_ERTRAG',
    side: 'NEUTRAL',
    isPflicht: false,
    confidence: 0.9,
  },
  {
    datevKonto: '4830',
    datevKontoName: 'Erträge aus Anlagenabgang',
    hgbPosition: '4.',
    hgbKontoNr: 'Sonstige betriebliche Erträge',
    kategorie: 'SONSTIGE_ERTRAG',
    side: 'NEUTRAL',
    isPflicht: false,
    confidence: 0.85,
  },
  {
    datevKonto: '4840',
    datevKontoName: 'Erträge aus Währungsumrechnung',
    hgbPosition: '4.',
    hgbKontoNr: 'Sonstige betriebliche Erträge',
    kategorie: 'SONSTIGE_ERTRAG',
    side: 'NEUTRAL',
    isPflicht: false,
    confidence: 0.7,
    notes: 'Kann auch unter FINANZ (11.) erfasst werden, abhängig von Kanzlei-Praxis.',
  },
  {
    datevKonto: '4900',
    datevKontoName: 'Erträge aus Verlustübernahme',
    hgbPosition: '4.',
    hgbKontoNr: 'Sonstige betriebliche Erträge',
    kategorie: 'SONSTIGE_ERTRAG',
    side: 'NEUTRAL',
    isPflicht: false,
    confidence: 0.7,
  },
  {
    datevKonto: '4910',
    datevKontoName: 'Provisionserträge',
    hgbPosition: '1.',
    hgbKontoNr: 'Umsatzerlöse',
    kategorie: 'ERLOES',
    side: 'NEUTRAL',
    isPflicht: false,
    confidence: 0.7,
    notes: 'Strittig: kann auch "4. Sonstige betriebliche Erträge" sein (§ 277 HGB).',
  },
  {
    datevKonto: '4920',
    datevKontoName: 'Lizenzerträge',
    hgbPosition: '1.',
    hgbKontoNr: 'Umsatzerlöse',
    kategorie: 'ERLOES',
    side: 'NEUTRAL',
    isPflicht: false,
    confidence: 0.7,
  },
];