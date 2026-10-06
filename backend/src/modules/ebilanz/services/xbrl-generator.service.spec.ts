/**
 * Regressionstest: der XBRL-Generator muss das GuV-Verfahren an das
 * Mapping durchreichen.
 *
 * Bugfix 2026-10-06. Der urspruengliche Fehler hatte ZWEI Ebenen:
 *
 *   1. `mapKontonummerToConcept()` loste die GKV/UKV-Kollision nicht
 *      auf (Regressionstest: `mappings/mapping-engine.spec.ts`).
 *   2. `generateEbilanzXbrl()` rief `this.mapGuVPositionen(guv.positionen)`
 *      OHNE das Verfahren auf. Damit war Ebene 1 wirkungslos — auch mit
 *      korrigierter Mapping-Engine griff der Default.
 *
 * Nur dieser Test deckt Ebene 2 ab: Ein Mapping-Engine-Test kann den
 * Aufrufstellen-Fehler nicht sehen, weil er die Engine direkt mit
 * `verfahren` fuettern wuerde.
 *
 * Anmerkung zur Testbarkeit: `GuV` hat `@@unique([mandantId,
 * geschaeftsjahr])`. Ein zweiter GuV (UKV) fuer dasselbe Jahr laesst
 * sich darum nicht ueber die HTTP-API anlegen — daher Stubs statt e2e.
 */

import { describe, it, expect, vi } from 'vitest';
import { XbrlGeneratorService } from './xbrl-generator.service';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { BilanzRepository } from '../../../common/repositories/bilanz.repository';
import type { GuVRepository } from '../../../common/repositories/guv.repository';
import type { AnhangRepository } from '../../../common/repositories/anhang.repository';
import type { AuditService } from '../../audit/services/audit.service';

const MANDANT_ID = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const Jahr = 2025;

/** Minimale, aber saldostimmende Bilanz (Aktiva = Passiva = 100.000). */
function bilanzStub() {
  return {
    id: 'b'.repeat(8) + '-1111-4111-8111-111111111111',
    geschaeftsjahr: Jahr,
    positionen: [
      {
        seite: 'AKTIVA',
        kontonummer: 'A.',
        bezeichnung: 'Aktiva',
        betragAktuell: '100000.00',
      },
      {
        seite: 'PASSIVA',
        kontonummer: 'P.',
        bezeichnung: 'Passiva',
        betragAktuell: '100000.00',
      },
    ],
  };
}

/**
 * GuV mit EINER kollidierenden Position: Kontonummer `14.`, 35.100 EUR.
 *
 * - GKV `14.` = „Steuern vom Einkommen und vom Ertrag" -> pl.tax.incomeTax
 * - UKV `14.` = Ergebnis des Geschäftsjahres-> pl.netIncome
 *
 * An einem einzigen Posten ist der Unterschied maximal eindeutig.
 */
function guvStub(verfahren: string) {
  return {
    id: 'c'.repeat(8) + '-1111-4111-8111-111111111111',
    geschaeftsjahr: Jahr,
    verfahren,
    ergebnis: '35100.00',
    positionen: [
      {
        kontonummer: '14.',
        bezeichnung: 'Position 14.',
        kategorie: 'STEUER',
        betragVorjahr: '35100.00',
        betragAktuell: '35100.00',
      },
    ],
  };
}

function anhangStub() {
  return {
    id: 'd'.repeat(8) + '-1111-4111-8111-111111111111',
    geschaeftsjahr: Jahr,
    bilanzierungsMethoden: 'Nach HGB.',
    bewertungsMethoden: 'Niedrigster Wert.',
    sonstigePflichtangaben: 'Mitarbeiter: 3.',
    abschnitte: [],
  };
}

function buildService(verfahren: string) {
  const prisma = {
    mandant: {
      findUnique: vi.fn().mockResolvedValue({
        id: MANDANT_ID,
        firmenname: 'Test GmbH',
        rechtsform: 'GmbH',
        handelsregister: 'HRB 1',
        steuernummer: '12/345/67890',
      }),
    },
  } as unknown as PrismaService;

  const bilanzRepository = {
    findWithPositionen: vi.fn().mockResolvedValue(bilanzStub()),
  } as unknown as BilanzRepository;

  const guvRepository = {
    findWithPositionen: vi.fn().mockResolvedValue(guvStub(verfahren)),
  } as unknown as GuVRepository;

  const anhangRepository = {
    findWithAbschnitte: vi.fn().mockResolvedValue(anhangStub()),
  } as unknown as AnhangRepository;

  const auditService = {
    record: vi.fn().mockResolvedValue(undefined),
  } as unknown as AuditService;

  return new XbrlGeneratorService(
    prisma,
    bilanzRepository,
    guvRepository,
    anhangRepository,
    auditService,
  );
}

const USER = {
  id: 'e'.repeat(8) + '-1111-4111-8111-111111111111',
  email: 'test@kanzlei.de',
  globalRole: null,
  mandanten: [{ id: MANDANT_ID, firmenname: 'Test GmbH', rolle: 'STEUERBERATER' }],
} as never;

async function generate(verfahren: string): Promise<string> {
  const service = buildService(verfahren);
  const result = await service.generateEbilanzXbrl(
    {
      bilanzId: 'b'.repeat(8) + '-1111-4111-8111-111111111111',
      guvId: 'c'.repeat(8) + '-1111-4111-8111-111111111111',
      anhangId: 'd'.repeat(8) + '-1111-4111-8111-111111111111',
      mandantId: MANDANT_ID,
    },
    USER,
    {},
  );
  return Buffer.from(result.xbrlBase64, 'base64').toString('utf-8');
}

const wert = (xml: string, code: string): string | undefined =>
  new RegExp(`<${code.replace(/\./g, '\\.')}[^>]*>([^<]*)<`).exec(xml)?.[1];

describe('XbrlGeneratorService: Verfahrensdurchreichung an das Mapping', () => {
  it('GKV: Kontonummer 14. wird zur Steuerzeile, nicht zum Jahresergebnis', async () => {
    const xml = await generate('GKV');
    expect(wert(xml, 'pl.tax.incomeTax')).toBe('35100.00');
    expect(wert(xml, 'pl.netIncome')).toBeUndefined();
  });

  it('UKV: dieselbe Kontonummer 14. wird zum Jahresergebnis', async () => {
    const xml = await generate('UKV');
    expect(wert(xml, 'pl.netIncome')).toBe('35100.00');
    expect(wert(xml, 'pl.tax.incomeTax')).toBeUndefined();
  });

  it('erzeugt für GKV und UKV unterschiedliche Dokumente', async () => {
    // Der eigentliche Befund: derselbe Abschluss, zwei Verfahren, zwei
    // Dateien. Ohne Durchreichung wären beide identisch.
    expect(await generate('GKV')).not.toBe(await generate('UKV'));
  });
});
