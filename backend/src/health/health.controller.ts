import { Controller, Get, HttpCode, HttpStatus, Logger } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Health-Controller (M4 Sprint 2).
 *
 * Verwendet von NGINX Blue-Green-Loadbalancing + Docker-Healthchecks +
 * externen Monitoring-Tools (UptimeRobot, Betterstack, etc.).
 *
 * Antwortet IMMER in Deutsch (User-Preference + konsistent mit übriger API).
 */
@Controller('health')
@SkipThrottle() // Health-Checks niemals throttlen
export class HealthController {
  private readonly logger = new Logger(HealthController.name);
  private readonly startupTime = Date.now();

  constructor(private readonly prismaService: PrismaService) {}

  /**
   * Liveness-Probe.
   *
   * Liefert 200 zurück sobald der Node-Prozess überhaupt Requests
   * annehmen kann. Schnell, ohne externe Dependencies.
   *
   * NGINX nutzt diesen Endpoint im `health_check`-Block der upstream-Definition.
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  async liveness(): Promise<{
    status: 'ok';
    uptime: number;
    activePool: string;
    timestamp: string;
  }> {
    return {
      status: 'ok',
      uptime: Math.floor((Date.now() - this.startupTime) / 1000),
      activePool: process.env.ACTIVE_POOL ?? 'unknown',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Readiness-Probe.
   *
   * Prüft DB (Primary + Replica) und Redis-Erreichbarkeit. Liefert 503
   * zurück wenn eine kritische Dependency nicht verfügbar ist.
   *
   * NGINX-Blue-Green-Switch prüft diesen Endpoint BEVOR er den
   * neuen Pool aktiv schaltet.
   */
  @Get('ready')
  @HttpCode(HttpStatus.OK)
  async readiness(): Promise<{
    status: 'ok' | 'degraded';
    checks: {
      primary: 'up' | 'down';
      replica: 'up' | 'down' | 'disabled';
    };
    uptime: number;
    timestamp: string;
  }> {
    const dbHealth = await this.prismaService.checkHealth();
    const allUp = dbHealth.primary === 'up' && dbHealth.replica !== 'down';

    return {
      status: allUp ? 'ok' : 'degraded',
      checks: dbHealth,
      uptime: Math.floor((Date.now() - this.startupTime) / 1000),
      timestamp: new Date().toISOString(),
    };
  }
}