import { describe, it, expect, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { WebhookService } from '../../modules/webhook/services/webhook.service';
import { DomainVerificationService } from '../../modules/dns/services/domain-verification.service';
import { ApiKeyService } from '../../modules/api/services/api-key.service';
import { SubscriptionService } from '../../modules/subscription/services/subscription.service';
import { EncryptionService } from '../../modules/auth/services/encryption.service';
import type { AuthUser } from '../../modules/auth/types/auth-user.types';

/**
 * VERDRAHTUNGSTEST — BEFUND 2026-10-11.
 *
 * `kanzlei-rolle.spec.ts` prueft die Regel. Dieser Test prueft, dass die
 * vier Services sie AUFRUFEN. Ohne ihn ist die Regel unbenutzbar, ohne dass
 * irgendetwas rot wird — genau dieser Zustand ist beim Umsetzen entstanden:
 *
 *   Negativprobe (Binding aus den Services entfernt):
 *     src/modules/webhook + src/modules/dns -> 17 passed
 *
 * Grund: Die vorhandenen Specs haben einen User mit GENAU EINEM Mandanten.
 * Bei einem Mandanten kann die alte Pruefungsfolge ("Admin irgendwo" +
 * "Mandant in der Ziel-Kanzlei") nie auseinanderfallen. Verwundbar ist sie
 * erst bei zwei Mandanten in zwei Kanzleien — und genau die Konstellation
 * bauen die Tests hier.
 */

const KANZLEI_A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const KANZLEI_B = 'bbbbbbbb-0000-4000-8000-00000000000b';
const MANDANT_A = 'aaaaaaaa-1111-4111-8111-111111111111';
const MANDANT_B = 'bbbbbbbb-2222-4222-8222-222222222222';

/**
 * Echter EncryptionService (Nachtrag 82): das Webhook-Secret wird
 * verschluesselt abgelegt. Der Test prueft die Rollenbindung — der
 * EncryptionService wird nicht gemockt, damit der Test nicht an einer
 * nachgebauten Verschluesselung scheitert.
 */
function encryption(): EncryptionService {
  return new EncryptionService(
    new ConfigService({ JWT_SECRET: 'test-secret-nur-fuer-diesen-test' }),
  );
}

/** Admin in A, nur Berater in B — die Konfiguration, die vorher durchrutschte. */
function userMitGeteilterAdminRolle(): AuthUser {
  return {
    id: 'cccccccc-3333-4333-8333-333333333333',
    globalRole: null,
    mandanten: [
      { id: MANDANT_A, firmenname: 'A GmbH', rolle: 'KANZLEI_ADMIN' },
      { id: MANDANT_B, firmenname: 'B GmbH', rolle: 'STEUERBERATER' },
    ],
  } as unknown as AuthUser;
}

/** Prisma-Mock: Mandant gehoert jeweils nur zu EINER Kanzlei. */
function mandantPrisma() {
  const passt = (where: { kanzleiId: string; id: { in: string[] } }) => {
    const ids = where.id?.in ?? [];
    if (ids.includes(MANDANT_A) && where.kanzleiId === KANZLEI_A) return [{ id: MANDANT_A }];
    if (ids.includes(MANDANT_B) && where.kanzleiId === KANZLEI_B) return [{ id: MANDANT_B }];
    return [];
  };

  return {
    mandant: {
      findFirst: vi.fn().mockImplementation(async ({ where }: { where: { kanzleiId: string; id: { in: string[] } } }) =>
        passt(where)[0] ?? null,
      ),
      findMany: vi.fn().mockImplementation(async ({ where }: { where: { kanzleiId: string; id: { in: string[] } } }) =>
        passt(where),
      ),
    },
    kanzlei: { findUnique: vi.fn().mockResolvedValue({ id: KANZLEI_B, name: 'B GmbH' }) },
  };
}

const ctx = { ip: null, userAgent: null };

describe('BEFUND 2026-10-11: Admin in A darf nicht in B schreiben', () => {
  it('SubscriptionService.cancel', async () => {
    const service = new SubscriptionService(
      { ...mandantPrisma(), kanzlei: { update: vi.fn() } } as never,
      { invalidate: vi.fn() } as never,
      {} as never,
      { record: vi.fn() } as never,
      { getProviderName: () => 'mock' } as never,
      {} as never,
      { get: () => 'true' } as never,
    );
    await expect(
      service.cancelSubscription(KANZLEI_B, userMitGeteilterAdminRolle(), ctx),
    ).rejects.toThrow(/KANZLEI_ADMIN dieser Kanzlei/);
  });

  it('ApiKeyService.createApiKey', async () => {
    const service = new ApiKeyService(
      {} as never,
      { record: vi.fn() } as never,
      { sign: vi.fn().mockReturnValue({}) } as never,
      { get: () => undefined } as never,
      mandantPrisma() as never,
    );
    await expect(
      service.createApiKey(
        { kanzleiId: KANZLEI_B, name: 'x', scopes: [] } as never,
        userMitGeteilterAdminRolle(),
        ctx,
      ),
    ).rejects.toThrow(/KANZLEI_ADMIN dieser Kanzlei/);
  });

  it('DomainVerificationService.startVerification', async () => {
    const service = new DomainVerificationService(
      {} as never,
      { findById: vi.fn().mockResolvedValue(null) } as never,
      { record: vi.fn() } as never,
      mandantPrisma() as never,
    );
    await expect(
      service.startVerification(KANZLEI_B, 'kanzlei-b.example', userMitGeteilterAdminRolle(), ctx),
    ).rejects.toThrow(/KANZLEI_ADMIN dieser Kanzlei/);
  });

  it('WebhookService.createSubscription', async () => {
    const repository = {
      findSubscriptionsByKanzlei: vi.fn().mockResolvedValue([]),
      findDeliveriesBySubscription: vi.fn().mockResolvedValue([]),
      findSubscriptionById: vi.fn().mockResolvedValue(null),
      deleteSubscription: vi.fn().mockResolvedValue(undefined),
    };
    const service = new WebhookService(
      mandantPrisma() as never,
      repository as never,
      { record: vi.fn() } as never,
      { signWebhookPayload: vi.fn().mockReturnValue('sig') } as never,
      encryption(),
    );
    // WICHTIG: die Signatur nimmt ein OBJEKT. Ein positionaler Aufruf
    // liefert `kanzleiId === undefined` — der Test waere dann aus dem
    // falschen Grund rot bzw. gruen. Deshalb wird hier auf die Meldung
    // geprueft, nicht nur auf die Fehlerklasse.
    await expect(
      service.createSubscription(
        {
          kanzleiId: KANZLEI_B,
          url: 'https://example.com/hook',
          secret: 's',
          events: ['banz.submission.prepared'],
        } as never,
        userMitGeteilterAdminRolle(),
        ctx,
      ),
    ).rejects.toThrow(/KANZLEI_ADMIN dieser Kanzlei/);
  });

  it('Gegenprobe: in der Kanzlei, in der der User Admin ist, geht es weiter', async () => {
    // Kein false positive. Ein User, der in A Admin ist, muss in A
    // weiterhin arbeiten können — sonst wäre die Korrektur ein Ausfall.
    const repository = {
      findSubscriptionsByKanzlei: vi.fn().mockResolvedValue([]),
      findDeliveriesBySubscription: vi.fn().mockResolvedValue([]),
      findSubscriptionById: vi.fn().mockResolvedValue(null),
      deleteSubscription: vi.fn().mockResolvedValue(undefined),
      createSubscription: vi.fn().mockResolvedValue({ id: 'sub-1', mandantId: MANDANT_A }),
      getMaxSubscriptions: vi.fn().mockResolvedValue(5),
    };
    const service2 = new WebhookService(
      mandantPrisma() as never,
      repository as never,
      { record: vi.fn() } as never,
      { signWebhookPayload: vi.fn().mockReturnValue('sig') } as never,
      encryption(),
    );
    await service2.createSubscription(
      {
        kanzleiId: KANZLEI_A,
        url: 'https://example.com/hook',
        secret: 's',
        events: ['banz.submission.prepared'],
      } as never,
      userMitGeteilterAdminRolle(),
      ctx,
    );

    expect(repository.createSubscription).toHaveBeenCalled();
  });
});