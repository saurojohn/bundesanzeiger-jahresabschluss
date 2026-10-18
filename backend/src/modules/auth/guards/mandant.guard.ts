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
import { ermittleMandantId } from '../../../common/utils/mandant-kontext';

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

    // Die Aufloesung selbst liegt in `common/utils/mandant-kontext` —
    // **eine Quelle der Wahrheit fuer beide Waechter**.
    //
    // BEFUND 2026-10-17 (Nachtrag 40): Bis eben hatte nur dieser Guard
    // eine Aufloesung, der `RolesGuard` keine. Genau daraus wurde, dass die
    // Rollenpruefung mandantenuebergreifend arbeiten konnte: ohne Mandanten-
    // Kontext blieb ihr nur der globale Vektor `user.mandanten.flatMap(…)`.
    // Zwei Waechter mit zwei Aufloesungen sind zwei Fehlerquellen.
    const mandantId = ermittleMandantId(req);

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
