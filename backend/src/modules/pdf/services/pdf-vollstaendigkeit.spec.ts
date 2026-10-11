import { describe, it, expect, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { PdfService } from './pdf.service';
import type { AuthUser } from '../../auth/types/auth-user.types';

/**
 * BEFUND 2026-10-11 — Das Vollständigkeits-Gate war nur für die Bilanz
 * verdrahtet.
 *
 * `generateBilanzPdf` ruft `assertBilanzVollstaendigUndSaldostimmig` auf und
 * verweigert ein PDF ohne Positionen — mit der Begründung: „ohne Positionen
 * ist keine Aussage möglich". Dieselbe Begründung gilt für GuV und Anhang,
 * dort stand aber kein Gate.
 *
 * Ein GuV ohne Positionen erzeugte also ein PDF, das
 * „Jahresergebnis: 0,00 EUR" behauptet — eine belegte Aussage ohne Beleg,
 * die danach im WORM mit `legalHold` landet und qeS-signierbar ist.
 *
 * Bewusst KEIN Saldo-Gate für die GuV: Erlöse minus Aufwendungen ergibt das
 * Jahresergebnis, nicht null. Eine GuV „saldo-stimmig" zu prüfen wäre
 * erfundene Buchhaltung. Geprüft wird nur, was das Bilanz-Gate ebenfalls
 * begründet: es muss etwas zu berichten geben.
 */

const MANDANT = '11111111-1111-4111-8111-111111111111';
const GUV = '22222222-2222-4222-8222-222222222222';
const ANHANG = '33333333-3333-4333-8333-333333333333';

const admin = {
  id: '44444444-4444-4444-8444-444444444444',
  globalRole: 'SYSTEM_ADMIN',
  mandanten: [],
} as unknown as AuthUser;

const ctx = { ip: null, userAgent: null };

function buildService(guvPositionen: unknown[], anhangAbschnitte: unknown[]) {
  const guvRepo = {
    findWithPositionen: vi.fn().mockResolvedValue({
      id: GUV,
      mandantId: MANDANT,
      geschaeftsjahr: 2094,
      status: 'DRAFT',
      positionen: guvPositionen,
    }),
  };
  const anhangRepo = {
    findWithAbschnitte: vi.fn().mockResolvedValue({
      id: ANHANG,
      mandantId: MANDANT,
      geschaeftsjahr: 2094,
      status: 'DRAFT',
      abschnitte: anhangAbschnitte,
    }),
  };

  // Reihenfolge laut Konstruktor: prisma, bilanz, guv, anhang, storage,
  // wormObject, audit, branding.
  const service = new PdfService(
    {
      mandant: {
        findFirst: vi.fn().mockResolvedValue({
          id: MANDANT,
          firmenname: 'X GmbH',
          rechtsform: 'GmbH',
        }),
      },
    } as never,
    {} as never,
    guvRepo as never,
    anhangRepo as never,
    {} as never,
    { create: vi.fn() } as never,
    { record: vi.fn() } as never,
    { getSnapshot: vi.fn().mockResolvedValue(null) } as never,
  );
  return { service, guvRepo, anhangRepo };
}

describe('BEFUND 2026-10-11: Kein leeres Pflichtdokument', () => {
  it('eine GuV ohne Positionen erzeugt kein PDF', async () => {
    const { service } = buildService([], []);
    await expect(service.generateGuVPdf(GUV, MANDANT, admin, ctx)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('ein Anhang ohne Abschnitte erzeugt kein PDF', async () => {
    const { service } = buildService([], []);
    await expect(service.generateAnhangPdf(ANHANG, MANDANT, admin, ctx)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('mit Inhalt kommt die Sperre nicht zum Tragen', async () => {
    // Gegenprobe zur Abgrenzung: eine Sperre, die den Normalfall blockiert,
    // wäre ein Ausfall. Der Test endet danach an einem spaeteren Fehler —
    // wichtig ist, dass es NICHT "keine Positionen" ist.
    const { service } = buildService(
      [{ seite: 'ERLOES', kontonummer: '4400', bezeichnung: 'Erlöse', betragAktuell: '1000' }],
      [{ reihenfolge: 0, titel: 'Bilanzverfahren' }],
    );

    const guvErgebnis = await service
      .generateGuVPdf(GUV, MANDANT, admin, ctx)
      .then(() => 'ok')
      .catch((e: Error) => e.message);

    expect(guvErgebnis).not.toContain('keine Positionen');
  });
});