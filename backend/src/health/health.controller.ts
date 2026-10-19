import { Controller, Get, HttpCode, HttpStatus, Logger } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../modules/audit/services/audit.service';
import { AuditIntegrityService } from '../modules/audit/services/audit-integrity.service';
import { Public } from '../modules/auth/decorators/public.decorator';

/**
 * Health-Controller (M4 Sprint 2).
 *
 * Verwendet von NGINX Blue-Green-Loadbalancing + Docker-Healthchecks +
 * externen Monitoring-Tools (UptimeRobot, Betterstack, etc.).
 *
 * Antwortet IMMER in Deutsch (User-Preference + konsistent mit übriger API).
 */
@Public() // Liveness/Readiness muessen ohne Token erreichbar sein —
// NGINX health_check, Docker-Healthcheck und externes Monitoring
// senden keinen Authorization-Header. Ohne dieses Decorator blockt
// der globale JwtAuthGuard (APP_GUARD) die Probe mit 401.
@Controller('health')
@SkipThrottle() // Health-Checks niemals throttlen
export class HealthController {
  private readonly logger = new Logger(HealthController.name);
  private readonly startupTime = Date.now();

  /**
   * Ab wie vielen Millisekunden gilt die Hash-Kette als **stehen**?
   *
   * BEFUND 2026-10-19 (Nachtrag 56, TODO-8.8): Normalerweise ist der
   * aelteste ungehashte Eintrag ein paar Millisekunden alt — der Hash wird
   * unmittelbar nach dem Schreiben gesetzt. Ein Alter ueber dieser Schwelle
   * bedeutet: die Kette arbeitet nicht mehr.
   *
   * Der Wert ist bewusst grosszuegig (60 s): die Kette muss auch dann noch
   * als gesund gelten, wenn der Datenbank kurzzeitig laenger braucht.
   */
  private readonly chainStallMs = Number(
    process.env.AUDIT_CHAIN_STALL_MS ?? '60000',
  );

  constructor(
    private readonly prismaService: PrismaService,
    private readonly auditService: AuditService,
    private readonly integrityService: AuditIntegrityService,
  ) {}

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
    /**
     * Anzahl fehlgeschlagener Audit-Writes seit Prozessstart.
     * > 0 heisst: die Nachvollziehbarkeit (§ 146 AO) hat eine Luecke.
     */
    auditWriteFailures: number;
    /**
     * Alter des aeltesten Audit-Eintrags, der noch keinen Hash hat.
     *
     * BEFUND 2026-10-19 (Nachtrag 56, TODO-8.8): Das ist die **Condition
     * auf Alter des aeltesten Eintrags**, die in Nachtrag 31 als Massnahme
     * vorgeschlagen wurde. `null` heisst: die Kette ist vollstaendig.
     */
    auditOldestUnhashedAgeMs: number | null;
    uptime: number;
    timestamp: string;
  }> {
    const dbHealth = await this.prismaService.checkHealth();
    const allUp = dbHealth.primary === 'up' && dbHealth.replica !== 'down';

    // Ein defekter Audit-Pfad macht das System BETRIEBSUNFAEHIG fuer
    // rechtsverbindliche Vorgaenge — das ist ein Betriebs-, kein Kosmetik-
    // zustand und muss im Health-Check sichtbar sein.
    const auditFailures = this.auditService.getFailedWrites();

    // Steht die Hash-Kette? Ein Eintrag, der seit Minuten ungehasht ist,
    // bedeutet: die Kette ist stehengeblieben. Ohne diese Groesse ist ein
    // stehengebliebener Audit-Trail von einem Eintrag zu unterscheiden, der
    // gerade geschrieben wurde — beide sehen gleich aus.
    const oldestUnhashedAge = await this.integrityService.getOldestUnhashedAgeMs();
    const chainStalled =
      oldestUnhashedAge !== null && oldestUnhashedAge > this.chainStallMs;

    const healthy = allUp && auditFailures === 0 && !chainStalled;

    if (chainStalled) {
      this.logger.error(
        `Audit-Hash-Kette steht: aeltester ungehashter Eintrag ist ${oldestUnhashedAge} ms alt ` +
          `(Schwelle ${this.chainStallMs} ms).`,
      );
    }

    return {
      status: healthy ? 'ok' : 'degraded',
      checks: {
        ...dbHealth,
        ...(auditFailures > 0 || chainStalled ? { audit: 'degraded' as const } : {}),
      },
      auditWriteFailures: auditFailures,
      auditOldestUnhashedAgeMs: oldestUnhashedAge,
      uptime: Math.floor((Date.now() - this.startupTime) / 1000),
      timestamp: new Date().toISOString(),
    };
  }
}