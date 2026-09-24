import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { GuVRepository } from '../../../common/repositories/guv.repository';
import { AuditService } from '../../audit/services/audit.service';
import type { AuthUser } from '../../auth/types/auth-user.types';
import type { SkrKonto, SkrPlan } from '../mappings/skr04-hgb.types';
import { mapGuVPositionToDefaultKonto, SKR04_BY_KONTO } from '../mappings/skr04-hgb-map';
import { getSkr03Konto, standardBankKonto } from '../mappings/skr03';
import { DatevCsvWriter } from '../utils/csv-writer';
import type {
  DatevMappingPreviewResponse,
  DatevMetadata,
  GenerateDatevResponse,
  GenerateSachkontenResponse,
} from '../dto/datev-response.dto';
import type { GenerateDatevDto, GenerateSachkontenDto } from '../dto/generate-datev.dto';

export interface DatevExportContext {
  ip?: string | null;
  userAgent?: string | null;
}

/** DATEV-Format Version (siehe docs/banz-schemata.md §3.3). */
const DATEV_VERSION_HEADER = '12';
/** WKZ — Default-Währung. */
const DEFAULT_WKZ = 'EUR';
/** Default-BU-Schlüssel (kein spezieller BU). */
const DEFAULT_BU_SCHLUESSEL = '0';
/** DATEV-Buchungstyp 1 = Standard-Buchung (siehe docs §3.3). */
const BUCHUNGSTYP_STANDARD = '1';
/** Rechnungslegungszweck 00 = keiner. */
const RECHNUNGSLEGUNGSZWECK_DEFAULT = '00';
/** Maximal 99.999 Buchungs-Zeilen pro CSV (DATEV-Limit). */
const DATEV_MAX_BUCHUNGS_ZEILEN = 99_999;

/**
 * DATEV-Buchungsstapel-Spalten (siehe docs/banz-schemata.md §3.4).
 *
 * Reihenfolge muss mit dem DATEV-Standard übereinstimmen.
 */
const BUCHUNGS_ZEILE_FELDER = [
  'Umsatz', // 1
  'SH', // 2
  'WKZ', // 3
  'Kurs', // 4
  'Basis', // 5
  'BWKZ', // 6
  'Konto', // 7
  'Gegenkonto', // 8
  'BUSchluessel', // 9
  'Belegdatum', // 10
  'Belegfeld1', // 11
  'Belegfeld2', // 12
  'Skonto', // 13
  'Buchungstext', // 14
  'Postensperre', // 15
  'Adressnummer', // 16
  'PartnerBLZ', // 17
] as const;

/** Header-Spalten (siehe docs/banz-schemata.md §3.3). */
const HEADER_FELDER = [
  'Formatname', // 1
  'Version', // 2
  'Berater', // 3
  'Mandant', // 4
  'WJ-Beginn', // 5
  'WJ-Ende', // 6
  'Sachkontenlaenge', // 7
  'Datum-von', // 8
  'Datum-bis', // 9
  'Bezeichnung', // 10
  'Diktat', // 11
  'Buchungstyp', // 12
  'Rechnungslegungszweck', // 13
] as const;

/** DATEV-Buchungstext max 60 Zeichen (siehe docs §3.4). */
const MAX_BUCHUNGSTEXT = 60;
/** DATEV-Belegfeld 1 max 36 Zeichen, nur erlaubte Zeichen (siehe docs §3.4). */
const MAX_BELEGFELD1 = 36;
const BELEGFELD1_ALLOWED_CHARS = /[^A-Za-z0-9$&%/+\-.]/g;

/**
 * Service für DATEV-Export — EXTF_Buchungsstapel (CSV) und EXTF_Sachkontobeschriftungen.
 *
 * Erzeugt paarige Buchungs-Zeilen aus GuV-Positionen:
 *   - Aufwand: Soll=Aufwandskonto, Haben=Bankkonto (1800)
 *   - Ertrag:  Soll=Bankkonto (1800), Haben=Ertragskonto
 *
 * Wichtige Details:
 *   - DATEV-Semikolon als Trenner (NICHT Komma — siehe docs §3.3)
 *   - UTF-8 ohne BOM
 *   - Deutsche Zahlen (1234,56 mit Komma als Dezimaltrenner)
 *   - Belegdatum als TTMM (z.B. 3112 für 31.12.)
 *   - Buchungstext max 60 Zeichen, Belegfeld1 max 36 (Buchstaben/Zahlen + $&%+-/)
 *   - Max 99.999 Buchungs-Zeilen pro CSV (DATEV-Limit — wir prüfen und warnen)
 *   - RBAC via @Roles() im Controller + Service-internen Mandant-Access-Check
 *   - Audit-Trail (GoBD §147 AO): jeder Export wird mit voller Metadata protokolliert
 */
