/**
 * DATEV-Import-Service — Reverse-Mapping DATEV → HGB.
 *
 * Workflow:
 *   1. Parse CSV (EXTF_Buchungsstapel)
 *   2. Calculate Saldovortrag pro Sachkonto
 *   3. Apply Auto-Mapping (Reverse-Mapping-Tabellen)
 *   4. Apply User-Overrides (für unmapped Konten)
 *   5. Split Positionen: Bilanz vs. GuV
 *   6. Create/Update Bilanz + GuV
 *   7. Audit-Trail
 *
 * Konventionen:
 *   - Bilanz-relevante Konten (0001-3999): BILANZ_AKTIVA / BILANZ_PASSIVA
 *   - GuV-relevante Konten (4400-7999): ERLOES / MATERIAL / PERSONAL / ABSCHREIBUNG / SONSTIGE / STEUER / FINANZ
 *   - Wenn ein Konto in beide Welten fallen könnte, gewinnt die Bilanz-Zuordnung
 *     (typischerweise 1800 Bank, das sowohl in Bilanz-Buchungen als auch in
 *     GuV-Buchungen vorkommen kann).
 *
 * Upsert-Strategie:
 *   - Existiert bereits eine Bilanz/GuV für das GJ, wird überschrieben
 *     (sofern `overwriteExisting === true`).
 *   - Beim Überschreiben wird der bestehende Datensatz gelöscht und neu erstellt
 *     (kein Diff-basiertes Update).
 *
 * RBAC:
 *   - STEUERBERATER, KANZLEI_ADMIN dürfen importieren.
 *   - SYSTEM_ADMIN darf alles.
 */
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../../auth/types/auth-user.types';
import { AuditService } from '../../audit/services/audit.service';
import {
  BilanzRepository,
  type BilanzPositionInput,
} from '../../../common/repositories/bilanz.repository';
import {
  GuVRepository,
  type GuVKategorieLiteral,
  type GuVPositionInput,
} from '../../../common/repositories/guv.repository';
import { PrismaService } from '../../../prisma/prisma.service';
import { DatevCsvParser, type ParsedBuchungsstapel, type SaldovortragEntry } from '../utils/csv-parser';
import {
  getReverseMapping,
  getUnmappedKonten,
} from '../mappings/skr04-reverse-map';
import type {
  HgbKategorie,
  MappedPosition,
  ReverseMapping,
} from '../mappings/skr04-reverse.types';
import type { PreviewDatevImportDto } from '../dto/preview-datev-import.dto';
import type { ImportDatevDto } from '../dto/import-datev.dto';
import type {
  ImportPreviewDto,
  ImportResultDto,
} from '../dto/datev-import-response.dto';

export interface DatevImportContext {
  ip?: string | null;
  userAgent?: string | null;
}

/** Konfidenz-Schwelle, ab der Auto-Mapping ohne UI-Confirm angewendet wird. */
const AUTO_MAPPING_CONFIDENCE_THRESHOLD = 0.8;
/** Default-Confidence für manuell gemappte Konten. */
const USER_OVERRIDE_CONFIDENCE = 1.0;

/**
 * Mapping-Plan: Pro Sachkonto, wohin soll der Betrag in Bilanz/GuV?
 */
interface ImportPlan {
  /** Bilanz-Positionen (Aktiva + Passiva). */
  bilanzPositionen: BilanzPositionInput[];
  /** GuV-Positionen. */
  guvPositionen: GuVPositionInput[];
  /** Warnungen (z. B. unmapped Konten, doppelte Zuordnungen). */
  warnings: string[];
  /** Anzahl gemappter Positionen. */
  mappedCount: number;
  /** Anzahl übersprungener (unmapped, etc.). */
  skippedCount: number;
}

