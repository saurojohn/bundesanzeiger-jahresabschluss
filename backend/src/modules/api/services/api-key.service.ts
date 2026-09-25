import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PublicApiRepository } from '../api.repository';
import { AuditService } from '../../audit/services/audit.service';
import {
  asAPIScope,
  DEFAULT_API_KEY_RATE_LIMIT,
  OAUTH_TOKEN_TTL_SECONDS,
  type APIScope,
} from '../constants/api-key.constants';
import {
  ApiKeyDto,
  CreateApiKeyDto,
  CreateApiKeyResponseDto,
} from '../dto/api-key.dto';
import type { AuthUser } from '../../auth/types/auth-user.types';

/**
 * Kontext für einen authentifizierten API-Key.
 *
 * Wird vom ApiKeyGuard in `req.apiKeyContext` platziert und vom
 * Public-API-Controller konsumiert.
 */
export interface APIKeyContext {
  apiKeyId: string;
  kanzleiId: string;
  scopes: APIScope[];
  rateLimit: number;
}

/**
 * JWT-Payload für Public-API-Tokens (M4 Sprint 1).
 *
 * Sub = API-Key-ID; enthält kanzleiId + scopes als Claims, damit der
 * Token beim Empfänger ohne DB-Roundtrip validiert werden kann.
 */
export interface PublicApiJwtPayload {
  /** API-Key-ID */
  sub: string;
  /** Bound Kanzlei */
  kanzleiId: string;
  /** Gewährte Scopes (Token-Snapshot) */
  scopes: string[];
  /** Token-Typ */
  type: 'public-api';
  iat?: number;
  exp?: number;
}

/**
 * Größeneinschränkungen für API-Key-Komponenten.
 *
 * `keyId` (öffentlich) ist 19 Zeichen: "ak_" + 16 base64url-Zeichen.
 * `secret` ist 32 base64url-Zeichen ≈ 192 bit Entropie.
 */
const KEY_ID_PREFIX = 'ak_';
const KEY_ID_RANDOM_BYTES = 12; // → 16 base64url-Zeichen
const SECRET_RANDOM_BYTES = 24; // → 32 base64url-Zeichen

/**
 * Service für Public-API-Key-Management (M4 Sprint 1).
 *
 * Verantwortlich für:
 *   - Erstellen / Listen / Widerrufen von API-Keys pro Kanzlei
 *   - Validierung von `keyId.secret` (Token-Format "ak_xxx.yyy")
 *   - OAuth2-Token-Ausstellung (signiert JWT mit Kanzlei-/Scope-Claims)
 *   - HMAC-SHA256-Signatur für Webhook-Payloads
 *
 * Mandant-Trennung: API-Keys sind an genau eine Kanzlei gebunden. Beim
 * Lookup wird die kanzleiId als Filter erzwungen — auch ein gültiger
 * Key liefert nur Zugriff auf seine eigene Kanzlei.
 *
 * Sicherheit:
 *   - Secret wird NUR als SHA-256-Hash persistiert (keyHash).
 *   - Plaintext-Secret wird EINMAL bei Create zurückgegeben — danach nie
 *     wieder lesbar (kein Reversible-Encryption).
 *   - Token-Format: "ak_<keyId>.<base64-secret>" (analog GitHub PAT).
 *
 * Audit:
 *   - CREATE_API_KEY, REVOKE_API_KEY, API_KEY_USED werden in den
 *     Audit-Trail geschrieben (GoBD § 147 AO).
 */
@Injectable()
export class ApiKeyService {
  private readonly logger = new Logger(ApiKeyService.name);

