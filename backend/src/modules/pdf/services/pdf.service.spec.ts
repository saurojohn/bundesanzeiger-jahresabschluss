/**
 * Regressionstest: PDF-Erzeugung — Saldo-Gate und Integritätsangabe.
 *
 * Bugfix 2026-10-06, zwei Defekte im selben Pfad.
 *
 * 1. KEIN SALDO-GATE. Der E-Bilanz-XBRL-Pfad hat eines
 *    (`BILANZ_NICHT_SALDOSTIMMIG`), der PDF-Pfad hatte keines. Der
 *    Saldo wurde als ROTER TEXT in das Dokument geschrieben und die
 *    Datei trotzdem gerendert, in den WORM-Speicher geschrieben und
 *    im Audit-Log verzeichnet. Empirisch belegt: Aktiva 100.000,00 /
 *    Passiva 99.995,00 ergab ein vollstaendiges PDF mit dem Hinweis
 *    „Bilanz ist NICHT ausgeglichen!".
 *    Fuers Bundesanzeiger-Verfahren ist das die schaedlichste
 *    Variante: Die Datei existiert und ist archiviert, bevor sie
 *    jemand prueft.
 *
 *    Zusaetzlich: eine BILANZ OHNE POSITIONEN rendert als
 *    „Aktiva 0,00 / Passiva 0,00 / ausgeglichen / Bilanzsumme 0,00".
 *
 * 2. FALSCHE INTEGRITAETSANGABE. `renderAndPersist()` uebergab an die
 *    Templates den Platzhalter 'PENDING-PLACEHOLDER-BEFORE-RENDER-0'
 *    als `sha256Hash`. Die Templates schrieben
 *    `SHA-256: PENDING-PLACEHOL…` in den FUSSER — in JEDEM erzeugten
 *    PDF. Der Kommentar behauptete sogar, es erscheine „der erste
 *    Hash-Drittel als Korrelations-ID".
 *
 *    Ein PDF kann seinen eigenen SHA-256 nicht enthalten: der Hash
 *    aendert sich, sobald er im Dokument steht. Die Aussage war also
 *    strukturell falsch, nicht nur ungefuellt. Der Footer traegt jetzt
 *    eine Korrelations-ID auf den WORM-Objektschluessel, die vor dem
 *    Rendern feststeht; der echte Hash bleibt in Manifest, Audit-Log
 *    und API-Antwort.
 */

import { describe, it, expect, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { PdfService } from './pdf.service';
import { saldoStimmt } from '../../../common/utils/saldo';

type Pos = { seite: string; betragAktuell: string };

function buildService(positionen: Pos[]) {
  const bilanzRepository = {
    findWithPositionen: vi
      .fn()
      .mockResolvedValue({ id: 'b1', geschaeftsjahr: 2025, status: 'DRAFT', positionen }),
  };
  const storageService = {
    uploadToWorm: vi.fn().mockResolvedValue({ objectKey: 'k', sha256: 'h' }),
    getConfig: vi.fn().mockReturnValue({ retentionDays: 3650 }),
    downloadFromWorm: vi.fn().mockResolvedValue(Buffer.from('')),
  };
  // Der Stub muss den HAPPY PATH vollstaendig tragen. Nur so ist die
  // Negativprobe aussagekraeftig: ohne Gate muss die Generierung
  // erfolgreich durchlaufen, nicht an einem unvollstaendigen Stub
  // scheitern. Sonst wuerde der Test auch mit kaputtem Code "bestehen",
  // nur aus dem falschen Grund rot.
  // Alle Felder wie im bestehenden `bilanz.template.spec.ts` — der
  // Template-Render greift auf `handelsregister`, `steuernummer` und
  // `anschrift` zu. Ein duennes Stub-Objekt liefert sonst einen
  // TypeError aus dem PDFKit-Layer, und der Test waere aus dem
  // falschen Grund rot.
  const prisma = {
    mandant: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'm1',
        firmenname: 'Demo GmbH',
        rechtsform: 'GmbH',
        handelsregister: 'HRB 123456',
        steuernummer: '12/345/67890',
        ustId: 'DE123456789',
        gruendungsdatum: null,
        anschrift: { strasse: 'Musterstr. 1', plz: '10115', ort: 'Berlin', land: 'DE' },
        publishChannel: 'EBILANZ_TAXONOMIE',
      }),
    },
  };
  const wormObjectRepository = {
    findActiveByEntity: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({
      objectKey: 'wurm/jahresabschluss/2025/bilanz.pdf',
      sha256: 'abc',
      sizeBytes: 100,
      objectLockMode: 'COMPLIANCE',
      retentionDays: 3650,
      retentionExpiresAt: new Date('2036-01-01T00:00:00Z'),
      uploadedAt: new Date('2026-01-01T00:00:00Z'),
    }),
  };
  const service = new PdfService(
    prisma as never,
    bilanzRepository as never,
    {} as never, // guvRepository
    {} as never, // anhangRepository
    storageService as never,
    wormObjectRepository as never,
    { record: vi.fn().mockResolvedValue(undefined) } as never,
    { getBrandingByMandantId: vi.fn().mockResolvedValue({ kanzleiId: null }) } as never,
  );
  return { service, bilanzRepository, storageService };
}

