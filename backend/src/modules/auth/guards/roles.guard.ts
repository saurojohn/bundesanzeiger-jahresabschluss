import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY, type MandantRole } from '../constants/auth.constants';
import type { AuthUser } from '../types/auth-user.types';
import type { AnyRole } from '../decorators/roles.decorator';

/**
 * RBAC-Guard.
 *
 * Wenn ein Endpoint ohne @Roles() dekoriert ist, lässt der Guard
 * jeden authentifizierten User passieren (permissive default).
 *
 * Mit @Roles('KANZLEI_ADMIN', 'STEUERBERATER') verlangt der Guard,
 * dass der User mindestens eine dieser Rollen innehat — entweder als
 * globale Rolle oder als Mandant-Rolle.
 *
 * SYSTEM_ADMIN umgeht die Prüfung (globale Admin-Permissions).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<AnyRole[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const req = context.switchToHttp().getRequest();
    const user: AuthUser | undefined = req.user;
    if (!user) {
      throw new ForbiddenException('Nicht authentifiziert');
    }
    if (user.globalRole === 'SYSTEM_ADMIN') return true;

    const userMandantRoles: MandantRole[] = user.mandanten.flatMap((m) => m.rolle);

    const hasRole = requiredRoles.some(
      (r) =>
        r === user.globalRole ||
        (userMandantRoles as readonly string[]).includes(r as string),
    );
    if (!hasRole) {
      throw new ForbiddenException(
        `Rolle fehlt. Erforderlich: ${requiredRoles.join(', ')}`,
      );
    }
    return true;
  }
}
