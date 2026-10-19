import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { authenticator } from 'otplib';
import { PrismaClient } from '@prisma/client';

/**
 * MFA-Aktivierung: erneute Authentifizierung.
 *
 * BEFUND 2026-10-19 (Nachtrag 48): `POST /auth/totp/enable` verlangte
 * **kein Passwort**, während `POST /auth/totp/disable` Passwort **und** Code
 * verlangt. Diese Asymmetrie war der Defekt.
 *
 * Gemessen, über die öffentliche API:
 *
 *     (1) POST /auth/totp/setup                        -> 200, Secret geliefert
 *     (2) POST /auth/totp/enable (selbst erzeugter Code)-> 200, TOTP aktiviert
 *     (3) POST /auth/totp/disable, Opfer ohne Secret   -> 401 "TOTP-Code ungültig"
 *     (4) POST /auth/totp/disable, Code des Angreifers -> 200
 *
 * Wer ein gültiges JWT hatte, konnte MFA des Opfers mit dem **eigenen**
 * Secret übernehmen — der „Code" beweist ja nichts, wenn man das Secret
 * selbst erzeugt hat. Das Opfer kennt sein Passwort, aber nicht das
 * Secret: es bleibt **dauerhaft aus seinem eigenen MFA ausgesperrt**,
 * während der Angreifer es jederzeit abschalten kann. Aus einer
 * begrenzten Session-Übernahme wird eine dauerhafte.
 *
 * Behoben: Das Aktivieren verlangt jetzt das Passwort — dieselbe Regel, die
 * im selben Controller für das Deaktivieren gilt.
 */

const BASE = 'http://localhost:3000';
const USER = 'wp@kanzlei.de';
const PASSWORT = 'Demo123!';

describe('MFA: Aktivieren verlangt erneute Authentifizierung', () => {
  const prisma = new PrismaClient();
  let token = '';

  const post = (pfad: string, body: unknown) =>
    fetch(`${BASE}/api/auth/${pfad}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });

  beforeAll(async () => {
    const r = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: USER, password: PASSWORT }),
    });
    const d = (await r.json()) as { accessToken: string };
    expect(d.accessToken, 'Login').toBeTruthy();
    token = d.accessToken;
  });

  afterEach(async () => {
    await prisma.user.update({
      where: { email: USER },
      data: { totpEnabled: false, totpSecret: null },
    });
  });

  it('ohne Passwort wird MFA nicht aktiviert', async () => {
    const setup = await post('totp/setup', {});
    expect(setup.status).toBe(200);
    const { secret } = (await setup.json()) as { secret: string };
    const code = authenticator.generate(secret);

    const res = await post('totp/enable', { secret, code });
    expect(
      res.status,
      'ein gültiges JWT allein darf kein zweites Faktorsystem übernehmen — ' +
        'sonst kann der Angreifer das Opfer dauerhaft aussperren. ' +
        'Erwartet 400 (Validierung: password fehlt) oder 401.',
    ).toBe(400);
    const text = await res.text();
    expect(text, 'die Meldung muss das fehlende Passwort benennen').toMatch(/password/i);
    // Und ausdrücklich kein 500: `bcrypt.compare(undefined, hash)` wirft.
    expect(text).not.toMatch(/data and hash arguments required/);

    const db = await prisma.user.findUniqueOrThrow({
      where: { email: USER },
      select: { totpEnabled: true },
    });
    expect(
      db.totpEnabled,
      'TOTP wurde trotz fehlendem Passwort aktiviert',
    ).toBe(false);
  });

  it('mit falschem Passwort wird MFA nicht aktiviert', async () => {
    const setup = await post('totp/setup', {});
    const { secret } = (await setup.json()) as { secret: string };
    const code = authenticator.generate(secret);

    const res = await post('totp/enable', {
      secret,
      code,
      password: 'FalschesPasswort1!',
    });
    expect(res.status).toBe(401);
    const db = await prisma.user.findUniqueOrThrow({
      where: { email: USER },
      select: { totpEnabled: true },
    });
    expect(db.totpEnabled).toBe(false);
  });

  it('mit Passwort und gültigem Code wird MFA aktiviert', async () => {
    const setup = await post('totp/setup', {});
    const { secret } = (await setup.json()) as { secret: string };
    const code = authenticator.generate(secret);

    const res = await post('totp/enable', { secret, code, password: PASSWORT });
    expect(res.status, `Aktivieren mit Passwort: ${await res.clone().text()}`).toBe(200);

    const db = await prisma.user.findUniqueOrThrow({
      where: { email: USER },
      select: { totpEnabled: true, totpSecret: true },
    });
    expect(db.totpEnabled).toBe(true);
    expect(db.totpSecret, 'der Secret muss verschlüsselt persistiert werden').toBeTruthy();
  });

  it('ein falscher Code wird auch mit korrektem Passwort abgewiesen', async () => {
    const setup = await post('totp/setup', {});
    const { secret } = (await setup.json()) as { secret: string };

    const res = await post('totp/enable', {
      secret,
      code: '000000',
      password: PASSWORT,
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    const db = await prisma.user.findUniqueOrThrow({
      where: { email: USER },
      select: { totpEnabled: true },
    });
    expect(db.totpEnabled).toBe(false);
  });
});
