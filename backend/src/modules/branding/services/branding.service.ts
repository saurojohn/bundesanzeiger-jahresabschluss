import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import type { Kanzlei } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { CacheManagerService } from '../../../common/cache/cache-manager.service';
import { KanzleiRepository } from '../../../common/repositories/kanzlei.repository';
import { AuditService } from '../../audit/services/audit.service';
import { StorageService } from '../../storage/services/storage.service';
import type { AuthUser } from '../../auth/types/auth-user.types';
import type { UpdateBrandingDto } from '../dto/update-branding.dto';
import { ALLOWED_LOGO_MIME_TYPES } from '../dto/upload-logo.dto';

/**
 * Default-Branding (Backwards-Compat).
 *
 * Wird zurückgegeben, wenn eine Kanzlei KEIN explizites Branding gesetzt
 * hat (z.B. nach Migration aus M1/M2). Farben entsprechen dem aktuellen
 * Tailwind-Design (siehe `frontend/tailwind.config.ts`).
 */
export const DEFAULT_BRANDING = {
  primaryColor: '#2563eb',
  accentColor: '#0ea5e9',
} as const;

/**
 * Größeneinschränkung für Logo-Uploads.
 *
 * 5MB nach Base64-Decoding (= ~6.7MB Base64). PDF-Logos in
 * Geschäftsberichten sind idR 100-500 KB; 5MB deckt auch hochauflösende
 * PNGs für Print-Wiedergabe ab.
 */
export const MAX_LOGO_SIZE_BYTES = 5 * 1024 * 1024;

/**
 * Branding-Lookup-Result (DTO).
 *
 * Bewusst eine Domain-DTO (kein direktes Prisma-Type), damit das
 * Frontend nicht von Schema-Änderungen abhängt.
 */
export interface KanzleiBrandingDto {
  kanzleiId: string;
  logoUrl: string | null;
  primaryColor: string;
  accentColor: string;
  customDomain: string | null;
  customDomainVerified: boolean;
  brandingUpdatedAt: Date | null;
}

export interface BrandingContext {
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Service für White-Label-Branding (M3 Sprint 4+5).
 *
 * Verantwortlich für:
 *   - Lesen des Kanzlei-Brandings (mit Cache 1h TTL).
 *   - Aktualisieren der Branding-Felder (Farben, Domain).
 *   - Logo-Upload (Base64 → S3/WORM + Cache-Invalidation).
 *
 * RBAC:
 *   - KANZLEI_ADMIN darf nur eigene Kanzlei editieren.
 *   - SYSTEM_ADMIN darf jede Kanzlei editieren.
 *   - Andere Rollen dürfen Branding LESEN (für PDF-Generierung),
 *     aber NICHT ändern.
 *
 * Backwards-Compat:
 *   - Default-Branding (DEFAULT_BRANDING) wird zurückgegeben, wenn die
 *     Kanzlei NULL-Werte für primaryColor/accentColor hat.
 */
@Injectable()
export class BrandingService {
  private readonly logger = new Logger(BrandingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheManagerService,
    private readonly kanzleiRepository: KanzleiRepository,
    private readonly auditService: AuditService,
    private readonly storageService: StorageService,
  ) {}

  // ===========================================================================
  // Public API
  // ===========================================================================

  /**
   * Liest das Branding einer Kanzlei (mit Cache 1h TTL).
   *
   * Backwards-Compat: Wenn die Kanzlei NULL-Farben hat (Default), wird
   * DEFAULT_BRANDING verwendet. Dadurch müssen Pilot-Kanzleien nicht
   * migriert werden — sie sehen automatisch das aktuelle Design.
   */
  /**
   * Branding einer Kanzlei lesen — mit Tenant-Pruefung.
   *
   * Bugfix 2026-10-05: `getBranding` nahm keinen `user` und rief
   * `assertKanzleiReadAccess` nicht auf. Der Controller holte den User als
   * `_user` und verwarf ihn. `GET /api/branding/<fremde-kanzleiId>` lieferte
   * daher 200 mit den Branding-Daten einer fremden Kanzlei — der Lese-Pfad
   * war ungeschuetzt, obwohl `assertKanzleiReadAccess` existierte und der
   * Schreib-Pfad ihn korrekt verwendete.
   */
  async getBranding(kanzleiId: string, user?: AuthUser): Promise<KanzleiBrandingDto> {
    // await ist Pflicht: die Methode ist async — ohne await landet die
    // Ablehnung in einer verwaisten Promise und beendet den Prozess.
    if (user) await this.assertKanzleiReadAccess(kanzleiId, user);
    return this.cache.memoize(
      `branding:${kanzleiId}`,
      60 * 60 * 1000, // 1h
      async () => {
        const kanzlei = await this.kanzleiRepository.findById(kanzleiId);
        if (!kanzlei) {
          throw new NotFoundException('Kanzlei nicht gefunden');
        }
        return this.toBrandingDto(kanzlei);
      },
    );
  }

