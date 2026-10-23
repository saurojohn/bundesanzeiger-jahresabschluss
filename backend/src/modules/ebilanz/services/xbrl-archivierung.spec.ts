import { describe, it, expect, vi } from 'vitest';
import { XbrlGeneratorService } from './xbrl-generator.service';

/**
 * BEFUND 2026-10-22 (Nachtrag 86): Die erzeugte E-Bilanz-XBRL wurde
 * **nirgends aufbewahrt** — sie lag nur in der HTTP-Antwort des
 * Export-Endpoints. Fuer einen Mandanten mit Kanal `XML_XBRL` oder
 * `EBILANZ_TAXONOMIE` ist die XBRL aber das eingereichte Dokument und
 * damit nach § 147 AO zehn Jahre zu verwahren.
 *
 * Der Einreichungsbeleg trug stattdessen das signierte PDF (gemessen:
 * `channel=XML_XBRL`, `rawPayload` began mit `%PDF-1.3`) — ein Dokument,
 * das bei diesem Kanal nie eingereicht wurde.
 *
 * Entscheidung der Fachverantwortlichen (2026-10-23): Die beim Einreichen
 * erzeugte XBRL wird im WORM abgelegt (eigener EntityType, zehn Jahre,
 * Object-Lock COMPLIANCE, Legal Hold) und als Nutzlast protokolliert.
 *
 * Dieser Test prueft die **Archivierung** — die Verdrahtung im
 * Einreichungs-Beleg prueft `e2e/einreichungsbeleg-kanal.e2e.spec.ts`.
 */
const MANDANT_ID = 'aaaaaaaa-4444-4444-8444-aaaaaaaaaaaa';
const ABSCHLUSS_ID = 'bbbbbbbb-4444-4444-8444-bbbbbbbbbbbb';
const BILANZ_ID = 'cccccccc-4444-4444-8444-cccccccccccc';
const GUV_ID = 'dddddddd-4444-4444-8444-dddddddddddd';
const ANHANG_ID = 'eeeeeeee-4444-4444-8444-eeeeeeeeeeee';

const USER = {
  id: 'e1e1e1e1-4444-4444-8444-e1e1e1e1e1e1',
  globalRole: null,
  mandanten: [{ id: MANDANT_ID, firmenname: 'Test GmbH', rolle: 'STEUERBERATER' }],
} as never;

const SALDOSTIMMIG = [
  { seite: 'AKTIVA', kontonummer: 'A.II.1.', bezeichnung: 'Grundstuecke', betragAktuell: '100000.00' },
  { seite: 'PASSIVA', kontonummer: 'A.I.', bezeichnung: 'Kapital', betragAktuell: '100000.00' },
];

function buildService() {
  const uploadToWorm = vi.fn().mockImplementation(async (args: { data: Buffer }) => ({
    sha256Hash: 'HASH-STEHT-DRIN',
    sizeBytes: args.data.length,
    retentionExpiresAt: new Date('2036-01-01'),
  }));
  const getConfig = vi.fn().mockReturnValue({
    bucket: 'banz-worm',
    retentionDays: 3650,
    lockMode: 'COMPLIANCE',
  });
  const create = vi.fn().mockImplementation(async (args: Record<string, unknown>) => ({
    id: 'worm-1',
    ...args,
    uploadedAt: new Date(),
  }));
  const record = vi.fn().mockResolvedValue(undefined);

  const service = new XbrlGeneratorService(
    {
      mandant: {
        findUnique: vi.fn().mockResolvedValue({
          id: MANDANT_ID,
          firmenname: 'Test GmbH',
          rechtsform: 'GmbH',
          handelsregister: 'HRB 1',
          steuernummer: '12/345/67890',
        }),
      },
    } as never,
    {
      findWithPositionen: vi.fn().mockResolvedValue({
        id: BILANZ_ID, geschaeftsjahr: 2025, positionen: SALDOSTIMMIG,
      }),
    } as never,
    {
      findWithPositionen: vi.fn().mockResolvedValue({
        id: GUV_ID, geschaeftsjahr: 2025, verfahren: 'GKV', ergebnis: '0.00',
        positionen: [{ kontonummer: '1.', bezeichnung: 'Umsatz', betragAktuell: '1000.00' }],
      }),
    } as never,
    {
      findWithAbschnitte: vi.fn().mockResolvedValue({
        id: ANHANG_ID, geschaeftsjahr: 2025, bilanzierungsMethoden: null,
        bewertungsMethoden: null, sonstigePflichtangaben: null, abschnitte: [],
      }),
    } as never,
    { record } as never,
    { uploadToWorm, getConfig } as never,
    { create } as never,
  );

  return { service, uploadToWorm, getConfig, create, record };
}

