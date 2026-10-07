import { HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import {
  SUBSCRIPTION_TIERS,
  TIER_CONFIGS,
  type FeatureFlag,
  type SubscriptionTier,
} from '../../modules/subscription/constants/subscription-tier.constants';

const logger = new Logger('Entitlement');

/**
 * Durchsetzt Tarifgrenzen fuer Premium-Funktionen.
 *
 * BEFUND 2026-10-07: `TIER_CONFIGS` definiert `custom-domain`,
 * `public-api` und `white-label-branding` als Premium-only. Es gab
 * aber KEINEN Aufruf von `FeatureFlagService.has()` und keinen
 * `SubscriptionGuard`. Eine PILOT-Kanzlei konnte alle drei Funktionen
 * uneingeschraenkt nutzen — die Konfiguration existierte, wurde nur
 * nirgends ausgewertet.
 *
 * Verhalten bei fehlender Berechtigung:
 * - Die AKTION wird abgewiesen (403 bzw. 402 bei bewusster
 *   Tarifumstellung).
 * - BESTEHENDE Daten bleiben erhalten. Wer nach einem Downgrade sein
 *   Logo verliert, kann nicht einmal nachvollziehen, warum. Das ist
 *   auch datenschutz- und auffinden-schonend: die Kanzlei sieht ihr
 *   Branding weiter, nur AENDERUNGEN sind gesperrt.
 *
 * Es wird bewusst direkt `TIER_CONFIGS` gelesen und nicht
 * `FeatureFlagService` injiziert: Das haette eine Modulabhaengigkeit
 * von Branding/DNS/Public-API auf das Subscription-Modul erzeugt. Die
 * Konstanten sind ohnehin die Wahrheit; die Logik steht jetzt an der
 * Stelle, an der sie tatsaechlich gebraucht wird.
 */
export async function assertFeatureEntitled(
  prisma: Pick<PrismaService, 'kanzlei'>,
  kanzleiId: string,
  feature: FeatureFlag,
): Promise<SubscriptionTier> {
  const kanzlei = await prisma.kanzlei.findUnique({
    where: { id: kanzleiId },
    select: { id: true, subscriptionTier: true },
  });
  if (!kanzlei) {
    throw new HttpException(
      `Kanzlei nicht gefunden — Tarifprüfung für "${feature}" nicht möglich`,
      HttpStatus.NOT_FOUND,
    );
  }

  // Unbekannter Tier -> PILOT (am wenigsten berechtigt). Siehe
  // `common/utils/saldo.ts`: derselbe fail-closed-Grundsatz.
  const roh = kanzlei.subscriptionTier as string;
  const tier = (SUBSCRIPTION_TIERS as readonly string[]).includes(roh)
    ? (roh as SubscriptionTier)
    : 'PILOT';
  if (tier !== roh) {
    logger.warn(
      `Kanzlei ${kanzleiId}: unplausibler subscriptionTier '${roh}' — ` +
        'beim Tarifcheck als PILOT behandelt',
    );
  }

  if (!TIER_CONFIGS[tier].features.has(feature)) {
    throw new HttpException(
      {
        message:
          `Die Funktion "${feature}" ist im Tarif "${TIER_CONFIGS[tier].displayName}" ` +
          'nicht enthalten. Bitte buchen Sie den Tarif hoch. ' +
          'Vorhandene Einstellungen bleiben dabei erhalten.',
        code: 'FEATURE_NOT_ENTITLED',
        feature,
        tier,
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }

  return tier;
}
