import { describe, it, expect, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { assertMandantNichtArchiviert } from './mandant-archivierung';
import { BilanzService } from '../../modules/bilanz/services/bilanz.service';
import { GuVService } from '../../modules/guv/services/guv.service';
import { AnhangService } from '../../modules/anhang/services/anhang.service';
import type { AuthUser } from '../../modules/auth/types/auth-user.types';

/**
 * PRODUKTENTSCHEIDUNG 2026-10-09: „Archivieren statt Loeschen".
 *
 * Hintergrund: `DELETE /api/mandant/:id` war ein Hard Delete und riss per
 * `onDelete: Cascade` Bilanz, GuV, Anhang, Jahresabschluss und die
 * qeS-Signaturen mit. Der Pfad ist fuer Mandanten mit Bestand gesperrt
 * (HTTP 409). Damit ein Mandant, der weg muss, trotzdem aus dem aktiven
 * Bestand verschwinden kann, gibt es die Archivierung.
 */

const MANDANT = '11111111-1111-4111-8111-111111111111';
const ID = '22222222-2222-4222-8222-222222222222';
const ARCHIVIERT = new Date('2026-10-09T10:00:00.000Z');

const admin = {
  id: '33333333-3333-4333-8333-333333333333',
  globalRole: 'SYSTEM_ADMIN',
  mandanten: [],
} as unknown as AuthUser;

const ctx = { ip: null, userAgent: null };

function mandantRepositoryMit(archiviertAt: Date | null) {
  return {
    findArchivierung: vi.fn().mockResolvedValue({ archiviertAt, firmenname: 'Muster GmbH' }),
  } as never;
}

/** Bilanz-Repository, das einen vollstaendigen Datensatz liefert. */
function bilanzRepository() {
  return {
    findWithPositionen: vi.fn().mockResolvedValue({
      id: ID,
      mandantId: MANDANT,
      geschaeftsjahr: 2096,
      status: 'DRAFT',
      hinweise: null,
      positionen: [],
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
    }),
    updateWithPositionen: vi.fn().mockResolvedValue({
      id: ID,
      mandantId: MANDANT,
      geschaeftsjahr: 2096,
      status: 'DRAFT',
      hinweise: null,
      positionen: [],
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
    }),
    createWithPositionen: vi.fn(),
    deleteByMandant: vi.fn(),
  };
}

describe('Regel: archivierte Mandanten werden nicht fortgeschrieben', () => {
  it('ein aktiver Mandant passiert', () => {
    expect(() => assertMandantNichtArchiviert(null, 'Bilanz anlegen')).not.toThrow();
  });

  it('ein archivierter Mandant wird abgelehnt', () => {
    expect(() => assertMandantNichtArchiviert(ARCHIVIERT, 'Bilanz anlegen')).toThrow(
      ConflictException,
    );
  });

  it('die Meldung nennt Zeitpunkt, Aktion und den Aufhebungsweg', () => {
    const fehler = (() => {
      try {
        assertMandantNichtArchiviert(ARCHIVIERT, 'GuV löschen');
        return null;
      } catch (e) {
        return e as ConflictException;
      }
    })();

    expect(fehler?.message).toContain(ARCHIVIERT.toISOString());
    expect(fehler?.message).toContain('GuV löschen');
    // Der Aufhebungsweg muss in der Meldung stehen — sonst steht ein
    // Anwender vor einer Sackgasse.
    expect(fehler?.message).toContain('/archivierung/aufheben');
    expect(fehler?.message).toContain('147');
  });
});

describe('Verdrahtung: alle drei Bestandteile prüfen den Archivzustand', () => {
  it('Bilanz-Update wird bei archiviertem Mandanten abgelehnt', async () => {
    const service = new BilanzService(
      bilanzRepository() as never,
      { record: vi.fn() } as never,
      mandantRepositoryMit(ARCHIVIERT),
    );
    await expect(
      service.update(ID, MANDANT, { hinweise: 'neue Notiz' }, admin, ctx),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('GuV-Update wird bei archiviertem Mandanten abgelehnt', async () => {
    const repo = {
      findWithPositionen: vi.fn().mockResolvedValue({
        id: ID,
        mandantId: MANDANT,
        geschaeftsjahr: 2096,
        status: 'DRAFT',
        hinweise: null,
        verfahren: 'GKV',
        ergebnis: 0,
        positionen: [],
      }),
      // Vollstaendiger Datensatz: sonst scheitert der Code VOR dem Fix an
      // `toAuditDto(undefined)` und die Negativprobe saehe nur die
      // Mock-Form statt des Verhaltens.
      updateWithPositionen: vi.fn().mockResolvedValue({
        id: ID,
        mandantId: MANDANT,
        geschaeftsjahr: 2096,
        status: 'DRAFT',
        hinweise: 'neue Notiz',
        verfahren: 'GKV',
        ergebnis: 0,
        positionen: [],
      }),
    };
    const service = new GuVService(
      repo as never,
      { record: vi.fn() } as never,
      mandantRepositoryMit(ARCHIVIERT),
    );
    await expect(
      service.update(ID, MANDANT, { hinweise: 'neue Notiz' }, admin, ctx),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repo.updateWithPositionen).not.toHaveBeenCalled();
  });

  it('Anhang-Update wird bei archiviertem Mandanten abgelehnt', async () => {
    const repo = {
      findWithAbschnitte: vi.fn().mockResolvedValue({
        id: ID,
        mandantId: MANDANT,
        geschaeftsjahr: 2096,
        status: 'DRAFT',
        bilanzierungsMethoden: [],
        bewertungsMethoden: [],
        sonstigePflichtangaben: null,
        abschnitte: [],
      }),
      updateWithAbschnitte: vi.fn().mockResolvedValue({
        id: ID,
        mandantId: MANDANT,
        geschaeftsjahr: 2096,
        status: 'DRAFT',
        bilanzierungsMethoden: [],
        bewertungsMethoden: [],
        sonstigePflichtangaben: 'Text',
        abschnitte: [],
      }),
    };
    const service = new AnhangService(
      repo as never,
      { record: vi.fn() } as never,
      mandantRepositoryMit(ARCHIVIERT),
    );
    await expect(
      service.update(ID, MANDANT, { sonstigePflichtangaben: 'Text' }, admin, ctx),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repo.updateWithAbschnitte).not.toHaveBeenCalled();
  });

  it('ein aktiver Mandant kann weiter geschrieben werden', async () => {
    // Gegenprobe: eine Sperre, die den Arbeitsweg zubaut, waere ein
    // Ausfall, keine Erfuellung.
    const service = new BilanzService(
      bilanzRepository() as never,
      { record: vi.fn() } as never,
      mandantRepositoryMit(null),
    );
    await expect(
      service.update(ID, MANDANT, { hinweise: 'neue Notiz' }, admin, ctx),
    ).resolves.toBeDefined();
  });
});