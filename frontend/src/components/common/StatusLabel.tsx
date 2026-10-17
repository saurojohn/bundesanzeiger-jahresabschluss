'use client';

import { useTranslations } from 'next-intl';

/**
 * Statusanzeige mit Fallback.
 *
 * BEFUND 2026-10-17: Die Bilanz bekommt vom Wirtschaftsprüfer den Status
 * `APPROVED` (Vier-Augen-Freigabe). Der stand in **keiner** Statusmenge des
 * Backends und in **keiner** Übersetzung — die Liste zeigte dem Anwender
 * deshalb den rohen Schlüssel:
 *
 *     bilanz.status.APPROVED
 *
 * (gemessen im Browser nach einer Freigabe)
 *
 * Der Fallback ist der eigentliche Fix: Ein Status, den die Oberflaeche
 * nicht kennt, darf **nie** wieder als Schlüsselpfad erscheinen. Er wird
 * stattdessen im Klartext gezeigt — der Nutzer sieht "REJECTED" und nicht
 * "bilanz.status.REJECTED".
 *
 * Der Namespace ist deshalb ein Parameter: Anhang und GuV verwenden im
 * Frontend ebenfalls `bilanz.status.*`, weil ihre Statusmengen identisch
 * sind. Sobald das auseinanderläuft, ist das hier die Stelle, an der es
 * auffaellt.
 */
export function StatusLabel({
  status,
  namespace = 'bilanz.status',
}: {
  status: string;
  namespace?: string;
}) {
  const t = useTranslations();
  const key = `${namespace}.${status}`;
  return <>{t.has(key) ? t(key) : status}</>;
}
