import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { APIKeyContext } from '../services/api-key.service';

/**
 * Liest den authentifizierten API-Key-Context aus dem Request.
 *
 * Wird vom ApiKeyGuard in `req.apiKeyContext` platziert. Verfügbar
 * innerhalb von `@UseGuards(ApiKeyGuard)`-Endpoints.
 */
export const CurrentApiKey = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): APIKeyContext => {
    const request = ctx.switchToHttp().getRequest();
    return request.apiKeyContext as APIKeyContext;
  },
);