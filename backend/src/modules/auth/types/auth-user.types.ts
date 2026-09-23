import type { GlobalRole, MandantRole } from '../constants/auth.constants';

/**
 * Repräsentation eines authentifizierten Users im Request (`req.user`).
 *
 * Wird vom JwtStrategy.validate() aufgebaut und vom CurrentUser-Decorator
 * konsumiert.
 */
export interface AuthUser {
  id: string;
  email: string;
  vorname: string;
  nachname: string;
  globalRole: GlobalRole;
  /**
   * Liste der Mandanten, auf die der User Zugriff hat.
   * - SYSTEM_ADMIN: leeres Array + globalRole === 'SYSTEM_ADMIN'
   * - Andere: mindestens ein Eintrag
   */
  mandanten: Array<{
    id: string;
    firmenname: string;
    rolle: MandantRole;
  }>;
  sessionId?: string;
}

/**
 * Payload eines JWT (Access Token).
 */
export interface JwtAccessPayload {
  sub: string; // user.id
  email: string;
  globalRole: GlobalRole;
  mandanten: AuthUser['mandanten'];
  iat?: number;
  exp?: number;
}

/**
 * Payload eines JWT (Refresh Token).
 */
export interface JwtRefreshPayload {
  sub: string; // user.id
  sessionId: string;
  iat?: number;
  exp?: number;
}
