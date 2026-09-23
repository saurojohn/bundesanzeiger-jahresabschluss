import { Prisma } from '@prisma/client';

/**
 * Format-Helper für PDF-Rendering.
 *
 * Alle Werte gehen ins Deutsche: 1.234.567,89 € (Tausender-Punkt,
 * Dezimal-Komma).
 */

/**
 * Formatiert einen Betrag (Cents-aware) im deutschen Format.
 *
 * Akzeptiert Prisma.Decimal, number (Cents oder EUR), string.
 * Output: "1.234.567,89" (ohne Währungssymbol) — Währung wird im
 * PDF-Layout separat gesetzt (z.B. "€" in der Spaltenüberschrift).
 */
export function formatBetrag(
  value: string | number | Prisma.Decimal | null | undefined,
): string {
  if (value === null || value === undefined) return '–';
  let n: number;
  if (typeof value === 'number') {
    n = value;
  } else if (typeof value === 'string') {
    n = Number.parseFloat(value);
  } else {
    // Prisma.Decimal
    n = value.toNumber();
  }
  if (!Number.isFinite(n)) return '–';
  return new Intl.NumberFormat('de-DE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

/**
 * Formatiert ein Datum im deutschen Format "DD.MM.YYYY".
 */
export function formatDatum(d: Date): string {
  const day = String(d.getUTCDate()).padStart(2, '0');
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const year = d.getUTCFullYear();
  return `${day}.${month}.${year}`;
}

/**
 * Formatiert ein Datum mit Uhrzeit "DD.MM.YYYY HH:mm:ss" (UTC).
 */
export function formatDatumZeit(d: Date): string {
  const datum = formatDatum(d);
  const h = String(d.getUTCHours()).padStart(2, '0');
  const m = String(d.getUTCMinutes()).padStart(2, '0');
  const s = String(d.getUTCSeconds()).padStart(2, '0');
  return `${datum} ${h}:${m}:${s}`;
}

/**
 * Kategorie-Label für GuV-Kategorien (deutsch).
 */
export function guvKategorieLabel(kategorie: string): string {
  const labels: Record<string, string> = {
    ERLOES: 'Umsatzerlöse / Erträge',
    MATERIAL: 'Materialaufwand',
    PERSONAL: 'Personalaufwand',
    ABSCHREIBUNG: 'Abschreibungen',
    SONSTIGE: 'Sonstige betriebliche Aufwendungen',
    STEUER: 'Steuern',
    FINANZ: 'Finanzergebnis',
  };
  return labels[kategorie] ?? kategorie;
}