/**
 * E2E-Test: Mandantentrennung (Tenant-Isolation).
 *
 * Am 2026-10-05 fand eine systematische Prüfung vier Lücken, die alle
 * derselben Fehlerklasse folgten — die Zugriffsprüfung wurde nicht
 * ausgeführt:
 *
 *  B-1 `SubscriptionService.assertKanzleiReadAccess` war `void` und
 *      lief über `.then((m) => { if (!m) throw new ForbiddenException })`.
 *      Der `throw` landete in einer verwaisten Promise: die Prüfung
 *      wirkte nicht, UND die Rejection war ein `unhandledRejection` —
 *      Node ≥15 beendet den Prozess. Ein angemeldeter Benutzer konnte
 *      den Dienst also durch einen normalen Leseaufruf stilllegen.
 *      Empirisch reproduziert (Socket geschlossen).
 *
 *  B-2 `BrandingService.getBranding` nahm keinen `user`; der Controller
 *      holte ihn als `_user` und verwarf ihn. Der Lese-Pfad war
 *      komplett ungeschützt, obwohl `assertKanzleiReadAccess` existierte
 *      und der Schreib-Pfad ihn nutzte.
 *
 *  B-3 Die Konsolidierung filterte nur nach `kanzleiId`. Wer EINEN
 *      Mandanten der Kanzlei hatte, sah alle Einheiten — auch die
 *      GuV- und Saldendaten fremder Mandanten.
 *
 *  B-4 `ApiKeyService.assertKanzleiAdminAccess`warf den Parameter
 *      `kanzleiId` mit `void kanzleiId;` weg: ein KANZLEI_ADMIN konnte
 *      einen Key für eine fremde Kanzlei anlegen.
 *
 * Die Kanzlei-IDs stammen aus dem laufenden System, damit die Tests gegen
 * echte Daten laufen (Cross-Tenant braucht zwei Kanzleien).
 */
import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const API = 'http://localhost:3000/api';

async function token(email: string, password: string): Promise<string> {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`Login ${email} fehlgeschlagen: ${res.status}`);
  return ((await res.json()) as { accessToken: string }).accessToken;
}

