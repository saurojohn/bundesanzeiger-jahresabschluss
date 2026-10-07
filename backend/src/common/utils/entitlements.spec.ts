/**
 * Regressionstest: Premium-Funktionen werden durchgesetzt.
 *
 * BEFUND 2026-10-07: `TIER_CONFIGS` definiert `custom-domain`,
 * `public-api` und `white-label-branding` als Premium-only.
 * `FeatureFlagService.has()` hatte NULL Aufrufer, ein
 * `SubscriptionGuard` existierte nicht. Eine PILOT-Kanzlei konnte alle
 * drei Funktionen uneingeschraenkt nutzen — die Konfiguration
 * existierte und wurde nirgends ausgewertet.
 *
 * Verhalten bei fehlender Berechtigung: die AKTION wird abgewiesen,
 * BESTEHENDE Einstellungen bleiben erhalten. Wer nach einem Downgrade
 * sein Logo verliert, kann nicht nachvollziehen, warum.
 */

import { describe, it, expect, vi } from 'vitest';
import { HttpException, HttpStatus } from '@nestjs/common';
import { assertFeatureEntitled } from './entitlements';

function prismaMit(tier: string) {
  return {
    kanzlei: {
      findUnique: vi.fn().mockResolvedValue({ id: 'k1', subscriptionTier: tier }),
    },
  } as never;
}

const ist402 = (fehler: unknown): boolean =>
  fehler instanceof HttpException && fehler.getStatus() === HttpStatus.PAYMENT_REQUIRED;

describe('Tarifgrenzen für Premium-Funktionen', () => {
  it('PILOT darf KEINE Custom-Domain verifizieren', async () => {
    await expect(
      assertFeatureEntitled(prismaMit('PILOT'), 'k1', 'custom-domain'),
    ).rejects.toSatisfy(ist402);
  });

  it('PILOT darf KEINE API-Schlüssel ausstellen', async () => {
    await expect(
      assertFeatureEntitled(prismaMit('PILOT'), 'k1', 'public-api'),
    ).rejects.toSatisfy(ist402);
  });

  it('PILOT darf KEIN White-Label-Branding setzen', async () => {
    await expect(
      assertFeatureEntitled(prismaMit('PILOT'), 'k1', 'white-label-branding'),
    ).rejects.toSatisfy(ist402);
  });

  it('STANDARD kann weiterhin Basis-Funktionen (PDF, WORM)', async () => {
    await expect(
      assertFeatureEntitled(prismaMit('STANDARD'), 'k1', 'pdf-generation'),
    ).resolves.toBe('STANDARD');
    await expect(
      assertFeatureEntitled(prismaMit('PILOT'), 'k1', 'pdf-generation'),
    ).resolves.toBe('PILOT');
  });

  it('PREMIUM darf alle drei Premium-Funktionen', async () => {
    for (const f of ['custom-domain', 'public-api', 'white-label-branding'] as const) {
      await expect(
        assertFeatureEntitled(prismaMit('PREMIUM'), 'k1', f),
      ).resolves.toBe('PREMIUM');
    }
  });

  it('STANDARD hat weder custom-domain noch public-api', async () => {
    await expect(
      assertFeatureEntitled(prismaMit('STANDARD'), 'k1', 'custom-domain'),
    ).rejects.toSatisfy(ist402);
    await expect(
      assertFeatureEntitled(prismaMit('STANDARD'), 'k1', 'public-api'),
    ).rejects.toSatisfy(ist402);
  });

  it('unbekannter Tier fällt auf PILOT zurück (fail-closed)', async () => {
    await expect(
      assertFeatureEntitled(prismaMit('GOLD'), 'k1', 'public-api'),
    ).rejects.toSatisfy(ist402);
  });

  it('fehlende Kanzlei ist 404, nicht 402', async () => {
    const prisma = {
      kanzlei: { findUnique: vi.fn().mockResolvedValue(null) },
    } as never;
    try {
      await assertFeatureEntitled(prisma, 'k1', 'public-api');
      throw new Error('Sollte abbrechen');
    } catch (fehler) {
      expect(fehler).toBeInstanceOf(HttpException);
      expect((fehler as HttpException).getStatus()).toBe(HttpStatus.NOT_FOUND);
    }
  });

  it('die Meldung nennt Funktion und Tarif', async () => {
    try {
      await assertFeatureEntitled(prismaMit('PILOT'), 'k1', 'custom-domain');
      throw new Error('Sollte abbrechen');
    } catch (fehler) {
      const body = (fehler as HttpException).getResponse() as {
        message: string; code: string; feature: string; tier: string;
      };
      expect(body.code).toBe('FEATURE_NOT_ENTITLED');
      expect(body.feature).toBe('custom-domain');
      expect(body.tier).toBe('PILOT');
      // Und: vorhandene Einstellungen bleiben erhalten.
      expect(body.message).toMatch(/bleiben dabei erhalten/i);
    }
  });
});

describe('Premium-Funktionen sind an den Schreibpfaden verdrahtet', () => {
  /** Strukturtest: ein Gate, das nirgends aufgerufen wird, ist keines. */
  async function quelle(pfad: string): Promise<string> {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    return readFileSync(join(process.cwd(), 'src', ...pfad.split('/')), 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
  }

  it('Domain-Verifikation prüft custom-domain', async () => {
    const c = await quelle('modules/dns/services/domain-verification.service.ts');
    expect(c).toContain("assertFeatureEntitled(this.prisma, kanzleiId, 'custom-domain')");
  });

  it('Branding-Patch prüft custom-domain UND white-label-branding', async () => {
    const c = await quelle('modules/branding/services/branding.service.ts');
    expect(c).toContain("assertFeatureEntitled(this.prisma, kanzleiId, 'custom-domain')");
    expect(c).toContain("assertFeatureEntitled(this.prisma, kanzleiId, 'white-label-branding')");
  });

  it('API-Key-Erstellung prüft public-api', async () => {
    const c = await quelle('modules/api/services/api-key.service.ts');
    expect(c).toContain(
      "assertFeatureEntitled(this.prisma, args.kanzleiId, 'public-api')",
    );
  });

  it('ein GET darf nie an einem Tarif scheitern', async () => {
    // Sonst waere die Branding-Seite fuer PILOT-Kanzleien unbenutzbar,
    // obwohl sie ihr vorhandenes Branding anzeigt.
    const c = await quelle('modules/branding/services/branding.service.ts');
    const getBranding = c.slice(c.indexOf('async getBranding('));
    const abschnitt = getBranding.slice(0, getBranding.indexOf('\n  async '));
    expect(abschnitt).not.toContain('assertFeatureEntitled');
  });
});