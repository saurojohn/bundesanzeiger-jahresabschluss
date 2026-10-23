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
    // `loadEinheitForUser` loest die Kanzlei des Users auf (SYSTEM_ADMIN:
    // die erste Kanzlei) — der apply-Pfad braucht das, sonst scheitert der
    // Test an der Mock-Form statt an der Regel.
    kanzlei: {
      findFirst: vi.fn().mockResolvedValue({ id: KANZLEI }),
    },
    mandant: {
      findUnique: vi.fn().mockResolvedValue(mutter),
      // BEFUND 2026-10-23 (Nachtrag 89): `applyKonsolidierung` laedt die
      // Archivzeitpunkte von MUTTER **und** TOCHTER, der Anlege-Pfad nur die
      // Toechter. Der Mock beantwortet deshalb je nach Abfrage.
      findMany: vi.fn().mockImplementation(async (args: { where: { id: { in: string[] } } }) =>
        args.where.id.in.length > 1 ? [mutter, tochter] : [tochter],
      ),
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
  // Die Bilanz-/GuV-Repositories werden mitgegeben, damit der Test am
  // VERHALTEN scheitert (die Berechnung darf nicht starten) und nicht an
  // einer Mock-Luecke.
  const bilanzRepository = {
    findByMandantAndJahr: vi.fn().mockResolvedValue([]),
    findWithPositionen: vi.fn(),
    createWithPositionen: vi.fn(),
  };
  const guvRepository = {
    findByMandantAndJahr: vi.fn().mockResolvedValue([]),
    findWithPositionen: vi.fn(),
    createWithPositionen: vi.fn(),
  };
  const service = new KonsolidierungService(
    prisma as never,
    repository as never,
    bilanzRepository as never,
    guvRepository as never,
    auditService as never,
  );
  return { service, repository, bilanzRepository, guvRepository };
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

/**
 * BEFUND 2026-10-23 (Nachtrag 89): Die Archivsperre stand nur im
 * **Anlege-Pfad** — `applyKonsolidierung` war die Hintertuer.
 *
 * Der Kopfkommentar dieses Tests benannte `applyKonsolidierung` bereits als
 * betroffenen Pfad ("obwohl `applyKonsolidierung` ueber
 * `createWithPositionen` eine neue Konzern-Bilanz UND eine Konzern-GuV
 * anlegt") — getestet wurde aber nur `createEinheit`. Die Regel war also
 * beschrieben und an **einer** der beiden Stellen eingeloest.
 *
 * Gemessen an der laufenden Anwendung (Mutter archivieren, dann anwenden):
 *
 *     PATCH /api/mandant/<M>/archivierung              -> HTTP 200
 *     POST  /api/bilanz?mandantId=<M>                  -> HTTP 403 (Gegenprobe)
 *     POST  /api/konsolidierung/einheiten/<E>/apply
 *       -> HTTP 201 {"konzernBilanzId":"…","konzernGuvId":"…"}
 *     SELECT status FROM bilanz
 *       WHERE mandantId='<M>' AND konzernEinheitId='<E>'
 *       -> VALIDATED            <- neue Belege fuer einen archivierten Mandanten
 */
describe('BEFUND 2026-10-23: Konsolidierung anwenden auf archivierten Mandanten', () => {
  it('eine archivierte MUTTER wird beim Anwenden abgelehnt', async () => {
    const { service, bilanzRepository } = build({ mutterArchiviert: ARCHIVIERT });

    await expect(service.applyKonsolidierung('e1', admin, ctx)).rejects.toBeInstanceOf(
      ConflictException,
    );
    // Und es darf **nicht** gerechnet werden: die Sperre greift vor der
    // Berechnung, nicht danach.
    expect(
      bilanzRepository.findByMandantAndJahr,
      'die Berechnung darf bei einem archivierten Mandanten nicht starten',
    ).not.toHaveBeenCalled();
  });

  it('eine archivierte TOCHTER wird beim Anwenden abgelehnt', async () => {
    // Nur die Tochter archiviert genügt zur Ablehnung — sonst wäre die
    // Sperre über eine Seitenlücke umgehbar.
    const { service, bilanzRepository } = build({ tochterArchiviert: ARCHIVIERT });

    await expect(service.applyKonsolidierung('e1', admin, ctx)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(
      bilanzRepository.findByMandantAndJahr,
      'die Berechnung darf bei einem archivierten Mandanten nicht starten',
    ).not.toHaveBeenCalled();
  });
});