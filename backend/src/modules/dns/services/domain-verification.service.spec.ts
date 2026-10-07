/**
 * Regressionstest: Custom-Domain-Verifikation ist kanzleigebunden.
 *
 * Bugfix 2026-10-06. `assertKanzleiAdminAccess()` nahm `kanzleiId`
 * entgegen und verwendete es **nirgends**:
 *
 *   const isAdmin = user.mandanten.some((m) => m.rolle === 'KANZLEI_ADMIN');
 *   ...
 *   // kein Zugriff auf kanzleiId
 *
 * Die Rollenpruefung ist strikt, beweist aber nur „Admin IRGENDWO".
 * Der Admin von Kanzlei A konnte die Domain-Verifikation fuer Kanzlei
 * B starten und bestaetigen und damit deren Branding uebernehmen.
 *
 * Zweiter Fund im selben Modul: `prismaUpdateWithFallback()` hat jeden
 * Prisma-Fehler geschluckt. `startVerification()` meldete danach
 * Erfolg, waehrend `customDomainVerified` still nicht gesetzt war.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common';
import { DomainVerificationService } from './domain-verification.service';

const KANZLEI_A = 'aaaaaaaa-9999-4999-8999-aaaaaaaaaaaa';
const KANZLEI_B = 'bbbbbbbb-0000-4000-8000-bbbbbbbbbbbb';

function buildService(opts: { updateWirft?: boolean } = {}) {
  const prisma = {
    // Bugfix 2026-10-07: `custom-domain` ist Premium und wird in
    // `startVerification` durchgesetzt. Der Stub muss den Tarif also
    // kennen — sonst scheitert der Aufruf an `kanzlei.findUnique`.
    mandant: {
      findFirst: vi.fn().mockImplementation(
        async ({ where }: { where: { kanzleiId: string; id: { in: string[] } } }) =>
          where.kanzleiId === KANZLEI_A && where.id.in.includes('mandant-1')
            ? { id: 'mandant-1' }
            : null,
      ),
    },
    kanzlei: {
      findUnique: vi
        .fn()
        .mockResolvedValue({ id: KANZLEI_A, subscriptionTier: 'PREMIUM' }),
      update: opts.updateWirft
        ? vi.fn().mockRejectedValue(new Error('P2022: column not found'))
        : vi.fn().mockResolvedValue({}),
    },
  };
  const kanzleiRepository = {
    findById: vi.fn().mockResolvedValue({
      id: KANZLEI_A,
      customDomain: null,
      customDomainVerified: false,
    }),
    isCustomDomainTaken: vi.fn().mockResolvedValue(false),
    findByCustomDomain: vi.fn().mockResolvedValue(null),
  };
  const dnsProvider = {
    createTxtRecord: vi.fn().mockResolvedValue({ recordId: 'rec-1' }),
    verifyTxtRecord: vi.fn().mockResolvedValue({ verified: true, value: 'tok' }),
    getProviderName: vi.fn().mockReturnValue('mock'),
    getInstruction: vi.fn().mockReturnValue('Anleitung'),
  };
  const service = new DomainVerificationService(
    dnsProvider as never,
    kanzleiRepository as never,
    { record: vi.fn().mockResolvedValue(undefined) } as never,
    prisma as never,
  );
  return { service, prisma, kanzleiRepository, dnsProvider };
}

const adminVonA = {
  id: 'a'.repeat(8) + '-9999-4999-8999-999999999999',
  globalRole: null,
  mandanten: [{ id: 'mandant-1', firmenname: 'A GmbH', rolle: 'KANZLEI_ADMIN' }],
} as never;

describe('DomainVerification: Kanzlei-Bindung', () => {
  it('startet die Verifikation für die eigene Kanzlei', async () => {
    const { service } = buildService();
    const r = await service.startVerification(KANZLEI_A, 'kanzlei-a.example', adminVonA, {});
    expect(r.verificationToken).toBeTruthy();
  });

  it('startet KEINE Verifikation für eine fremde Kanzlei (BUG vor dem Fix)', async () => {
    const { service, dnsProvider, prisma } = buildService();
    await expect(
      service.startVerification(KANZLEI_B, 'fremd.example', adminVonA, {}),
    ).rejects.toBeInstanceOf(ForbiddenException);
    // Weder DNS-Eintrag noch Datenbank wurden beruehrt.
    expect(dnsProvider.createTxtRecord).not.toHaveBeenCalled();
    expect(prisma.kanzlei.update).not.toHaveBeenCalled();
  });

  it('bestaetigt keine fremde Kanzlei (BUG vor dem Fix)', async () => {
    const { service } = buildService();
    await expect(
      service.verifyVerification(KANZLEI_B, adminVonA, {}),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('SYSTEM_ADMIN darf weiterhin jede Kanzlei', async () => {
    const { service } = buildService();
    const sysadmin = {
      id: 's'.repeat(8) + '-9999-4999-8999-999999999999',
      globalRole: 'SYSTEM_ADMIN',
      mandanten: [],
    } as never;
    const r = await service.startVerification(KANZLEI_B, 'fremd.example', sysadmin, {});
    expect(r.verificationToken).toBeTruthy();
  });

  it('meldet einen fehlgeschlagenen DB-Write als Fehler statt als Erfolg', async () => {
    const { service } = buildService({ updateWirft: true });
    // Der Aufrufer darf NICHT mit `autoCreated: true` und Token dastehen,
    // wenn `customDomainVerified` still nicht gesetzt wurde.
    await expect(
      service.startVerification(KANZLEI_A, 'kanzlei-a.example', adminVonA, {}),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });
});