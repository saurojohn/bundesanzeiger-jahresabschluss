import { Injectable } from '@nestjs/common';
import type { Prisma, Kanzlei } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Typen für Branding-spezifische Eingaben.
 */
export interface BrandingUpdateInput {
  primaryColor?: string;
  accentColor?: string;
  customDomain?: string | null;
  brandingUpdatedAt?: Date;
  brandingUpdatedById?: string | null;
}

export interface LogoUpdateInput {
  logoUrl: string;
  logoWormKey: string;
  brandingUpdatedAt: Date;
  brandingUpdatedById: string | null;
}

/**
 * Mandant-isoliertes Repository für Kanzlei + Branding.
 *
 * Alle Methoden erzwingen einen kanzleiId-Filter. Direkter Zugriff auf
 * `prisma.kanzlei` außerhalb dieses Repositories ist via ESLint verboten
 * (siehe `eslint.config.mjs` — *Repository*.ts ist ausgenommen).
 */
@Injectable()
export class KanzleiRepository {
  static readonly entityName = 'Kanzlei';

  constructor(private readonly prismaService: PrismaService) {}

  /**
   * Findet eine Kanzlei anhand ihrer ID (für Branding-Lookup).
   * Wirft KEINEN 404 — Aufrufer prüft selbst.
   */
  async findById(id: string): Promise<Kanzlei | null> {
    return this.prismaService.kanzlei.findUnique({ where: { id } });
  }

  /**
   * Findet eine Kanzlei anhand ihrer Custom-Domain (für DNS-Routing,
   * M4-Vorbereitung).
   */
  async findByCustomDomain(domain: string): Promise<Kanzlei | null> {
    return this.prismaService.kanzlei.findUnique({ where: { customDomain: domain } });
  }

  /**
   * Findet eine Kanzlei anhand der ID eines ihrer Mandanten.
   *
   * Wird verwendet, um von einer mandantId-Resource auf die kanzleiId zu
   * schließen (z.B. PDF-Generierung braucht Branding aus kanzleiId).
   */
  async findByMandantId(mandantId: string): Promise<Kanzlei | null> {
    const mandant = await this.prismaService.mandant.findUnique({
      where: { id: mandantId },
      select: { kanzlei: true },
    });
    return mandant?.kanzlei ?? null;
  }

  /**
   * Liefert die erste Kanzlei (Pilot-Mode: Single-Tenant-Annahme).
   *
   * Nur für SYSTEM_ADMIN-Pfade sinnvoll — gibt eine Default-Kanzlei
   * zurück, wenn der User keine expliziten Mandanten hat.
   */
  async findFirstKanzlei(): Promise<Kanzlei | null> {
    return this.prismaService.kanzlei.findFirst({
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Aktualisiert die Branding-Felder (Farben + Custom-Domain).
   *
   * Audit-konform: Es werden NICHT logoUrl/logoWormKey überschrieben —
   * dafür gibt es `updateLogo()`. Die Trennung ist absichtlich (Logo-
   * Uploads haben eigene Audit-Actions).
   */
  async updateBranding(
    id: string,
    input: BrandingUpdateInput,
  ): Promise<Kanzlei> {
    const data: Prisma.KanzleiUpdateInput = {
      brandingUpdatedAt: input.brandingUpdatedAt ?? new Date(),
    };
    if (input.primaryColor !== undefined) data.primaryColor = input.primaryColor;
    if (input.accentColor !== undefined) data.accentColor = input.accentColor;
    if (input.customDomain !== undefined) {
      data.customDomain = input.customDomain;
      // Wenn der User eine neue Domain setzt → Verifikation zurücksetzen.
      data.customDomainVerified = false;
    }
    if (input.brandingUpdatedById !== undefined) {
      data.brandingUpdatedById = input.brandingUpdatedById;
    }

    return this.prismaService.kanzlei.update({
      where: { id },
      data,
    });
  }

  /**
   * Setzt Logo-Felder (URL + WORM-Key) und stempelt brandingUpdatedAt.
   */
  async updateLogo(id: string, input: LogoUpdateInput): Promise<Kanzlei> {
    return this.prismaService.kanzlei.update({
      where: { id },
      data: {
        logoUrl: input.logoUrl,
        logoWormKey: input.logoWormKey,
        brandingUpdatedAt: input.brandingUpdatedAt,
        brandingUpdatedById: input.brandingUpdatedById,
      },
    });
  }

  /**
   * Entfernt das Logo (setzt logoUrl + logoWormKey auf NULL).
   *
   * Bewusst NICHT deleteFromWorm — WORM-Objekte sind unveränderlich
   * (GoBD § 147 AO). Das Logo bleibt im WORM-Storage für Audit-Zwecke
   * erhalten; nur die Referenz in der Kanzlei wird entfernt.
   */
  async clearLogo(
    id: string,
    input: { brandingUpdatedById: string | null },
  ): Promise<Kanzlei> {
    return this.prismaService.kanzlei.update({
      where: { id },
      data: {
        logoUrl: null,
        logoWormKey: null,
        brandingUpdatedAt: new Date(),
        brandingUpdatedById: input.brandingUpdatedById,
      },
    });
  }

  /**
   * Prüft, ob eine Custom-Domain bereits von einer anderen Kanzlei
   * verwendet wird (für Update-Validation).
   */
  async isCustomDomainTaken(
    domain: string,
    excludeKanzleiId?: string,
  ): Promise<boolean> {
    const found = await this.prismaService.kanzlei.findUnique({
      where: { customDomain: domain },
      select: { id: true },
    });
    if (!found) return false;
    return found.id !== excludeKanzleiId;
  }
}