@Injectable()
export class DatevExportService {
  private readonly logger = new Logger(DatevExportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly guvRepository: GuVRepository,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Hauptmethode: Generiert einen DATEV-Buchungsstapel.
   *
   * Ablauf:
   *   1. assertMandantAccess
   *   2. GuV laden (mandant-gefiltert)
   *   3. Buchungs-Zeilen pro GuV-Position generieren
   *   4. Header schreiben
   *   5. CSV-Buffer bauen
   *   6. Validierung (max 99.999 Zeilen)
   *   7. AuditService.record
   *   8. Return csvBytes + metadata
   */
  async generateBuchungsstapel(
    args: GenerateDatevDto & { mandantId: string },
    user: AuthUser,
    context: DatevExportContext,
  ): Promise<GenerateDatevResponse> {
    const skrPlan: SkrPlan = args.skrPlan ?? 'SKR04';
    const sachkontenlaenge: 4 | 5 = args.sachkontenlaenge ?? 4;

    this.assertMandantAccess(args.mandantId, user);

    // 2. GuV laden.
    const guv = await this.guvRepository.findWithPositionen(args.guvId, args.mandantId);
    if (!guv) throw new NotFoundException('GuV nicht gefunden');

    const mandant = await this.prisma.mandant.findUnique({
      where: { id: args.mandantId },
    });
    if (!mandant) throw new NotFoundException('Mandant nicht gefunden');

    // 3-4. Buchungs-Zeilen + Header generieren.
    const vonDatum = args.vonDatum ?? `01.01.${guv.geschaeftsjahr}`;
    const bisDatum = args.bisDatum ?? `31.12.${guv.geschaeftsjahr}`;

    const writer = new DatevCsvWriter();

    // Header-Block.
    this.writeHeader(writer, {
      beraternummer: args.beraternummer,
      mandantennummer: args.mandantennummer,
      vonDatum,
      bisDatum,
      sachkontenlaenge,
    });

    // Spaltennamen für Buchungs-Zeilen.
    writer.writeRow([...BUCHUNGS_ZEILE_FELDER]);

    // Buchungs-Zeilen.
    const verwendeteKonten = new Set<string>();
    let buchungsZeilenCount = 0;

    for (const pos of guv.positionen) {
      const betrag = Number(pos.betragAktuell);
      if (betrag === 0) continue; // Nullbuchungen überspringen

      const skrKonto = mapGuVPositionToDefaultKonto(pos.kontonummer, pos.kategorie, skrPlan);
      if (!skrKonto) {
        // Position kann nicht gemappt werden — überspringen, aber loggen.
        this.logger.warn(
          `Kein DATEV-Mapping für GuV-Position ${pos.kontonummer}/${pos.kategorie} (${pos.bezeichnung})`,
        );
        continue;
      }

      // Pad Konto auf gewünschte Sachkontenlänge.
      const konto = this.padKonto(skrKonto.konto, sachkontenlaenge);
      const bankKonto = this.padKonto(standardBankKonto(skrPlan), sachkontenlaenge);

      verwendeteKonten.add(konto);
      verwendeteKonten.add(bankKonto);

      // Erlöse (positiv, Kategorie ERLOES/FINANZ mit pos. Betrag) vs. Aufwand.
      const istErtrag = pos.kategorie === 'ERLOES' || (pos.kategorie === 'FINANZ' && betrag > 0);

      const belegdatum = this.toBelegdatum(bisDatum);
      const belegfeld1 = this.sanitizeBelegfeld1(
        `Banz-${guv.geschaeftsjahr}-${pos.kontonummer}`,
      );
      const buchungstext = this.truncateBuchungstext(`${pos.bezeichnung} (GuV ${guv.geschaeftsjahr})`);

      const absBetrag = Math.abs(betrag);

      if (istErtrag) {
        // Soll: Bankkonto, Haben: Ertragskonto
        writer.writeRow([
          this.formatBetrag(absBetrag),
          'S',
          DEFAULT_WKZ,
          '',
          '',
          '',
          bankKonto,
          konto,
          skrKonto.buschluesselDefault ?? DEFAULT_BU_SCHLUESSEL,
          belegdatum,
          belegfeld1,
          '',
          '',
          buchungstext,
          '0',
          '',
          '',
        ]);
        writer.writeRow([
          this.formatBetrag(-absBetrag),
          'H',
          DEFAULT_WKZ,
          '',
          '',
          '',
          bankKonto,
          konto,
          skrKonto.buschluesselDefault ?? DEFAULT_BU_SCHLUESSEL,
          belegdatum,
          belegfeld1,
          '',
          '',
          buchungstext,
          '0',
          '',
          '',
        ]);
      } else {
        // Aufwand: Soll: Aufwandskonto, Haben: Bankkonto
        writer.writeRow([
          this.formatBetrag(absBetrag),
          'S',
          DEFAULT_WKZ,
          '',
          '',
          '',
          konto,
          bankKonto,
          skrKonto.buschluesselDefault ?? DEFAULT_BU_SCHLUESSEL,
          belegdatum,
          belegfeld1,
          '',
          '',
          buchungstext,
          '0',
          '',
          '',
        ]);
        writer.writeRow([
          this.formatBetrag(-absBetrag),
          'H',
          DEFAULT_WKZ,
          '',
          '',
          '',
          konto,
          bankKonto,
          skrKonto.buschluesselDefault ?? DEFAULT_BU_SCHLUESSEL,
          belegdatum,
          belegfeld1,
          '',
          '',
          buchungstext,
          '0',
          '',
          '',
        ]);
      }
      buchungsZeilenCount += 2;
    }

    if (buchungsZeilenCount > DATEV_MAX_BUCHUNGS_ZEILEN) {
      throw new BadRequestException(
        `Buchungs-Stapel überschreitet DATEV-Limit: ${buchungsZeilenCount} > ${DATEV_MAX_BUCHUNGS_ZEILEN} Zeilen`,
      );
    }

    const csvBytes = writer.toBuffer();

    // 7. AuditLog
    const erloeseSumme = this.sumKategorie(guv.positionen, ['ERLOES'], true);
    const aufwandSumme = this.sumKategorie(
      guv.positionen,
      ['MATERIAL', 'PERSONAL', 'ABSCHREIBUNG', 'SONSTIGE', 'STEUER', 'FINANZ'],
      false,
    );

    void this.auditService.record({
      userId: user.id,
      kanzleiId: mandant.kanzleiId ?? null,
      mandantId: args.mandantId,
      jahresabschlussId: null,
      action: 'EXPORT',
      entityType: 'DatevExport',
      entityId: args.guvId,
      newState: {
        skrPlan,
        beraternummer: args.beraternummer,
        mandantennummer: args.mandantennummer,
        sachkontenlaenge,
        buchungsZeilenCount,
        verwendeteKontenCount: verwendeteKonten.size,
        verwendeteKonten: [...verwendeteKonten].sort(),
        csvSizeBytes: csvBytes.length,
        geschaeftsjahr: guv.geschaeftsjahr,
        erloeseSumme,
        aufwandSumme,
        encoding: 'UTF-8',
      } as Prisma.JsonValue,
      ipAddress: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    const metadata: DatevMetadata = {
      skrPlan,
      beraternummer: args.beraternummer,
      mandantennummer: args.mandantennummer,
      sachkontenlaenge,
      buchungsZeilenCount,
      verwendeteKontenCount: verwendeteKonten.size,
      verwendeteKonten: [...verwendeteKonten].sort(),
      geschaeftsjahr: guv.geschaeftsjahr,
      firmenname: mandant.firmenname,
      erloeseSumme,
      aufwandSumme,
      csvSizeBytes: csvBytes.length,
      encoding: 'UTF-8',
    };

    const filename = this.buildFilename({
      firmenname: mandant.firmenname,
      geschaeftsjahr: guv.geschaeftsjahr,
      skrPlan,
      sachkontenlaenge,
    });

    return {
      csvBase64: csvBytes.toString('base64'),
      filename,
      metadata,
    };
  }

  /**
   * Generiert DATEV-Sachkontenbeschriftungen (EXTF_Sachkontobeschriftungen.csv).
   *
   * Für jeden verwendeten Konto wird die Bezeichnung als CSV ausgegeben.
   * DATEV nutzt diese Datei, um die Konto-Bezeichnungen in der Buchhaltungs-
   * Software zu importieren.
   */
  async generateSachkontobeschriftungen(args: GenerateSachkontenDto): Promise<GenerateSachkontenResponse> {
    const writer = new DatevCsvWriter();

    // Header für Sachkontenbeschriftungen.
    writer.writeRow([
      'Konto',
      'Bezeichnung',
      'Sprache',
      'Kontotyp',
      'BU-Schlüssel',
    ]);

    // Inhalt pro Konto.
    for (const kontoNr of args.usedKonten) {
      const konto = this.lookupKonto(kontoNr, args.skrPlan);
      if (!konto) {
        // Unbekanntes Konto — trotzdem mit Default-Bezeichnung ausgeben.
        writer.writeRow([kontoNr, `Konto ${kontoNr}`, 'de', '', '']);
      } else {
        writer.writeRow([
          konto.konto,
          konto.bezeichnung,
          'de',
          konto.kontoTyp,
          konto.buschluesselDefault ?? '',
        ]);
      }
    }

    const csvBytes = writer.toBuffer();

    const filename = `EXTF_Sachkontobeschriftungen_${args.beraternummer}_${args.mandantennummer}.csv`;

    return {
      csvBase64: csvBytes.toString('base64'),
      filename,
      anzahlKonten: args.usedKonten.length,
    };
  }

  /**
   * Liefert ein Mapping-Preview für eine GuV.
   *
   * Wird vom GET /api/datev/preview/:guvId-Endpoint verwendet.
   */
  async previewMapping(args: {
    guvId: string;
    mandantId: string;
    skrPlan?: SkrPlan;
    user: AuthUser;
  }): Promise<DatevMappingPreviewResponse> {
    const skrPlan: SkrPlan = args.skrPlan ?? 'SKR04';

    this.assertMandantAccess(args.mandantId, args.user);

    const guv = await this.guvRepository.findWithPositionen(args.guvId, args.mandantId);
    if (!guv) throw new NotFoundException('GuV nicht gefunden');

    const mappings: DatevMappingPreviewResponse['mappings'] = [];
    const unMapped: DatevMappingPreviewResponse['unMapped'] = [];

    for (const pos of guv.positionen) {
      const betrag = Number(pos.betragAktuell);
      if (betrag === 0) continue;

      const skrKonto = mapGuVPositionToDefaultKonto(pos.kontonummer, pos.kategorie, skrPlan);
      if (!skrKonto) {
        unMapped.push({
          kontonummer: pos.kontonummer,
          bezeichnung: pos.bezeichnung,
          betragAktuell: Math.abs(betrag),
          kategorie: pos.kategorie,
          reason: `Kein DATEV-Mapping für HGB-Konto "${pos.kontonummer}" / Kategorie "${pos.kategorie}" im ${skrPlan}-Kontenplan`,
        });
        continue;
      }

      mappings.push({
        source: {
          kontonummer: pos.kontonummer,
          bezeichnung: pos.bezeichnung,
          betragAktuell: Math.abs(betrag),
          kategorie: pos.kategorie,
        },
        target: {
          konto: skrKonto.konto,
          bezeichnung: skrKonto.bezeichnung,
          kontoTyp: skrKonto.kontoTyp,
          buschluesselDefault: skrKonto.buschluesselDefault ?? DEFAULT_BU_SCHLUESSEL,
        },
      });
    }

    return {
      mappings,
      unMapped,
      skrPlan,
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

  private writeHeader(
    writer: DatevCsvWriter,
    args: {
      beraternummer: string;
      mandantennummer: string;
      vonDatum: string;
      bisDatum: string;
      sachkontenlaenge: 4 | 5;
    },
  ): void {
    // Spaltennamen.
    writer.writeRow([...HEADER_FELDER]);
    // Daten-Zeile.
    writer.writeRow([
      'EXTF_Buchungsstapel',
      DATEV_VERSION_HEADER,
      args.beraternummer,
      args.mandantennummer,
      args.vonDatum,
      args.bisDatum,
      String(args.sachkontenlaenge),
      args.vonDatum,
      args.bisDatum,
      'Buchungsstapel aus Banz-Jahresabschluss',
      'Buchhaltung',
      BUCHUNGSTYP_STANDARD,
      RECHNUNGSLEGUNGSZWECK_DEFAULT,
    ]);
  }

  /**
   * Pad Kontonummer auf die gewünschte Sachkontenlänge (4 oder 5).
   */
  private padKonto(konto: string, sachkontenlaenge: 4 | 5): string {
    if (konto.length >= sachkontenlaenge) return konto.slice(0, sachkontenlaenge);
    return konto.padEnd(sachkontenlaenge, '0');
  }

  /**
   * Formatiert einen Betrag im deutschen DATEV-Format (Komma als Dezimaltrenner).
   *
   * Beispiel: 1234.5 → "1234,50"
   */
  private formatBetrag(betrag: number): string {
    const rounded = Math.round(betrag * 100) / 100;
    const sign = rounded < 0 ? '-' : '';
    const abs = Math.abs(rounded);
    const formatted = abs.toFixed(2).replace('.', ',');
    return `${sign}${formatted}`;
  }

  /**
   * Wandelt ein TT.MM.JJJJ-Datum in das DATEV-Belegdatum-Format TTMM.
   *
   * Beispiel: "31.12.2026" → "3112"
   */
  private toBelegdatum(ttmmjjjj: string): string {
    const match = /^(\d{2})\.(\d{2})\.\d{4}$/.exec(ttmmjjjj);
    if (!match) return '3112'; // Fallback 31.12.
    return `${match[1]}${match[2]}`;
  }

  /**
   * Sanitize Belegfeld1: max 36 Zeichen, keine Sonderzeichen außer $&%+-/.
   */
  private sanitizeBelegfeld1(value: string): string {
    let cleaned = value.replace(BELEGFELD1_ALLOWED_CHARS, '');
    if (cleaned.length > MAX_BELEGFELD1) cleaned = cleaned.slice(0, MAX_BELEGFELD1);
    return cleaned;
  }

  /**
   * Truncate Buchungstext auf max 60 Zeichen.
   */
  private truncateBuchungstext(text: string): string {
    if (text.length <= MAX_BUCHUNGSTEXT) return text;
    return text.slice(0, MAX_BUCHUNGSTEXT);
  }

  /**
   * Summenberechnung für Audit-Metadata.
   */
  private sumKategorie(
    positionen: Array<{ betragAktuell: { toString(): string } | string | number; kategorie: string }>,
    kategorien: string[],
    nurPositive: boolean,
  ): number {
    let sum = 0;
    for (const pos of positionen) {
      if (!kategorien.includes(pos.kategorie)) continue;
      const betrag = Number(pos.betragAktuell.toString());
      if (nurPositive && betrag <= 0) continue;
      if (!nurPositive) {
        sum += Math.abs(betrag);
      } else {
        sum += betrag;
      }
    }
    return Math.round(sum * 100) / 100;
  }

  /**
   * Lookup für ein DATEV-Konto (SKR03 oder SKR04).
   */
  private lookupKonto(kontoNr: string, plan: SkrPlan): SkrKonto | null {
    if (plan === 'SKR03') {
      return getSkr03Konto(kontoNr);
    }
    return SKR04_BY_KONTO.get(kontoNr) ?? null;
  }

  /**
   * Baut einen empfohlenen Dateinamen für den Download.
   *
   * Format: `EXTF_Buchungsstapel_<slug>_<jahr>_<plan>_<laenge>.csv`
   */
  private buildFilename(args: {
    firmenname: string;
    geschaeftsjahr: number;
    skrPlan: SkrPlan;
    sachkontenlaenge: 4 | 5;
  }): string {
    const slug = args.firmenname
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    return `EXTF_Buchungsstapel_${slug}_${args.geschaeftsjahr}_${args.skrPlan}_${args.sachkontenlaenge}.csv`;
  }
}