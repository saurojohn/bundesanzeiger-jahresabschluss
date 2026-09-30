import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { PrismaModule } from '../prisma/prisma.module';
// HealthController liest den Audit-Fehlerzaehler aus. Nest loest Provider
//ueber Modulgrenzen auf — ein in AppModule registriertes AuditModule
//genuegt dafuer nicht, HealthModule muss es selbst importieren.
import { AuditModule } from '../modules/audit/audit.module';

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
  imports: [PrismaModule, AuditModule],
  controllers: [HealthController],
})
export class HealthModule {}