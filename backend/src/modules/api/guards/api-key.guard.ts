import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ApiKeyService, type APIKeyContext } from '../services/api-key.service';
import { ApiKeyThrottlerService } from '../services/api-key-throttler.service';
import {
  REQUIRE_SCOPES_KEY,
  asAPIScope,
} from '../constants/api-key.constants';

/**
 * Auth-Guard für Public-API-Endpoints (M4 Sprint 1).
 *
 * Authentifizierung:
 *   1. `Authorization: Bearer ak_<keyId>.<secret>` → API-Key-Validierung
 *   2. `Authorization: Bearer <jwt>` → OAuth2-JWT-Validierung
 *   3. Scope-Check gegen `@RequireScope(...)`-Decorator
 *   4. Per-API-Key Rate-Limit
 *
 * Backwards-Compat:
 *   - Wirft 401 mit deutscher Message (analog zu JwtAuthGuard)
 *   - Wirft 429 mit Retry-After-Header bei Rate-Limit-Überschreitung
 *
 * Mandant-Trennung: Der `apiKeyContext.kanzleiId` wird in jedem
 * Controller-Pfad als Filter für Repository-Queries genutzt.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly apiKeyService: ApiKeyService,
    private readonly throttler: ApiKeyThrottlerService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = this.getAuthHeader(request);

    if (!authHeader) {
      throw new UnauthorizedException('Missing Bearer token');
    }
    if (!authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Invalid Authorization header');
    }

    const token = authHeader.substring(7).trim();
    if (!token) {
      throw new UnauthorizedException('Empty Bearer token');
    }

    let apiKeyContext: APIKeyContext | null = null;

    // Variante 1: API-Key-Token im Format "ak_xxx.<base64-secret>"
    if (token.startsWith('ak_') && token.includes('.')) {
      const [keyId, secret] = token.split('.', 2);
      if (!keyId || !secret) {
        throw new UnauthorizedException('Invalid API-Key format');
      }
      apiKeyContext = await this.apiKeyService.validateApiKey(keyId, secret);
    } else {
      // Variante 2: OAuth2-JWT (signiert via JWT_SECRET)
      apiKeyContext = await this.apiKeyService.validateJwt(token);
    }

    if (!apiKeyContext) {
      throw new UnauthorizedException('Invalid API-Key or token');
    }

    // Scope-Check
    const requiredScopes = this.reflector.getAllAndOverride<string[] | undefined>(
      REQUIRE_SCOPES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (requiredScopes && requiredScopes.length > 0) {
      const grantedSet = new Set<string>(apiKeyContext.scopes);
      const missing = requiredScopes.filter((s) => !grantedSet.has(s));
      if (missing.length > 0) {
        throw new ForbiddenException(
          `Fehlende Scopes: ${missing.join(', ')}`,
        );
      }
    }

    // Rate-Limit
    const rateCheck = await this.throttler.checkRateLimit(
      apiKeyContext.apiKeyId,
      apiKeyContext.rateLimit,
    );
    if (!rateCheck.ok) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Rate-Limit überschritten',
          retryAfter: rateCheck.resetInSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Headers für Response (X-RateLimit-*)
    const res = context.switchToHttp().getResponse();
    if (res && typeof res.setHeader === 'function') {
      res.setHeader('X-RateLimit-Limit', apiKeyContext.rateLimit);
      res.setHeader('X-RateLimit-Remaining', rateCheck.remaining);
      res.setHeader('X-RateLimit-Reset', rateCheck.resetInSeconds);
    }

    // Cast: alle scopes sind bereits via validateApiKey gefiltert,
    // hier geben wir sie zurück. Wir casten zu APIScope[] für strikte
    // Typsicherheit.
    request.apiKeyContext = {
      ...apiKeyContext,
      scopes: apiKeyContext.scopes.filter((s): s is NonNullable<ReturnType<typeof asAPIScope>> => s !== null),
    };

    return true;
  }

  private getAuthHeader(request: Request): string | null {
    const header = request.headers.authorization;
    return typeof header === 'string' && header.length > 0 ? header : null;
  }
}