import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Zentraler Prisma-Service.
 *
 * Stellt `this.prisma.<model>` zur Verfügung. Module dürfen Prisma nur indirekt
 * über das Repository-Pattern oder Services ansprechen, die einen
 * mandantId-Filter anwenden (siehe ESLint-Regel in `eslint.config.mjs`).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log:
        process.env.NODE_ENV === 'production'
          ? ['error']
          : ['error', 'warn'],
    });
    this.logger.log('PrismaService initialisiert');
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Prisma DB-Verbindung hergestellt');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log('Prisma DB-Verbindung getrennt');
  }
}
