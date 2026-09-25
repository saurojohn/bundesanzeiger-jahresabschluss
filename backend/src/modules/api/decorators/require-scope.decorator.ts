import { SetMetadata } from '@nestjs/common';
import { REQUIRE_SCOPES_KEY } from '../constants/api-key.constants';

/**
 * Markiert einen Endpoint mit erforderlichen OAuth2-Scopes.
 *
 * Verwendung:
 *   @RequireScope('bilanz:read')
 *   @RequireScope('bilanz:read', 'guv:read')    // ALL scopes required
 *
 * Der ApiKeyGuard prüft, ob der authentifizierte API-Key ALLE hier
 * gelisteten Scopes enthält. Fehlt mindestens einer → 403 Forbidden.
 *
 * Backwards-Compat: Wenn der Endpoint keinen @RequireScope-Decorator
 * trägt, wird KEIN Scope-Check durchgeführt (permissive default).
 */
export const RequireScope = (...scopes: string[]): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRE_SCOPES_KEY, scopes);