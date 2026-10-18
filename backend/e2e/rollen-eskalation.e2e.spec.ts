import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';

/**
 * Rollen-Eskalation über Mandanten hinweg.
 *
 * BEFUND 2026-10-17 (Nachtrag 40): Der `RolesGuard` wertete **alle** Rollen
 * des Users aus **allen** Mandanten gemeinsam aus:
 *
 *     const userMandantRoles = user.mandanten.flatMap((m) => m.rolle);
 *     const hasRole = requiredRoles.some((r) => userMandantRoles.includes(r));
 *
 * Das Datenmodell ist das Gegenteil: `UserMandantRole` führt eine
 * `mandantId`, und `@@unique([userId, mandantId, rolle])`. Die Rolle gehört
 * zu einem Mandanten — der Guard hat daraus eine globale gemacht.
 *
 * Gemessen über die öffentliche API. Ein User mit
 *
 *     Beispiel GmbH → STEUERBERATER
 *     Beispiel GmbH → WIRTSCHAFTSPRUEFER    ← nur hier ist er WP
 *     Demo GmbH    → STEUERBERATER
 *     Test AG      → STEUERBERATER
 *
 * rief `POST /api/signatur/sign-abschluss` für **Test AG** auf und erhielt
 * **HTTP 200 mit einer echten `signatureId`**.
 *
 * Er ist auf Test AG kein Wirtschaftsprüfer. Damit greift die
 * Vier-Augen-Kontrolle für diesen Mandanten nicht: eine qeS ist eine
 * **Bescheinigung**, und sie wurde abgegeben von jemandem, der für den
 * Mandanten nicht bescheinigen darf.
 *
 * **Zum Vergleich: derselbe Aufruf auf `sign-bilanz` bleibt erlaubt.** Das
 * ist richtig — dort lautet die Rollenbindung
 * `@Roles('WIRTSCHAFTSPRUEFER', 'STEUERBERATER')`, und der User ist auf
 * Test AG STEUERBERATER. Die Prüfung greift mandantenbezogen, wie sie soll.
 * Die Eskalation zeigt sich nur bei Routen, die **ausschließlich** der
 * WP-Rolle vorbehalten sind.
 */

const BASE = 'http://localhost:3000';
const P12_PATH = './tmp/test-certs/test-token.p12';
const P12_PASSWORD = 'Test1234!';
const BERATER = 'steuerberater@kanzlei.de';
const MANDANT_OHNE_WP = 'Test AG'; // Rolle dort: STEUERBERATER
const MANDANT_MIT_WP = 'Beispiel GmbH'; // hier bekommt der User zusätzlich WP
const JAHR = 2093;

