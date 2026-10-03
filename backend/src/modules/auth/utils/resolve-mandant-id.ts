import { BadRequestException } from '@nestjs/common';
import type { Request } from 'express';

/**
 * Request-Form mit dem vom {@link MandantGuard} gesetzten Downstream-Signal.
 */
type RequestWithActiveMandant = Request & {
  activeMandantId?: string;
  body?: Record<string, unknown>;
  params?: Record<string, string | string[]>;
  query?: Record<string, unknown>;
};

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Ermittelt die mandantId aus demselben Request, den der {@link MandantGuard}
 * geprüft hat.
 *
 * Bugfix 2026-10-03: Die Controller (bilanz/guv/anhang) haben die
 * mandantId eigenstaendig aus Query bzw. Body abgeleitet, waehrend der Guard
 * zusaetzlich `params.mandantId` und den Header `x-mandant-id` akzeptiert.
 * Beide Stellen konnten sich nicht widersprechen — aber sie kamen zu
 * unterschiedlichen Ergebnissen:
 *
 *   - Client sendet `x-mandant-id` (das ist exakt, was das Frontend tut,
 *     siehe `apiFetch`): Guard PASS, Controller fand nichts, threw einen
 *     nackten `Error` → HTTP 500. Das Speichern eines bestehenden
 *     Bilanz/GuV/Anhang-Datensatzes war in der Oberflaeche nicht moeglich.
 *   - Routen mit `@Query('mandantId')` bekamen `undefined` in die
 *     Service-Schicht → 403 "Kein Zugriff auf diesen Mandanten", obwohl der
 *     Mandant authorisiert war.
 *
 * (Der PDF-Controller war kein 500er-Fall: er las `body?.mandantId` zuerst
 * und fiel auf Query + Header zurueck. Er nutzt den Helper jetzt trotzdem,
 * damit `params.mandantId` funktioniert und der nackte Error wegfällt.)
 *
 * Deshalb gibt es hier nur EINE Aufloesungsregel, und sie ist identisch mit
 * der des Guards. `req.activeMandantId` steht an erster Stelle: Der Guard hat
 * den Wert zu diesem Zeitpunkt bereits validiert (Zugriffspruefung inklusive),
 * eine erneute Herleitung koennte also nur davon abweichen, wenn ein Client
 * Parameter doppelt und widerspruechlich setzt — dann gewinnt der Guard.
 *
 * Reihenfolge (bewusst, siehe Kommentar im Guard):
 *   params → header → query → body
 */
export function resolveMandantId(req: RequestWithActiveMandant): string | undefined {
  return (
    nonEmptyString(req.activeMandantId) ??
    nonEmptyString(req.params?.mandantId) ??
    nonEmptyString(req.headers?.['x-mandant-id']) ??
    nonEmptyString(req.query?.mandantId) ??
    nonEmptyString(req.body?.mandantId)
  );
}

/**
 * Wie {@link resolveMandantId}, wirft aber statt `undefined` zu liefern.
 *
 * Wirft bewusst {@link BadRequestException} (400) und nicht `new Error(...)`:
 * Ein nackter Error wird von Nest als HTTP 500 "Internal server error"
 * ausgeliefert und verschluckt die Meldung — der Client sieht nicht, was er
 * falsch gemacht hat. Der Fehler entsteht durch die Anfrage des Clients,
 * nicht durch einen Serverdefekt.
 */
export function requireMandantId(req: RequestWithActiveMandant): string {
  const mandantId = resolveMandantId(req);
  if (!mandantId) {
    throw new BadRequestException(
      'mandantId erforderlich (Header x-mandant-id, Query-Parameter oder Body)',
    );
  }
  return mandantId;
}
