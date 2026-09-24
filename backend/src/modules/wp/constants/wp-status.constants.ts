/**
 * Konstanten für WP-Status-Werte.
 *
 * Bewusst lokal definiert (nicht aus `@prisma/client` reexportiert) — der
 * WP-Service nutzt domain-spezifische Formen, die auch im Frontend
 * und im WP-Bericht verwendet werden.
 */

export const WP_NOTIZ_STATUS = [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'NEEDS_REVISION',
] as const;
export type WPNotizStatus = (typeof WP_NOTIZ_STATUS)[number];

export const WP_PRUEFUNG_STATUS = [
  'IN_PROGRESS',
  'APPROVED',
  'REJECTED',
] as const;
export type WPPruefungStatus = (typeof WP_PRUEFUNG_STATUS)[number];

export const WP_REGEL_STATUS = ['PASSED', 'WARNUNG', 'KRITISCH'] as const;
export type WPRegelStatus = (typeof WP_REGEL_STATUS)[number];

export const WP_REGEL_SCHWEREGRAD = ['INFO', 'WARNUNG', 'KRITISCH'] as const;
export type WPRegelSchweregrad = (typeof WP_REGEL_SCHWEREGRAD)[number];

/**
 * Acknowledge-Aktionen (Status, der via PATCH gesetzt werden darf).
 */
export const WP_NOTIZ_ACK_STATUS: readonly WPNotizStatus[] = [
  'APPROVED',
  'REJECTED',
  'NEEDS_REVISION',
];