describe('Mandantentrennung (Cross-Tenant)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    await prisma.$connect();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    app.setGlobalPrefix('api', { exclude: ['health'] });
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  /**
   * Eigene "fremde" Kanzlei als Fixture anlegen.
   *
   * Der Test darf sich nicht darauf verlassen, dass zwei Kanzleien im Seed
   * stehen — nach `prisma db seed` ist regelmäßig nur eine da, und genau
   * dann waere der Cross-Tenant-Test still wirkungslos. Die Fixture wird
   * deshalb selbst erzeugt und nachher wieder entfernt.
   */
  let fremdeKanzleiId: string | null = null;

  beforeAll(async () => {
    const k = await prisma.kanzlei.create({
      data: {
        name: `Fremde Kanzlei (Cross-Tenant-Test ${Date.now()})`,
        rechtsform: 'Einzelkanzlei',
        adresse: { strasse: 'Testweg 1', plz: '10999', ort: 'München', land: 'DE' },
      },
    });
    fremdeKanzleiId = k.id;
  });

  afterAll(async () => {
    if (fremdeKanzleiId) {
      await prisma.kanzlei.delete({ where: { id: fremdeKanzleiId } }).catch(() => undefined);
    }
  });

  /** Eigene Kanzlei des Admin + die selbst angelegte fremde Kanzlei. */
  async function zweiKanzleien() {
    const adminToken = await token('kanzlei-admin@kanzlei.de', 'Demo123!');
    const mandanten = (await (
      await fetch(`${API}/mandant`, {
        headers: { authorization: `Bearer ${adminToken}` },
      })
    ).json()) as Array<{ id: string }>;
    expect(mandanten.length, 'der Admin braucht mindestens einen Mandanten').toBeGreaterThan(0);
    const detail = (await (
      await fetch(`${API}/mandant/${mandanten[0].id}`, {
        headers: { authorization: `Bearer ${adminToken}` },
      })
    ).json()) as { kanzleiId: string };
    const eigene = { id: detail.kanzleiId, name: 'eigene' };
    const fremde = { id: fremdeKanzleiId!, name: 'fremde' };
    expect(eigene.id, 'die Kanzleien müssen verschieden sein').not.toBe(fremde.id);
    return { adminToken, eigene, fremde };
  }

  it('B-1: Subscription einer fremden Kanzlei → 403 statt 200', async () => {
    const { adminToken, fremde } = await zweiKanzleien();
    const res = await fetch(`${API}/subscription/${fremde.id}`, {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(
      res.status,
      `fremde Kanzlei muss 403 liefern, war ${res.status}`,
    ).toBe(403);
  });

  it('B-1: der Prozess lebt nach dem abgelehnten Zugriff noch', async () => {
    // Der unawaited-Throw beendete den Prozess (unhandledRejection).
    // Diese Probe ist der eigentliche Nachweis des Absturzes.
    const { adminToken, fremde } = await zweiKanzleien();
    await fetch(`${API}/subscription/${fremde.id}`, {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    await new Promise((r) => setTimeout(r, 500));
    const danach = await fetch(`${API}/mandant`, {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(
      danach.status,
      'der Server muss den abgelehnten Zugriff überstehen',
    ).toBe(200);
  });

  it('B-2: Branding einer fremden Kanzlei → 403 statt 200', async () => {
    const { adminToken, fremde } = await zweiKanzleien();
    const res = await fetch(`${API}/branding/${fremde.id}`, {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.status, `fremdes Branding muss 403 liefern`).toBe(403);
  });

  it('B-2: eigenes Branding bleibt lesbar (kein False-Positive)', async () => {
    const adminToken = await token('kanzlei-admin@kanzlei.de', 'Demo123!');
    const mandanten = (await (
      await fetch(`${API}/mandant`, {
        headers: { authorization: `Bearer ${adminToken}` },
      })
    ).json()) as Array<{ id: string }>;
    expect(mandanten.length, 'der Admin braucht mindestens einen Mandanten').toBeGreaterThan(0);
    const detail = (await (
      await fetch(`${API}/mandant/${mandanten[0].id}`, {
        headers: { authorization: `Bearer ${adminToken}` },
      })
    ).json()) as { kanzleiId: string };
    const res = await fetch(`${API}/branding/${detail.kanzleiId}`, {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(
      res.status,
      'das eigene Branding muss lesbar bleiben — sonst verhindert die Prüfung die Nutzung',
    ).toBe(200);
  });

  it('B-4: API-Key für eine fremde Kanzlei → 403', async () => {
    const { adminToken, fremde } = await zweiKanzleien();
    const res = await fetch(`${API}/api-keys`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        kanzleiId: fremde.id,
        name: `Cross-Tenant-Probe ${Date.now()}`,
        scopes: ['mandant:read'],
      }),
    });
    expect(
      res.status,
      `fremde kanzleiId muss 403 liefern, war ${res.status}`,
    ).toBe(403);
  });

  it('B-3: Konsolidierungs-Einheiten nur mit Beteiligung', async () => {
    const sbToken = await token('steuerberater@kanzlei.de', 'Demo123!');
    const mandanten = (await (
      await fetch(`${API}/mandant`, {
        headers: { authorization: `Bearer ${sbToken}` },
      })
    ).json()) as Array<{ id: string }>;
    const meineIds = new Set(mandanten.map((m) => m.id));

    // Alle Einheiten der Kanzlei holen (über SYSTEM_ADMIN, der alles sieht)
    const adminToken = await token('admin@kanzlei.de', 'Admin123!');
    const alle = (await (
      await fetch(`${API}/konsolidierung/einheiten`, {
        headers: { authorization: `Bearer ${adminToken}` },
      })
    ).json()) as Array<{ id: string; mutterMandantId: string; tochterMandantIds: string[] }>;

    const sichtbar = (await (
      await fetch(`${API}/konsolidierung/einheiten`, {
        headers: { authorization: `Bearer ${sbToken}` },
      })
    ).json()) as Array<{ id: string; mutterMandantId: string; tochterMandantIds: string[] }>;

    for (const e of sichtbar) {
      const beteiligt =
        meineIds.has(e.mutterMandantId) ||
        e.tochterMandantIds.some((id) => meineIds.has(id));
      expect(
        beteiligt,
        `Einheit ${e.id} wird gezeigt, obwohl der User nicht beteiligt ist ` +
          `(Mutter ${e.mutterMandantId}, Tochter ${e.tochterMandantIds.join(',')})`,
      ).toBe(true);
    }
    console.log(
      `Konsolidierung: ${sichtbar.length} von ${alle.length} Einheiten für den Steuerberater sichtbar`,
    );
  });
});
