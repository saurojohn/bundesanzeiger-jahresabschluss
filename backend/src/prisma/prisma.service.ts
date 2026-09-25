import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient, Prisma } from '@prisma/client';

/**
 * Zentraler Prisma-Service mit Read-Replica-Routing (M4 Sprint 2).
 *
 * Stellt `this.<model>` zur Verfügung. Module dürfen Prisma nur indirekt
 * über das Repository-Pattern oder Services ansprechen, die einen
 * mandantId-Filter anwenden (siehe ESLint-Regel in `eslint.config.mjs`).
 *
 * ## Read-Replica-Verhalten
 *
 * Wenn `DATABASE_READ_REPLICA_URL` gesetzt ist, werden Read-Operationen
 * (findMany, findUnique, findFirst, findUniqueOrThrow, findFirstOrThrow,
 * count, aggregate, groupBy) automatisch an die Read-Replica geroutet.
 *
 * Write-Operationen (create, update, delete, upsert, createMany,
 * updateMany, deleteMany) bleiben IMMER auf der Primary.
 *
 * Wenn `DATABASE_READ_REPLICA_URL` NICHT gesetzt ist, verhält sich der
 * Service exakt wie vor Sprint 2 (alle Queries auf Primary).
 * Zero-Impact-Migration.
 *
 * Raw-SQL ($queryRaw, $queryRawUnsafe, $executeRaw) bleibt auf Primary,
 * weil Read/Write dort nicht statisch erkennbar ist.
 *
 * Transactionen ($transaction) bleiben auf Primary, weil sie Writes
 * enthalten können.
 *
 * ## Technische Umsetzung
 *
 * PrismaService extendet weiterhin PrismaClient (für statische Typ-Info
 * + alle Model-Delegates). Read-Routing greift per $extends in den
 * query-Lifecycle ein und ersetzt nur die Read-Operationen transparent
 * durch Calls auf den Replica-Client.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private replicaClient: PrismaClient | null = null;
  private replicaEnabled = false;

  constructor(configService?: ConfigService) {
    const primaryUrl =
      configService?.get<string>('DATABASE_URL') ??
      process.env.DATABASE_URL ??
      '';
    const replicaUrl =
      configService?.get<string>('DATABASE_READ_REPLICA_URL') ??
      process.env.DATABASE_READ_REPLICA_URL ??
      '';

    if (!primaryUrl) {
      throw new Error('DATABASE_URL ist nicht gesetzt');
    }

    super({
      datasources: { db: { url: primaryUrl } },
      log:
        process.env.NODE_ENV === 'production'
          ? ['error']
          : ['error', 'warn'],
    });

    if (replicaUrl && replicaUrl !== primaryUrl) {
      this.replicaClient = new PrismaClient({
        datasources: { db: { url: replicaUrl } },
        log:
          process.env.NODE_ENV === 'production'
            ? ['error']
            : ['error', 'warn'],
      });
      this.replicaEnabled = true;
      this.logger.log(
        `Read-Replica aktiviert: ${redactUrl(replicaUrl)}`,
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const self = this as unknown as { $extends: (ext: unknown) => unknown };
      self.$extends(this.buildReadRoutingExtender());
      this.logger.debug('PrismaService Read-Routing via $extends installiert');
    } else {
      this.replicaEnabled = false;
      this.logger.log('Read-Replica nicht konfiguriert — alle Queries auf Primary');
    }

    this.logger.log('PrismaService initialisiert');
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Prisma DB-Verbindung (Primary) hergestellt');
    if (this.replicaClient) {
      try {
        await this.replicaClient.$connect();
        this.logger.log('Prisma DB-Verbindung (Replica) hergestellt');
      } catch (err) {
        this.logger.error(
          `Replica-Verbindung fehlgeschlagen — Fallback auf Primary: ${(err as Error).message}`,
        );
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log('Prisma DB-Verbindung (Primary) getrennt');
    if (this.replicaClient) {
      await this.replicaClient.$disconnect();
      this.logger.log('Prisma DB-Verbindung (Replica) getrennt');
    }
  }

  /**
   * Health-Check: prüft Primary + (optional) Replica.
   * Verwendet vom Health-Controller (Sprint 2 Phase C).
   */
  async checkHealth(): Promise<{
    primary: 'up' | 'down';
    replica: 'up' | 'down' | 'disabled';
  }> {
    const result: { primary: 'up' | 'down'; replica: 'up' | 'down' | 'disabled' } = {
      primary: 'down',
      replica: this.replicaEnabled ? 'down' : 'disabled',
    };
    try {
      await this.$queryRaw`SELECT 1`;
      result.primary = 'up';
    } catch (err) {
      this.logger.error(`Primary-Health-Check fehlgeschlagen: ${(err as Error).message}`);
    }
    if (this.replicaClient) {
      try {
        await this.replicaClient.$queryRaw`SELECT 1`;
        result.replica = 'up';
      } catch (err) {
        this.logger.error(`Replica-Health-Check fehlgeschlagen: ${(err as Error).message}`);
      }
    }
    return result;
  }

  /**
   * Baut einen Prisma Client Extension, der Read-Operationen an die
   * Replica weiterleitet.
   *
   * WICHTIG: Transactionen + Raw-SQL + Aggregations-with-side-effects
   * werden NICHT umgeleitet — die Replica ist eventual-consistent und
   * kann Writes nicht persistieren.
   */
  private buildReadRoutingExtender(): unknown {
    const READ_OPS = new Set([
      'findMany',
      'findUnique',
      'findUniqueOrThrow',
      'findFirst',
      'findFirstOrThrow',
      'count',
      'aggregate',
      'groupBy',
    ]);

    const replica = this.replicaClient;
    if (!replica) return {};

    // Prisma 5.22 $extends query-API
    return {
      name: 'ReadReplicaRouting',
      query: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        $allModels: {
          async $allOperations({ model, operation, args, query }: {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            model: string; operation: string; args: any; query: (a: any) => Promise<unknown>;
          }) {
            if (!READ_OPS.has(operation)) {
              // Write-Operation oder unbekannt → Primary
              return query(args);
            }
            // Read-Operation → Replica
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const delegate = (replica as unknown as Record<string, any>)[model];
            if (!delegate || typeof delegate[operation] !== 'function') {
              return query(args);
            }
            return delegate[operation](args);
          },
        },
      },
    };
  }
}

function redactUrl(url: string): string {
  return url.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:***@');
}