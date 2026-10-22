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
  BadRequestException,
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
      // BEFUND 2026-10-11: Der Service fragt `findMany` ab, weil die
      // Admin-Rolle an die Kanzlei gebunden wird.
      findMany: vi.fn().mockImplementation(
        async ({ where }: { where: { kanzleiId: string; id: { in: string[] } } }) =>
          where.kanzleiId === KANZLEI_A && where.id.in.includes('mandant-1')
            ? [{ id: 'mandant-1' }]
            : [],
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
      customDomainVerificationToken: null,
    }),
    isCustomDomainTaken: vi.fn().mockResolvedValue(false),
    findByCustomDomain: vi.fn().mockResolvedValue(null),
  };
  const dnsProvider = {
    createTxtRecord: vi.fn().mockResolvedValue({ recordId: 'rec-1' }),
    verifyTxtRecord: vi.fn().mockResolvedValue({ verified: true, value: 'tok' }),
    getProviderName: vi.fn().mockReturnValue('mock'),
    getInstruction: vi.fn().mockReturnValue('Anleitung'),
    // BEFUND 2026-10-22 (Nachtrag 83): Der Service liest den Provider ueber
    // `getProvider()` (das ist der Provider-Adapter) und prueft die
    // Verifikation ueber `verifyTxtRecordViaPublicDns()` (das ist der
    // DNS-Resolver — er kennt keinen Provider).
    getProvider: vi.fn().mockReturnValue({
      createTxtRecord: vi.fn().mockResolvedValue({ recordId: 'rec-1' }),
      deleteTxtRecord: vi.fn().mockResolvedValue(undefined),
      listTxtRecords: vi.fn().mockResolvedValue([]),
    }),
    verifyTxtRecordViaPublicDns: vi.fn().mockResolvedValue(false),
  };
  // BEFUND 2026-10-22 (Nachtrag 84): Der Service invalidiert nach dem
  // Schreiben den Branding-Cache — die Verifikation schreibt Felder, die
  // `GET /api/branding/:kanzleiId` aus dem Cache liefert.
  const cache = {
    invalidate: vi.fn().mockResolvedValue(undefined),
    memoize: vi.fn(async (_k: string, _t: number, fn: () => Promise<unknown>) => fn()),
    get: vi.fn().mockReturnValue(undefined),
    set: vi.fn().mockResolvedValue(undefined),
  };
  const service = new DomainVerificationService(
    dnsProvider as never,
    kanzleiRepository as never,
    { record: vi.fn().mockResolvedValue(undefined) } as never,
    prisma as never,
    cache as never,
  );
  return { service, prisma, kanzleiRepository, dnsProvider, cache };
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

/**
 * BEFUND 2026-10-22 (Nachtrag 83): Die Verifikation verglich den
 * ausgestellten Token **nicht**.
 *
 * `startVerification()` erzeugte einen Token, gab ihn dem Client mit und
 * legte ihn **nirgends ab**. `verifyVerification()` las den erwarteten Wert
 * stattdessen aus dem DNS selbst:
 *
 *     const records = await listTxtRecords(name);
 *     const expectedValue = records.find(r => r.value.startsWith('banz-verify=')).value;
 *     const publicMatch = await verifyTxtRecordViaPublicDns(name, expectedValue);
 *
 * Geprueft wurde damit: "Es gibt einen TXT-Record mit dem Praefix
 * 'banz-verify=' und er ist oeffentlich sichtbar." **Nicht** geprueft wurde:
 * "Der Record enthaelt das Token, das diese Kanzlei erhalten hat."
 *
 * Ein Record aus einem fremden Verifikationslauf genuegte damit — und
 * zusammen mit der case-sensitiven Domain-Eindeutigkeit (zwei Kanzleien,
 * dieselbe Domain) war das eine Uebernahme fremder Domains.
 */
