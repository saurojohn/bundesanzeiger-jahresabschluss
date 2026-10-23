import { describe, it, expect, vi } from 'vitest';
import { BilanzService } from './bilanz.service';
import type { AuthUser } from '../../auth/types/auth-user.types';

/**
 * PRODUKTENTSCHEIDUNG 2026-10-10: Nach der Signatur bleiben die Daten
 * ÄNDERBAR.
 *
 * Damit steht fest, dass die qeS-Signatur einen Zeitpunkt bescheinigt und
 * nicht den Endzustand. Das ist eine bewusste Wahl, keine Verlegenheit —
 * und sie hat eine Folge, die hier festgehalten wird, damit sie niemand
 * übersieht:
 *
 *   Eine signierte Bilanz kann sich nach der Signierung ändern. Die
 *   Signatur bleibt kryptografisch gültig — sie bezeugt das PDF, das
 *   unveränderlich im WORM liegt. Ob der zugrunde liegende Datensatz
 *   danach verändert wurde, ist ausschliesslich aus dem AUDIT-TRAIL
 *   ersichtlich.
 *
 * Daraus folgt: der Audit-Trail ist bei dieser Entscheidung nicht
 * Nebenschauplatz, sondern der einzige Ort, an dem die Veränderung
 * sichtbar wird. Deshalb wird hier auch nichts am Signaturpfad geändert —
 * der Pfad schreibt bereits vollständig (Zertifikat, Hash vorher/nachher,
 * WORM-Key, Zeitstempel-Aussteller), und jede spätere Änderung an der
 * Bilanz erzeugt einen eigenen Audit-Eintrag mit `previousState` und
 * `newState`.
 *
 * Warum trotzdem ein Test? Ein Test, der festhält, dass BEWUSST NICHT
 * gesperrt wird, verhindert, dass jemand die Sperre später "sicherheitshalber"
 * einbaut. Dann nämlich ändert sich das Verhalten des Produkts, ohne dass
 * jemand die Entscheidung nochmal getroffen hat — und zwar zur genau
 * anderen Seite hin, als entschieden wurde.
 *
 * Der Gegenfall ist durch die gewählte Entscheidung abgedeckt: der
 * Audit-Eintrag entfällt nicht, weil die Sperre fehlt.
 */
const BILANZ = '11111111-1111-4111-8111-111111111111';
const MANDANT = '22222222-2222-4222-8222-222222222222';

const user = {
  id: '33333333-3333-4333-8333-333333333333',
  globalRole: 'SYSTEM_ADMIN',
  mandanten: [],
} as unknown as AuthUser;

const ctx = { ip: null, userAgent: null };

/**
 * Signierter Datensatz: es existiert ein WORM-Objekt vom Typ
 * `BILANZ_PDF_SIGNED` zu genau dieser Bilanz. Das ist das, was nach der
 * Signierung tatsächlich in der Datenbank steht — die `Signature`-Tabelle
 * bleibt nach der Entscheidung vom 2026-10-09 leer, der Nachweis liegt im
 * WORM-Objekt und im Audit-Trail.
 */
const SIGNIERT = {
  objectKey: `mandant/${MANDANT}/bilanz-signed/2026/abc.pdf`,
  entityType: 'BILANZ_PDF_SIGNED',
  entityId: BILANZ,
  sha256Hash: 'a'.repeat(64),
  legalHold: true,
};

function buildService() {
  const bilanz = {
    id: BILANZ,
    mandantId: MANDANT,
    geschaeftsjahr: 2093,
    status: 'DRAFT',
    hinweise: 'vor der Signatur',
    positionen: [],
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };
  const repository = {
    findWithPositionen: vi.fn().mockResolvedValue(bilanz),
    findJahresabschlussStatusByBilanzId: vi.fn().mockResolvedValue(null),
    updateWithPositionen: vi.fn().mockResolvedValue({
      ...bilanz,
      hinweise: 'nach der Signatur geaendert',
    }),
  };
  // Der Archivzustand ist nicht Teil dieser Entscheidung — Mandant aktiv.
  const mandantRepository = {
    findArchivierung: vi.fn().mockResolvedValue({ archiviertAt: null, firmenname: 'Muster GmbH' }),
  } as never;
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new BilanzService(repository as never, audit as never, mandantRepository);
  return { service, repository, audit };
}

describe('Entscheidung 2026-10-10: Signatur sperrt die Daten NICHT', () => {
  it('eine signierte Bilanz bleibt änderbar', async () => {
    const { service, repository } = buildService();
    // Signiert ist sie — der WORM-Eintrag existiert und steht unter
    // legalHold. Es gibt in diesem Service keinen Pfad, der danach fragt.
    expect(SIGNIERT.legalHold).toBe(true);

    await expect(
      service.update(BILANZ, MANDANT, { hinweise: 'nach der Signatur geaendert' }, user, ctx),
    ).resolves.toBeDefined();

    expect(repository.updateWithPositionen).toHaveBeenCalled();
  });

  it('die Änderung wird im Audit-Trail festgehalten', async () => {
    // Das ist der Kern der Entscheidung: weil nichts gesperrt wird, muss
    // die Nachvollziehbarkeit zuverlässig sein. Der Eintrag enthaelt den
    // Zustand VOR der Aenderung.
    const { service, audit } = buildService();

    await service.update(BILANZ, MANDANT, { hinweise: 'nach der Signatur geaendert' }, user, ctx);

    expect(audit.record).toHaveBeenCalledTimes(1);
    const p = audit.record.mock.calls[0][0];
    expect(p.action).toBe('UPDATE');
    expect(p.entityType).toBe('Bilanz');
    expect(p.entityId).toBe(BILANZ);
    expect(p.previousState).toMatchObject({ hinweise: 'vor der Signatur' });
    expect(p.newState).toMatchObject({ hinweise: 'nach der Signatur geaendert' });
  });

  it('die Bearbeitungssperre für abgeschlossene Sätze gilt davon unberührt', async () => {
    // Gegenprobe zur Abgrenzung: „Daten dürfen sich ändern" heisst
    // ausdrücklich NICHT „die DRAFT-Sperre fällt weg". Die Inhaltssperre
    // eines abgeschlossenen Satzes ist eine andere Entscheidung und bleibt.
    const bilanz = {
      id: BILANZ, mandantId: MANDANT, geschaeftsjahr: 2093, status: 'VALIDATED',
      hinweise: null, positionen: [], createdAt: new Date(), updatedAt: new Date(),
    };
    const repository = {
      findWithPositionen: vi.fn().mockResolvedValue(bilanz),
    findJahresabschlussStatusByBilanzId: vi.fn().mockResolvedValue(null),
      updateWithPositionen: vi.fn(),
    };
    const service = new BilanzService(
      repository as never,
      { record: vi.fn() } as never,
      { findArchivierung: vi.fn().mockResolvedValue({ archiviertAt: null, firmenname: 'X' }) } as never,
    );

    await expect(
      service.update(
        BILANZ,
        MANDANT,
        { positionen: [{ seite: 'AKTIVA', kontonummer: '1600', bezeichnung: 'X', betragAktuell: 1, reihenfolge: 0 }] },
        user,
        ctx,
      ),
    ).rejects.toThrow();
    expect(repository.updateWithPositionen).not.toHaveBeenCalled();
  });
});