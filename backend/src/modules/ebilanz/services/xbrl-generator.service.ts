import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { create } from 'xmlbuilder2';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/services/audit.service';
import { BilanzRepository } from '../../../common/repositories/bilanz.repository';
import { GuVRepository } from '../../../common/repositories/guv.repository';
import { AnhangRepository } from '../../../common/repositories/anhang.repository';
import type { AuthUser } from '../../auth/types/auth-user.types';
import {
  HGB_KT_V6_GENINFO,
  HGB_KT_V6_AKTIVA_PFLICHT_CODES,
  HGB_KT_V6_PASSIVA_PFLICHT_CODES,
  HGB_KT_V6_GUV_GKV_PFLICHT_CODES,
  HGB_KT_V6_GENINFO_PFLICHT_CODES,
  type TaxonomyConcept,
} from '../mappings/hgb-kt-v6';
import {
  mapKontonummerToConcept,
  getTotalConcept,
} from '../mappings/mapping-engine';
import type { EbilanzPreparerDto } from '../dto/ebilanz-preparer.dto';
import type { EbilanzMetadata, GenerateEbilanzResponse } from '../dto/validation-result.dto';
import {
  DECIMALS_MONETARY,
  TAXONOMY_NAMESPACE_URIS,
  TAXONOMY_VERSION,
  UNIT_REF_EUR,
} from '../mappings/hgb-kt-v6.types';

export interface XbrlGeneratorContext {
  ip?: string | null;
  userAgent?: string | null;
}

interface GeneratorInput {
  bilanzId: string;
  guvId: string;
  anhangId: string;
  mandantId: string;
  preparer?: EbilanzPreparerDto;
}

const SALDO_TOLERANZ_CENTS = 1; // 0.01 EUR Toleranz

/**
 * Service für die Generierung von E-Bilanz-XBRL-Dokumenten.
 *
 * Wandelt Bilanz + GuV + Anhang + Mandantenstammdaten in eine
 * XBRL-Instance nach amtlicher HGB-Kerntaxonomie v6 (2025-04-01).
 *
 * Wichtige Eigenschaften:
 *   - UTF-8 encoded, kein BOM, kein Whitespace-Aufblähung
 *   - Aufwände werden POSITIV gespeichert (sign-convention)
 *   - Context-Refs: V_D (Duration) für GuV, V_Y (Instant) für Bilanz
 *   - Validation: Aktiva == Passiva, Pflicht-Felder vorhanden
 *   - Audit-Trail via AuditService.record
 *   - RBAC: nur Mandant-Owner (außer SYSTEM_ADMIN)
 */