const USER = {
  id: 'u'.repeat(8) + '-1111-4111-8111-111111111111',
  // `email` ist Pflicht: das Template schreibt `Author: user.email` in
  // die PDF-Metadaten. Ohne das Feld bricht PDFKit bereits im
  // Konstruktor ab — der Test waere dann aus dem falschen Grund rot.
  email: 'test@kanzlei.de',
  globalRole: null,
  mandanten: [{ id: 'm1', firmenname: 'Demo GmbH', rolle: 'STEUERBERATER' }],
} as never;

const CTX = { ip: null, userAgent: null };

const SALDOSTIMMIG: Pos[] = [
  { seite: 'AKTIVA', betragAktuell: '100000.00' },
  { seite: 'PASSIVA', betragAktuell: '100000.00' },
];

describe('PdfService: Saldo-Gate und Integritätsangabe', () => {
  it('erzeugt das PDF für eine saldostimmende Bilanz (Positivpfad)', async () => {
    // Ohne diesen Test waere die Negativprobe wertlos: ein roter Test
    // kann auch entstehen, weil der Stub zu duenn ist.
    const { service, storageService } = buildService(SALDOSTIMMIG);
    await expect(
      service.generateBilanzPdf('b1', 'm1', USER, CTX),
    ).resolves.toBeDefined();
    expect(storageService.uploadToWorm).toHaveBeenCalled();
  });

  it('lehnt eine nicht saldostimmende Bilanz ab', async () => {
    const { service, storageService } = buildService([
      { seite: 'AKTIVA', betragAktuell: '100000.00' },
      { seite: 'PASSIVA', betragAktuell: '99995.00' },
    ]);
    await expect(
      service.generateBilanzPdf('b1', 'm1', USER, CTX),
    ).rejects.toBeInstanceOf(BadRequestException);
    // Vor allem anderen: nichts darf archiviert werden.
    expect(storageService.uploadToWorm).not.toHaveBeenCalled();
  });

  it('lehnt eine leere Bilanz ab (0,00 war als Aussage gewertet)', async () => {
    const { service, storageService } = buildService([]);
    await expect(
      service.generateBilanzPdf('b1', 'm1', USER, CTX),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(storageService.uploadToWorm).not.toHaveBeenCalled();
  });

  it('lehnt auch die Gegenrichtung ab', async () => {
    const { service } = buildService([
      { seite: 'AKTIVA', betragAktuell: '30000.00' },
      { seite: 'PASSIVA', betragAktuell: '0.00' },
    ]);
    await expect(
      service.generateBilanzPdf('b1', 'm1', USER, CTX),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('nutzt dieselbe Toleranzregel wie E-Bilanz und Bilanz-Service', async () => {
    // 0,01 EUR ist nach der zentralen Regel erlaubt. Das PDF-Template
    // urteilte mit `saldo < 0.01` strenger — zwei Antworten auf
    // dieselbe Frage.
    const { service } = buildService([
      { seite: 'AKTIVA', betragAktuell: '100000.00' },
      { seite: 'PASSIVA', betragAktuell: '99999.99' },
    ]);
    const intern = service as unknown as {
      assertBilanzVollstaendigUndSaldostimmig: (b: unknown) => void;
    };
    expect(() =>
      intern.assertBilanzVollstaendigUndSaldostimmig({
        positionen: [
          { seite: 'AKTIVA', betragAktuell: '100000.00' },
          { seite: 'PASSIVA', betragAktuell: '99999.99' },
        ],
      }),
    ).not.toThrow();
    // Und die zentrale Regellogik ist dieselbe.
    expect(saldoStimmt(100000, 99999.99)).toBe(true);
  });

  it('erlaubt eine saldostimmende Bilanz', async () => {
    const { service } = buildService(SALDOSTIMMIG);
    const intern = service as unknown as {
      assertBilanzVollstaendigUndSaldostimmig: (b: unknown) => void;
    };
    expect(() =>
      intern.assertBilanzVollstaendigUndSaldostimmig({
        positionen: SALDOSTIMMIG,
      }),
    ).not.toThrow();
  });

  it('kein Platzhalter-Hash mehr im Code', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const datei = readFileSync(
      join(process.cwd(), 'src/modules/pdf/services/pdf.service.ts'),
      'utf-8',
    );
    // Kommentare zaehlen nicht: die Historie wird bewusst erlaeutert.
    const code = datei
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(code).not.toContain('PENDING-PLACEHOLDER');
  });

  it('kein SHA-256-Versprechen mehr im Footer der Templates', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    for (const t of [
      'bilanz.template.ts',
      'abschluss.template.ts',
      'guv.template.ts',
      'anhang.template.ts',
    ]) {
      const inhalt = readFileSync(
        join(process.cwd(), 'src/modules/pdf/pdf-templates', t),
        'utf-8',
      );
      const code = inhalt
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      // Kein gerendertes `SHA-256: …` mehr — die Zeile war nie wahr.
      expect(code, t).not.toMatch(/`SHA-256: /);
    }
  });

  it('die Korrelations-ID enthält keine Sonderzeichen', async () => {
    const { service } = buildService(SALDOSTIMMIG);
    const intern = service as unknown as {
      buildKorrelationsId: (k: string) => string;
    };
    expect(intern.buildKorrelationsId('wurm/jahresabschluss/2025/bilanz.pdf')).toMatch(
      /^[A-Za-z0-9]{16}$/,
    );
    expect(intern.buildKorrelationsId('x')).toMatch(/^[A-Za-z0-9]{16}$/);
  });
});