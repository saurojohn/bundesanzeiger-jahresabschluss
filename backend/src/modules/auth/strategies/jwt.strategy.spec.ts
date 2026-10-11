import { describe, it, expect, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';

/**
 * BEFUND 2026-10-11 — `User.isActive` war ein totes Feld.
 *
 * `JwtStrategy.validate()` prüfte nur Signatur und Payload-Form und
 * konsultierte die Datenbank nie. Das Schema führt `isActive` — es stand
 * dort ohne Wirkung. Ein deaktiviertes Konto arbeite weiter, bis das
 * Access-Token ablief; einen Deaktivierungsweg oder eine Token-Version,
 * die alte Tokens sofort entwerten, gab es nicht.
 *
 * Die Prüfung ist bewusst **fail-closed**: auch bei DB-Fehler wird
 * verweigert. Ein Ausfall, der Zugriff erlaubt, wäre genau die Fehler-
 * klasse, die dieses Audit mehrfach gefunden hat.
 */

const USER = '11111111-1111-4111-8111-111111111111';

/** Verhaeltnis, nicht Signatur: die alte validate() war synchron. */
const ruf = (strategy: JwtStrategy, p: unknown): Promise<unknown> =>
  Promise.resolve(strategy.validate(p as never));

const payload = {
  sub: USER,
  email: 'deaktiviert@kanzlei.de',
  globalRole: 'USER',
  mandanten: [{ id: 'm1', rolle: 'STEUERBERATER' }],
};

function build(user: { isActive: boolean } | null | 'dbFehler') {
  const findUnique = vi.fn().mockImplementation(async () => {
    if (user === 'dbFehler') throw new Error('Verbindung zur Datenbank abgerissen');
    return user;
  });

  const config = { get: vi.fn().mockReturnValue('test-secret') } as unknown as ConfigService;
  const strategy = new JwtStrategy(config, { user: { findUnique } } as never);
  return { strategy, findUnique };
}

describe('BEFUND 2026-10-11: Deaktivierte Konten kommen nicht mehr hinein', () => {
  it('ein aktives Konto wird akzeptiert', async () => {
    const { strategy } = build({ isActive: true });
    await expect(ruf(strategy, payload)).resolves.toMatchObject({ id: USER });
  });

  it('ein DEAKTIVIERTES Konto wird abgewiesen', async () => {
    const { strategy } = build({ isActive: false });
    await expect(ruf(strategy, payload)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('ein unbekannter User wird abgewiesen', async () => {
    // Gueltige Signatur, aber der User existiert nicht mehr.
    const { strategy } = build(null);
    await expect(ruf(strategy, payload)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('ein Datenbankausfall verweigert den Zugriff (fail-closed)', async () => {
    // Das ist der teure Punkt. Ohne diese Regel waere ein DB-Ausfall
    // ein Vollzugriff.
    const { strategy } = build('dbFehler');
    await expect(ruf(strategy, payload)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('die Pruefung liest wirklich die Datenbank', async () => {
    // Ohne diesen Test waere ein `if (payload.isActive)` voellig
    // equally — und der Test waere trotzdem gruen.
    const { strategy, findUnique } = build({ isActive: true });
    await ruf(strategy, payload);
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: USER } }),
    );
  });

  it('Mandant-Rollen kommen weiterhin aus dem Token-Snapshot', async () => {
    // Bewusst unveraendert: Rollenentzug wirkt bis zum Token-Ablauf. Der
    // Test haelt fest, dass das eine Entscheidung ist und kein Versehen —
    // sonst wuerde es beim naechsten Umbau unbemerkt mitgezogen.
    const { strategy } = build({ isActive: true });
    const user = (await ruf(strategy, payload)) as { mandanten: unknown[] };
    expect(user.mandanten).toEqual(payload.mandanten);
  });

  it('ein ungueltiges Payload wird weiterhin abgewiesen', async () => {
    const { strategy } = build({ isActive: true });
    await expect(ruf(strategy, { email: 'x' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});