@Injectable()
export class DatevImportService {
  private readonly logger = new Logger(DatevImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bilanzRepository: BilanzRepository,
    private readonly guvRepository: GuVRepository,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Vorschau: parst CSV und liefert Mapping-Vorschlag.
   *
   * Schreibt KEINE Audit-Logs (Read-Operation).
   */
  async previewImport(
    dto: PreviewDatevImportDto,
    user: AuthUser,
  ): Promise<ImportPreviewDto> {
    this.assertMandantAccess(dto.mandantId, user);

    const parsed = this.parseCsv(dto.csvBase64);
    const saldovortrag = DatevCsvParser.calculateSaldovortrag(
      parsed.buchungsZeilen,
    );

    const usedKonten = [...saldovortrag.keys()];
    const unmapped = getUnmappedKonten(usedKonten);

    const mappedPositionen = this.buildMappedPositionen(
      saldovortrag,
      undefined,
    );

    return {
      parsed: parsed.header,
      saldovortrag: [...saldovortrag.values()],
      mappedPositionen,
      unmappedKonten: unmapped,
      warnings: parsed.warnings,
    };
  }

  /**
   * Tatsächlicher Import in die DB.
   *
   * Führt:
   *   1. CSV-Parsing
   *   2. Saldovortrag-Berechnung
   *   3. Reverse-Mapping (Auto + User-Override)
   *   4. Build Bilanz/GuV-Inputs
   *   5. Create/Update Bilanz + GuV (mit Overwrite-Logik)
   *   6. Audit-Log
   */
  async importFromDatev(
    dto: ImportDatevDto,
    user: AuthUser,
    context: DatevImportContext,
  ): Promise<ImportResultDto> {
    this.assertMandantAccess(dto.mandantId, user);

    const parsed = this.parseCsv(dto.csvBase64);
    const saldovortrag = DatevCsvParser.calculateSaldovortrag(
      parsed.buchungsZeilen,
    );

    // Build Import-Plan (Bilanz/GuV-Splits) mit User-Overrides
    const plan = this.buildImportPlan(
      saldovortrag,
      dto.userMappingOverrides ?? {},
    );

    // Mandant-Existenz prüfen
    const mandant = await this.prisma.mandant.findUnique({
      where: { id: dto.mandantId },
    });
    if (!mandant) throw new NotFoundException('Mandant nicht gefunden');

    // Bestehende Bilanz/GuV prüfen
    const existingBilanz = await this.bilanzRepository.findByMandantAndJahr(
      dto.mandantId,
      dto.geschaeftsjahr,
    );
    const existingGuV = await this.guvRepository.findByMandantAndJahr(
      dto.mandantId,
      dto.geschaeftsjahr,
    );

    const overwriteWarned =
      existingBilanz.length > 0 || existingGuV.length > 0;

    if (overwriteWarned && !dto.overwriteExisting) {
      throw new BadRequestException(
        `Für diesen Mandanten existieren bereits Bilanz/GuV für das Geschäftsjahr ${dto.geschaeftsjahr}. ` +
          `Setzen Sie "overwriteExisting": true, um zu überschreiben.`,
      );
    }

    // 5. Create/Update Bilanz
    let bilanzId: string | null = null;
    if (plan.bilanzPositionen.length > 0) {
      if (existingBilanz.length > 0 && existingBilanz[0]) {
        // Update bestehende Bilanz (nur DRAFT-Phase erlaubt)
        const existing = existingBilanz[0];
        if (existing.status !== 'DRAFT') {
          throw new BadRequestException(
            `Bestehende Bilanz für das Status ist bereits "${existing.status}". Überschreiben nur in DRAFT-Phase möglich.`,
          );
        }
        const updated = await this.bilanzRepository.updateWithPositionen(
          existing.id,
          dto.mandantId,
          {
            updatedById: user.id,
            positionen: plan.bilanzPositionen,
          },
        );
        bilanzId = updated.id;
      } else {
        const created = await this.bilanzRepository.createWithPositionen({
          mandantId: dto.mandantId,
          geschaeftsjahr: dto.geschaeftsjahr,
          status: 'DRAFT',
          createdById: user.id,
          positionen: plan.bilanzPositionen,
        });
        bilanzId = created.id;
      }
    }

    // 5b. Create/Update GuV
    let guvId: string | null = null;
    if (plan.guvPositionen.length > 0) {
      // Jahresergebnis berechnen
      const ergebnis = this.computeErgebnis(plan.guvPositionen);

      if (existingGuV.length > 0 && existingGuV[0]) {
        const existing = existingGuV[0];
        if (existing.status !== 'DRAFT') {
          throw new BadRequestException(
            `Bestehende GuV für das Status ist bereits "${existing.status}". Überschreiben nur in DRAFT-Phase möglich.`,
          );
        }
        const updated = await this.guvRepository.updateWithPositionen(
          existing.id,
          dto.mandantId,
          {
            ergebnis: ergebnis.toString(),
            bilanzId: bilanzId ?? undefined,
            updatedById: user.id,
            positionen: plan.guvPositionen,
          },
        );
        guvId = updated.id;
      } else {
        const created = await this.guvRepository.createWithPositionen({
          mandantId: dto.mandantId,
          geschaeftsjahr: dto.geschaeftsjahr,
          verfahren: 'GKV',
          status: 'DRAFT',
          bilanzId: bilanzId,
          ergebnis: ergebnis.toString(),
          createdById: user.id,
          positionen: plan.guvPositionen,
        });
        guvId = created.id;
      }
    }

    // 6. Audit-Trail
    void this.auditService.record({
      userId: user.id,
      kanzleiId: mandant.kanzleiId ?? null,
      mandantId: dto.mandantId,
      action: 'IMPORT',
      entityType: 'DatevImport',
      entityId: `${dto.geschaeftsjahr}-${dto.mandantId}`,
      newState: {
        csvSizeBytes: dto.csvBase64.length,
        buchungsZeilenCount: parsed.buchungsZeilen.length,
        saldovortragEntries: saldovortrag.size,
        bilanzPositionenCount: plan.bilanzPositionen.length,
        guvPositionenCount: plan.guvPositionen.length,
        mappedCount: plan.mappedCount,
        skippedCount: plan.skippedCount,
        unmappedKontenCount: getUnmappedKonten([...saldovortrag.keys()]).length,
        userOverridesCount: dto.userMappingOverrides
          ? Object.keys(dto.userMappingOverrides).length
          : 0,
        overwriteWarned,
        bilanzId,
        guvId,
        wirtschaftsjahrBeginn: parsed.header.wirtschaftsjahrBeginn.toISOString(),
        wirtschaftsjahrEnde: parsed.header.wirtschaftsjahrEnde.toISOString(),
        encoding: 'UTF-8',
      } as Prisma.JsonValue,
      ipAddress: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    return {
      importedCount: plan.mappedCount,
      skippedCount: plan.skippedCount,
      bilanzId,
      guvId,
      warnings: [...parsed.warnings, ...plan.warnings],
      overwriteWarned,
    };
  }

  // ===========================================================================
  // Private helpers
  // ===========================================================================

  /**
   * Parst Base64-kodiertes CSV und liefert ParsedBuchungsstapel.
   */
  private parseCsv(csvBase64: string): ParsedBuchungsstapel {
    let csvContent: string;
    try {
      csvContent = Buffer.from(csvBase64, 'base64').toString('utf-8');
    } catch {
      throw new BadRequestException('csvBase64 ist nicht Base64-kodiert');
    }
    if (csvContent.trim().length === 0) {
      throw new BadRequestException('CSV-Inhalt ist leer');
    }

    // UTF-8 BOM entfernen, falls vorhanden (trotz Spec eigentlich nicht erlaubt)
    if (csvContent.charCodeAt(0) === 0xfeff) {
      csvContent = csvContent.slice(1);
    }

    const parser = new DatevCsvParser();
    try {
      return parser.parseBuchungsstapel(csvContent);
    } catch (err) {
      throw new BadRequestException(
        `CSV-Parse-Fehler: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Baut eine Liste von MappedPosition-Einträgen für die Preview.
   */
  private buildMappedPositionen(
    saldovortrag: Map<string, SaldovortragEntry>,
    userOverrides: Record<string, string> | undefined,
  ): MappedPosition[] {
    const result: MappedPosition[] = [];
    for (const entry of saldovortrag.values()) {
      const autoMapping = getReverseMapping(entry.konto);
      const userOverride = userOverrides?.[entry.konto];

      let mapping: ReverseMapping | null = autoMapping;
      let autoMapped = false;
      let userOverrideApplied = false;
      let warning: string | undefined;

      if (userOverride) {
        // User-Override anwenden
        const overrideMapping = this.buildOverrideMapping(
          entry.konto,
          userOverride,
        );
        if (overrideMapping) {
          mapping = overrideMapping;
          userOverrideApplied = true;
        } else {
          warning = `User-Override "${userOverride}" konnte nicht als gültige HGB-Position interpretiert werden`;
        }
      } else if (autoMapping && autoMapping.confidence >= AUTO_MAPPING_CONFIDENCE_THRESHOLD) {
        autoMapped = true;
      } else if (!autoMapping) {
        warning = `DATEV-Konto "${entry.konto}" hat kein Auto-Mapping — manuelle Zuordnung erforderlich`;
      } else {
        warning = `Auto-Mapping für "${entry.konto}" hat niedrige Confidence (${autoMapping.confidence.toFixed(2)}) — manuelle Bestätigung empfohlen`;
      }

      result.push({
        datevKonto: entry.konto,
        saldo: entry.saldo,
        buchungsCount: entry.buchungsCount,
        mapping,
        autoMapped,
        userOverride: userOverrideApplied,
        warning,
      });
    }
    // Sortiere nach Kontonummer
    result.sort((a, b) => a.datevKonto.localeCompare(b.datevKonto));
    return result;
  }

  /**
   * Baut ein Reverse-Mapping aus einem User-Override (datevKonto → hgbPosition).
   *
   * Heuristik: hgbPosition ist die HGB-Kontonummer (z. B. "1.", "5a.", "B.IV.").
   * Wir leiten kategorie/side aus dem Format ab.
   */
  private buildOverrideMapping(
    datevKonto: string,
    hgbPosition: string,
  ): ReverseMapping | null {
    // HGB-Position → Kategorie + Side
    const isBilanzAktiva =
      hgbPosition.startsWith('A.') ||
      hgbPosition.startsWith('B.') ||
      hgbPosition.startsWith('C.');
    const isBilanzPassiva =
      hgbPosition.startsWith('PA') ||
      hgbPosition.startsWith('PB') ||
      hgbPosition.startsWith('PC') ||
      hgbPosition.startsWith('PD') ||
      hgbPosition.startsWith('PE') ||
      // HGB-Passiva verwendet dieselben A./B./C. wie Aktiva — daher Side über
      // HGB-Bilanz-Schema ableiten, falls möglich.
      hgbPosition === 'A.I.' ||
      hgbPosition === 'A.II.' ||
      hgbPosition === 'A.III.' ||
      hgbPosition === 'A.IV.' ||
      hgbPosition === 'A.V.';

    let kategorie: HgbKategorie;
    let side: 'AKTIVA' | 'PASSIVA' | 'NEUTRAL';

    if (isBilanzPassiva && !isBilanzAktiva) {
      kategorie = 'BILANZ_PASSIVA';
      side = 'PASSIVA';
    } else if (hgbPosition.startsWith('B.IV.') || hgbPosition === 'B.IV.') {
      kategorie = 'BILANZ_AKTIVA';
      side = 'AKTIVA';
    } else if (isBilanzAktiva) {
      kategorie = 'BILANZ_AKTIVA';
      side = 'AKTIVA';
    } else {
      // GuV-Position
      kategorie = this.guessGuVKategorie(hgbPosition);
      side = 'NEUTRAL';
    }

    return {
      datevKonto,
      datevKontoName: `Konto ${datevKonto}`,
      hgbPosition,
      hgbKontoNr: hgbPosition,
      kategorie,
      side,
      isPflicht: false,
      confidence: USER_OVERRIDE_CONFIDENCE,
      notes: 'Manuell durch Kanzlei zugeordnet',
    };
  }

  /**
   * Heuristik für GuV-Kategorie basierend auf HGB-Position.
   */
  private guessGuVKategorie(hgbPosition: string): HgbKategorie {
    if (hgbPosition === '1.') return 'ERLOES';
    if (hgbPosition.startsWith('5')) return 'MATERIAL';
    if (hgbPosition.startsWith('6')) return 'PERSONAL';
    if (hgbPosition.startsWith('7')) return 'ABSCHREIBUNG';
    if (hgbPosition.startsWith('8')) return 'SONSTIGE_AUFWAND';
    if (hgbPosition === '9.' || hgbPosition === '10.' || hgbPosition === '11.' || hgbPosition === '13.') return 'FINANZ';
    if (hgbPosition === '14.' || hgbPosition === '15.' || hgbPosition === '16.' || hgbPosition === '17.') return 'STEUER';
    if (hgbPosition === '4.') return 'SONSTIGE_ERTRAG';
    return 'SONSTIGE_AUFWAND';
  }

  /**
   * Baut den Import-Plan: Splittet Positionen in Bilanz und GuV.
   */
  private buildImportPlan(
    saldovortrag: Map<string, SaldovortragEntry>,
    userOverrides: Record<string, string>,
  ): ImportPlan {
    const bilanzPositionen: BilanzPositionInput[] = [];
    const guvPositionen: GuVPositionInput[] = [];
    const warnings: string[] = [];
    let mappedCount = 0;
    let skippedCount = 0;

    let aktivaReihenfolge = 1;
    let passivaReihenfolge = 1;
    let guvReihenfolge = 1;

    for (const entry of saldovortrag.values()) {
      // Skip Null-Salden (kein Buchungseffekt)
      if (Math.abs(entry.saldo) < 0.005) {
        skippedCount += 1;
        continue;
      }

      const autoMapping = getReverseMapping(entry.konto);
      const userOverride = userOverrides[entry.konto];

      let mapping: ReverseMapping | null = null;
      if (userOverride) {
        mapping = this.buildOverrideMapping(entry.konto, userOverride);
      } else if (autoMapping && autoMapping.confidence >= AUTO_MAPPING_CONFIDENCE_THRESHOLD) {
        mapping = autoMapping;
      }

      if (!mapping) {
        skippedCount += 1;
        if (!userOverride && !autoMapping) {
          warnings.push(
            `DATEV-Konto "${entry.konto}" wurde übersprungen (kein Mapping)`,
          );
        }
        continue;
      }

      // Saldo als positiven Bilanz-/GuV-Betrag übernehmen
      const betrag = Math.abs(entry.saldo);

      if (mapping.kategorie === 'BILANZ_AKTIVA' || mapping.kategorie === 'BILANZ_PASSIVA') {
        const seite: 'AKTIVA' | 'PASSIVA' =
          mapping.kategorie === 'BILANZ_AKTIVA' ? 'AKTIVA' : 'PASSIVA';
        bilanzPositionen.push({
          seite,
          kontonummer: mapping.hgbPosition,
          bezeichnung: mapping.hgbKontoNr,
          betragAktuell: betrag,
          reihenfolge: seite === 'AKTIVA' ? aktivaReihenfolge++ : passivaReihenfolge++,
        });
        mappedCount += 1;
      } else {
        // GuV-Position
        const kategorie = this.toGuVKategorie(mapping.kategorie);
        guvPositionen.push({
          kontonummer: mapping.hgbPosition,
          bezeichnung: mapping.hgbKontoNr,
          kategorie,
          betragAktuell: betrag,
          reihenfolge: guvReihenfolge++,
        });
        mappedCount += 1;
      }
    }

    return {
      bilanzPositionen,
      guvPositionen,
      warnings,
      mappedCount,
      skippedCount,
    };
  }

  /**
   * Konvertiert HgbKategorie → GuVKategorieLiteral (für Repository-Input).
   */
  private toGuVKategorie(kategorie: HgbKategorie): GuVKategorieLiteral {
    switch (kategorie) {
      case 'ERLOES':
      case 'SONSTIGE_ERTRAG':
        return 'ERLOES';
      case 'MATERIAL':
        return 'MATERIAL';
      case 'PERSONAL':
        return 'PERSONAL';
      case 'ABSCHREIBUNG':
        return 'ABSCHREIBUNG';
      case 'SONSTIGE_AUFWAND':
        return 'SONSTIGE';
      case 'STEUER':
        return 'STEUER';
      case 'FINANZ':
        return 'FINANZ';
      default:
        return 'SONSTIGE';
    }
  }

  /**
   * Berechnet das Jahresergebnis aus den GuV-Positionen.
   *
   * GuV-Konvention:
   *   - ERLOES: positiver Beitrag zum Ergebnis
   *   - Alle anderen: Aufwand → negativer Beitrag
   */
  private computeErgebnis(positionen: GuVPositionInput[]): number {
    let ergebnis = 0;
    for (const pos of positionen) {
      const betrag = Number(pos.betragAktuell);
      if (pos.kategorie === 'ERLOES') {
        ergebnis += betrag;
      } else {
        ergebnis -= betrag;
      }
    }
    return Math.round(ergebnis * 100) / 100;
  }

  /**
   * Erzwingt Mandant-Trennung. SYSTEM_ADMIN umgeht die Prüfung.
   */
  private assertMandantAccess(mandantId: string, user: AuthUser): void {
    if (user.globalRole === 'SYSTEM_ADMIN') return;
    const accessibleMandantIds = user.mandanten.map((m) => m.id);
    if (!accessibleMandantIds.includes(mandantId)) {
      throw new ForbiddenException('Kein Zugriff auf diesen Mandanten');
    }
  }
}