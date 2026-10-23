import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { UpdateGuVDto } from '../dto/update-guv.dto';
import { GuVService } from './guv.service';
import type { AuthUser } from '../../auth/types/auth-user.types';

/**
 * BEFUND 2026-10-11 — `ergebnis` (Jahresüberschuss/-fehlbetrag) der GuV
 * war clientgesteuert.
 *
 * `CreateGuVDto` kannte das Feld nicht, `UpdateGuVDto` schon. Im Service
 * stand `let ergebnis = dto.ergebnis`, neu berechnet wurde nur, wenn
 * Positionen mitgeschickt wurden. Damit genügte EIN Request ohne
 * Positionen:
 *
 *     PATCH { ergebnis: 999999.99 }  ->  HTTP 200, DB 999999.99
 *
 * Der Wert fliesst von dort in das GuV-PDF, in das Abschluss-PDF und in
 * die E-Bilanz-XBRL als `netIncome`. Das PDF landet im WORM mit `legalHold`
 * und ist qeS-signierbar — das Jahresergebnis eines signierten Abschlusses
 * war also frei setzbar.
 *
 * Zwei Ebenen werden geprüft, weil beide für sich allein nicht reichen:
 * das DTO (Input-Tür) und den Service (die Zuweisung).
 */

const GUV = '11111111-1111-4111-8111-111111111111';
const MANDANT = '22222222-2222-4222-8222-222222222222';

const admin = {
  id: '33333333-3333-4333-8333-333333333333',
  globalRole: 'SYSTEM_ADMIN',
  mandanten: [],
} as unknown as AuthUser;

const ctx = { ip: null, userAgent: null };

/** Wie die globale ValidationPipe: unbekannte Properties entfernen. */
function whitelist<T extends object>(obj: T): T {
  validateSync(obj, { whitelist: true });
  return obj;
}

function guvMitStatus(status: string) {
  const updateWithPositionen = vi.fn().mockResolvedValue({
    id: GUV,
    mandantId: MANDANT,
    geschaeftsjahr: 2091,
    status,
    hinweise: null,
    verfahren: 'GKV',
    ergebnis: 4242,
    positionen: [],
  });
  const service = new GuVService(
    {
      findWithPositionen: vi.fn().mockResolvedValue({
        id: GUV,
        mandantId: MANDANT,
        geschaeftsjahr: 2091,
        status,
        hinweise: null,
        verfahren: 'GKV',
        ergebnis: 4242,
        positionen: [],
      }),
      updateWithPositionen,
      // BEFUND 2026-10-24 (Nachtrag 95): der Status des Jahresabschlusses,
      // zu dem die GuV gehoert — null = nicht eingereicht.
      findJahresabschlussStatusByGuVId: vi.fn().mockResolvedValue(null),
    } as never,
    { record: vi.fn() } as never,
    { findArchivierung: vi.fn().mockResolvedValue({ archiviertAt: null, firmenname: 'X' }) } as never,
  );
  return { service, updateWithPositionen };
}

describe('BEFUND 2026-10-11: Jahresergebnis ist nicht clientgesteuert', () => {
  it('das DTO kennt `ergebnis` nicht mehr — die ValidationPipe entfernt es', () => {
    // Die Input-Tür. `plainToInstance` allein entfernt nichts — erst die
    // ValidationPipe mit `whitelist` strippt, `forbidNonWhitelisted` wirft.
    // Genau deshalb wird hier beides geprüft statt nur die Property-Liste:
    // ein DTO, das die Property nicht DEKLARIERT, ist der eigentliche Fix;
    // das Strippen ist die vorhandene Absicherung, die jetzt greift.
    const dto = plainToInstance(UpdateGuVDto, { ergebnis: 999999.99 });
    whitelist(dto);
    expect(
      dto,
      'nach dem Whitelist-Stripp darf `ergebnis` nicht mehr am Objekt hängen',
    ).not.toHaveProperty('ergebnis');
  });

  it('`ergebnis` im Body löst einen Validierungsfehler aus', () => {
    const dto = plainToInstance(UpdateGuVDto, { ergebnis: 999999.99 });
    const errors = validateSync(dto, { whitelist: true, forbidNonWhitelisted: true });
    expect(
      errors.some((e) => e.property === 'ergebnis'),
      'ergebnis muss als unerlaubtes Feld abgewiesen werden',
    ).toBe(true);
  });

  it('der Service übernimmt den Wert aus dem Request nicht', async () => {
    const { service, updateWithPositionen } = guvMitStatus('DRAFT');

    // Selbst wenn ein Aufrufer das umgeht (z. B. ein interner Pfad ohne
    // ValidationPipe), darf der Wert nicht landen.
    await service.update(
      GUV,
      MANDANT,
      { ergebnis: 999999.99 } as never,
      admin,
      ctx,
    );

    expect(updateWithPositionen).toHaveBeenCalledWith(
      GUV,
      MANDANT,
      expect.objectContaining({ ergebnis: undefined }),
    );
  });

  it('ohne Positionsänderung bleibt der bestehende Wert unberührt', async () => {
    // Nicht `undefined` heisst nicht "null": der Datenbankwert bleibt, weil
    // `updateWithPositionen` nur gesetzte Felder schreibt.
    const { service, updateWithPositionen } = guvMitStatus('DRAFT');

    await service.update(GUV, MANDANT, { hinweise: 'nur eine Notiz' }, admin, ctx);

    expect(updateWithPositionen).toHaveBeenCalledWith(
      GUV,
      MANDANT,
      expect.objectContaining({ ergebnis: undefined, hinweise: 'nur eine Notiz' }),
    );
  });

  it('mit Positionsänderung wird weiterhin berechnet, nicht übernommen', async () => {
    // Gegenprobe zur Abgrenzung: der berechnete Weg muss funktionieren.
    const { service, updateWithPositionen } = guvMitStatus('DRAFT');

    await service.update(
      GUV,
      MANDANT,
      {
        positionen: [
          { kontonummer: '4400', bezeichnung: 'Erlöse', kategorie: 'ERLOES', betragAktuell: 1000, reihenfolge: 0 },
          { kontonummer: '5000', bezeichnung: 'Material', kategorie: 'MATERIAL', betragAktuell: 400, reihenfolge: 1 },
        ],
        // Ein mitgeschickter Wert darf die Berechnung nicht überschreiben.
        ergebnis: 999999.99,
      } as never,
      admin,
      ctx,
    );

    const data = updateWithPositionen.mock.calls[0][2] as { ergebnis: number };
    expect(data.ergebnis).not.toBe(999999.99);
    expect(typeof data.ergebnis).toBe('number');
    expect(data.ergebnis).toBeLessThan(1000);
  });
});