const args = {
  mandantId: MANDANT_ID,
  bilanzId: BILANZ_ID,
  guvId: GUV_ID,
  anhangId: ANHANG_ID,
  jahresabschlussId: ABSCHLUSS_ID,
};

describe('E-Bilanz: die XBRL wird im WORM abgelegt (Nachtrag 86)', () => {
  it('legt die Datei unter eigenem EntityType und eigenem Key ab', async () => {
    const { service, uploadToWorm } = buildService();
    const r = await service.generateUndArchivieren(args, USER, {});

    expect(uploadToWorm).toHaveBeenCalledTimes(1);
    const opts = uploadToWorm.mock.calls[0]![0] as {
      objectKey: string;
      entityType: string;
      entityId: string;
      mandantId: string;
      data: Buffer;
      contentType: string;
    };
    expect(opts.entityType).toBe('ABSCHLUSS_XBRL');
    expect(opts.entityId).toBe(ABSCHLUSS_ID);
    expect(opts.mandantId).toBe(MANDANT_ID);
    expect(opts.contentType).toBe('application/xml');
    expect(opts.objectKey).toContain('abschluss_xbrl');
    expect(opts.objectKey).toContain(MANDANT_ID);
    // Die Nutzlast ist die XML-Datei selbst.
    expect(opts.data.subarray(0, 5).toString('utf-8')).toBe('<?xml');
    expect(r.bytes.subarray(0, 5).toString('utf-8')).toBe('<?xml');
  });

  it('schreibt das WORM-Manifest mit zehn Jahren Retention und Legal Hold', async () => {
    const { service, create } = buildService();
    await service.generateUndArchivieren(args, USER, {});

    expect(create).toHaveBeenCalledTimes(1);
    const manifest = create.mock.calls[0]![0] as {
      entityType: string;
      entityId: string;
      sha256Hash: string;
      objectLockMode: string;
      retentionDays: number;
      legalHold: boolean;
    };
    expect(manifest.entityType).toBe('ABSCHLUSS_XBRL');
    expect(manifest.entityId).toBe(ABSCHLUSS_ID);
    expect(manifest.sha256Hash).toBe('HASH-STEHT-DRIN');
    expect(manifest.objectLockMode).toBe('COMPLIANCE');
    expect(manifest.retentionDays).toBe(3650);
    expect(manifest.legalHold).toBe(true);
  });

  it('protokolliert die Archivierung im Audit-Trail', async () => {
    const { service, record } = buildService();
    await service.generateUndArchivieren(args, USER, {});

    // Zwei Eintraege: der EXPORT der Datei und das CREATE des WORM-Objekts.
    expect(record).toHaveBeenCalledTimes(2);
    const wormAudit = record.mock.calls[1]![0] as {
      action: string;
      entityType: string;
      jahresabschlussId: string | null;
      newState: Record<string, unknown>;
    };
    expect(wormAudit.action).toBe('CREATE');
    expect(wormAudit.entityType).toBe('WormObject');
    expect(wormAudit.jahresabschlussId).toBe(ABSCHLUSS_ID);
    expect(wormAudit.newState['domainEntityType']).toBe('ABSCHLUSS_XBRL');
    expect(wormAudit.newState['sha256Hash']).toBe('HASH-STEHT-DRIN');
  });

  it('Gegenprobe: der reine Export archiviert nichts', async () => {
    // `generateEbilanzXbrl()` ist der Export-Pfad (Vorschau, Download).
    // Er darf **nicht** archivieren: sonst wuerde jeder Vorschau-Klick
    // einen zehnjaehrigen WORM-Objekt erzeugen.
    const { service, uploadToWorm, create } = buildService();
    await service.generateEbilanzXbrl(
      {
        mandantId: MANDANT_ID,
        bilanzId: BILANZ_ID,
        guvId: GUV_ID,
        anhangId: ANHANG_ID,
      },
      USER,
      {},
    );
    expect(uploadToWorm).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});