describe('DomainVerification: der Token wird geprueft (Nachtrag 83)', () => {
  const DOMAIN = 'kanzlei-a.example';
  const TOKEN = 'a'.repeat(32);

  /** Kanzlei mit hinterlegter Verifikationsanfrage. */
  function svcMitAnfrage(opts: { dnsWert?: string } = {}) {
    const gebaut = buildService();
    const dnsWert = opts.dnsWert ?? `banz-verify=${TOKEN}`;
    gebaut.kanzleiRepository.findById.mockResolvedValue({
      id: KANZLEI_A,
      customDomain: DOMAIN,
      customDomainVerified: false,
      customDomainVerificationToken: TOKEN,
    });
    // Der Mock bildet die Umgebung ab (welche TXT-Records oeffentlich
    // sichtbar sind) — NICHT die Vergleichslogik: der Service muss den
    // richtigen Erwartungswert uebergeben.
    //
    // WICHTIG: `listTxtRecords` liefert den Record, der tatsaechlich im DNS
    // steht. Sonst prueft der Test nur den "kein Record gefunden"-Zweig —
    // und waere auch mit dem alten Code gruen (die Negativprobe waere dann
    // aus dem falschen Grund gruen).
    gebaut.dnsProvider.getProvider.mockReturnValue({
      createTxtRecord: vi.fn().mockResolvedValue({ recordId: 'rec-1' }),
      deleteTxtRecord: vi.fn().mockResolvedValue(undefined),
      listTxtRecords: vi.fn().mockResolvedValue([
        { recordId: 'rec-1', name: `_banz-verify.${DOMAIN}`, value: dnsWert, ttl: 300 },
      ]),
    });
    gebaut.dnsProvider.verifyTxtRecordViaPublicDns.mockImplementation(
      async (_name: string, erwartet: string) => dnsWert === erwartet,
    );
    return gebaut;
  }

  it('prueft gegen das Token der laufenden Anfrage', async () => {
    const { service, dnsProvider } = svcMitAnfrage();
    const ergebnis = await service.verifyVerification(KANZLEI_A, adminVonA, {});

    expect(dnsProvider.verifyTxtRecordViaPublicDns).toHaveBeenCalledWith(
      `_banz-verify.${DOMAIN}`,
      `banz-verify=${TOKEN}`,
    );
    expect(ergebnis.verified).toBe(true);
  });

  it('weist einen Record mit FREMDEM Token ab (BUG vor dem Fix)', async () => {
    // Der TXT-Record stammt aus einem anderen Verifikationslauf.
    const { service, prisma } = svcMitAnfrage({
      dnsWert: 'banz-verify=fremderToken12345678901234567890',
    });
    const ergebnis = await service.verifyVerification(KANZLEI_A, adminVonA, {});

    expect(ergebnis.verified).toBe(false);
    expect(ergebnis.reason).toBeTruthy();
    // Und es wurde **nicht** als verifiziert gespeichert.
    expect(prisma.kanzlei.update).not.toHaveBeenCalled();
  });

  it('verweigert die Pruefung ohne laufende Verifikationsanfrage (fail-closed)', async () => {
    // Vorher konnte jede Kanzlei "pruefen", ohne je ein Token erhalten zu
    // haben — die Domain stand dann als verifiziert da, obwohl sie
    // niemandem gehoert.
    const { service, dnsProvider, prisma, kanzleiRepository } = buildService();
    kanzleiRepository.findById.mockResolvedValue({
      id: KANZLEI_A,
      customDomain: DOMAIN,
      customDomainVerified: false,
      customDomainVerificationToken: null,
    });

    await expect(
      service.verifyVerification(KANZLEI_A, adminVonA, {}),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(dnsProvider.verifyTxtRecordViaPublicDns).not.toHaveBeenCalled();
    expect(prisma.kanzlei.update).not.toHaveBeenCalled();
  });

  it('loescht das Token nach der erfolgreichen Verifikation (einmalig)', async () => {
    const { service, prisma } = svcMitAnfrage();
    await service.verifyVerification(KANZLEI_A, adminVonA, {});

    const schreibvorgaenge = prisma.kanzlei.update.mock.calls;
    expect(schreibvorgaenge.length).toBeGreaterThan(0);
    const daten = schreibvorgaenge[0]![0] as {
      data: { customDomainVerified: boolean; customDomainVerificationToken: string | null };
    };
    expect(daten.data.customDomainVerified).toBe(true);
    expect(daten.data.customDomainVerificationToken).toBeNull();
  });

  it('speichert den ausgestellten Token und normalisiert die Domain', async () => {
    const { service, prisma } = buildService();
    const antwort = await service.startVerification(
      KANZLEI_A,
      '  Kanzlei-A.Example.  ',
      adminVonA,
      {},
    );

    expect(antwort.verificationToken).toHaveLength(32);
    const daten = prisma.kanzlei.update.mock.calls[0]![0] as {
      data: {
        customDomain: string;
        customDomainVerificationToken: string;
        customDomainVerificationRequestedAt: Date;
      };
    };
    expect(daten.data.customDomain).toBe('kanzlei-a.example');
    expect(daten.data.customDomainVerificationToken).toBe(
      antwort.verificationToken,
    );
    expect(daten.data.customDomainVerificationRequestedAt).toBeInstanceOf(Date);
  });

  it('invalidiert den Branding-Cache nach dem Schreiben (Nachtrag 84)', async () => {
    // Der Cache haelt genau die Felder, die diese Verifikation schreibt
    // (`customDomain`, `customDomainVerified`). Ohne Invalidierung lieferte
    // die Branding-API bis zu einer Stunde (TTL) den alten Stand.
    const { service, cache } = buildService();
    await service.startVerification(KANZLEI_A, 'kanzlei-a.example', adminVonA, {});
    expect(cache.invalidate).toHaveBeenCalledWith(`branding:${KANZLEI_A}`);
  });

  it('invalidiert den Branding-Cache auch nach der Verifikation', async () => {
    const { service, cache, kanzleiRepository, dnsProvider } = buildService();
    kanzleiRepository.findById.mockResolvedValue({
      id: KANZLEI_A,
      customDomain: 'kanzlei-a.example',
      customDomainVerified: false,
      customDomainVerificationToken: 'a'.repeat(32),
    });
    dnsProvider.verifyTxtRecordViaPublicDns.mockResolvedValue(true);
    await service.verifyVerification(KANZLEI_A, adminVonA, {});
    expect(cache.invalidate).toHaveBeenCalledWith(`branding:${KANZLEI_A}`);
  });
});