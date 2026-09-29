import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { REQUIRE_MANDANT_KEY } from '../constants/auth.constants';
import type { AuthUser } from '../types/auth-user.types';

/**
 * Mandant-Trennung-Guard.
 *
 * Liest die mandantId aus (in dieser Reihenfolge):
 *   1. URL-Param `:mandantId`
 *   2. Header `x-mandant-id`
 *   3. Body-Feld `mandantId`
 *
 * SYSTEM_ADMIN darf jeden Mandanten adressieren. Alle anderen müssen
 * die mandantId in `user.mandanten` haben.
 *
 * Setzt `req.activeMandantId` als downstream-Signal (für AuditInterceptor,
 * Repository-Layer).
 */
@Injectable()
export class MandantGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<boolean>(REQUIRE_MANDANT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const req = context.switchToHttp().getRequest<Request & {
      user?: AuthUser;
      activeMandantId?: string;
      body?: Record<string, unknown>;
      params?: Record<string, string>;
      query?: Record<string, unknown>;
    }>();
    const user: AuthUser | undefined = req.user;
    if (!user) {
      throw new ForbiddenException('Nicht authentifiziert');
    }

    // Reihenfolge = Präzedenz (bewusst header vor query vor body):
    //   params  — mandantId im Pfad, am eindeutigsten
    //   header  — expliziter Mandantenwechsel via x-mandant-id
    //   query   — REST-ueblich (?mandantId=...); wird von den Listen-Endpunkten
    //             (GET /bilanz, /guv, /anhang, ...) ausschliesslich so bedient
    //   body    — POST/PATCH/Payload
    //
    // Bugfix 2026-09-28: `req.query` fehlte hier voellig. Die Listen-Endpunkte
    // deklarieren `@Query('mandantId')`, der Guard las aber weder Query noch
    // Query-Fallback — dadurch lieferte JEDE Mandanten-Liste fuer alle Rollen
    // ausser SYSTEM_ADMIN ein 403 "mandantId erforderlich", egal was der
    // Client sendete. Header bleibt bewusst VOR query, damit ein Client nicht
    // per Query-Parameter einen per Header gesetzten Mandanten uebersteuern kann.
    const mandantId =
      req.params?.mandantId ??
      (req.headers?.['x-mandant-id'] as string | undefined) ??
      (typeof req.query?.mandantId === 'string' ? req.query.mandantId : undefined) ??
      (typeof req.body?.mandantId === 'string' ? req.body.mandantId : undefined);

    if (!mandantId) {
      throw new ForbiddenException('mandantId erforderlich');
    }

    if (user.globalRole === 'SYSTEM_ADMIN') {
      req.activeMandantId = mandantId;
      return true;
    }

    const accessibleMandantIds = user.mandanten.map((m) => m.id);
    if (!accessibleMandantIds.includes(mandantId)) {
      throw new ForbiddenException('Kein Zugriff auf diesen Mandanten');
    }
    req.activeMandantId = mandantId;
    return true;
  }
}
