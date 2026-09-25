/**
 * Konstanten für die Public-API (M4 Sprint 1).
 *
 * Definiert die unterstützten OAuth2-Scopes + Reflector-Metadata-Keys.
 *
 * Scopes werden als Doppelpunkt-Separator notiert (`<resource>:<action>`),
 * analog zu gängigen OAuth2-Konventionen (z.B. Google, GitHub).
 */

/**
 * Unterstützte Scopes — die Schnittmenge zwischen OAuth2-Token, API-Key
 * und per-Endpoint-Dekorator.
 */
export const API_SCOPES = [
  'mandant:read',
  'bilanz:read',
  'bilanz:write',
  'guv:read',
  'guv:write',
  'anhang:read',
  'jahresabschluss:read',
  'jahresabschluss:write',
  'banz-submission:write',
  'webhook:manage',
] as const;

export type APIScope = (typeof API_SCOPES)[number];

/**
 * Type-Guard: prüft, ob ein String ein gültiger Scope ist.
 */
export function isAPIScope(value: string): value is APIScope {
  return (API_SCOPES as readonly string[]).includes(value);
}

/**
 * Cast-Helper (analog zu asGlobalRole / asAuditAction).
 */
export function asAPIScope(value: string): APIScope | null {
  return isAPIScope(value) ? value : null;
}

/**
 * Reflector-Metadata-Keys für SetMetadata.
 *
 * `REQUIRE_SCOPES_KEY` — Liste der für einen Endpoint erforderlichen Scopes.
 * `IS_PUBLIC_API_KEY` — Markiert einen API-Endpoint als ohne API-Key
 *                       aufrufbar (z.B. Health).
 */
export const REQUIRE_SCOPES_KEY = 'requireApiScopes';
export const IS_PUBLIC_API_KEY = 'isPublicApiKey';

/**
 * Default-Rate-Limit (Requests pro Stunde) für neu erstellte API-Keys.
 * Kanzlei-Admins können den Wert pro Key überschreiben.
 */
export const DEFAULT_API_KEY_RATE_LIMIT = 1000;

/**
 * Token-Lifetime für OAuth2-Access-Tokens (in Sekunden).
 * 1 Stunde ist der OAuth2-Standard für kurzlebige Tokens.
 */
export const OAUTH_TOKEN_TTL_SECONDS = 3600;