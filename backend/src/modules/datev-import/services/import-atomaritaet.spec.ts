import { describe, it, expect, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { DatevImportService } from './datev-import.service';
import type { AuthUser } from '../../auth/types/auth-user.types';

/**
 * BEFUND 2026-10-11 — Der DATEV-Import war nicht atomar.
 *
 * Schritt 5 schrieb die Bilanz, Schritt 5b die GuV — und die
 * DRAFT-Prüfung der GuV stand in 5b, also NACH dem Schreiben der Bilanz.
 *
 * Bestand "Bilanz DRAFT + GuV VALIDATED", Import mit
 * `overwriteExisting: true`:
 *   1. Bilanzpositionen werden ERSETZT (deleteMany + Neuanlage)
 *   2. der GuV-Zweig wirft 400
 *   3. der Audit-Eintrag wird nie erreicht
 *
 * Ergebnis: eine GoBD-relevante Mutation ohne Nachweis und ein
 * HTTP-Fehler, der das Gegenteil suggeriert.
 *
 * Behoben auf zwei Ebenen: beide DRAFT-Prüfungen laufen VOR dem ersten
 * Schreibvorgang, und beide Schreibvorgänge laufen in EINER Transaktion.
 */

const MANDANT = '11111111-1111-4111-8111-111111111111';
const BILANZ = '22222222-2222-4222-8222-222222222222';

const admin = {
  id: '33333333-3333-4333-8333-333333333333',
  globalRole: 'SYSTEM_ADMIN',
  mandanten: [],
} as unknown as AuthUser;

const ctx = { ip: null, userAgent: null };

/** CSV mit einer Bank-Buchung und einer Erloes-Buchung. */
const CSV = [
  '"Formatname";"Version";"Berater";"Mandant";"WJ-Beginn";"WJ-Ende";"Sachkontenlaenge";"Datum-von";"Datum-bis";"Bezeichnung";"Diktat";"Buchungstyp";"Rechnungslegungszweck"',
  '"EXTF_Buchungsstapel";"12";"12345";"67890";"01.01.2094";"31.12.2094";"4";"01.01.2094";"31.12.2094";"Test";"Buchhaltung";"1";"00"',
  '"Umsatz";"SH";"WKZ";"Kurs";"Basis";"BWKZ";"Konto";"Gegenkonto";"BUSchluessel";"Belegdatum";"Belegfeld1";"Belegfeld2";"Skonto";"Buchungstext";"Postensperre";"Adressnummer";"PartnerBLZ"',
  '"1000,00";"S";"EUR";"";"";"";"1800";"4400";"0";"3112";"RG1";"";"";"Bank an Erloes";"0";"";""',
  '"1000,00";"H";"EUR";"";"";"";"4400";"1800";"0";"3112";"RG1";"";"";"Bank an Erloes";"0";"";""',
].join('\r\n');

function buildService(bilanzStatus: string, guvStatus: string) {
  const bilanzUpdate = vi.fn().mockResolvedValue({ id: BILANZ, positionen: [] });
  const guvUpdate = vi.fn().mockResolvedValue({ id: 'guv-1', positionen: [] });

  const service = new DatevImportService(
    {
      mandant: {
        findUnique: vi.fn().mockResolvedValue({
          id: MANDANT,
          archiviertAt: null,
          kanzleiId: 'k1',
        }),
      },
      // Die Bestandsabfrage laeuft ueber die Repositorys, nicht ueber prisma.
      $transaction: vi.fn().mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) =>
        cb({ $marker: 'tx' }),
      ),
    } as never,
    {
      findByMandantAndJahr: vi.fn().mockResolvedValue([{ id: BILANZ, status: bilanzStatus }]),
      updateWithPositionen: bilanzUpdate,
      createWithPositionen: vi.fn(),
    } as never,
    {
      findByMandantAndJahr: vi.fn().mockResolvedValue([{ id: 'guv-1', status: guvStatus }]),
      updateWithPositionen: guvUpdate,
      createWithPositionen: vi.fn(),
    } as never,
    { record: vi.fn().mockResolvedValue(undefined) } as never,
  );

  return { service, bilanzUpdate, guvUpdate };
}

const dto = {
  csvBase64: Buffer.from(CSV, 'utf-8').toString('base64'),
  mandantId: MANDANT,
  geschaeftsjahr: 2094,
  skrPlan: 'SKR04',
  overwriteExisting: true,
} as never;

describe('BEFUND 2026-10-11: Der DATEV-Import ist atomar', () => {
  it('GuV VALIDATED: die Bilanz wird NICHT überschrieben', async () => {
    // Der eigentliche Nachweis. Vor dem Fix wurde hier geschrieben und
    // danach mit 400 abgebrochen.
    const { service, bilanzUpdate, guvUpdate } = buildService('DRAFT', 'VALIDATED');

    await expect(service.importFromDatev(dto, admin, ctx)).rejects.toBeInstanceOf(
      BadRequestException,
    );

    expect(bilanzUpdate, 'die Bilanz darf vor der Ablehnung nicht angefasst werden').not.toHaveBeenCalled();
    expect(guvUpdate).not.toHaveBeenCalled();
  });

  it('Bilanz VALIDATED: es wird gar nichts geschrieben', async () => {
    const { service, bilanzUpdate, guvUpdate } = buildService('VALIDATED', 'DRAFT');

    await expect(service.importFromDatev(dto, admin, ctx)).rejects.toBeInstanceOf(
      BadRequestException,
    );

    expect(bilanzUpdate).not.toHaveBeenCalled();
    expect(guvUpdate).not.toHaveBeenCalled();
  });

  it('beide DRAFT: beide Schreibvorgänge teilen sich EINE Transaktion', async () => {
    const { service, bilanzUpdate, guvUpdate } = buildService('DRAFT', 'DRAFT');

    await service.importFromDatev(dto, admin, ctx).catch(() => undefined);

    expect(bilanzUpdate).toHaveBeenCalled();
    expect(guvUpdate).toHaveBeenCalled();

    // Derselbe Client in beiden Aufrufen: das ist der eigentliche Beleg
    // fuer "eine Transaktion" und nicht "zwei Transaktionen, die zufällig
    // kurz hintereinander laufen".
    const bilanzTx = bilanzUpdate.mock.calls[0][3];
    const guvTx = guvUpdate.mock.calls[0][3];
    expect(bilanzTx).toBeDefined();
    expect(guvTx).toBe(bilanzTx);
  });

  it('die Ablehnung nennt den konkreten Bestand', async () => {
    // Bei zwei moeglichen Ablehnungen ist die Meldung das, was den
    // Anwender auf den richtigen Datensatz fuehrt.
    const { service } = buildService('DRAFT', 'ARCHIVED');

    const fehler = await service.importFromDatev(dto, admin, ctx).catch((e: Error) => e.message);
    expect(fehler).toContain('GuV');
    expect(fehler).toContain('ARCHIVED');
  });
});