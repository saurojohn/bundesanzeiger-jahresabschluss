import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../audit/services/audit.service';
import type { AuthUser } from '../../auth/types/auth-user.types';
import {
  HGB_KONTONUMMER,
  LANGFRISTIGE_RUECKSTELLUNGEN_KONTONUMMERN,
  IDW_STANDARDREgeln,
  evaluateOperator,
  type IDWRegelDefinition,
  type RegelStatus,
} from '../constants/idw-regeln.constants';
import type {
  BilanzPruefungsResultEntity,
} from '../wp.repository';
import { WPRepository } from '../wp.repository';

export interface IdwPruefungServiceContext {
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Service: IDW PS 880 Plausibilitätsprüfung.
 *
 * Führt die 5 Standardregeln gegen eine Bilanz aus und persistiert die
 * Ergebnisse in `BilanzPruefungsResult`.
 *
 * Mandant-Trennung: Bilanz/GuV werden über `mandantId` gefiltert.
 *
 * RBAC: jeder authentifizierte User mit Zugriff auf den Mandanten darf
 * die Plausi ausführen (lesender Check, kein Schreib-Event außer Logs).
 */
@Injectable()
export class IdwPruefungService {
  private readonly logger = new Logger(IdwPruefungService.name);

  constructor(
    private readonly wpRepository: WPRepository,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Führt alle 5 IDW-Standardregeln gegen eine Bilanz aus und persistiert
   * die Ergebnisse (upsert pro (bilanzId, regelCode)).
   */
  async runPruefung(
    args: { bilanzId: string; guvId?: string },
    user: AuthUser,
    context: IdwPruefungServiceContext,
  ): Promise<BilanzPruefungsResultEntity[]> {
    const bilanzMandantId = await this.wpRepository.findBilanzMandantId(args.bilanzId);
    if (!bilanzMandantId) {
      throw new NotFoundException('Bilanz nicht gefunden');
    }
    this.assertMandantAccess(bilanzMandantId, user);

    let guvMandantId: string | null = null;
    if (args.guvId) {
      guvMandantId = await this.wpRepository.findGuVMandantId(args.guvId);
      if (!guvMandantId) {
        throw new NotFoundException('GuV nicht gefunden');
      }
      if (guvMandantId !== bilanzMandantId) {
        throw new ForbiddenException(
          'GuV gehört nicht zum selben Mandanten wie die Bilanz',
        );
      }
    }

    const bilanz = await this.wpRepository.findBilanz(
      args.bilanzId,
      bilanzMandantId,
    );
    if (!bilanz) {
      throw new NotFoundException('Bilanz nicht gefunden');
    }

    const results: BilanzPruefungsResultEntity[] = [];
    for (const regel of IDW_STANDARDREgeln) {
      const result = await this.evaluateAndPersist(regel, bilanz, args.guvId ?? null);
      results.push(result);
    }

    void this.auditService.record({
      userId: user.id,
      mandantId: bilanzMandantId,
      action: 'READ',
      entityType: 'BilanzPruefungsResult',
      entityId: args.bilanzId,
      newState: {
        bilanzId: args.bilanzId,
        guvId: args.guvId ?? null,
        anzahlRegeln: results.length,
        statusVerteilung: this.summarizeStatus(results),
      } as unknown as Prisma.JsonValue,
      ipAddress: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    return results;
  }

  /**
   * Lädt persistierte Ergebnisse (ohne Neuberechnung).
   */
  async getResults(
    bilanzId: string,
    user: AuthUser,
  ): Promise<BilanzPruefungsResultEntity[]> {
    const mandantId = await this.wpRepository.findBilanzMandantId(bilanzId);
    if (!mandantId) {
      throw new NotFoundException('Bilanz nicht gefunden');
    }
    this.assertMandantAccess(mandantId, user);
    return this.wpRepository.findPruefungsResultsByBilanz(bilanzId);
  }

  // ===========================================================================
  // Private helpers
  // ===========================================================================

  private async evaluateAndPersist(
    regel: IDWRegelDefinition,
    bilanz: NonNullable<Awaited<ReturnType<WPRepository['findBilanz']>>>,
    guvId: string | null,
  ): Promise<BilanzPruefungsResultEntity> {
    const { berechneterWert, meldung } = this.berechneRegel(regel, bilanz);
    const passed = evaluateOperator(
      berechneterWert,
      regel.konfiguration.vergleichsOperator,
      regel.konfiguration.schwellwert,
    );
    const status: RegelStatus = passed
      ? 'PASSED'
      : regel.schweregrad === 'KRITISCH'
        ? 'KRITISCH'
        : 'WARNUNG';

    return this.wpRepository.upsertPruefungsResult({
      bilanzId: bilanz.id,
      guvId,
      regelCode: regel.code,
      status,
      berechneterWert: new Prisma.Decimal(berechneterWert),
      schwellwert: new Prisma.Decimal(regel.konfiguration.schwellwert),
      meldung,
    });
  }

  /**
   * Berechnet den Wert, der gegen den Schwellwert geprüft wird.
   *
   * Achtung: kontonummer-Mehrdeutigkeit im HGB-Schema! "A." existiert
   * sowohl auf der Aktiva-Seite (Anlagevermögen) als auch auf der
   * Passiva-Seite (Eigenkapital). Daher wird nach `seite` gefiltert.
   */
  private berechneRegel(
    regel: IDWRegelDefinition,
    bilanz: NonNullable<Awaited<ReturnType<WPRepository['findBilanz']>>>,
  ): { berechneterWert: number; meldung: string } {
    const aktiva = bilanz.positionen.filter((p) => p.seite === 'AKTIVA');
    const passiva = bilanz.positionen.filter((p) => p.seite === 'PASSIVA');

    const aktivaSumme = sumBy(aktiva, (p) => Number(p.betragAktuell));

    const eigenkapital = sumBy(
      passiva.filter((p) => p.kontonummer === 'A.I.' || p.kontonummer === 'A.II.' ||
        p.kontonummer === 'A.III.' || p.kontonummer === 'A.IV.' || p.kontonummer === 'A.V.'),
      (p) => Number(p.betragAktuell),
    );

    const verbindlichkeiten = sumBy(
      passiva.filter((p) => p.kontonummer.startsWith('C.')),
      (p) => Number(p.betragAktuell),
    );

    const rueckstellungen = sumBy(
      passiva.filter((p) => p.kontonummer.startsWith('B.') && (p.kontonummer === 'B.1.' || p.kontonummer === 'B.2.' || p.kontonummer === 'B.3.')),
      (p) => Number(p.betragAktuell),
    );

    const langfristigeRueckstellungen = sumBy(
      passiva.filter((p) => LANGFRISTIGE_RUECKSTELLUNGEN_KONTONUMMERN.has(p.kontonummer)),
      (p) => Number(p.betragAktuell),
    );

    const anlagevermoegen = sumBy(
      aktiva.filter((p) => p.kontonummer === HGB_KONTONUMMER.ANLAGEVERMOEGEN_GRUPPE || isAnlagevermögenSubPosition(p.kontonummer)),
      (p) => Number(p.betragAktuell),
    );

    const fluessigeMittel = sumBy(
      aktiva.filter((p) => p.kontonummer === HGB_KONTONUMMER.FLUESSIGE_MITTEL),
      (p) => Number(p.betragAktuell),
    );

    switch (regel.code) {
      case 'IDW_EK_QUOTE': {
        const quote = aktivaSumme > 0 ? (eigenkapital / aktivaSumme) * 100 : 0;
        return {
          berechneterWert: roundTo(quote, 4),
          meldung: `Eigenkapitalquote ${quote.toFixed(2)}% (EK=${eigenkapital.toFixed(2)} EUR, Bilanzsumme=${aktivaSumme.toFixed(2)} EUR).`,
        };
      }

      case 'IDW_LIQUIDITAET_1': {
        return {
          berechneterWert: roundTo(fluessigeMittel, 4),
          meldung: `Flüssige Mittel (B.IV.) = ${fluessigeMittel.toFixed(2)} EUR.`,
        };
      }

      case 'IDW_VERSCHULDUNGSGRAD': {
        const grad =
          eigenkapital > 0
            ? ((verbindlichkeiten + rueckstellungen) / eigenkapital) * 100
            : Number.POSITIVE_INFINITY;
        const clamped = isFinite(grad) ? grad : 9999;
        return {
          berechneterWert: roundTo(clamped, 4),
          meldung: `Verschuldungsgrad ${clamped.toFixed(2)}% ((Verbindlichkeiten ${verbindlichkeiten.toFixed(2)} EUR + Rückstellungen ${rueckstellungen.toFixed(2)} EUR) / EK ${eigenkapital.toFixed(2)} EUR × 100).`,
        };
      }

      case 'IDW_ANLAGEVERMOEGEN_BIS_AKTIVA': {
        // Geprüft wird: (Aktiva-Summe - Anlagevermögen) >= 0
        const restAktiva = aktivaSumme - anlagevermoegen;
        return {
          berechneterWert: roundTo(restAktiva, 4),
          meldung: `Aktiva-Summe ${aktivaSumme.toFixed(2)} EUR – Anlagevermögen ${anlagevermoegen.toFixed(2)} EUR = ${restAktiva.toFixed(2)} EUR (muss ≥ 0 sein).`,
        };
      }

      case 'IDW_GOING_CONCERN': {
        const quote =
          aktivaSumme > 0
            ? ((eigenkapital + langfristigeRueckstellungen) / aktivaSumme) * 100
            : 0;
        return {
          berechneterWert: roundTo(quote, 4),
          meldung: `Going-Concern-Quote ${quote.toFixed(2)}% ((EK ${eigenkapital.toFixed(2)} EUR + langfr. Rückstellungen ${langfristigeRueckstellungen.toFixed(2)} EUR) / Aktiva ${aktivaSumme.toFixed(2)} EUR × 100).`,
        };
      }

      default: {
        this.logger.warn(`Unbekannte Regel: ${regel.code}`);
        return {
          berechneterWert: 0,
          meldung: `Regel ${regel.code} nicht implementiert.`,
        };
      }
    }
  }

  private assertMandantAccess(mandantId: string, user: AuthUser): void {
    if (user.globalRole === 'SYSTEM_ADMIN') return;
    const accessible = new Set(user.mandanten.map((m) => m.id));
    if (!accessible.has(mandantId)) {
      throw new ForbiddenException('Kein Zugriff auf diesen Mandanten');
    }
  }

  private summarizeStatus(
    results: BilanzPruefungsResultEntity[],
  ): { PASSED: number; WARNUNG: number; KRITISCH: number } {
    return {
      PASSED: results.filter((r) => r.status === 'PASSED').length,
      WARNUNG: results.filter((r) => r.status === 'WARNUNG').length,
      KRITISCH: results.filter((r) => r.status === 'KRITISCH').length,
    };
  }
}

function sumBy<T>(arr: T[], fn: (item: T) => number): number {
  return arr.reduce((acc, item) => acc + fn(item), 0);
}

function roundTo(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

/**
 * Heuristik: HGB-Positionen, die zum Anlagevermögen (Aktiva A.) gehören.
 * Erfasst sowohl die Obergruppe (A.) als auch alle Untergruppen
 * (A.I., A.I.1., …, A.III.6.).
 */
function isAnlagevermögenSubPosition(kontonummer: string): boolean {
  return /^A\.(I|II|III)\.?(\d+\.?)?$/.test(kontonummer);
}