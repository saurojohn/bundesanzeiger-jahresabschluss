import type { Request } from 'express';

/**
 * Ermittelt den Mandanten-Kontext eines Requests.
 *
 * **Eine Quelle der Wahrheit für zwei Wächter.** `MandantGuard` und
 * `RolesGuard` brauchen dieselbe Antwort; vor dieser Datei hatte nur der
 * `MandantGuard` eine — und der `RolesGuard` lief **ohne** sie. Genau so
 * konnten die beiden auseinanderlaufen, ohne dass es auffiel.
 *
 * Reihenfolge = Präzedenz (bewusst Header vor Query vor Body):
 *   params — `mandantId` im Pfad, am eindeutigsten
 *   header — expliziter Mandantenwechsel via `x-mandant-id`
 *   query  — REST-üblich (`?mandantId=…`), von den Listen-Endpunkten
 *            (`GET /bilanz`, `/guv`, `/anhang`, …) so bedient
 *   body   — POST/PATCH/Payload
 *
 * Bugfix 2026-09-28 (im `MandantGuard`): `req.query` fehlte dort
 * vollständig. Die Listen-Endpunkte deklarieren `@Query('mandantId')`, der
 * Guard las aber weder Query noch Query-Fallback — dadurch lieferte **jede**
 * Mandanten-Liste für alle Rollen außer SYSTEM_ADMIN ein 403
 * „mandantId erforderlich", egal was der Client sendete.
 *
 * Header bleibt bewusst **vor** Query, damit ein Client nicht per
 * Query-Parameter einen per Header gesetzten Mandanten übersteuern kann.
 *
 * @returns die mandantId oder `null`, wenn keine ermittelbar ist
 *          (kanzlei-weite Routen ohne Mandantenbezug).
 */
export function ermittleMandantId(req: Request): string | null {
  const params = req.params as Record<string, unknown> | undefined;
  const query = req.query as Record<string, unknown> | undefined;
  const body = req.body as Record<string, unknown> | undefined;

  const ausParam = params?.mandantId;
  if (typeof ausParam === 'string' && ausParam.length > 0) return ausParam;

  const ausHeader = req.headers?.['x-mandant-id'];
  if (typeof ausHeader === 'string' && ausHeader.length > 0) return ausHeader;

  const ausQuery = query?.mandantId;
  if (typeof ausQuery === 'string' && ausQuery.length > 0) return ausQuery;

  const ausBody = body?.mandantId;
  if (typeof ausBody === 'string' && ausBody.length > 0) return ausBody;

  return null;
}
