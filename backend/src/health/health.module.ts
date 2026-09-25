import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { PrismaModule } from '../prisma/prisma.module';

/**
 * Health-Modul (M4 Sprint 2).
 *
 * Stellt `/health` und `/health/ready` Endpoints bereit für NGINX-Load-
 * Balancing + Kubernetes-Style-Probes.
 *
 *   - /health        — Liveness: ist der Prozess überhaupt da? (200 wenn ja)
 *   - /health/ready  — Readiness: kann der Prozess Traffic bedienen? (DB+Redis erreichbar?)
 *
 * Beide Endpoints sind explizit vom globalen `/api`-Prefix ausgenommen
 * (siehe `main.ts`).
 */
@Module({
  imports: [PrismaModule],
  controllers: [HealthController],
})
export class HealthModule {}