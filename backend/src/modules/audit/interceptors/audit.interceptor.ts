import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { type AuditActionLiteral } from '../constants/audit-actions';
import { AuditService } from '../services/audit.service';

const AUDITABLE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const AUDIT_SKIP_PATHS = ['/api/auth/login', '/api/auth/refresh', '/api/auth/logout'];

/**
 * Auto-Audit-Interceptor.
 *
 * Schreibt für jede mutierende HTTP-Anfrage einen AuditLog-Eintrag. Login-
 * und Refresh-Endpoints sind explizit übersprungen — sie loggen manuell via
 * AuthService.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(private readonly auditService: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    const method: string = req.method ?? '';
    if (!AUDITABLE_METHODS.has(method)) {
      return next.handle();
    }
    const originalUrl: string = req.originalUrl ?? req.url ?? '';
    if (AUDIT_SKIP_PATHS.some((p) => originalUrl.startsWith(p))) {
      return next.handle();
    }

    const { entityType, entityId } = this.parseEntity(originalUrl);
    const action = this.methodToAction(method);

    return next.handle().pipe(
      tap({
        next: (responseBody: unknown) => {
          const resolvedId = entityId ?? this.extractIdFromResponse(responseBody);
          void this.auditService.record({
            userId: req.user?.id ?? null,
            mandantId: req.activeMandantId ?? null,
            action,
            entityType,
            entityId: resolvedId ?? null,
            newState: this.toJsonValue(responseBody),
            ipAddress: req.ip ?? req.socket?.remoteAddress ?? null,
            userAgent: (req.headers?.['user-agent'] as string | undefined) ?? null,
          });
        },
        error: (err: Error) => {
          void this.auditService.record({
            userId: req.user?.id ?? null,
            mandantId: req.activeMandantId ?? null,
            action,
            entityType,
            entityId: entityId ?? null,
            newState: { error: err.message },
            ipAddress: req.ip ?? req.socket?.remoteAddress ?? null,
            userAgent: (req.headers?.['user-agent'] as string | undefined) ?? null,
          });
        },
      }),
    );
  }

  private methodToAction(method: string): AuditActionLiteral {
    switch (method) {
      case 'POST':
        return 'CREATE';
      case 'PUT':
      case 'PATCH':
        return 'UPDATE';
      case 'DELETE':
        return 'DELETE';
      default:
        return 'READ';
    }
  }

  private parseEntity(url: string): { entityType: string; entityId: string | null } {
    const path = url.split('?')[0] ?? '';
    const apiIndex = path.indexOf('/api/');
    const stripped = apiIndex >= 0 ? path.substring(apiIndex + 5) : path;
    const segments = stripped.split('/').filter(Boolean);
    const [entityType, firstId] = segments;
    return {
      entityType: entityType ?? 'unknown',
      entityId: firstId ?? null,
    };
  }

  private extractIdFromResponse(body: unknown): string | null {
    if (body && typeof body === 'object' && 'id' in body) {
      const id = (body as { id: unknown }).id;
      return typeof id === 'string' ? id : null;
    }
    return null;
  }

  private safeJson(value: unknown): unknown {
    if (value === undefined || value === null) return null;
    try {
      return JSON.parse(JSON.stringify(value)) as unknown;
    } catch (err) {
      this.logger.warn(`Audit-Sanitize fehlgeschlagen: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * Konvertiert beliebige JSON-Datenbank-Strukturen in `Prisma.JsonValue`.
   * Vermeidet das `unknown`-Cast-Idiom, da JSON-Werte strukturell
   * kompatibel sind.
   */
  private toJsonValue(value: unknown): Prisma.JsonValue | undefined {
    const sanitized = this.safeJson(value);
    if (sanitized === null || sanitized === undefined) {
      return undefined;
    }
    return sanitized as Prisma.JsonValue;
  }
}
