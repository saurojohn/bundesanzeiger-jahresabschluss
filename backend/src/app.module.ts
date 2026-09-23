import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from './modules/auth/guards/roles.guard';
import { AuthModule } from './modules/auth/auth.module';
import { AuditModule } from './modules/audit/audit.module';
import { MandantModule } from './modules/mandant/mandant.module';
import { PrismaModule } from './prisma/prisma.module';

/**
 * Root-App-Module.
 *
 * Globale Guards (Reihenfolge zählt):
 *   1. ThrottlerGuard  — Rate-Limit
 *   2. JwtAuthGuard    — Auth, mit @Public() überspringbar
 *   3. RolesGuard      — RBAC anhand @Roles()
 *
 * Modul-Liste:
 *   - PrismaModule       (global)
 *   - AuthModule         (Login, TOTP, Refresh, /me, Logout)
 *   - AuditModule        (Audit-Trail lesen + Service)
 *   - MandantModule      (Mandanten CRUD)
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60_000,
        limit: 600,
      },
    ]),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    AuditModule,
    MandantModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
