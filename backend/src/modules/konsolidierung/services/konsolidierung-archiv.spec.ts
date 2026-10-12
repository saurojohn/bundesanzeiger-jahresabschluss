import { describe, it, expect, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { KonsolidierungService } from './konsolidierung.service';
import type { AuthUser } from '../../auth/types/auth-user.types';

/**
 * BEFUND 2026-10-12 — Die Archivsperre umging die Konsolidierung.
 *
 * Die Archivierung wurde in Bilanz, GuV, Anhang und DATEV-Import
 * verdrahtet. `konsolidierung.service` nicht — obwohl
 * `applyKonsolidierung` über `createWithPositionen` eine neue
 * Konzern-Bilanz UND eine Konzern-GuV anlegt.
 *
 * Ein archivierter Mandant bekam damit doch wieder neue Dokumente: ein
 * Widerspruch zu der dokumentierten Regel der Archivierung, nach der
 * „keine neuen Belege mehr" entstehen. Das ist keine neue Fachfrage,
 * sondern die Durchsetzung einer bereits entschiedenen Regel.
 *
 * Geprüft wird der MUTTER- und der TOCHTER-Fall: ein Konzernabschluss
 * kann nicht über eine archivierte Gesellschaft laufen, auch nicht,
 * wenn nur eine Seite archiviert ist.
 */

const KANZLEI = 'aaaaaaaa-0000-4000-8000-00000000000a';
const MUTTER = 'aaaaaaaa-1111-4111-8111-111111111111';
const TOCHTER = 'aaaaaaaa-2222-4222-8222-222222222222';
const ARCHIVIERT = new Date('2026-01-01');

const admin = {
  id: 'u1',
  globalRole: 'SYSTEM_ADMIN',
  mandanten: [],
} as unknown as AuthUser;

const ctx = { ip: null, userAgent: null };

function build(opts: { mutterArchiviert?: Date | null; tochterArchiviert?: Date | null }) {
  const mutter = {
    id: MUTTER,
    kanzleiId: KANZLEI,
    firmenname: 'Mutter GmbH',
    archiviertAt: opts.mutterArchiviert ?? null,
  };
  const tochter = {
    id: TOCHTER,
    kanzleiId: KANZLEI,
    firmenname: 'Tochter GmbH',
    archiviertAt: opts.tochterArchiviert ?? null,
  };


  const prisma = {
    mandant: {
      findUnique: vi.fn().mockResolvedValue(mutter),
      findMany: vi.fn().mockResolvedValue([tochter]),
    },
  };
  const repository = {
    create: vi.fn().mockResolvedValue({
      id: 'e1',
      kanzleiId: KANZLEI,
      mutterMandantId: MUTTER,
      tochterMandantIds: [TOCHTER],
      geschaeftsjahr: 2092,
      konsolidierungsArt: 'VOLLKONSOLIDIERUNG',
      beteiligungsquote: '100',
      anschaffungskosten: '0',
      eigenkapitalTochter: '0',
      jahresueberschussTochter: '0',
      status: 'DRAFT',
      konzernBilanzId: null,
      konzernGuvId: null,
      erstellungsdatum: new Date(),
      finalisiertAt: null,
      buchungen: [],
    }),
    // Nach dem Anlegen liest der Service die Einheit erneut — ohne das
    // scheitert die Gegenprobe an der Mock-Form statt am Verhalten.
    findWithBuchungen: vi.fn().mockResolvedValue({
      id: 'e1',
      kanzleiId: KANZLEI,
      mutterMandantId: MUTTER,
      tochterMandantIds: [TOCHTER],
      geschaeftsjahr: 2092,
      konsolidierungsArt: 'VOLLKONSOLIDIERUNG',
      beteiligungsquote: '100',
      anschaffungskosten: '0',
      eigenkapitalTochter: '0',
      jahresueberschussTochter: '0',
      status: 'DRAFT',
      konzernBilanzId: null,
      konzernGuvId: null,
      erstellungsdatum: new Date(),
      finalisiertAt: null,
      buchungen: [],
    }),
  };

  // auditService wird nach dem Anlegen befragt — ohne Mock scheitert die
  // Gegenprobe an der Mock-Form statt am Verhalten.
  const auditService = { record: vi.fn().mockResolvedValue(undefined) };
  // Reihenfolge: prisma, konsolidierungRepository, bilanzRepository,
  // guvRepository, auditService.
  const service = new KonsolidierungService(
    prisma as never,
    repository as never,
    {} as never,
    {} as never,
    auditService as never,
  );
  return { service, repository };
}

const dto = {
  mutterMandantId: MUTTER,
  tochterMandantIds: [TOCHTER],
  geschaeftsjahr: 2092,
  konsolidierungsArt: 'VOLLKONSOLIDIERUNG',
  beteiligungsquote: 100,
} as never;

describe('BEFUND 2026-10-12: Konsolidierung auf archivierten Mandanten', () => {
  it('eine archivierte MUTTER wird abgelehnt', async () => {
    const { service, repository } = build({ mutterArchiviert: ARCHIVIERT });

    await expect(service.createEinheit(dto, admin, ctx)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('eine archivierte TOCHTER wird abgelehnt', async () => {
    // Nur die Tochter archiviert genügt zur Ablehnung — sonst wäre die
    // Sperre über eine Seitenlücke umgehbar.
    const { service, repository } = build({ tochterArchiviert: ARCHIVIERT });

    await expect(service.createEinheit(dto, admin, ctx)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('aktive Mandanten werden weiterhin konsolidiert', async () => {
    // Gegenprobe zur Abgrenzung: eine Sperre, die den Normalweg zubaut,
    // waere ein Ausfall.
    const { service, repository } = build({});

    await service.createEinheit(dto, admin, ctx);

    expect(repository.create).toHaveBeenCalled();
  });
});