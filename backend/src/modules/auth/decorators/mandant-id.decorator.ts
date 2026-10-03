import {
  BadRequestException,
  createParamDecorator,
  ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import { resolveMandantId } from '../utils/resolve-mandant-id';

type RequestWithMandantSources = Request & {
  activeMandantId?: string;
  body?: Record<string, unknown>;
  params?: Record<string, string | string[]>;
  query?: Record<string, unknown>;
};

const FEHLERHINWEIS =
  'mandantId erforderlich (Header x-mandant-id, Query-Parameter oder Body)';

function readMandantId(ctx: ExecutionContext): string | undefined {
  const req = ctx.switchToHttp().getRequest<RequestWithMandantSources>();
  return resolveMandantId(req);
}

/**
 * Liest die mandantId mit derselben Praezedenz wie der {@link MandantGuard}:
 * `params.mandantId` → `x-mandant-id`-Header → `?mandantId=` → Body-Feld,
 * wobei der vom Guard validierte Wert (`req.activeMandantId`) fuehrt.
 *
 * Bugfix 2026-10-03: Diese Routen deklarierten `@Query('mandantId')` und
 * bekamen dadurch ausschliesslich den Query-Parameter zu sehen. Der Guard
 * akzeptierte dagegen vier Quellen. Ein Client, der (wie das Frontend) den
 * Mandanten ueber den Header waehlt, passierte den Guard und bekam dann
 * `undefined` in die Service-Schicht:
 *
 *   - `assertMandantAccess(undefined, user)` → 403 "Kein Zugriff auf diesen
 *     Mandanten" — sachlich falsch, der Mandant war authorisiert.
 *   - Aufloesungslisten wurden mit `mandantId: undefined` abgefragt und
 *     lieferten still eine leere Liste statt eines Fehlers.
 *
 * Der Decorator macht Header und Query austauschbar und macht das Fehlen
 * explizit (400) statt indirekt.
 */
export const MandantId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const mandantId = readMandantId(ctx);
    if (!mandantId) throw new BadRequestException(FEHLERHINWEIS);
    return mandantId;
  },
);

/**
 * Wie {@link MandantId}, aber `undefined` statt Fehler, wenn keine mandantId
 * mitkommt. Nur fuer Routen, die das Fehlen fachlich auswerten (z. B. der
 * Audit-Controller, der ohne Angabe ueber alle zulaessigen Mandanten filtert).
 */
export const MandantIdOptional = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => readMandantId(ctx),
);
