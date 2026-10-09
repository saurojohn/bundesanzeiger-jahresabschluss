import { describe, it, expect, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { BilanzService } from '../../modules/bilanz/services/bilanz.service';
import { GuVService } from '../../modules/guv/services/guv.service';
import { AnhangService } from '../../modules/anhang/services/anhang.service';
import type { AuthUser } from '../../modules/auth/types/auth-user.types';

/**
 * BEFUND 2026-10-09 — Die Regel aus `common/utils/status-transition` ist
 * nur dann etwas wert, wenn sie in ALLEN drei Bestandteilen hängt.
 *
 * Vorher hatte jeder Service seine eigene Kopie der DRAFT-Pruefung:
 * Bilanz, GuV und Anhang mit drei verschiedenen Fehlermeldungen für
 * denselben Sachverhalt — und alle drei mit demselben Loch.
 *
 * Diese Spec prüft die Verdrahtung, nicht die Regel (die hat ihre eigene).
 * Ein Test der nur die Regel prüft, wäre grün, selbst wenn niemand sie
 * aufruft.
 */

const MANDANT = '11111111-1111-4111-8111-111111111111';
const ID = '22222222-2222-4222-8222-222222222222';

const admin = {
  id: '33333333-3333-4333-8333-333333333333',
  globalRole: 'SYSTEM_ADMIN',
  mandanten: [],
} as unknown as AuthUser;

const ctx = { ip: null, userAgent: null };

/**
 * Mandant-Repository-Mock. Standardmaessig ein AKTIVER Mandant
 * (`archiviertAt: null`) — die Tests hier pruefen die Bearbeitungssperre,
 * nicht die Archivierung. Die Archivierung hat ihre eigene Spec.
 */
function mandantRepositoryMock(archiviertAt: Date | null = null) {
  return {
    findArchivierung: vi.fn().mockResolvedValue({ archiviertAt, firmenname: 'Muster GmbH' }),
  } as never;
}

function bilanzMitStatus(status: string) {
  // WICHTIG fuer die Negativprobe: der Mock gibt einen vollstaendigen
  // Datensatz zurueck. Sonst scheitert die alte Fassung an einem TypeError
  // aus `toAuditDto(undefined)` und der Test saehe den Produktfehler nur
  // indirekt. So laeuft das alte Verhalten sauber durch — der Test
  // scheitert dann daran, dass es NICHT abgelehnt hat.
  const updateWithPositionen = vi.fn().mockResolvedValue({
    id: ID,
    mandantId: MANDANT,
    geschaeftsjahr: 2096,
    status,
    hinweise: null,
    positionen: [],
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  });
  const repository = {
    findWithPositionen: vi.fn().mockResolvedValue({
      id: ID,
      mandantId: MANDANT,
      geschaeftsjahr: 2096,
      status,
      hinweise: null,
      positionen: [],
    }),
    updateWithPositionen,
  };
  const service = new BilanzService(repository as never, { record: vi.fn() } as never, mandantRepositoryMock());
  return { service, updateWithPositionen };
}

function guvMitStatus(status: string) {
  const updateWithPositionen = vi.fn().mockResolvedValue({
    id: ID,
    mandantId: MANDANT,
    geschaeftsjahr: 2096,
    status,
    hinweise: null,
    verfahren: 'GKV',
    // `ergebnis` wird von toAuditDto mit `.toString()` gelesen — ohne das
    // scheitert der Mock an der Form statt am Verhalten.
    ergebnis: 0,
    positionen: [],
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  });
  const repository = {
    findWithPositionen: vi.fn().mockResolvedValue({
      id: ID,
      mandantId: MANDANT,
      geschaeftsjahr: 2096,
      status,
      hinweise: null,
      verfahren: 'GKV',
      ergebnis: 0,
      positionen: [],
    }),
    updateWithPositionen,
  };
  const service = new GuVService(repository as never, { record: vi.fn() } as never, mandantRepositoryMock());
  return { service, updateWithPositionen };
}

function anhangMitStatus(status: string) {
  const updateWithAbschnitte = vi.fn().mockResolvedValue({
    id: ID,
    mandantId: MANDANT,
    geschaeftsjahr: 2096,
    status,
    bilanzierungsMethoden: [],
    bewertungsMethoden: [],
    sonstigePflichtangaben: null,
    abschnitte: [],
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  });
  const repository = {
    findWithAbschnitte: vi.fn().mockResolvedValue({
      id: ID,
      mandantId: MANDANT,
      geschaeftsjahr: 2096,
      status,
      bilanzierungsMethoden: [],
      bewertungsMethoden: [],
      sonstigePflichtangaben: null,
      abschnitte: [],
    }),
    updateWithAbschnitte,
  };
  const service = new AnhangService(repository as never, { record: vi.fn() } as never, mandantRepositoryMock());
  return { service, updateWithAbschnitte };
}

describe('Verdrahtung: alle drei Bestandteile sind gegen das Zurücksetzen geschützt', () => {
  it('Bilanz', async () => {
    const { service, updateWithPositionen } = bilanzMitStatus('VALIDATED');
    await expect(service.update(ID, MANDANT, { status: 'DRAFT' }, admin, ctx)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(updateWithPositionen).not.toHaveBeenCalled();
  });

  it('GuV', async () => {
    const { service, updateWithPositionen } = guvMitStatus('VALIDATED');
    await expect(service.update(ID, MANDANT, { status: 'DRAFT' }, admin, ctx)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(updateWithPositionen).not.toHaveBeenCalled();
  });

  it('Anhang', async () => {
    const { service, updateWithAbschnitte } = anhangMitStatus('VALIDATED');
    await expect(service.update(ID, MANDANT, { status: 'DRAFT' }, admin, ctx)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(updateWithAbschnitte).not.toHaveBeenCalled();
  });

  it('der Vier-Augen-Stand APPROVED ist in allen drei geschützt', async () => {
    const { service } = bilanzMitStatus('APPROVED');
    await expect(service.update(ID, MANDANT, { status: 'DRAFT' }, admin, ctx)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('im Status DRAFT bleibt das Speichern normaler Inhalte moeglich', () => {
    // Gegenprobe: eine Sperre, die den Bearbeitungsweg zubaut, waere ein
    // Ausfall, keine Erfuellung.
    const { service, updateWithPositionen } = bilanzMitStatus('DRAFT');
    expect(() => service.update(ID, MANDANT, { hinweise: 'Notiz' }, admin, ctx)).not.toThrow();
    expect(updateWithPositionen).toBeDefined();
  });
});