@Injectable()
export class XbrlGeneratorService {
  private readonly logger = new Logger(XbrlGeneratorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bilanzRepository: BilanzRepository,
    private readonly guvRepository: GuVRepository,
    private readonly anhangRepository: AnhangRepository,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Hauptmethode: Generiert eine E-Bilanz-XBRL-Datei.
   *
   * Ablauf:
   *   1. assertMandantAccess
   *   2. Bilanz + GuV + Anhang + Mandant laden (mandant-gefiltert)
   *   3. Mapping Bilanz/GuV-Positionen → Taxonomie-Codes
   *   4. XML-Generierung via xmlbuilder2
   *   5. Strukturelle Validation
   *   6. AuditLog
   *   7. Return Buffer + Metadata
   */
  async generateEbilanzXbrl(
    args: GeneratorInput,
    user: AuthUser,
    context: XbrlGeneratorContext,
  ): Promise<GenerateEbilanzResponse> {
    this.assertMandantAccess(args.mandantId, user);

    // 2. Bilanz / GuV / Anhang / Mandant laden.
    const bilanz = await this.bilanzRepository.findWithPositionen(
      args.bilanzId,
      args.mandantId,
    );
    if (!bilanz) throw new NotFoundException('Bilanz nicht gefunden');

    const guv = await this.guvRepository.findWithPositionen(args.guvId, args.mandantId);
    if (!guv) throw new NotFoundException('GuV nicht gefunden');

    const anhang = await this.anhangRepository.findWithAbschnitte(
      args.anhangId,
      args.mandantId,
    );
    if (!anhang) throw new NotFoundException('Anhang nicht gefunden');

    const mandant = await this.prisma.mandant.findUnique({
      where: { id: args.mandantId },
    });
    if (!mandant) throw new NotFoundException('Mandant nicht gefunden');

    // Konsistenz-Check: alle drei müssen aus demselben Geschäftsjahr sein.
    const years = new Set([bilanz.geschaeftsjahr, guv.geschaeftsjahr, anhang.geschaeftsjahr]);
    if (years.size !== 1) {
      throw new BadRequestException(
        `Bilanz, GuV und Anhang müssen aus demselben Geschäftsjahr stammen (gefunden: ${[...years].join(', ')})`,
      );
    }

    // 3-5. XML aufbauen.
    const fiscalYearBegin = `${bilanz.geschaeftsjahr}-01-01`;
    const fiscalYearEnd = `${bilanz.geschaeftsjahr}-12-31`;

    const bilanzMappings = this.mapBilanzPositionen(bilanz.positionen);
    // verfahren MUSS mitgegeben werden: GKV und UKV teilen sich
    // 11 Concept-Codes (Bugfix 2026-10-06).
    const guvMappings = this.mapGuVPositionen(guv.positionen, guv.verfahren);
    const totals = this.computeTotalsFromBilanz(bilanz);
    const netIncome = Number(guv.ergebnis?.toString() ?? 0);

    const xbrlXml = this.buildXbrlXml({
      mandant,
      bilanz,
      bilanzMappings,
      guvMappings,
      anhang,
      preparer: args.preparer ?? null,
      fiscalYearBegin,
      fiscalYearEnd,
      verfahren: guv.verfahren,
      aktivaSumme: totals.aktivaSumme,
      passivaSumme: totals.passivaSumme,
      netIncome,
    });

    // Strukturelle Validation: well-formed + Pflicht-Felder.
    const validation = this.structureValidate(xbrlXml, {
      mandant,
      fiscalYearBegin,
      fiscalYearEnd,
      bilanzMappings,
      guvMappings,
    });

    if (!validation.valid) {
      throw new BadRequestException({
        message: 'E-Bilanz-Validation fehlgeschlagen',
        errors: validation.errors,
        warnings: validation.warnings,
      });
    }

    const xbrlBytes = Buffer.from(xbrlXml, 'utf-8');

    // 6. Audit-Log.
    const erloeseSumme = this.sumErloese(guvMappings);
    const aufwandSumme = this.sumAufwand(guvMappings);
    void this.auditService.record({
      userId: user.id,
      mandantId: args.mandantId,
      action: 'EXPORT',
      entityType: 'EbilanzXbrl',
      entityId: `${args.bilanzId}-${args.guvId}-${args.anhangId}`,
      newState: {
        bilanzId: args.bilanzId,
        guvId: args.guvId,
        anhangId: args.anhangId,
        xbrlSizeBytes: xbrlBytes.length,
        taxonomieVersion: TAXONOMY_VERSION,
        geschaeftsjahr: bilanz.geschaeftsjahr,
        aktivaSumme: totals.aktivaSumme,
        passivaSumme: totals.passivaSumme,
        saldostimmt: Math.abs(totals.aktivaSumme - totals.passivaSumme) < SALDO_TOLERANZ_CENTS,
        netIncome,
        erloeseSumme,
        aufwandSumme,
        validationErrors: validation.errors.length,
        validationWarnings: validation.warnings.length,
      } as Prisma.JsonValue,
      ipAddress: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    const metadata: EbilanzMetadata = {
      taxonomieVersion: TAXONOMY_VERSION,
      aktivaSumme: totals.aktivaSumme,
      passivaSumme: totals.passivaSumme,
      saldostimmt: Math.abs(totals.aktivaSumme - totals.passivaSumme) < SALDO_TOLERANZ_CENTS,
      netIncome,
      erloeseSumme,
      aufwandSumme,
      sizeBytes: xbrlBytes.length,
      anzahlFacts: bilanzMappings.length + guvMappings.length + 1,
      geschaeftsjahr: bilanz.geschaeftsjahr,
      firmenname: mandant.firmenname,
    };

    return {
      xbrlBase64: xbrlBytes.toString('base64'),
      metadata,
    };
  }

  /**
   * Berechnet ein Preview-Mapping (welches HGB-Konto → welches Concept).
   *
   * Wird vom Preview-Endpoint verwendet.
   */
  async previewMapping(args: {
    bilanzId: string;
    guvId: string;
    anhangId: string;
    mandantId: string;
    user: AuthUser;
  }) {
    this.assertMandantAccess(args.mandantId, args.user);

    const bilanz = await this.bilanzRepository.findWithPositionen(
      args.bilanzId,
      args.mandantId,
    );
    if (!bilanz) throw new NotFoundException('Bilanz nicht gefunden');

    const guv = await this.guvRepository.findWithPositionen(args.guvId, args.mandantId);
    if (!guv) throw new NotFoundException('GuV nicht gefunden');

    const anhang = await this.anhangRepository.findWithAbschnitte(
      args.anhangId,
      args.mandantId,
    );
    if (!anhang) throw new NotFoundException('Anhang nicht gefunden');

    const bilanzAktiva = this.mapBilanzPositionen(bilanz.positionen);
    const guvPos = this.mapGuVPositionen(guv.positionen, guv.verfahren);

    const bilanzAktivaMappings = bilanzAktiva
      .filter((m) => m.concept.conceptType === 'Aktiva' && m.source.seite === 'AKTIVA')
      .map((m) => this.toPreviewEntry(m));
    const bilanzPassivaMappings = bilanzAktiva
      .filter((m) => m.concept.conceptType === 'Passiva')
      .map((m) => this.toPreviewEntry(m));

    return {
      bilanzAktivaMappings,
      bilanzPassivaMappings,
      guvMappings: guvPos.map((m) => this.toPreviewEntry(m)),
      anhangMappings: anhang.abschnitte.map((a) => ({
        source: {
          kontonummer: a.titel,
          bezeichnung: a.inhalt.slice(0, 80),
          betragAktuell: 0,
        },
        target: {
          code: 'genInfo.notes',
          namespace: 'genInfo',
          labelDe: a.titel,
          calculationSign: '+1' as const,
        },
      })),
      unMapped: [],
    };
  }

  // ===========================================================================
  // Private helpers
  // ===========================================================================

  private assertMandantAccess(mandantId: string, user: AuthUser): void {
    if (user.globalRole === 'SYSTEM_ADMIN') return;
    const accessibleMandantIds = user.mandanten.map((m) => m.id);
    if (!accessibleMandantIds.includes(mandantId)) {
      throw new ForbiddenException('Kein Zugriff auf diesen Mandanten');
    }
  }

  private mapBilanzPositionen(positionen: Array<{
    seite: string;
    kontonummer: string;
    bezeichnung: string;
    betragAktuell: { toString(): string } | string | number;
  }>): Array<{
    source: {
      seite: 'AKTIVA' | 'PASSIVA';
      kontonummer: string;
      bezeichnung: string;
      betragAktuell: number;
    };
    concept: TaxonomyConcept;
  }> {
    const result: Array<{
      source: {
        seite: 'AKTIVA' | 'PASSIVA';
        kontonummer: string;
        bezeichnung: string;
        betragAktuell: number;
      };
      concept: TaxonomyConcept;
    }> = [];

    for (const pos of positionen) {
      if (pos.seite !== 'AKTIVA' && pos.seite !== 'PASSIVA') continue;
      const concept = mapKontonummerToConcept(pos.kontonummer);
      if (!concept) continue;
      // Nur Konzepte passend zur Seite.
      if (pos.seite === 'AKTIVA' && concept.conceptType !== 'Aktiva') continue;
      if (pos.seite === 'PASSIVA' && concept.conceptType !== 'Passiva') continue;
      result.push({
        source: {
          seite: pos.seite,
          kontonummer: pos.kontonummer,
          bezeichnung: pos.bezeichnung,
          betragAktuell: Number(pos.betragAktuell.toString()),
        },
        concept,
      });
    }

    return result;
  }

  private mapGuVPositionen(
    positionen: Array<{
      kontonummer: string;
      bezeichnung: string;
      betragAktuell: { toString(): string } | string | number;
    }>,
    // `string` statt der Union: `GuVEntity.verfahren` ist im Prisma-Modell
    // ein String. Die Normalisierung (`GKV` als Default) passiert in
    // `guvKonzepte()`.
    verfahren?: string,
  ): Array<{
    source: { kontonummer: string; bezeichnung: string; betragAktuell: number };
    concept: TaxonomyConcept;
  }> {
    const result: Array<{
      source: { kontonummer: string; bezeichnung: string; betragAktuell: number };
      concept: TaxonomyConcept;
    }> = [];
    for (const pos of positionen) {
      const concept = mapKontonummerToConcept(pos.kontonummer, verfahren);
      if (!concept) continue;
      // Nur Erloes / Aufwand / Steuer / Ergebnis-Konzepte.
      if (
        concept.conceptType !== 'Erloes' &&
        concept.conceptType !== 'Aufwand' &&
        concept.conceptType !== 'Steuer' &&
        concept.conceptType !== 'Ergebnis'
      ) {
        continue;
      }
      result.push({
        source: {
          kontonummer: pos.kontonummer,
          bezeichnung: pos.bezeichnung,
          betragAktuell: Number(pos.betragAktuell.toString()),
        },
        concept,
      });
    }
    return result;
  }

  /**
   * Berechnet Aktiva/Passiva-Summen aus dem Mapping-Resultat.
   *
   * Wir summieren die `betragAktuell`-Werte aller gemappten Bilanz-
   * Positionen (Total-Konzepte `bs.ass` / `bs.eqLiab` werden übersprungen).
   *
   * Falls keine Aktiva- oder Passiva-Position gemappt wurde, wird die
   * Original-Bilanz-Summe verwendet (`bilanz.positionen`), um
   * Mapping-Lücken zu kompensieren.
   */
  private computeTotalsFromBilanz(bilanz: {
    positionen: Array<{
      seite: string;
      betragAktuell: { toString(): string } | string | number;
    }>;
  }): { aktivaSumme: number; passivaSumme: number } {
    let aktivaSumme = 0;
    let passivaSumme = 0;
    for (const p of bilanz.positionen) {
      const betrag = Number(p.betragAktuell.toString());
      if (p.seite === 'AKTIVA') aktivaSumme += betrag;
      else if (p.seite === 'PASSIVA') passivaSumme += betrag;
    }
    return {
      aktivaSumme: Number(aktivaSumme.toFixed(2)),
      passivaSumme: Number(passivaSumme.toFixed(2)),
    };
  }

  private sumErloese(
    guvMappings: Array<{
      source: { betragAktuell: number };
      concept: TaxonomyConcept;
    }>,
  ): number {
    let sum = 0;
    for (const m of guvMappings) {
      if (m.concept.conceptType === 'Erloes' || m.concept.conceptType === 'Ergebnis') {
        sum += m.source.betragAktuell;
      }
    }
    return Number(sum.toFixed(2));
  }

  private sumAufwand(
    guvMappings: Array<{
      source: { betragAktuell: number };
      concept: TaxonomyConcept;
    }>,
  ): number {
    let sum = 0;
    for (const m of guvMappings) {
      if (m.concept.conceptType === 'Aufwand' || m.concept.conceptType === 'Steuer') {
        sum += m.source.betragAktuell;
      }
    }
    return Number(sum.toFixed(2));
  }

  private toPreviewEntry(m: {
    source: { kontonummer: string; bezeichnung: string; betragAktuell: number; seite?: string };
    concept: TaxonomyConcept;
  }) {
    return {
      source: {
        kontonummer: m.source.kontonummer,
        bezeichnung: m.source.bezeichnung,
        betragAktuell: m.source.betragAktuell,
      },
      target: {
        code: m.concept.code,
        namespace: m.concept.namespace,
        labelDe: m.concept.labelDe,
        calculationSign: m.concept.calculationSign,
      },
    };
  }

  /**
   * Baut die XBRL-XML-Instanz mit xmlbuilder2.
   *
   * Struktur:
   *   xbrli:xbrl
   *   ├── link:schemaRef
   *   ├── xbrli:context (V_D, V_Y)
   *   ├── xbrli:unit (EUR)
   *   └── Facts (genInfo.*, bs.*, pl.*, genInfo.notes.*)
   */
  private buildXbrlXml(args: {
    mandant: {
      id: string;
      firmenname: string;
      rechtsform: string;
      handelsregister: string | null;
      steuernummer?: string | null;
    };
    bilanz: { geschaeftsjahr: number };
    bilanzMappings: Array<{
      source: { seite: 'AKTIVA' | 'PASSIVA'; kontonummer: string; bezeichnung: string; betragAktuell: number };
      concept: TaxonomyConcept;
    }>;
    guvMappings: Array<{
      source: { kontonummer: string; bezeichnung: string; betragAktuell: number };
      concept: TaxonomyConcept;
    }>;
    anhang: { bilanzierungsMethoden: string | null; bewertungsMethoden: string | null; sonstigePflichtangaben: string | null };
    preparer: EbilanzPreparerDto | null;
    fiscalYearBegin: string;
    fiscalYearEnd: string;
    verfahren: string;
    aktivaSumme: number;
    passivaSumme: number;
    netIncome: number;
  }): string {
    const root = create({ version: '1.0', encoding: 'UTF-8' })
      .ele('xbrli:xbrl', {
        'xmlns:xbrli': 'http://www.xbrl.org/2003/instance',
        'xmlns:xbrldi': 'http://xbrl.org/2003/xbrldi-2003-12-31',
        'xmlns:link': 'http://www.xbrl.org/2003/linkbase',
        'xmlns:iso4217': 'http://www.xbrl.org/2003/iso4217',
        'xmlns:bs': TAXONOMY_NAMESPACE_URIS.bs,
        'xmlns:pl': TAXONOMY_NAMESPACE_URIS.pl,
        'xmlns:genInfo': TAXONOMY_NAMESPACE_URIS.genInfo,
        'xmlns:de-gaap-ci': TAXONOMY_NAMESPACE_URIS['de-gaap-ci'],
      });

    // link:schemaRef (Schema-Verweis auf die HGB-KT)
    root.ele('link:schemaRef')
      .att('xlink:type', 'simple')
      .att('xlink:href', `http://www.xbrl.de/taxonomies/${TAXONOMY_VERSION}/bs.xsd`)
      .up();

    // Context: V_D (Duration, fiscalYearBegin → fiscalYearEnd)
    root.ele('xbrli:context', { id: 'V_D' })
      .ele('xbrli:entity')
      .ele('xbrli:identifier', { scheme: 'http://www.xbrl.de/taxonomies/de-gaap-ci' })
      .txt(`DE-${args.mandant.id.slice(0, 8).toUpperCase()}`)
      .up()
      .up()
      .ele('xbrli:period')
      .ele('xbrli:startDate')
      .txt(args.fiscalYearBegin)
      .up()
      .ele('xbrli:endDate')
      .txt(args.fiscalYearEnd)
      .up()
      .up()
      .up();

    // Context: V_Y (Instant, fiscalYearEnd)
    root.ele('xbrli:context', { id: 'V_Y' })
      .ele('xbrli:entity')
      .ele('xbrli:identifier', { scheme: 'http://www.xbrl.de/taxonomies/de-gaap-ci' })
      .txt(`DE-${args.mandant.id.slice(0, 8).toUpperCase()}`)
      .up()
      .up()
      .ele('xbrli:period')
      .ele('xbrli:instant')
      .txt(args.fiscalYearEnd)
      .up()
      .up()
      .up();

    // Unit: EUR
    root.ele('xbrli:unit', { id: UNIT_REF_EUR })
      .ele('xbrli:measure')
      .txt('iso4217:EUR')
      .up()
      .up();

    // --- GenInfo-Felder ---
    const writeGenInfo = (concept: TaxonomyConcept, value: string) => {
      root.ele(concept.code, {
        contextRef: concept.contextRef,
      }).txt(value).up();
    };

    writeGenInfo(
      HGB_KT_V6_GENINFO.find((c) => c.code === 'genInfo.companyInfo.companyName')!,
      this.escapeXml(args.mandant.firmenname),
    );
    writeGenInfo(
      HGB_KT_V6_GENINFO.find((c) => c.code === 'genInfo.companyInfo.legalForm')!,
      this.escapeXml(args.mandant.rechtsform),
    );
    // Steuernummer des Finanzamts (genInfo.companyInfo.taxNumber).
    //
    // Bis 2026-10-01 stand hier:
    //   `args.mandant.handelsregister ?? \`MANDANT-${id.slice(0, 8)}\``
    // Das war doppelt falsch: die Handelsregisternummer ("HRB 123456") ist
    // KEINE Steuernummer, und der Fallback "MANDANT-<id>" ist frei erfunden.
    // Beides landete als taxNumber im Formular gegenüber dem Finanzamt.
    //
    // Jetzt: nur die echte Steuernummer. Fehlt sie, bricht die Generierung ab —
    // ein fehlendes Pflichtfeld wird gemeldet, nicht ausgefüllt.
    if (!args.mandant.steuernummer || args.mandant.steuernummer.trim() === '') {
      throw new BadRequestException(
        `Steuernummer für "${args.mandant.firmenname}" fehlt. ` +
          'Sie ist Pflicht im E-Bilanz-Formular (genInfo.companyInfo.taxNumber) und ' +
          'kann nicht aus der Handelsregisternummer abgeleitet werden. ' +
          'Bitte im Mandanten-Stammblatt nachtragen.',
      );
    }
    writeGenInfo(
      HGB_KT_V6_GENINFO.find((c) => c.code === 'genInfo.companyInfo.taxNumber')!,
      this.escapeXml(args.mandant.steuernummer.trim()),
    );
    if (args.mandant.handelsregister) {
      writeGenInfo(
        HGB_KT_V6_GENINFO.find((c) => c.code === 'genInfo.companyInfo.commercialRegister')!,
        this.escapeXml(args.mandant.handelsregister),
      );
    }
    writeGenInfo(
      HGB_KT_V6_GENINFO.find((c) => c.code === 'genInfo.reporting.fiscalYearBegin')!,
      args.fiscalYearBegin,
    );
    writeGenInfo(
      HGB_KT_V6_GENINFO.find((c) => c.code === 'genInfo.reporting.fiscalYearEnd')!,
      args.fiscalYearEnd,
    );
    writeGenInfo(
      HGB_KT_V6_GENINFO.find((c) => c.code === 'genInfo.reporting.periodStart')!,
      args.fiscalYearBegin,
    );
    writeGenInfo(
      HGB_KT_V6_GENINFO.find((c) => c.code === 'genInfo.reporting.periodEnd')!,
      args.fiscalYearEnd,
    );
    if (args.preparer) {
      writeGenInfo(
        HGB_KT_V6_GENINFO.find((c) => c.code === 'genInfo.preparer.name')!,
        this.escapeXml(args.preparer.name),
      );
      if (args.preparer.beraternummer) {
        writeGenInfo(
          HGB_KT_V6_GENINFO.find((c) => c.code === 'genInfo.preparer.memberNumber')!,
          this.escapeXml(args.preparer.beraternummer),
        );
      }
      if (args.preparer.mandantennummer) {
        writeGenInfo(
          HGB_KT_V6_GENINFO.find((c) => c.code === 'genInfo.preparer.clientNumber')!,
          this.escapeXml(args.preparer.mandantennummer),
        );
      }
      if (args.preparer.telefon) {
        writeGenInfo(
          HGB_KT_V6_GENINFO.find((c) => c.code === 'genInfo.preparer.telefon')!,
          this.escapeXml(args.preparer.telefon),
        );
      }
      if (args.preparer.email) {
        writeGenInfo(
          HGB_KT_V6_GENINFO.find((c) => c.code === 'genInfo.preparer.email')!,
          this.escapeXml(args.preparer.email),
        );
      }
    }

    // --- Bilanz Aktiva (ContextRef V_Y) ---
    for (const m of args.bilanzMappings) {
      if (m.concept.conceptType !== 'Aktiva' || m.source.seite !== 'AKTIVA') continue;
      if (m.concept.code === 'bs.ass') continue;
      root.ele(m.concept.code, {
        contextRef: m.concept.contextRef,
        decimals: DECIMALS_MONETARY,
        unit: UNIT_REF_EUR,
      }).txt(this.formatDecimal(m.source.betragAktuell)).up();
    }
    // Total Aktiva
    const aktivaTotal = getTotalConcept('ass');
    if (aktivaTotal) {
      root.ele(aktivaTotal.code, {
        contextRef: aktivaTotal.contextRef,
        decimals: DECIMALS_MONETARY,
        unit: UNIT_REF_EUR,
        'total': 'true',
      }).txt(this.formatDecimal(args.aktivaSumme)).up();
    }

    // --- Bilanz Passiva (ContextRef V_Y) ---
    for (const m of args.bilanzMappings) {
      if (m.concept.conceptType !== 'Passiva' || m.source.seite !== 'PASSIVA') continue;
      if (m.concept.code === 'bs.eqLiab') continue;
      root.ele(m.concept.code, {
        contextRef: m.concept.contextRef,
        decimals: DECIMALS_MONETARY,
        unit: UNIT_REF_EUR,
      }).txt(this.formatDecimal(m.source.betragAktuell)).up();
    }
    const passivaTotal = getTotalConcept('eqLiab');
    if (passivaTotal) {
      root.ele(passivaTotal.code, {
        contextRef: passivaTotal.contextRef,
        decimals: DECIMALS_MONETARY,
        unit: UNIT_REF_EUR,
        'total': 'true',
      }).txt(this.formatDecimal(args.passivaSumme)).up();
    }

    // --- GuV (ContextRef V_D) ---
    for (const m of args.guvMappings) {
      if (m.concept.code === 'pl.netIncome' && m.source.betragAktuell === 0) continue;
      root.ele(m.concept.code, {
        contextRef: m.concept.contextRef,
        decimals: DECIMALS_MONETARY,
        unit: UNIT_REF_EUR,
      }).txt(this.formatDecimal(m.source.betragAktuell)).up();
    }

    // --- Anhang (Notes) ---
    if (args.anhang.bilanzierungsMethoden) {
      root.ele('genInfo.accountingPolicies.de.ing', {
        contextRef: 'V_Y',
      }).txt(this.escapeXml(args.anhang.bilanzierungsMethoden)).up();
    }
    if (args.anhang.bewertungsMethoden) {
      root.ele('genInfo.accountingPolicies.de.g', {
        contextRef: 'V_Y',
      }).txt(this.escapeXml(args.anhang.bewertungsMethoden)).up();
    }
    if (args.anhang.sonstigePflichtangaben) {
      root.ele('genInfo.notes.other', {
        contextRef: 'V_Y',
      }).txt(this.escapeXml(args.anhang.sonstigePflichtangaben)).up();
    }

    return root.end({ prettyPrint: false });
  }

  /**
   * Strukturelle Validierung (well-formed + Pflicht-Felder).
   */
  private structureValidate(
    xml: string,
    args: {
      mandant: { firmenname: string };
      fiscalYearBegin: string;
      fiscalYearEnd: string;
      bilanzMappings: Array<{ concept: TaxonomyConcept }>;
      guvMappings: Array<{ concept: TaxonomyConcept }>;
    },
  ): { valid: boolean; errors: Array<{ code: string; message: string }>; warnings: string[] } {
    const errors: Array<{ code: string; message: string }> = [];
    const warnings: string[] = [];

    // 1. XML well-formed (sehr grobe Prüfung — fast-xml-parser übernimmt das genauer).
    if (!xml.startsWith('<?xml')) {
      errors.push({ code: 'INVALID_XML', message: 'Kein XML-Header gefunden' });
    }

    // 2. Pflicht-Felder (in diesem Stadium prüfen wir nur, dass sie im
    //    Mapping berücksichtigt wurden).
    const mappedCodes = new Set([
      ...args.bilanzMappings.map((m) => m.concept.code),
      ...args.guvMappings.map((m) => m.concept.code),
    ]);
    for (const pflicht of HGB_KT_V6_AKTIVA_PFLICHT_CODES) {
      if (pflicht === 'bs.ass') continue;
      if (!mappedCodes.has(pflicht)) {
        warnings.push(`Pflicht-Bilanz-Aktiva-Position nicht zugeordnet: ${pflicht}`);
      }
    }
    for (const pflicht of HGB_KT_V6_PASSIVA_PFLICHT_CODES) {
      if (pflicht === 'bs.eqLiab') continue;
      if (!mappedCodes.has(pflicht)) {
        warnings.push(`Pflicht-Bilanz-Passiva-Position nicht zugeordnet: ${pflicht}`);
      }
    }
    for (const pflicht of HGB_KT_V6_GUV_GKV_PFLICHT_CODES) {
      if (!mappedCodes.has(pflicht)) {
        warnings.push(`Pflicht-GuV-Position nicht zugeordnet: ${pflicht}`);
      }
    }
    // GenInfo-Pflicht-Felder müssen mindestens einmal im XML auftauchen.
    for (const pflicht of HGB_KT_V6_GENINFO_PFLICHT_CODES) {
      if (!xml.includes(`<${pflicht} `) && !xml.includes(`<${pflicht}>`)) {
        errors.push({
          code: 'MISSING_GENINFO_FIELD',
          message: `Pflicht-GenInfo-Feld fehlt: ${pflicht}`,
        });
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  private formatDecimal(value: number): string {
    return value.toFixed(2);
  }

  /**
   * Maskiert XML-Sonderzeichen in String-Werten.
   */
  private escapeXml(input: string): string {
    return input
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}