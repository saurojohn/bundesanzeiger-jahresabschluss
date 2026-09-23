import { GLOBAL_ROLES, type GlobalRole, MANDANT_ROLES, type MandantRole } from '../constants/auth.constants';

function isGlobalRole(value: string): value is GlobalRole {
  return (GLOBAL_ROLES as readonly string[]).includes(value);
}

function isMandantRole(value: string): value is MandantRole {
  return (MANDANT_ROLES as readonly string[]).includes(value);
}

/**
 * Schmale String-zu-Union-Casts. Datenbank-Werte für `globalRole` und
 * `rolle` kommen aus dem Schema als `String`, werden hier aber über
 * allowlists gegen die dokumentierten Werte geprüft.
 */
export function asGlobalRole(value: string): GlobalRole {
  return isGlobalRole(value) ? value : 'USER';
}

export function asMandantRole(value: string): MandantRole {
  return isMandantRole(value) ? value : 'GF';
}
