import { describe, it, expect, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { DatevImportService } from './datev-import.service';
import type { AuthUser } from '../../auth/types/auth-user.types';

/**
 * BEFUND 2026-10-11 — Die Archivierung umging den DATEV-Import.
 *
 * Am 2026-10-09 wurde „archivieren statt löschen" eingeführt und in Bilanz,
 * GuV und Anhang verdrahtet. Der Import-Pfad blieb aus — vermutlich, weil
 * er nicht in der Liste der Bestandteile stand, sondern als eigener
 * Schreibweg.
 *
 * Das ist keine theoretische Lücke: `execute` legt eine Bilanz UND eine
 * GuV an und ERSETZT dabei die Positionen. Ein archivierter Mandant — also
 * einer, der aus dem aktiven Bestand verschwunden ist — konnte darüber
 * weiterhin Belege erhalten.
 *
 * Die Sperre sitzt bewusst neben `assertMandantAccess` und nicht darin:
 * Zugriff und Bearbeitbarkeit sind zwei unabhängige Fragen.
 */

const MANDANT = '11111111-1111-4111-8111-111111111111';

const admin = {
  id: '33333333-3333-4333-8333-333333333333',
  globalRole: 'SYSTEM_ADMIN',
  mandanten: [],
} as unknown as AuthUser;

const ctx = { ip: null, userAgent: null };

function buildService(archiviertAt: Date | null) {
  const guvCreate = vi.fn();
  const bilanzCreate = vi.fn();

  const service = new DatevImportService(
    {
      mandant: {
        findUnique: vi.fn().mockResolvedValue({ id: MANDANT, archiviertAt }),
      },
    } as never,
    { createWithPositionen: bilanzCreate, deleteByMandant: vi.fn() } as never,
    { createWithPositionen: guvCreate } as never,
    { record: vi.fn().mockResolvedValue(undefined) } as never,
  );

  // `parseCsv` braucht eine wohlgeformte CSV; die interessiert hier nicht.
  const intern = service as unknown as {
    parseCsv: (b64: string) => unknown;
    importFromDatev: (dto: unknown, u: AuthUser, c: unknown) => Promise<unknown>;
  };
  intern.parseCsv = vi.fn().mockReturnValue({
    header: { wirtschaftsjahrBeginn: new Date(), wirtschaftsjahrEnde: new Date(), formatName: 'EXTF_Buchungsstapel', version: 12, anzahlBuchungen: 0, sachkontenLaenge: 4, umsatzGesamt: 0, sollGesamt: 0, habenGesamt: 0 },
    buchungsZeilen: [],
  });

  return { service, guvCreate, bilanzCreate };
}

const dto = {
  csvBase64: 'eA==',
  mandantId: MANDANT,
  geschaeftsjahr: 2093,
  skrPlan: 'SKR04',
} as never;

describe('BEFUND 2026-10-11: Archivierte Mandanten sind über den Import gesperrt', () => {
  it('ein archivierter Mandant wird abgelehnt — es wird nichts geschrieben', async () => {
    const { service, guvCreate, bilanzCreate } = buildService(new Date('2026-10-01'));

    await expect(service.importFromDatev(dto, admin, ctx)).rejects.toBeInstanceOf(ConflictException);

    // Der eigentliche Nachweis: die Ablehnung muss VOR jedem Schreibvorgang
    // kommen. Ein Test, der nur die Exception prüft, wäre auch dann grün,
    // wenn der Import erst schreibt und danach abbricht.
    expect(bilanzCreate).not.toHaveBeenCalled();
    expect(guvCreate).not.toHaveBeenCalled();
  });

  it('die Meldung nennt den Aufhebungsweg', async () => {
    const { service } = buildService(new Date('2026-10-01'));

    const fehler = await service.importFromDatev(dto, admin, ctx).catch((e: unknown) => e);

    expect((fehler as Error).message).toContain('archiviert');
    expect((fehler as Error).message).toContain('/archivierung/aufheben');
  });

  it('ein aktiver Mandant kommt an der Sperre vorbei', async () => {
    // Gegenprobe: die Sperre darf den Import nicht generell blockieren.
    // Der Test endet danach an einem spaeteren, fachlichen Fehler — wichtig
    // ist, dass es NICHT "Mandant ist archiviert" ist.
    const { service } = buildService(null);

    const ergebnis = await service
      .importFromDatev(dto, admin, ctx)
      .then(() => 'ok')
      .catch((e: Error) => e.message);

    expect(ergebnis).not.toContain('archiviert');
  });
});