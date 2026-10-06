/**
 * Regressionstest: eine Webhook-Zustellung darf den Prozess nicht beenden.
 *
 * Bugfix 2026-10-06. `WebhookService.deliver()` sichert per try/catch nur
 * den HTTP-Aufruf ab. Die drei nachfolgenden Datenbank-Schreibweisen
 * (`repository.updateDelivery()`, Zeilen 373/406/446) lagen ausserhalb.
 * Diese Repository-Methode hat keinen internen catch
 * (`webhook.repository.ts:140`).
 *
 * Beide Aufrufstellen benutzten `void this.deliver(id)` — OHNE
 * `.catch()`. Eine DB-Stoerung schoss damit aus `deliver()` in eine
 * verwaiste Promise.
 *
 * Belegt mit `node` auf dem gleichen Muster: Exit-Code 1, waehrend der
 * Aufrufer bereits regulaer geantwortet hat. Im Betrieb heisst das:
 * der Kanzlei-Backend-Prozess stirbt mitten im Betrieb, ausgeloest
 * durch ein DB-Problem beim Webhook-Versand — dieselbe Fehlerklasse
 * wie bei `SubscriptionService.assertKanzleiReadAccess`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { WebhookService } from './webhook.service';

const KANZLEI_ID = 'aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa';

function buildService(opts: { updateDeliveryThrows: boolean }) {
  const subscription = {
    id: 'sub-1',
    kanzleiId: KANZLEI_ID,
    url: 'https://example.invalid/hook',
    secret: 'sekret',
  };
  const delivery = {
    id: 'del-1',
    event: 'banz.submission.published',
    payload: { a: 1 },
    status: 'PENDING',
    attemptCount: 0,
    maxAttempts: 3,
    subscription,
  };

  const repository = {
    findDeliveryById: vi.fn().mockResolvedValue(delivery),
    // Genau die Stelle, die ohne Absicherung aus deliver() herauswuerfe.
    updateDelivery: opts.updateDeliveryThrows
      ? vi.fn().mockRejectedValue(new Error('P2021: relation does not exist'))
      : vi.fn().mockResolvedValue(delivery),
    updateSubscriptionDeliveryStatus: vi.fn().mockResolvedValue(undefined),
  };

  // Prisma-Stub: die Zugriffspruefung loest ueber den Mandanten auf
  // (`kanzleiId` + Mandant-UUID des Users). Standardmaessig gehoert der
  // Mandant zur gesuchten Kanzlei.
  const prisma = {
    mandant: {
      findFirst: vi.fn().mockImplementation(
        async ({ where }: { where: { kanzleiId: string; id: { in: string[] } } }) =>
          where.id.in.includes('mandant-1') && where.kanzleiId === KANZLEI_ID
            ? { id: 'mandant-1' }
            : null,
      ),
    },
  };

  const service = new WebhookService(
    prisma as never,
    repository as never,
    { record: vi.fn().mockResolvedValue(undefined) } as never,
    { signWebhookPayload: vi.fn().mockReturnValue('sig') } as never,
  );

  return { service, repository, prisma };
}

/**
 * Wartet, bis `bedingt()` wahr ist, oder wirft nach Timeout.
 *
 * In diesem Test laufen DNS-/SSRF-Aufloesungen und DB-Aufrufe wirklich
 * — `setImmediate`-Ketten reichen da nicht und wuerden einen
 * zeitabhaengigen, flackernden Test erzeugen.
 */
