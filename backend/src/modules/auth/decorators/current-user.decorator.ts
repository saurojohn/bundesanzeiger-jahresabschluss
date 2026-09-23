import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthUser } from '../types/auth-user.types';

/**
 * Liest den authentifizierten User aus dem Request.
 *
 * Wird vom JwtAuthGuard in `req.user` platziert (über Passport).
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const request = ctx.switchToHttp().getRequest();
    return request.user as AuthUser;
  },
);