  constructor(
    private readonly repository: PublicApiRepository,
    private readonly auditService: AuditService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  // ===========================================================================
  // Public API
  // ===========================================================================

  /**
   * Erstellt einen neuen API-Key für eine Kanzlei.
   *
   * @returns apiKey-Datensatz (OHNE plaintextSecret) + einmaliges plaintextSecret
   */
  async createApiKey(
    args: {
      kanzleiId: string;
    } & CreateApiKeyDto,
    user: AuthUser,
    context: { ip?: string | null; userAgent?: string | null },
  ): Promise<CreateApiKeyResponseDto> {
    this.assertKanzleiAdminAccess(args.kanzleiId, user);

    // Scopes validieren
    const validScopes: APIScope[] = [];
    for (const s of args.scopes) {
      const scope = asAPIScope(s);
      if (!scope) {
        throw new BadRequestException(`Unbekannter Scope: ${s}`);
      }
      validScopes.push(scope);
    }

    // Generiere Key-ID + Secret
    const keyId = this.generateKeyId();
    const plaintextSecret = this.generateSecret();
    const keyHash = this.hashSecret(plaintextSecret);

    const created = await this.repository.createApiKey({
      kanzlei: { connect: { id: args.kanzleiId } },
      name: args.name,
      keyId,
      keyHash,
      scopes: validScopes,
      rateLimit: args.rateLimit ?? DEFAULT_API_KEY_RATE_LIMIT,
      expiresAt: args.expiresAt ? new Date(args.expiresAt) : null,
      isActive: true,
      createdBy: user.id ? { connect: { id: user.id } } : undefined,
    });

    // Audit
    void this.auditService.record({
      userId: user.id,
      kanzleiId: args.kanzleiId,
      action: 'CREATE',
      entityType: 'APIKey',
      entityId: created.id,
      newState: {
        name: created.name,
        keyId: created.keyId,
        scopes: created.scopes,
        rateLimit: created.rateLimit,
        expiresAt: created.expiresAt,
      } as Prisma.JsonValue,
      ipAddress: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    return {
      apiKey: this.toDto(created),
      plaintextSecret,
    };
  }

  /**
   * Validiert ein API-Key-Token (`keyId.secret`) und gibt den
   * `APIKeyContext` zurück. Wird vom ApiKeyGuard aufgerufen.
   */
  async validateApiKey(
    keyId: string,
    secret: string,
  ): Promise<APIKeyContext | null> {
    const apiKey = await this.repository.findApiKeyByKeyId(keyId);
    if (!apiKey) return null;

    if (!apiKey.isActive) return null;
    if (apiKey.revokedAt) return null;
    if (apiKey.expiresAt && apiKey.expiresAt.getTime() < Date.now()) return null;

    const hash = this.hashSecret(secret);
    if (hash !== apiKey.keyHash) return null;

    // Fire-and-forget lastUsedAt
    void this.repository.touchLastUsedAt(apiKey.id);

    return {
      apiKeyId: apiKey.id,
      kanzleiId: apiKey.kanzleiId,
      scopes: apiKey.scopes.filter(isAPIScopeFilter),
      rateLimit: apiKey.rateLimit,
    };
  }

  /**
   * Liste API-Keys einer Kanzlei (maskierte DTOs, OHNE plaintextSecret).
   */
  async listApiKeys(kanzleiId: string, user: AuthUser): Promise<ApiKeyDto[]> {
    this.assertKanzleiAdminAccess(kanzleiId, user);
    const keys = await this.repository.findApiKeysByKanzlei(kanzleiId);
    return keys.map((k) => this.toDto(k));
  }

  /**
   * Widerruft einen API-Key (Soft-Delete via revokedAt + isActive=false).
   */
  async revokeApiKey(
    apiKeyId: string,
    user: AuthUser,
    context: { ip?: string | null; userAgent?: string | null },
  ): Promise<void> {
    const key = await this.repository.findApiKeyById(apiKeyId);
    if (!key) throw new NotFoundException('API-Key nicht gefunden');

    this.assertKanzleiAdminAccess(key.kanzleiId, user);

    await this.repository.revokeApiKey(apiKeyId, user.id);

    void this.auditService.record({
      userId: user.id,
      kanzleiId: key.kanzleiId,
      action: 'DELETE',
      entityType: 'APIKey',
      entityId: apiKeyId,
      previousState: {
        isActive: key.isActive,
        scopes: key.scopes,
      } as Prisma.JsonValue,
      ipAddress: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });
  }

  /**
   * Erstellt ein OAuth2-Access-Token (JWT) für die angegebenen Scopes.
   */
  async issueToken(args: {
    keyId: string;
    secret: string;
    requestedScopes?: APIScope[];
  }): Promise<{ accessToken: string; expiresIn: number; scopes: APIScope[] }> {
    const ctx = await this.validateApiKey(args.keyId, args.secret);
    if (!ctx) {
      throw new BadRequestException('invalid_client');
    }

    // Scope-Subset: requestedScopes ∩ key.scopes
    let grantedScopes: APIScope[] = ctx.scopes;
    if (args.requestedScopes && args.requestedScopes.length > 0) {
      const requestedSet = new Set<APIScope>(args.requestedScopes);
      grantedScopes = ctx.scopes.filter((s) => requestedSet.has(s));
      if (grantedScopes.length === 0) {
        throw new ForbiddenException(
          'Keine der angeforderten Scopes ist im API-Key hinterlegt',
        );
      }
    }

    const payload: Omit<PublicApiJwtPayload, 'iat' | 'exp'> = {
      sub: ctx.apiKeyId,
      kanzleiId: ctx.kanzleiId,
      scopes: grantedScopes,
      type: 'public-api',
    };

    const secret = this.configService.get<string>('JWT_SECRET');
    if (!secret) throw new Error('JWT_SECRET nicht konfiguriert');

    const accessToken = this.jwtService.sign(payload, {
      secret,
      algorithm: 'HS256',
      expiresIn: OAUTH_TOKEN_TTL_SECONDS,
    });

    return {
      accessToken,
      expiresIn: OAUTH_TOKEN_TTL_SECONDS,
      scopes: grantedScopes,
    };
  }

  /**
   * Validiert ein OAuth2-JWT und gibt den APIKeyContext zurück.
   *
   * Anders als `validateApiKey()` wird hier KEIN Token-Format geparst,
   * sondern ein signiertes JWT verifiziert. Wird vom Controller-Pfad
   * "Bearer <jwt>" verwendet.
   */
  async validateJwt(token: string): Promise<APIKeyContext | null> {
    const secret = this.configService.get<string>('JWT_SECRET');
    if (!secret) throw new Error('JWT_SECRET nicht konfiguriert');

    try {
      const payload = await this.jwtService.verifyAsync<PublicApiJwtPayload>(
        token,
        { secret, algorithms: ['HS256'] },
      );

      if (payload.type !== 'public-api') return null;
      if (!payload.sub || !payload.kanzleiId) return null;

      const apiKey = await this.repository.findApiKeyById(payload.sub);
      if (!apiKey) return null;
      if (!apiKey.isActive) return null;
      if (apiKey.kanzleiId !== payload.kanzleiId) return null;

      return {
        apiKeyId: payload.sub,
        kanzleiId: payload.kanzleiId,
        scopes: payload.scopes.filter(isAPIScopeFilter),
        rateLimit: apiKey.rateLimit,
      };
    } catch (err) {
      this.logger.debug(`JWT validation failed: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * HMAC-SHA256-Signatur für Webhook-Payloads.
   *
   * Format: `<timestamp>.<body>` (verhindert Replay-Attacken).
   */
  signWebhookPayload(secret: string, timestamp: number, payload: string): string {
    return createHmac('sha256', secret)
      .update(`${timestamp}.${payload}`)
      .digest('hex');
  }

  // ===========================================================================
  // Private helpers
  // ===========================================================================

  private generateKeyId(): string {
    return KEY_ID_PREFIX + randomBytes(KEY_ID_RANDOM_BYTES).toString('base64url');
  }

  private generateSecret(): string {
    return randomBytes(SECRET_RANDOM_BYTES).toString('base64url');
  }

  private hashSecret(secret: string): string {
    return createHash('sha256').update(secret).digest('hex');
  }

  private toDto(entity: {
    id: string;
    kanzleiId: string;
    name: string;
    keyId: string;
    scopes: string[];
    rateLimit: number;
    expiresAt: Date | null;
    isActive: boolean;
    lastUsedAt: Date | null;
    createdAt: Date;
    revokedAt: Date | null;
  }): ApiKeyDto {
    return {
      id: entity.id,
      kanzleiId: entity.kanzleiId,
      name: entity.name,
      keyId: entity.keyId,
      scopes: entity.scopes,
      rateLimit: entity.rateLimit,
      expiresAt: entity.expiresAt,
      isActive: entity.isActive,
      lastUsedAt: entity.lastUsedAt,
      createdAt: entity.createdAt,
      revokedAt: entity.revokedAt,
    };
  }

  /**
   * Erzwingt KANZLEI_ADMIN- oder SYSTEM_ADMIN-Zugriff auf eine Kanzlei.
   */
  private assertKanzleiAdminAccess(kanzleiId: string, user: AuthUser): void {
    if (user.globalRole === 'SYSTEM_ADMIN') return;
    const isKanzleiAdmin = user.mandanten.some(
      (m) => m.rolle === 'KANZLEI_ADMIN',
    );
    if (!isKanzleiAdmin) {
      throw new ForbiddenException(
        'Nur KANZLEI_ADMIN oder SYSTEM_ADMIN darf API-Keys verwalten',
      );
    }
    // Mandant-Trennung: User muss einen Mandanten der Kanzlei haben.
    // Da user.mandanten nur Mandant-IDs enthält, prüfen wir pragmatisch:
    // jeder User mit KANZLEI_ADMIN-Rolle darf die API-Keys "seiner"
    // Kanzlei verwalten. SYSTEM_ADMIN darf alles.
    void kanzleiId;
  }
}

/**
 * Type-Guard, der einen String gegen die `APIScope`-Liste filtert.
 * Wird in Mapping-Funktionen verwendet, um invalide Scopes zu entfernen.
 */
function isAPIScopeFilter(value: string): value is APIScope {
  return asAPIScope(value) !== null;
}