async function warteBis(
  bedingt: () => boolean,
  timeoutMs = 5000,
): Promise<void> {
  const start = Date.now();
  while (!bedingt()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('warteBis: Bedingung trat nicht ein (Timeout)');
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('WebhookService: Zustellung darf den Prozess nicht beenden', () => {
  // Der eigentliche Beweis: eine unbehandelte Rejection im Prozess
  // beendet Node (>= 15) sofort. Dieser Listener macht sie fuer den
  // Test sichtbar, statt still den Testlauf zu beenden.
  let unhandled: unknown[] = [];

  beforeEach(() => {
    unhandled = [];
    process.on('unhandledRejection', (reason) => {
      unhandled.push(reason);
    });
  });

  it('fängt einen DB-Fehler beim Speichern des Zustands ab', async () => {
    const { service, repository } = buildService({ updateDeliveryThrows: true });

    // `emit()` startet fire-and-forget. Wir rufen `deliver()` hier
    // direkt, um die Zustaende deterministisch pruefen zu koennen.
    await expect(service.deliver('del-1')).rejects.toThrow(
      'P2021: relation does not exist',
    );
    expect(repository.updateDelivery).toHaveBeenCalled();
  });

  it('startDelivery lässt keine unbehandelte Rejection zurück', async () => {
    const { service } = buildService({ updateDeliveryThrows: true });

    // Das ist der eigentliche Fix: `startDelivery` ist die
    // fire-and-forget-Grenze und muss die Rejection schlucken.
    const intern = service as unknown as { startDelivery(id: string): void };
    expect(() => intern.startDelivery('del-1')).not.toThrow();

    // Die Rejection entsteht erst NACH der SSRF-/DNS-Aufloesung
    // innerhalb von deliver(). Ein reines `setImmediate`-Warten
    // prueft also zu frueh — der Test waere gruen, obwohl die
    // Rejection unausgeglichen ist. Deshalb wird bewusst ein
    // Zeitfenster abgewartet, in dem sie auftreten MUESSTE.
    await new Promise((r) => setTimeout(r, 1500));

    expect(unhandled, 'Es darf keine unbehandelte Rejection geben').toEqual([]);
  });

  it('startDelivery protokolliert den Fehler, statt ihn zu schlucken', async () => {
    const { service } = buildService({ updateDeliveryThrows: true });
    const logger = { error: vi.fn(), warn: vi.fn(), log: vi.fn(), debug: vi.fn() };
    (service as unknown as { logger: unknown }).logger = logger;

    const intern = service as unknown as { startDelivery(id: string): void };
    intern.startDelivery('del-1');
    // Deterministisch warten: deliver() macht vorher eine
    // DNS-/SSRF-Aufloesung, die nicht in zwei Microtasks erledigt ist.
    await warteBis(() => logger.error.mock.calls.length > 0);

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(String(logger.error.mock.calls[0][0])).toMatch(
      /un.?erwartet abgebrochen/i,
    );
    expect(String(logger.error.mock.calls[0][0])).toContain('del-1');
  });

  it('startDelivery ist bei intakter Datenbank geräuschlos', async () => {
    const { service, repository } = buildService({ updateDeliveryThrows: false });
    const logger = { error: vi.fn(), warn: vi.fn(), log: vi.fn(), debug: vi.fn() };
    (service as unknown as { logger: unknown }).logger = logger;

    const intern = service as unknown as { startDelivery(id: string): void };
    intern.startDelivery('del-1');
    await warteBis(() => repository.updateDelivery.mock.calls.length > 0);
    // Etwas Luft, damit ein spaeter Fehler doch noch auffaellt.
    await new Promise((r) => setTimeout(r, 50));

    expect(repository.updateDelivery).toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('kein Aufrufer startet deliver() ohne .catch()', async () => {
    // Structural check. Achtung: `startDelivery` selbst benutzt
    // `void this.deliver(...).catch(...)` — DAS ist die Absicherung und
    // muss erlaubt bleiben. Verboten ist nur ein `void this.deliver(`
    // ganz ohne angehängtes `.catch(`.
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const roh = readFileSync(
      join(process.cwd(), 'src/modules/webhook/services/webhook.service.ts'),
      'utf-8',
    );
    // Kommentare entfernen: die Doku zu diesem Fix nennt das alte Muster
    // woertlich (`void this.deliver(id)`) und wuerde sonst faelschlich
    // als echter Aufrufer durchgehen.
    const code = roh
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');

    expect(code).toMatch(/this\.startDelivery\(/);
    expect(code).not.toMatch(/void\s+this\.deliver\((?![^)]*\)\s*\.catch\()/);
  });
});

describe('WebhookService: Kanzlei-Trennung der Zugriffsprüfung', () => {
  const KANZLEI_A = 'aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa';
  const KANZLEI_B = 'bbbbbbbb-6666-4666-8666-bbbbbbbbbbbb';

  /** User mit einem Mandanten, der zu KANZLEI_A gehoert. */
  const userVonA = (rolle: string) =>
    ({
      id: 'e'.repeat(8) + '-5555-4555-8555-555555555555',
      globalRole: null,
      mandanten: [
        { id: 'mandant-1', firmenname: 'A GmbH', rolle },
      ],
    }) as never;

  function svc() {
    const repository = {
      findSubscriptionsByKanzlei: vi.fn().mockResolvedValue([]),
      findDeliveriesBySubscription: vi.fn().mockResolvedValue([]),
      findSubscriptionById: vi.fn().mockResolvedValue(null),
      deleteSubscription: vi.fn().mockResolvedValue(undefined),
    };
    const prisma = {
      mandant: {
        // Mandant gehoert NUR zu KANZLEI_A.
        findFirst: vi.fn().mockImplementation(
          async ({ where }: { where: { kanzleiId: string; id: { in: string[] } } }) =>
            where.kanzleiId === KANZLEI_A && where.id.in.includes('mandant-1')
              ? { id: 'mandant-1' }
              : null,
        ),
      },
    };
    const service = new WebhookService(
      prisma as never,
      repository as never,
      { record: vi.fn().mockResolvedValue(undefined) } as never,
      { signWebhookPayload: vi.fn().mockReturnValue('sig') } as never,
    );
    return { service, repository, prisma };
  }

  it('liest die eigene Kanzlei', async () => {
    const { service } = svc();
    await expect(
      service.listSubscriptions(KANZLEI_A, userVonA('STEUERBERATER')),
    ).resolves.toBeDefined();
  });

  it('liest NICHT die Kanzlei eines anderen (BUG vor dem Fix)', async () => {
    const { service } = svc();
    // KANZLEI_ADMIN von A, aber kanzleiId zeigt auf B.
    await expect(
      service.listSubscriptions(KANZLEI_B, userVonA('KANZLEI_ADMIN')),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('verwaltet NICHT die Kanzlei eines anderen (BUG vor dem Fix)', async () => {
    const { service } = svc();
    await expect(
      service.deleteSubscription('sub-x', KANZLEI_B, userVonA('KANZLEI_ADMIN'), {}),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('loest kein test-delivery gegen eine fremde Kanzlei aus (SSRF-Vektor)', async () => {
    const { service, repository } = svc();
    await expect(
      service.testDelivery('sub-x', KANZLEI_B, userVonA('KANZLEI_ADMIN')),
    ).rejects.toBeInstanceOf(ForbiddenException);
    // Es darf keine Delivery erzeugt und kein HTTP-Request abgesetzt werden.
    expect(repository.findSubscriptionById).not.toHaveBeenCalled();
  });

  it('verwaltet die eigene Kanzlei weiterhin (kein false positive)', async () => {
    const { service, repository } = svc();
    repository.findSubscriptionById.mockResolvedValue({
      id: 'sub-1',
      kanzleiId: KANZLEI_A,
      url: 'https://example.invalid/hook',
      secret: 's',
      events: [],
      isActive: true,
      createdAt: new Date(),
      lastDeliveryAt: null,
      lastDeliveryStatus: null,
    });
    // Der eigentliche Aufruf darf die Kanzlei-Pruefung passieren.
    // (Der nachfolgende Delivery-Pfad wird hier nicht weiter verfolgt.)
    await service
      .testDelivery('sub-1', KANZLEI_A, userVonA('KANZLEI_ADMIN'))
      .catch(() => undefined);
    expect(repository.findSubscriptionById).toHaveBeenCalled();
  });

  it('SYSTEM_ADMIN darf weiterhin jede Kanzlei', async () => {
    const { service } = svc();
    const sysadmin = {
      id: 's'.repeat(8) + '-5555-4555-8555-555555555555',
      globalRole: 'SYSTEM_ADMIN',
      mandanten: [],
    } as never;
    await expect(
      service.listSubscriptions(KANZLEI_B, sysadmin),
    ).resolves.toBeDefined();
  });

  it('ein User ganz ohne Mandant kommt nirgends durch', async () => {
    const { service } = svc();
    const keiner = {
      id: 'k'.repeat(8) + '-5555-4555-8555-555555555555',
      globalRole: null,
      mandanten: [],
    } as never;
    await expect(
      service.listSubscriptions(KANZLEI_A, keiner),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
