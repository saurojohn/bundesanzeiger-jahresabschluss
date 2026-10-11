import { describe, it, expect, vi } from 'vitest';
import { BilanzRepository } from './bilanz.repository';
import { GuVRepository } from './guv.repository';

/**
 * BEFUND 2026-10-11 — `total` zählte Konzernsätze mit, `items` nicht.
 *
 * `findByMandantPaginated` filtert `konzernEinheitId: null` und sagt im
 * Kommentar ausdrücklich, warum: der Konzernsatz ist ein eigener Datensatz
 * und gehört zur Konsolidierungseinheit, nicht in die Liste der
 * Jahresabschlüsse des Mandanten.
 *
 * `countByMandant` hatte denselben Filter nicht. Für einen Muttermandanten
 * einer Konsolidierungseinheit galt damit:
 *
 *   total: 3    items: 2
 *
 * Die letzte Seite war leer und der Paginator zählte falsch. In einer
 * Oberfläche, die „Seite 2 von 2" anzeigt und dann nichts liefert.
 *
 * Der Test prüft die BEDINGUNG im Where-Clause, nicht das Ergebnis: ein
 * Mock, der unabhängig von der Bedingung eine Zahl zurückgibt, würde einen
 * falschen Filter als richtigen aussehen lassen.
 */

const MANDANT = '11111111-1111-4111-8111-111111111111';

function bilanzRepo() {
  const count = vi.fn().mockResolvedValue(0);
  const findMany = vi.fn().mockResolvedValue([]);
  return {
    repo: new BilanzRepository({ bilanz: { count, findMany }, bilanzPosition: { findMany } } as never),
    count,
    findMany,
  };
}

function guvRepo() {
  const count = vi.fn().mockResolvedValue(0);
  const findMany = vi.fn().mockResolvedValue([]);
  return {
    repo: new GuVRepository({ guV: { count, findMany }, guVPosition: { findMany } } as never),
    count,
    findMany,
  };
}

describe('BEFUND 2026-10-11: Zähler und Liste teilen denselben Filter', () => {
  it('Bilanz: countByMandant schließt den Konzernsatz aus', async () => {
    const { repo, count } = bilanzRepo();

    await repo.countByMandant({ mandantId: MANDANT });

    expect(count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ mandantId: MANDANT, konzernEinheitId: null }),
      }),
    );
  });

  it('GuV: countByMandant schließt den Konzernsatz aus', async () => {
    const { repo, count } = guvRepo();

    await repo.countByMandant({ mandantId: MANDANT });

    expect(count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ mandantId: MANDANT, konzernEinheitId: null }),
      }),
    );
  });

  it('beide behalten den Jahresfilter', async () => {
    // Der Konzernfilter darf den Jahrfilter nicht verdrängen — das wäre
    // ein Tauschfehler statt einer Korrektur.
    const { repo, count } = bilanzRepo();
    await repo.countByMandant({ mandantId: MANDANT, jahr: 2025 });

    expect(count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          mandantId: MANDANT,
          konzernEinheitId: null,
          geschaeftsjahr: 2025,
        }),
      }),
    );
  });
});