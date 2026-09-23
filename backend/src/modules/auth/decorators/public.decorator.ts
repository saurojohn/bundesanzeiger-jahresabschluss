import { SetMetadata } from '@nestjs/common';
import { IS_PUBLIC_KEY } from '../constants/auth.constants';

/**
 * Markiert einen Endpoint als öffentlich — der globale JwtAuthGuard
 * überspringt die Authentifizierung. Nur für /auth/login, /auth/refresh,
 * /health verwenden.
 */
export const Public = (): MethodDecorator & ClassDecorator =>
  SetMetadata(IS_PUBLIC_KEY, true);
