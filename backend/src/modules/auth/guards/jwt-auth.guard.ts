import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { Observable } from 'rxjs';
import { IS_PUBLIC_KEY } from '../constants/auth.constants';

/**
 * Globaler JWT-Auth-Guard.
 *
 * Wird via `APP_GUARD` registriert. Überspringt Routes, die mit @Public()
 * markiert sind.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context) as
      | boolean
      | Promise<boolean>
      | Observable<boolean>;
  }

  /**
   * Wird bei einem ungültigen Token von Passport aufgerufen. Wirft eine
   * `UnauthorizedException` mit deutschem Text — die Globale CORS-Layer
   * sorgt für einheitliche Response-Struktur.
   */
  handleRequest<TUser = unknown>(
    err: Error | null,
    user: TUser,
  ): TUser {
    if (err || !user) {
      throw err ?? new UnauthorizedException('Nicht authentifiziert');
    }
    return user;
  }
}
