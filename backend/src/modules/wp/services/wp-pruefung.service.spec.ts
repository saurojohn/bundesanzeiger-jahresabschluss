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
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { WPPruefungService } from './wp-pruefung.service';

const MANDANT = 'm1';
const BILANZ = 'b1';
const PRUEFUNG = 'p1';
const PRUEFENDE = 'aaaaaaaa-1111-4111-8111-111111111111';
const ZWEITE = 'bbbbbbbb-2222-4222-8222-222222222222';

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

describe('WP-Freigabe: Vier-Augen-Prinzip wird ERZWUNGEN', () => {
  /**
   * Bis 2026-10-07 gab es keine Sperre: der Wirtschaftsprüfer, der die
   * Prüfung durchgeführt hat, konnte sie selbst freigeben.
   *
   * Und sie war auch nicht abstellbar: `WPPruefungsAbschluss` führte
   * genau EIN `wpUserId` — den Prüfenden — und der Seed legte genau
   * EINEN WIRTSCHAFTSPRUEFER an. Eine harte 403-Sperre hätte den
   * gesamten Freigabeweg lahmgelegt.
   *
   * Beides ist erledigt: `freigegebenVonId` (Migration
   * 20261007212118) und ein zweiter WIRTSCHAFTSPRUEFER im Seed
   * (wp2@kanzlei.de). Damit ist die Kontrolle erfüllbar — also wird
   * sie erzwungen.
   */
  function buildService() {
    const repository = {
      findPruefungsAbschlussById: vi.fn().mockResolvedValue({
        ...laufendePruefung,
      }),
      findBilanzMandantId: vi.fn().mockResolvedValue(MANDANT),
      finalizePruefungsAbschluss: vi.fn().mockResolvedValue({}),
      setBilanzStatus: vi.fn().mockResolvedValue({}),
    };
    const audit = { record: vi.fn().mockResolvedValue(undefined) };
    const service = new WPPruefungService(
      repository as never,
      {} as never,
      audit as never,
    );
    return { service, repository, audit };
  }

  it('der Prüfende darf seine eigene Prüfung NICHT freigeben', async () => {
    const { service, repository } = buildService();
    await expect(
      service.finalizePruefung(
        PRUEFUNG,
        { status: 'APPROVED', zusammenfassung: 'geprüft' },
        wpUser(PRUEFENDE),
        ctx,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repository.setBilanzStatus).not.toHaveBeenCalled();
  });

  it('eine zweite Person darf freigeben', async () => {
    const { service, repository } = buildService();
    await service.finalizePruefung(
      PRUEFUNG,
      { status: 'APPROVED', zusammenfassung: 'geprüft' },
      wpUser(ZWEITE),
      ctx,
    );
    expect(repository.setBilanzStatus).toHaveBeenCalledWith(BILANZ, 'APPROVED', ZWEITE);
  });

  it('eine Ablehnung durch den Prüfenden selbst ist erlaubt', async () => {
    // Sie entwertet nichts — sie stoppt nur.
    const { service, repository } = buildService();
    await service.finalizePruefung(
      PRUEFUNG,
      { status: 'REJECTED', zusammenfassung: 'Nachbesserung nötig' },
      wpUser(PRUEFENDE),
      ctx,
    );
    expect(repository.finalizePruefungsAbschluss).toHaveBeenCalled();
    expect(repository.setBilanzStatus).not.toHaveBeenCalled();
  });

  it('der Audit-Eintrag nennt Prüfenden, Freigebenden und die Vier-Augen-Erfüllung', async () => {
    const { service, audit } = buildService();
    await service.finalizePruefung(
      PRUEFUNG,
      { status: 'APPROVED', zusammenfassung: 'geprüft' },
      wpUser(ZWEITE),
      ctx,
    );
    const newState = audit.record.mock.calls[0][0].newState as {
      pruefendeUserId: string;
      freigegebenVonId: string;
      vierAugenErfuellt: boolean;
    };
    expect(newState.pruefendeUserId).toBe(PRUEFENDE);
    expect(newState.freigegebenVonId).toBe(ZWEITE);
    expect(newState.vierAugenErfuellt).toBe(true);
  });

  it('der Seed legt einen ZWEITEN Wirtschaftsprüfer an', async () => {
    // Ohne zweiten Prüfer wäre die erzwungene Sperre wieder eine
    // Abschaltung des Freigabewegs.
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const seed = readFileSync(join(process.cwd(), 'prisma/seed.ts'), 'utf-8');
    const wpNutzer = seed.match(/email: 'wp[^']*'/g) ?? [];
    expect(wpNutzer.length).toBeGreaterThanOrEqual(2);
    expect(seed).toMatch(/wp2@kanzlei\.de/);
  });

  it('das Repository schreibt freigegebenVonId nur beim FREIGEBEN', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const code = readFileSync(join(process.cwd(), 'src/modules/wp/wp.repository.ts'), 'utf-8');
    const start = code.indexOf('async finalizePruefungsAbschluss');
    // Achtung: `code.indexOf('\n  }')` schneidet an der schliessenden
    // Klammer des `input`-Typen ab, also VOR dem Methodenkoerper. Es
    // wird bis zur naechsten Methode geschnitten.
    const ende = code.indexOf('\n  async ', start + 10);
    const koerper = code.slice(start, ende === -1 ? undefined : ende);
    expect(koerper).toContain('freigegebenVonId');
    expect(koerper).toMatch(/APPROVED/);
  });

  it('eine bereits abgeschlossene Prüfung bleibt gesperrt', async () => {
    const repository = {
      findPruefungsAbschlussById: vi.fn().mockResolvedValue({
        ...laufendePruefung,
        status: 'APPROVED',
      }),
      findBilanzMandantId: vi.fn().mockResolvedValue(MANDANT),
      finalizePruefungsAbschluss: vi.fn(),
      setBilanzStatus: vi.fn(),
    };
    const service = new WPPruefungService(repository as never, {} as never, {
      record: vi.fn(),
    } as never);
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
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const notiz = readFileSync(
      join(process.cwd(), 'src/modules/wp/services/wp-notiz.service.ts'),
      'utf-8',
    );
    expect(notiz).toMatch(/existing\.wpUserId\s*===\s*user\.id/);
  });
});
