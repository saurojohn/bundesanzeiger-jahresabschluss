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
import { ConfigService } from '@nestjs/config';
import { WebhookService } from './webhook.service';
import { EncryptionService } from '../../auth/services/encryption.service';
import {
  entschluesseln,
  istVerschluesselt,
  verschluesseln,
} from '../../../common/utils/verschluesseltes-geheimnis';

const KANZLEI_ID = 'aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa';

/**
 * Echter EncryptionService (kein Mock): der Test soll beweisen, dass der
 * Chiffretext wirklich lesbar ist — eine nachgebaute Verschluesselung
 * wuerde nur die Nachbildung messen.
 */
function echteEncryption(): EncryptionService {
  return new EncryptionService(
    new ConfigService({ JWT_SECRET: 'test-secret-nur-fuer-diesen-test' }),
  );
}

function buildService(opts: { updateDeliveryThrows: boolean }) {
  const encryption = echteEncryption();
  const secret = 'sekret';
  const subscription = {
    id: 'sub-1',
    kanzleiId: KANZLEI_ID,
    url: 'https://example.invalid/hook',
    // BEFUND 2026-10-22 (Nachtrag 82): das Secret liegt in der Datenbank
    // verschluesselt. Der Test benutzt denselben Weg wie die Anwendung.
    secret: verschluesseln(encryption, secret),
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
    updateSubscriptionSecret: vi.fn().mockResolvedValue(undefined),
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
      // BEFUND 2026-10-11: Der Service fragt jetzt `findMany` ab, weil die
      // Admin-Rolle an die Kanzlei gebunden wird. `findFirst` bleibt im
      // Mock, damit aeltere Aufrufer nicht stillschweigend `undefined`
      // bekommen und der Test an einer unerwarteten Stelle scheitert.
      findMany: vi.fn().mockImplementation(
        async ({ where }: { where: { kanzleiId: string; id: { in: string[] } } }) =>
          where.id.in.includes('mandant-1') && where.kanzleiId === KANZLEI_ID
            ? [{ id: 'mandant-1' }]
            : [],
      ),
    },
  };

  const service = new WebhookService(
    prisma as never,
    repository as never,
    { record: vi.fn().mockResolvedValue(undefined) } as never,
    { signWebhookPayload: vi.fn().mockReturnValue('sig') } as never,
    encryption,
  );

  return { service, repository, prisma, encryption };
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
      updateSubscriptionSecret: vi.fn().mockResolvedValue(undefined),
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
        findMany: vi.fn().mockImplementation(
          async ({ where }: { where: { kanzleiId: string; id: { in: string[] } } }) =>
            where.kanzleiId === KANZLEI_A && where.id.in.includes('mandant-1')
              ? [{ id: 'mandant-1' }]
              : [],
        ),
      },
    };
    const service = new WebhookService(
      prisma as never,
      repository as never,
      { record: vi.fn().mockResolvedValue(undefined) } as never,
      { signWebhookPayload: vi.fn().mockReturnValue('sig') } as never,
      echteEncryption(),
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

/**
 * BEFUND 2026-10-22 (Nachtrag 82): das HMAC-Secret lag im Klartext in der
 * Datenbank. Belegt wurde das an der LIVE-API:
 *
 *   POST /api/webhook-subscriptions {secret: "MessSecretKlartext0123..."}
 *   -> HTTP 201, plaintextSecret zurueckgegeben
 *   SELECT secret FROM webhook_subscription
 *      -> "MessSecretKlartext0123456789ABCDEFGH"   (byteweise identisch)
 *
 * Ein Datenbank-Dump (Backup, Restore, Leck) lieferte damit ein
 * verwendbares HMAC-Secret — damit war jede ausgehende Webhook-Nachricht
 * faelschbar.
 *
 * Die Begruendung im DTO ("das Secret MUSS fuer HMAC-Signatur lesbar
 * bleiben") war falsch: hashen ist unmoeglich, VERSCHLUESSELN nicht.
 */
describe('WebhookService: das HMAC-Secret liegt verschluesselt in der Datenbank', () => {
  const KANZLEI = 'aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa';
  const PLAINTEXT = 'MessSecretKlartext0123456789ABCDEFGH';

  const sysadmin = {
    id: 's'.repeat(8) + '-5555-4555-8555-555555555555',
    globalRole: 'SYSTEM_ADMIN',
    mandanten: [],
  } as never;

  function svcMitSecret(secret: string) {
    const enc = echteEncryption();
    const subscription = {
      id: 'sub-1',
      kanzleiId: KANZLEI,
      url: 'https://example.invalid/hook',
      secret,
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
      updateDelivery: vi.fn().mockResolvedValue(delivery),
      updateSubscriptionDeliveryStatus: vi.fn().mockResolvedValue(undefined),
      updateSubscriptionSecret: vi.fn().mockResolvedValue(undefined),
      createSubscription: vi.fn().mockImplementation(
        async (args: { secret: string }) => ({
          id: 'sub-neu',
          kanzleiId: KANZLEI,
          url: 'https://example.invalid/hook',
          events: ['banz.submission.published'],
          isActive: true,
          createdAt: new Date(),
          lastDeliveryAt: null,
          lastDeliveryStatus: null,
          secret: args.secret,
        }),
      ),
    };
    const apiKeyService = {
      signWebhookPayload: vi.fn().mockReturnValue('sig'),
    };
    const service = new WebhookService(
      { mandant: { findFirst: vi.fn(), findMany: vi.fn() } } as never,
      repository as never,
      { record: vi.fn().mockResolvedValue(undefined) } as never,
      apiKeyService as never,
      enc,
    );
    return { service, repository, apiKeyService, enc };
  }

  it('legt das Secret NICHT im Klartext ab (der Kern des Befunds)', async () => {
    const { service, repository, enc } = svcMitSecret('');
    const antwort = await service.createSubscription(
      {
        kanzleiId: KANZLEI,
        url: 'https://example.invalid/hook',
        secret: PLAINTEXT,
        events: ['banz.submission.published'],
      } as never,
      sysadmin,
      {},
    );

    const gespeichert = repository.createSubscription.mock.calls[0]![0] as {
      secret: string;
    };
    expect(
      gespeichert.secret,
      'das Secret darf nicht unveraendert in der Datenbank stehen',
    ).not.toBe(PLAINTEXT);
    expect(istVerschluesselt(gespeichert.secret)).toBe(true);
    // Gegenstueck zur Negativ-Zusicherung: es ist nicht irgendein Muell,
    // sondern genau DIES Secret — verschluesselt.
    expect(entschluesseln(enc, gespeichert.secret)).toBe(PLAINTEXT);
    // Der Client bekommt das Plaintext-Secret weiterhin genau einmal.
    expect(antwort.plaintextSecret).toBe(PLAINTEXT);
  });

  it('signiert die Zustellung mit dem entschluesselten Secret', async () => {
    const { service, apiKeyService } = svcMitSecret(
      verschluesseln(echteEncryption(), PLAINTEXT),
    );
    await service.deliver('del-1').catch(() => undefined);

    expect(apiKeyService.signWebhookPayload).toHaveBeenCalled();
    const benutztesSecret = apiKeyService.signWebhookPayload.mock
      .calls[0]![0] as string;
    // Das ist der Gegenstueck zur Verschluesselung: in der Datenbank steht
    // der Chiffretext, signiert wird mit dem Klartext — der Empfaenger kann
    // die Signatur also weiterhin mit seinem Secret pruefen.
    expect(benutztesSecret).toBe(PLAINTEXT);
  });

  it('heilt eine Altzeile im Klartext selbst (Selbstheilung)', async () => {
    // Altzeile: das Secret liegt noch unverschluesselt in der Datenbank.
    const { service, repository, apiKeyService } = svcMitSecret(PLAINTEXT);
    await service.deliver('del-1').catch(() => undefined);

    // 1) Die Zustellung nutzt den vorhandenen Wert (er ist gueltig) ...
    expect(apiKeyService.signWebhookPayload).toHaveBeenCalledWith(
      PLAINTEXT,
      expect.any(Number),
      expect.any(String),
    );
    // 2) ... und der Klartext wird sofort aus der Datenbank entfernt.
    expect(repository.updateSubscriptionSecret).toHaveBeenCalledTimes(1);
    const [, , neu] = repository.updateSubscriptionSecret.mock.calls[0]! as [
      string,
      string,
      string,
    ];
    expect(neu).not.toBe(PLAINTEXT);
    expect(istVerschluesselt(neu)).toBe(true);
  });

  it('laesst die Delivery bei unlesbarem Secret sichtbar fehlschlagen', async () => {
    // Chiffretext beschaedigt (oder Master-Key rotiert): die Zustellung darf
    // nicht mit leerem Secret weiterlaufen und nicht auf PENDING stehen
    // bleiben — der Fehler muss am Zustand sichtbar werden.
    const { service, repository, apiKeyService } = svcMitSecret(
      'enc:v1:kein.gueltiger.chiffretext',
    );
    await service.deliver('del-1').catch(() => undefined);

    expect(apiKeyService.signWebhookPayload).not.toHaveBeenCalled();
    expect(repository.updateDelivery).toHaveBeenCalled();
    // `updateDelivery(deliveryId, daten)` — der Zustand ist das ZWEITE Argument.
    const zustand = repository.updateDelivery.mock.calls[0]![1] as {
      status: string;
      errorMessage: string | null;
    };
    expect(zustand.status).toBe('FAILED');
    expect(zustand.errorMessage ?? '').toMatch(/Secret nicht lesbar/);
  });
});