describe('Rollen-Eskalation über Mandanten', () => {
  const prisma = new PrismaClient();
  let token = '';
  let mandantId = '';
  let abschlussId = '';
  /** Die zusätzliche Rolle — wird im afterAll wieder entzogen. */
  let vergebeneRolleId = '';

  async function anmelden(email: string): Promise<string> {
    const r = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'Demo123!' }),
    });
    expect(r.status, `Login ${email}`).toBe(200);
    return ((await r.json()) as { accessToken: string }).accessToken;
  }

  async function satzAnlegen(art: 'bilanz' | 'guv' | 'anhang'): Promise<string> {
    const h = {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      'x-mandant-id': mandantId,
    };
    let res: Response;
    if (art === 'bilanz') {
      res = await fetch(`${BASE}/api/bilanz?mandantId=${mandantId}`, {
        method: 'POST',
        headers: h,
        body: JSON.stringify({
          mandantId,
          geschaeftsjahr: JAHR,
          positionen: [
            { seite: 'AKTIVA', kontonummer: 'B.IV.', bezeichnung: 'Kasse', betragAktuell: 1000, reihenfolge: 1 },
            { seite: 'PASSIVA', kontonummer: 'A.I.', bezeichnung: 'Kapital', betragAktuell: 1000, reihenfolge: 1 },
          ],
        }),
      });
    } else if (art === 'guv') {
      res = await fetch(`${BASE}/api/guv?mandantId=${mandantId}`, {
        method: 'POST',
        headers: h,
        body: JSON.stringify({
          mandantId,
          geschaeftsjahr: JAHR,
          verfahren: 'GKV',
          positionen: [
            { kontonummer: '1.', bezeichnung: 'Umsatzerloese', kategorie: 'ERLOES', betragAktuell: 1000, reihenfolge: 1 },
          ],
        }),
      });
    } else {
      res = await fetch(`${BASE}/api/anhang?mandantId=${mandantId}`, {
        method: 'POST',
        headers: h,
        body: JSON.stringify({
          mandantId,
          geschaeftsjahr: JAHR,
          abschnitte: [{ titel: 'Angaben', reihenfolge: 1, inhalt: 'Sitz: Berlin' }],
        }),
      });
    }
    expect(res.status, `${art} anlegen`).toBe(201);
    const roh = (await res.json()) as Record<string, unknown>;
    return ((roh.bilanz ?? roh.guv ?? roh) as { id: string }).id;
  }

  beforeAll(async () => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: BERATER },
      select: { id: true },
    });
    const mandanten = await prisma.mandant.findMany({
      select: { id: true, firmenname: true },
    });
    mandantId = mandanten.find((m) => m.firmenname === MANDANT_OHNE_WP)?.id ?? '';
    const mandantMitWp = mandanten.find((m) => m.firmenname === MANDANT_MIT_WP)?.id ?? '';
    expect(mandantId, `${MANDANT_OHNE_WP} muss erreichbar sein`).not.toBe('');
    expect(mandantMitWp, `${MANDANT_MIT_WP} muss da sein`).not.toBe('');

    // VORBEDINGUNG: Auf dem Zielmandanten ist der User nur STEUERBERATER.
    const rolleVorher = await prisma.userMandantRole.findMany({
      where: { userId: user.id, mandantId },
      select: { rolle: true },
    });
    expect(
      rolleVorher.map((r) => r.rolle),
      'Vorbedingung: der User darf auf dem Zielmandanten KEIN WP sein',
    ).not.toContain('WIRTSCHAFTSPRUEFER');

    // Die WP-Rolle kommt auf den ANDEREN Mandanten — genau das ist der Fall.
    const vergeben = await prisma.userMandantRole.create({
      data: { userId: user.id, mandantId: mandantMitWp, rolle: 'WIRTSCHAFTSPRUEFER' },
      select: { id: true },
    });
    vergebeneRolleId = vergeben.id;

    // Token erst danach holen: das JWT muss die neue Rolle enthalten.
    token = await anmelden(BERATER);
    const me = (await (
      await fetch(`${BASE}/api/auth/me`, { headers: { authorization: `Bearer ${token}` } })
    ).json()) as { mandanten: Array<{ firmenname: string; rolle: string }> };
    expect(
      me.mandanten.some((m) => m.rolle === 'WIRTSCHAFTSPRUEFER'),
      'Vorbedingung: das JWT muss die WP-Rolle aus dem anderen Mandanten tragen',
    ).toBe(true);

    // Jahresabschluss auf dem Mandanten bauen, auf dem er Berater ist.
    const b = await satzAnlegen('bilanz');
    const g = await satzAnlegen('guv');
    const a = await satzAnlegen('anhang');
    for (const [url, id] of [
      ['/api/bilanz', b],
      ['/api/guv', g],
      ['/api/anhang', a],
    ] as const) {
      const r = await fetch(`${BASE}${url}/${id}?mandantId=${mandantId}`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
          'x-mandant-id': mandantId,
        },
        body: JSON.stringify({ status: 'VALIDATED' }),
      });
      expect(r.status, `${url} VALIDATED`).toBe(200);
    }
    const ja = await fetch(`${BASE}/api/jahresabschluss?mandantId=${mandantId}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'x-mandant-id': mandantId,
      },
      body: JSON.stringify({ mandantId, geschaeftsjahr: JAHR }),
    });
    expect(ja.status, 'Jahresabschluss anlegen').toBe(201);
    abschlussId = ((await ja.json()) as { id: string }).id;

    const fin = await fetch(`${BASE}/api/jahresabschluss/${abschlussId}/finalize?mandantId=${mandantId}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'x-mandant-id': mandantId,
      },
      body: JSON.stringify({}),
    });
    expect(fin.status, 'finalize').toBe(200);
  });

  afterAll(async () => {
    if (vergebeneRolleId) {
      await prisma.userMandantRole.deleteMany({ where: { id: vergebeneRolleId } });
    }
    if (abschlussId) {
      await prisma.signature.deleteMany({ where: { jahresabschlussId: abschlussId } });
      await prisma.wormObject.deleteMany({ where: { entityId: abschlussId } });
      await prisma.jahresabschluss.deleteMany({ where: { id: abschlussId } });
    }
    await prisma.bilanz.deleteMany({ where: { mandantId, geschaeftsjahr: JAHR } });
    await prisma.guV.deleteMany({ where: { mandantId, geschaeftsjahr: JAHR } });
    await prisma.anhang.deleteMany({ where: { mandantId, geschaeftsjahr: JAHR } });
    await prisma.$disconnect();
  });

  it('eine WP-Rolle aus einem anderen Mandanten erlaubt kein sign-abschluss', async () => {
    const p12 = readFileSync(join(process.cwd(), P12_PATH)).toString('base64');
    const res = await fetch(`${BASE}/api/signatur/sign-abschluss?mandantId=${mandantId}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'x-mandant-id': mandantId,
      },
      body: JSON.stringify({
        jahresabschlussId: abschlussId,
        mandantId,
        p12Base64: p12,
        p12Password: P12_PASSWORD,
      }),
    });

    expect(
      res.status,
      `Der User ist auf ${MANDANT_OHNE_WP} STEUERBERATER und dort ` +
        'WIRTSCHAFTSPRUEFER. sign-abschluss ist WP-only — die Vier-Augen-' +
        'Kontrolle darf hier nicht umgangen werden.',
    ).toBe(403);
    const body = (await res.json()) as { message: string };
    expect(body.message).toMatch(/Mandant/i);
  });

  it('die Eskalation hinterlässt KEIN signiertes Objekt', async () => {
    // Nicht der Statuscode ist der Beleg, sondern das Artefakt. Eine
    // Sperre nach dem WORM-Upload waere nur eine Verzoegerung des Schadens
    // — dieselbe Fehlerklasse wie in Nachtrag 35.
    const signiert = await prisma.wormObject.findMany({
      where: { entityId: abschlussId },
      select: { objectKey: true },
    });
    expect(
      signiert,
      'die verweigerte Signatur hat trotzdem ein Objekt abgelegt',
    ).toHaveLength(0);
    const sigs = await prisma.signature.count({ where: { jahresabschlussId: abschlussId } });
    expect(sigs, 'und keinen Signature-Datensatz').toBe(0);
  });

  it('auf dem Mandanten, für den die Rolle gilt, bleibt es erlaubt', async () => {
    // Gegenprobe: die Sperre darf nicht zu breit sein. Auf
    // `Beispiel GmbH` ist der User WIRTSCHAFTSPRUEFER — dort muss eine
    // WP-Handlung weiterhin am Guard vorbeikommen.
    //
    // `POST /wp/pruefungen` ist `@Roles('WIRTSCHAFTSPRUEFER')`. Wir
    // schicken einen absichtlich unvollstaendigen Rumpf: es ist uns egal,
    // ob die Validierung 400 sagt — entscheidend ist, dass es **nicht 403**
    // ist. Ein 403 hiesse: der Guard haette auch hier zugeschlagen.
    const mandantListe = (await (
      await fetch(`${BASE}/api/mandant`, { headers: { authorization: `Bearer ${token}` } })
    ).json()) as Array<{ id: string; firmenname: string }>;
    const mandantMitWp = mandantListe.find((m) => m.firmenname === MANDANT_MIT_WP);
    expect(mandantMitWp, `${MANDANT_MIT_WP} muss erreichbar sein`).toBeDefined();

    const res = await fetch(`${BASE}/api/wp/pruefungen?mandantId=${mandantMitWp!.id}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'x-mandant-id': mandantMitWp!.id,
      },
      body: JSON.stringify({}),
    });

    expect(
      res.status,
      `${MANDANT_MIT_WP}: dort ist er WP — der Guard darf nicht sperren`,
    ).not.toBe(403);
  });
});
