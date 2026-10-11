import { describe, it, expect, vi } from 'vitest';
import { AuthService } from './auth.service';

/**
 * BEFUND 2026-10-11 — `POST /auth/logout` war zu weit.
 *
 * Zwei Probleme, beide aus dem Code ablesbar:
 *
 * 1. `update({ where: { id: sessionId } })` ohne `userId`. Die Session-ID
 *    kam aus einer Suche nach dem Hash des MITGESCHICKTEN Refresh-Tokens.
 *    Wer den Token eines anderen Users mitbrachte, lieferte dessen
 *    Session-ID — und die wurde widerrufen. Im Audit stand dann der
 *    aufrufende User bei einer fremden Abmeldung: die
 *    Nachvollziehbarkeit (§ 146 AO) waere falsch.
 *
 * 2. Unbekannter Token → `sessionId` bleibt `undefined` → der else-Zweig
 *    widerrief ALLE Sessions des Users. Ein Client mit abgelaufenem oder
 *    rotiertem Refresh-Token wurde damit unerwartet ueberall abgemeldet,
 *    bekam aber `204` und keine Meldung. Aus "dieses Geraet abmelden" wurde
 *    "ueberall abmelden".
 *
 * Der Test prueft beides getrennt, weil die Fehler unterschiedliche Ursachen
 * haben: (1) fehlende Sperrbedingung, (2) falsche Verzweigung.
 */

const USER = '33333333-3333-4333-8333-333333333333';
const SESSION = '44444444-4444-4444-8444-444444444444';

function buildService() {
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  // Reihenfolge: prisma, jwtService, configService, totpService, auditService
  const service = new AuthService(
    { userSession: { updateMany } } as never,
    {} as never,
    { get: (k: string, d?: string) => d ?? '15m' } as never,
    {} as never,
    { record: vi.fn().mockResolvedValue(undefined) } as never,
  );
  return { service, updateMany };
}

describe('BEFUND 2026-10-11: Logout meldet genau die beabsichtigte Sitzung ab', () => {
  it('eine fremde Session wird nicht widerrufen', async () => {
    const { service, updateMany } = buildService();

    await service.logout(USER, SESSION);

    // Der Beleg ist die BEDINGUNG, nicht das Ergebnis: `count: 0` waere
    // ebenfalls "nichts passiert", aber aus dem richtigen Grund. Deshalb
    // wird auf `userId` geprueft.
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: SESSION, userId: USER }),
      }),
    );
  });

  it('unbekannter Token widerruft NICHT alle Sessions', async () => {
    // Der eigentliche Befund. `gezieltAngefordert` heisst: der Aufrufer hat
    // einen Token geschickt, also wollte er EINEN Geraet abmelden.
    const { service, updateMany } = buildService();

    await service.logout(USER, undefined, true);

    expect(updateMany).not.toHaveBeenCalled();
  });

  it('ohne Token bleibt der globale Widerruf (alle eigenen Geraete)', async () => {
    // Kein Token bedeutet: der Client kann nur "alles abmelden" gemeint
    // haben. Das bleibt erhalten — ein Test, der es auch hier entfernen
    // wuerde, wuerde ein Verhalten loeschen, das niemand reklamiert hat.
    const { service, updateMany } = buildService();

    await service.logout(USER, undefined, false);

    expect(updateMany).toHaveBeenCalledWith({
      where: { userId: USER, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('eine bekannte eigene Session wird widerrufen', async () => {
    const { service, updateMany } = buildService();

    await service.logout(USER, SESSION, true);

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: SESSION, userId: USER }),
      }),
    );
  });
});