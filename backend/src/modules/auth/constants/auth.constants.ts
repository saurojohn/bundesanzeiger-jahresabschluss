/**
 * Globale Rollen eines Users.
 *
 * SYSTEM_ADMIN:    Plattform-weite Administration (Mandant-übergreifend).
 * USER:            Default-Rolle ohne globale Privilegien — Rollenvergabe
 *                  erfolgt über UserMandantRole.
 */
export const GLOBAL_ROLES = ['SYSTEM_ADMIN', 'USER'] as const;
export type GlobalRole = (typeof GLOBAL_ROLES)[number];

/**
 * Rollen innerhalb eines Mandanten (Multi-Tenancy RBAC).
 *
 * GF:                   Geschäftsführer des Mandanten.
 * STEUERBERATER:        Berater der Kanzlei mit CRUD auf Bilanz/GuV/Anhang.
 * WIRTSCHAFTSPRUEFER:   Prüfer — Lesezugriff, Signatur-Berechtigung.
 * KANZLEI_ADMIN:        Kanzlei-Administrator — verwaltet alle Mandanten
 *                       der Kanzlei und ihre User-Zuordnungen.
 */
export const MANDANT_ROLES = [
  'GF',
  'STEUERBERATER',
  'WIRTSCHAFTSPRUEFER',
  'KANZLEI_ADMIN',
] as const;
export type MandantRole = (typeof MANDANT_ROLES)[number];

/**
 * Reflector-Metadaten-Keys für SetMetadata.
 */
export const ROLES_KEY = 'roles';
export const REQUIRE_MANDANT_KEY = 'requireMandant';
export const IS_PUBLIC_KEY = 'isPublic';
