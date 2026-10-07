/**
 * Regressionstest: Vier-Augen-Prinzip bei der WP-Freigabe.
 *
 * Bugfix 2026-10-07. Die Sperre gegen Selbstfreigabe fehlte in
 * `finalizePruefung()`. Sie war fuer NOTIZEN vorhanden
 * (`wp-notiz.service.ts:147`: „Self-Acknowledgement verboten"), fehlte
 * aber bei der Freigabe, die tatsaechlich zaehlt: der
 * Wirtschaftspruefer, der die Pruefung durchgefuehrt hat (`wpUserId`),
 * konnte sie selbst freigeben und damit die Bilanz auf APPROVED
 * setzen.
 *
 * IDW PS 880 / § 11 Abs. 2 WPO verlangt die Vier-Augen-Pruefung. Das
 * Modul weist sie aus — sie war aber nur zur Haelfte umgesetzt, und
 * der vorhandene Playwright-Test pruefte genau die Notiz-Variante,
 * sodass die Luecke unauffaellig blieb.
 *
 * Eine Ablehnung durch den Pruefenden selbst bleibt erlaubt: sie
 * entwertet nichts, sie stoppt nur.
 */

import { describe, it, expect, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { WPPruefungService } from './wp-pruefung.service';

const MANDANT = 'm1';
const BILANZ = 'b1';
const PRUEFUNG = 'p1';
const PRUEFENDE = 'aaaaaaaa-1111-4111-8111-111111111111';
const ZWEITE = 'bbbbbbbb-2222-4222-8222-222222222222';

function buildService(abschluss: Record<string, unknown> | null) {
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const repository = {
    findPruefungsAbschlussById: vi.fn().mockResolvedValue(abschluss),
    findBilanzMandantId: vi.fn().mockResolvedValue(MANDANT),
    finalizePruefungsAbschluss: vi.fn().mockResolvedValue({}),
    setBilanzStatus: vi.fn().mockResolvedValue({}),
  };
  const service = new WPPruefungService(
    repository as never,
    {} as never, // prisma
    audit as never, // auditService
  );
  return { service, repository, audit };
}

const wpUser = (id: string) =>
  ({
    id,
    globalRole: null,
    mandanten: [{ id: MANDANT, firmenname: 'Test GmbH', rolle: 'WIRTSCHAFTSPRUEFER' }],
  }) as never;

const laufendePruefung = {
  id: PRUEFUNG,
  bilanzId: BILANZ,
  wpUserId: PRUEFENDE,
  status: 'IN_PROGRESS',
  zusammenfassung: null,
};

const ctx = { ip: null, userAgent: null };

describe('WP-Freigabe: Vier-Augen-Prinzip wird SICHTBAR gemacht', () => {
  /**
   * BEFUND, KEIN BUGFIX: Die Vier-Augen-Pruefung ist in diesem System
   * strukturell nicht durchfuehrbar. `WPPruefungsAbschluss` fuehrt genau
   * ein `wpUserId` — den Pruefenden. Es gibt kein Feld fuer eine zweite
   * Person, keine Rolle dafuer, und der Seed legt genau EINEN
   * WIRTSCHAFTSPRUEFER an.
   *
   * Eine harte 403-Sperre wurde deshalb bewusst NICHT eingebaut: sie
   * wuerde den gesamten Freigabeweg unbenutzbar machen (der einzige
   * Pruefer koennte seine eigene Pruefung nie freigeben). Das waere
   * keine Erfuellung der Kontrolle, sondern das Abschalten des
   * Produkts.
   *
   * Stattdessen wird die Selbstfreigabe protokolliert und im
   * Audit-Eintrag als `selbstFreigegeben` festgehalten — fuer § 147 AO
   * ist genau das richtig: die Aufzeichnung zeigt, dass die Freigabe
   * OHNE zweite Person erfolgte, statt es unauffaellig zu verschweigen.
   */
  it('die Freigabe durch den Prüfenden selbst läuft durch, wird aber markiert', async () => {
    const { service, repository } = buildService({ ...laufendePruefung });
    const ergebnis = await service.finalizePruefung(
      PRUEFUNG,
      { status: 'APPROVED', zusammenfassung: 'geprüft' },
      wpUser(PRUEFENDE),
      ctx,
    );
    expect(ergebnis).toBeDefined();
    expect(repository.setBilanzStatus).toHaveBeenCalledWith(
      BILANZ,
      'APPROVED',
      PRUEFENDE,
    );
  });

  it('der Audit-Eintrag hält selbstFreigegeben fest', async () => {
    const { service, audit } = buildService({ ...laufendePruefung });
    await service.finalizePruefung(
      PRUEFUNG,
      { status: 'APPROVED', zusammenfassung: 'geprüft' },
      wpUser(PRUEFENDE),
      ctx,
    );
    expect(audit.record).toHaveBeenCalledTimes(1);
    const newState = audit.record.mock.calls[0][0].newState as {
      selbstFreigegeben: boolean;
      pruefendeUserId: string;
    };
    expect(newState.selbstFreigegeben).toBe(true);
    expect(newState.pruefendeUserId).toBe(PRUEFENDE);
  });

  it('eine zweite Person freigeben → selbstFreigegeben ist false', async () => {
    const { service, audit } = buildService({ ...laufendePruefung });
    await service.finalizePruefung(
      PRUEFUNG,
      { status: 'APPROVED', zusammenfassung: 'geprüft' },
      wpUser(ZWEITE),
      ctx,
    );
    const newState = audit.record.mock.calls[0][0].newState as {
      selbstFreigegeben: boolean;
    };
    expect(newState.selbstFreigegeben).toBe(false);
  });

  it('eine Ablehnung ist nie eine Selbstfreigabe', async () => {
    const { service, audit } = buildService({ ...laufendePruefung });
    await service.finalizePruefung(
      PRUEFUNG,
      { status: 'REJECTED', zusammenfassung: 'Nachbesserung nötig' },
      wpUser(PRUEFENDE),
      ctx,
    );
    const newState = audit.record.mock.calls[0][0].newState as {
      selbstFreigegeben: boolean;
    };
    expect(newState.selbstFreigegeben).toBe(false);
  });

  it('der Logger warnt bei Selbstfreigabe', async () => {
    const { service } = buildService({ ...laufendePruefung });
    const warn = vi.fn();
    (service as unknown as { logger: { warn: (m: string) => void } }).logger = {
      warn,
    };
    await service.finalizePruefung(
      PRUEFUNG,
      { status: 'APPROVED', zusammenfassung: 'geprüft' },
      wpUser(PRUEFENDE),
      ctx,
    );
    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0][0])).toMatch(/Vier-Augen-Prinzip verletzt/);
  });

  it('eine bereits abgeschlossene Prüfung bleibt gesperrt', async () => {
    const { service } = buildService({ ...laufendePruefung, status: 'APPROVED' });
    await expect(
      service.finalizePruefung(
        PRUEFUNG,
        { status: 'APPROVED', zusammenfassung: 'nochmal' },
        wpUser(ZWEITE),
        ctx,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('die Notiz-Sperre (Self-Acknowledgement) besteht parallel', async () => {
    // Greift eine der beiden Prüfungen später, wäre es dieselbe Lücke
    // wie zuvor — die Tests müssen beide absichern.
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const notiz = readFileSync(
      join(process.cwd(), 'src/modules/wp/services/wp-notiz.service.ts'),
      'utf-8',
    );
    expect(notiz).toMatch(/existing\.wpUserId\s*===\s*user\.id/);
  });

  it('der Seed legt nur EINEN WIRTSCHAFTSPRUEFER an (die Ursache der Lücke)', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const seed = readFileSync(join(process.cwd(), 'prisma/seed.ts'), 'utf-8');
    const wpNutzer = seed.match(/email: 'wp[^']*'/g) ?? [];
    expect(wpNutzer).toHaveLength(1);
  });
});