  /**
   * Liest das Branding anhand einer Mandant-ID (Convenience für PDF-Service).
   *
   * Cached mit 1h TTL — Branding ändert sich selten.
   */
  async getBrandingByMandantId(mandantId: string): Promise<KanzleiBrandingDto> {
    const kanzlei = await this.kanzleiRepository.findByMandantId(mandantId);
    if (!kanzlei) {
      throw new NotFoundException('Kanzlei für Mandant nicht gefunden');
    }
    return this.getBranding(kanzlei.id);
  }

  /**
   * Aktualisiert Branding-Felder (Farben, Custom-Domain).
   *
   * Cache wird invalidiert, Audit-Eintrag wird geschrieben.
   *
   * Berechtigung: SYSTEM_ADMIN oder KANZLEI_ADMIN der jeweiligen Kanzlei.
   */
  async updateBranding(
    kanzleiId: string,
    dto: UpdateBrandingDto,
    user: AuthUser,
    context: BrandingContext,
  ): Promise<KanzleiBrandingDto> {
    await this.assertKanzleiAccess(kanzleiId, user);

    // Vorher-Snapshot für Audit
    const before = await this.kanzleiRepository.findById(kanzleiId);
    if (!before) throw new NotFoundException('Kanzlei nicht gefunden');

    // Custom-Domain-Kollisionsprüfung
    if (dto.customDomain && dto.customDomain !== before.customDomain) {
      const taken = await this.kanzleiRepository.isCustomDomainTaken(
        dto.customDomain,
        kanzleiId,
      );
      if (taken) {
        throw new BadRequestException(
          `Custom-Domain "${dto.customDomain}" wird bereits von einer anderen Kanzlei verwendet`,
        );
      }
    }

    const updated = await this.kanzleiRepository.updateBranding(kanzleiId, {
      primaryColor: dto.primaryColor,
      accentColor: dto.accentColor,
      customDomain: dto.customDomain ?? undefined,
      brandingUpdatedAt: new Date(),
      brandingUpdatedById: user.id,
    });

    // Cache invalidieren (async via CacheManager)
    await this.cache.invalidate(`branding:${kanzleiId}`);

    // Audit-Trail
    void this.auditService.record({
      userId: user.id,
      kanzleiId,
      action: 'UPDATE',
      entityType: 'KanzleiBranding',
      entityId: kanzleiId,
      previousState: {
        primaryColor: before.primaryColor,
        accentColor: before.accentColor,
        customDomain: before.customDomain,
      },
      newState: {
        primaryColor: updated.primaryColor,
        accentColor: updated.accentColor,
        customDomain: updated.customDomain,
      },
      ipAddress: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    return this.toBrandingDto(updated);
  }

  /**
   * Lädt ein Logo hoch (Base64 → S3/WORM).
   *
   * Validiert:
   *   - MIME-Type (PNG/JPEG/SVG)
   *   - Größe nach Base64-Decoding (max 5MB)
   *
   * Cache wird invalidiert. Audit-Eintrag wird geschrieben.
   */
  async uploadLogo(
    kanzleiId: string,
    args: {
      logoBase64: string;
      mimeType: string;
      filename: string;
    },
    user: AuthUser,
    context: BrandingContext,
  ): Promise<{ logoUrl: string; logoWormKey: string }> {
    await this.assertKanzleiAccess(kanzleiId, user);

    // MIME-Type-Validierung (defensiv — DTO hat es schon validiert, aber
    // wenn jemand den Service direkt aufruft, ist dies die letzte Verteidigung).
    if (!ALLOWED_LOGO_MIME_TYPES.includes(args.mimeType as never)) {
      throw new BadRequestException(
        `Logo-MIME-Type nicht erlaubt: ${args.mimeType}`,
      );
    }

    // Base64 → Buffer
    const buffer = this.decodeBase64Logo(args.logoBase64, args.mimeType);
    if (buffer.length === 0) {
      throw new BadRequestException('Logo-Datei ist leer');
    }
    if (buffer.length > MAX_LOGO_SIZE_BYTES) {
      throw new BadRequestException(
        `Logo überschreitet die maximale Größe von ${MAX_LOGO_SIZE_BYTES / (1024 * 1024)}MB`,
      );
    }

    // WORM-Upload (10 Jahre Retention, COMPLIANCE-Mode — GoBD § 147 AO).
    const objectKey = this.buildLogoObjectKey(kanzleiId, args.filename);
    const meta = await this.storageService.uploadToWorm({
      objectKey,
      entityType: 'KANZLEI_LOGO',
      entityId: kanzleiId,
      mandantId: kanzleiId, // Wir nutzen mandantId = kanzleiId für Logo-Manifest
      data: buffer,
      contentType: args.mimeType,
    });

    // Logo-URL: wir exposen den Object-Key über einen /api/branding/logo-Endpoint.
    // Im Pilot (M3) ist die URL einfach der Key (S3-Public-Bucket-Setup
    // wäre M4). Hier liefern wir den Key + ein Download-URL-Pattern.
    const logoUrl = `/api/branding/${kanzleiId}/logo/blob?key=${encodeURIComponent(objectKey)}`;

    await this.kanzleiRepository.updateLogo(kanzleiId, {
      logoUrl,
      logoWormKey: objectKey,
      brandingUpdatedAt: new Date(),
      brandingUpdatedById: user.id,
    });

    // Cache invalidieren (async via CacheManager)
    await this.cache.invalidate(`branding:${kanzleiId}`);

    // Audit
    void this.auditService.record({
      userId: user.id,
      kanzleiId,
      action: 'UPDATE',
      entityType: 'KanzleiBranding',
      entityId: kanzleiId,
      newState: {
        event: 'LOGO_UPLOADED',
        filename: args.filename,
        mimeType: args.mimeType,
        sizeBytes: buffer.length,
        sha256Hash: meta.sha256Hash,
        logoWormKey: objectKey,
      },
      ipAddress: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    return { logoUrl, logoWormKey: objectKey };
  }

  /**
   * Löscht das Logo (entfernt nur die Referenz in Kanzlei, nicht das
   * WORM-Objekt — GoBD: 10 Jahre unveränderlich).
   */
  async deleteLogo(
    kanzleiId: string,
    user: AuthUser,
    context: BrandingContext,
  ): Promise<void> {
    await this.assertKanzleiAccess(kanzleiId, user);

    const before = await this.kanzleiRepository.findById(kanzleiId);
    if (!before) throw new NotFoundException('Kanzlei nicht gefunden');
    if (!before.logoUrl) {
      throw new BadRequestException('Kein Logo vorhanden');
    }

    await this.kanzleiRepository.clearLogo(kanzleiId, {
      brandingUpdatedById: user.id,
    });

    // Cache invalidieren (async via CacheManager)
    await this.cache.invalidate(`branding:${kanzleiId}`);

    void this.auditService.record({
      userId: user.id,
      kanzleiId,
      action: 'DELETE',
      entityType: 'KanzleiBranding',
      entityId: kanzleiId,
      previousState: {
        logoUrl: before.logoUrl,
        logoWormKey: before.logoWormKey,
      },
      ipAddress: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });
  }

  /**
   * Liefert den Logo-Buffer (für Frontend-Anzeige oder PDF-Branding).
   *
   * Aus dem WORM-Storage. Mandant-Trennung: jeder User einer Kanzlei
   * darf das Logo seiner Kanzlei lesen; SYSTEM_ADMIN darf alles.
   */
  async getLogoBuffer(
    kanzleiId: string,
    user: AuthUser,
  ): Promise<{ buffer: Buffer; contentType: string } | null> {
    // Bugfix 2026-10-06: die Pruefung stand (a) ohne `await` und (b)
    // NACH dem Kanzlei-Lookup.
    //
    //   (a) Ohne `await` warf `assertKanzleiReadAccess()` in eine
    //       verwaiste Promise: die Ablehnung griff nicht UND Node
    //       beendete den Prozess an der `unhandledRejection`. Ein
    //       normaler Logo-Abruf einer fremden Kanzlei lieferte damit
    //       das fremde Logo aus WORM — und legte den Dienst still.
    //       (Identische Fehlerklasse wie `assertKanzleiReadAccess` in
    //       Zeile 115, das korrekt awaited wird.)
    //
    //   (b) Nach dem Lookup konnte ein fremder User zusaetzlich
    //       unterscheiden, ob eine Kanzlei existiert (404) und ob sie
    //       ein Logo hat (200 mit `null`) — beides vor der Pruefung.
    //       Die Pruefung gehoert vor jede Existenz-Auskunft.
    await this.assertKanzleiReadAccess(kanzleiId, user);

    const kanzlei = await this.kanzleiRepository.findById(kanzleiId);
    if (!kanzlei) throw new NotFoundException('Kanzlei nicht gefunden');
    if (!kanzlei.logoWormKey) return null;

    const buffer = await this.storageService.downloadFromWorm(kanzlei.logoWormKey);
    // Content-Type wird per Metadata gespeichert — wir leiten ihn aus dem
    // Suffix ab (PNG/JPG/SVG).
    const contentType = this.detectContentType(kanzlei.logoWormKey);

    // READ-Audit (für Logo-Download)
    void this.auditService.record({
      userId: user.id,
      kanzleiId,
      action: 'READ',
      entityType: 'KanzleiBranding',
      entityId: kanzleiId,
      newState: {
        event: 'LOGO_DOWNLOADED',
        logoWormKey: kanzlei.logoWormKey,
      },
    });

    return { buffer, contentType };
  }

  // ===========================================================================
  // Private helpers
  // ===========================================================================

  /**
   * Mappt Kanzlei → KanzleiBrandingDto mit Backwards-Compat (Defaults).
   */
  private toBrandingDto(kanzlei: Kanzlei): KanzleiBrandingDto {
    return {
      kanzleiId: kanzlei.id,
      logoUrl: kanzlei.logoUrl,
      primaryColor: kanzlei.primaryColor ?? DEFAULT_BRANDING.primaryColor,
      accentColor: kanzlei.accentColor ?? DEFAULT_BRANDING.accentColor,
      customDomain: kanzlei.customDomain,
      customDomainVerified: kanzlei.customDomainVerified,
      brandingUpdatedAt: kanzlei.brandingUpdatedAt,
    };
  }

  /**
   * Decodiert Base64 → Buffer.
   *
   * Wenn der String mit `data:<mime>;base64,` prefix'd ist, wird der
   * Prefix entfernt (Data-URL-Support für Browser).
   */
  private decodeBase64Logo(base64: string, mimeType: string): Buffer {
    let cleaned = base64;
    // Data-URL-Format: "data:image/png;base64,iVBOR..."
    const dataUrlMatch = /^data:[^;]+;base64,(.+)$/i.exec(base64);
    if (dataUrlMatch) {
      cleaned = dataUrlMatch[1] ?? '';
    }
    const buffer = Buffer.from(cleaned, 'base64');
    // Sanity-Check: bei PNG muss der Buffer mit den Magic-Bytes
    // 89 50 4E 47 beginnen. Für JPEG: FF D8 FF. Für SVG: Text-Inhalt
    // (kleiner <svg ... oder <?xml).
    if (mimeType === 'image/png' && !buffer.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) {
      throw new BadRequestException(
        'PNG-Datei ungültig: Magic-Bytes fehlen',
      );
    }
    if (mimeType === 'image/jpeg' && !buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) {
      throw new BadRequestException(
        'JPEG-Datei ungültig: Magic-Bytes fehlen',
      );
    }
    if (mimeType === 'image/svg+xml') {
      const head = buffer.subarray(0, 200).toString('utf8').trim();
      if (!head.startsWith('<svg') && !head.startsWith('<?xml')) {
        throw new BadRequestException(
          'SVG-Datei ungültig: Beginnt nicht mit <svg oder <?xml',
        );
      }
    }
    return buffer;
  }

  /**
   * Deterministischer Object-Key für Logo.
   *
   * Schema: `kanzlei/<kanzleiId>/logo/<uuid>.<ext>`
   *
   * Der Suffix-UUID macht jedes Re-Upload eindeutig — kein Überschreiben
   * (WORM), aber Historie im Storage.
   */
  private buildLogoObjectKey(kanzleiId: string, filename: string): string {
    const ext = this.extractExtension(filename);
    return `kanzlei/${kanzleiId}/logo/${uuidv4()}${ext}`;
  }

  private extractExtension(filename: string): string {
    const m = /\.([a-z0-9]+)$/i.exec(filename);
    if (!m) return '';
    const ext = m[1]?.toLowerCase() ?? '';
    if (ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'svg') {
      return `.${ext === 'jpeg' ? 'jpg' : ext}`;
    }
    return '';
  }

  private detectContentType(objectKey: string): string {
    if (objectKey.endsWith('.png')) return 'image/png';
    if (objectKey.endsWith('.jpg') || objectKey.endsWith('.jpeg')) {
      return 'image/jpeg';
    }
    if (objectKey.endsWith('.svg')) return 'image/svg+xml';
    return 'application/octet-stream';
  }

  /**
   * RBAC-Check für Branding-Mutationen.
   * SYSTEM_ADMIN: alle Kanzleien.
   * KANZLEI_ADMIN: nur eigene Kanzlei.
   *
   * Bugfix 2026-10-04: `accessibleKanzleiIds` enthielt `user.mandanten.map(m
   * => m.id)` — das sind MANDANT-IDs. Verglichen wurde damit gegen die
   * `kanzleiId`, die nie in dieser Liste steht (Mandant-IDs und Kanzlei-IDs
   * sind verschiedene UUIDs). Der Vergleich konnte also prinzipiell nie
   * treffen: Branding war für JEDEN KANZLEI_ADMIN gesperrt, es blieb nur
   * SYSTEM_ADMIN. Der eigene Kommentar zwei Zeilen darüber beschreibt den
   * richtigen Weg ("müssen wir prüfen, ob der User einen Mandanten dieser
   * Kanzlei hat") — genau den hat der Code nicht getan.
   *
   * Der Check läuft jetzt wie der Read-Pfad über einen DB-Lookup, nur mit
   * der zusätzlichen Rollenbedingung.
   */
  private async assertKanzleiAccess(
    kanzleiId: string,
    user: AuthUser,
  ): Promise<void> {
    if (user.globalRole === 'SYSTEM_ADMIN') return;
    const isKanzleiAdmin = user.mandanten.some(
      (m) => m.rolle === 'KANZLEI_ADMIN',
    );
    if (!isKanzleiAdmin) {
      throw new ForbiddenException(
        'Nur KANZLEI_ADMIN oder SYSTEM_ADMIN darf Branding ändern',
      );
    }
    // Gleiche Auflösung wie assertKanzleiReadAccess: hat der User einen
    // Mandanten in dieser Kanzlei?
    const mandant = await this.prisma.mandant.findFirst({
      where: {
        kanzleiId,
        id: { in: user.mandanten.map((m) => m.id) },
      },
      select: { id: true },
    });
    if (!mandant) {
      throw new ForbiddenException('Kein Zugriff auf diese Kanzlei');
    }
  }

  /**
   * Read-Access: Jeder authentifizierte User einer Kanzlei darf das
   * Branding (inkl. Logo) seiner Kanzlei lesen.
   *
   * Wir prüfen nur grob: User muss MINDESTENS einen Mandanten der Kanzlei
   * haben. SYSTEM_ADMIN darf alles lesen.
   *
   * Da `user.mandanten` nur die IDs enthält (keine kanzleiId), müssen
   * wir das via Prisma-DB-Lookup prüfen — wir machen es hier lightweight
   * und vertrauen auf den JWT (im Pilot werden Mandanten-Tokens vom
   * AuthService mit kanzleiId-Claim signiert).
   */
  private async assertKanzleiReadAccess(
    kanzleiId: string,
    user: AuthUser,
  ): Promise<void> {
    if (user.globalRole === 'SYSTEM_ADMIN') return;
    // Für Non-Admin: wir prüfen via Kanzlei-Tabelle, ob der User MINDESTENS
    // einen Mandant dieser Kanzlei hat.
    const mandant = await this.prisma.mandant.findFirst({
      where: {
        kanzleiId,
        id: { in: user.mandanten.map((m) => m.id) },
      },
      select: { id: true },
    });
    if (!mandant) {
      throw new ForbiddenException('Kein Zugriff auf diese Kanzlei');
    }
  }
}
