import { SetMetadata } from '@nestjs/common';
import {
  GLOBAL_ROLES,
  MANDANT_ROLES,
  ROLES_KEY,
  type GlobalRole,
  type MandantRole,
} from '../constants/auth.constants';

export type AnyRole = GlobalRole | MandantRole;

/**
 * Markiert einen Endpoint mit erlaubten Rollen.
 *
 * Akzeptiert sowohl globale Rollen (`SYSTEM_ADMIN`, `USER`) als auch
 * Mandant-Rollen (`GF`, `STEUERBERATER`, `WIRTSCHAFTSPRUEFER`,
 * `KANZLEI_ADMIN`). Der RolesGuard prüft, ob der User mindestens eine
 * der Rollen besitzt.
 *
 * SYSTEM_ADMIN durchgeht die Prüfung auch, wenn hier nur Mandant-Rollen
 * gefordert sind.
 */
export const Roles = (...roles: AnyRole[]): MethodDecorator & ClassDecorator => {
  const validRoles = [...GLOBAL_ROLES, ...MANDANT_ROLES] as readonly string[];
  const valid = roles.every((r) => validRoles.includes(r));
  if (!valid) {
    throw new Error(
      `Roles()-Decorator: ungültige Rolle. Erlaubt: ${validRoles.join(', ')}`,
    );
  }
  return SetMetadata(ROLES_KEY, roles);
};
