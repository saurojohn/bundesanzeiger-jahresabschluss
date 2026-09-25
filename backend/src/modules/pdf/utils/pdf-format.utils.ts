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

/**
 * Konvertiert einen Hex-Color-String (#rrggbb oder #rgb) in ein
 * PDFKit-RGB-Objekt {r, g, b}.
 *
 * Unterstützt:
 *   - "#2563eb"  (6-stellig)
 *   - "#25e"     (3-stellig, expandiert zu "#2255ee")
 *
 * Fällt bei ungültigem Input auf das Default-Blau (#2563eb) zurück.
 */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const DEFAULT = { r: 37, g: 99, b: 235 }; // #2563eb
  if (typeof hex !== 'string') return DEFAULT;

  const trimmed = hex.trim();
  // 3-stellige Kurzform: #rgb → #rrggbb
  const shortMatch = /^#?([a-f\d])([a-f\d])([a-f\d])$/i.exec(trimmed);
  if (shortMatch) {
    return {
      r: parseInt((shortMatch[1] ?? '0') + (shortMatch[1] ?? '0'), 16),
      g: parseInt((shortMatch[2] ?? '0') + (shortMatch[2] ?? '0'), 16),
      b: parseInt((shortMatch[3] ?? '0') + (shortMatch[3] ?? '0'), 16),
    };
  }
  // 6-stellig: #rrggbb
  const fullMatch = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(trimmed);
  if (fullMatch) {
    return {
      r: parseInt(fullMatch[1] ?? '00', 16),
      g: parseInt(fullMatch[2] ?? '00', 16),
      b: parseInt(fullMatch[3] ?? '00', 16),
    };
  }
  return DEFAULT;
}