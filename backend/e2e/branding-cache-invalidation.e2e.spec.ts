import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

/**
 * BEFUND 2026-10-22 (Nachtrag 84): Die DNS-Verifikation schrieb die Felder
 * `customDomain` und `customDomainVerified`, invalidiert den
 * **Branding-Cache** aber nicht. `GET /api/branding/:kanzleiId` liefert aus
 * diesem Cache (TTL 1 h) — die API zeigte bis zu einer Stunde den alten
 * Stand.
 *
 * **Gemessen** an der laufenden API, vor dem Fix:
 *
 *     POST /api/dns/<id>/start-verification  {customDomain: "mess-cache-…"}
 *       -> HTTP 200
 *     SELECT "customDomain" FROM kanzlei
 *       -> "mess-cache-….example.de"
 *     GET /api/branding/<id>
 *       -> {"customDomain": null}          <- veraltet
 *
 * Der Weg dahin: das Branding-Modell invalidiert an allen **drei** eigenen
 * Schreibpfaden (Farben/Domain, Logo-Upload, Logo-Loeschen). Der
 * Schreibpfad **ausserhalb** des Moduls (die DNS-Verifikation) war
 * uebersehen — der Cache gehoert zum Branding-Modul, die Daten aber nicht.
 *
 * Der Wächter `src/common/cache/branding-cache-invalidation.spec.ts` stellt
 * sicher, dass kein weiterer Schreiber das uebersieht.
 */
const BASE = 'http://localhost:3000';

describe('Branding-Cache: die DNS-Verifikation invalidiert ihn (Nachtrag 84)', () => {
  const prisma = new PrismaClient();
  let kanzleiId = '';
  let mandantId = '';
  let token = '';
  let tier: string | null = null;
  let domain = '';

  const login = async (email: string) => {
    const r = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'Demo123!' }),
    });
    const d = (await r.json()) as { accessToken: string };
    expect(d.accessToken, `Login ${email}`).toBeTruthy();
    return d.accessToken;
  };

  const head = () => ({
    'content-type': 'application/json',
    authorization: `Bearer ${token}`,
    'x-mandant-id': mandantId,
  });

  const branding = async () => {
    const res = await fetch(`${BASE}/api/branding/${kanzleiId}`, { headers: head() });
    return { status: res.status, body: (await res.json()) as { customDomain: string | null } };
  };

  beforeAll(async () => {
    const kanzlei = await prisma.kanzlei.findFirstOrThrow({
      orderBy: { createdAt: 'asc' },
    });
    kanzleiId = kanzlei.id;
    tier = kanzlei.subscriptionTier;
    const mandant = await prisma.mandant.findFirstOrThrow({
      where: { kanzleiId },
    });
    mandantId = mandant.id;
    token = await login('kanzlei-admin@kanzlei.de');
    // `custom-domain` ist Premium — ohne Premium greift zuerst die
    // Tarifgrenze (402) und der Test pruefte die falsche Sache.
    await prisma.kanzlei.update({
      where: { id: kanzleiId },
      data: { subscriptionTier: 'PREMIUM' },
    });
    domain = `e2e-cache-${String(Date.now())}.example.de`;
  });

  afterAll(async () => {
    if (kanzleiId) {
      await prisma.kanzlei.update({
        where: { id: kanzleiId },
        data: {
          customDomain: null,
          customDomainVerified: false,
          customDomainVerificationToken: null,
          customDomainVerificationRequestedAt: null,
          subscriptionTier: tier,
        },
      });
    }
    await prisma.$disconnect();
  });

  it('liefert die Domain sofort, nachdem die Verifikation sie gesetzt hat', async () => {
    // 1) Der Cache wird gefuellt (die Domain ist noch nicht gesetzt).
    const vorher = await branding();
    expect(vorher.status).toBe(200);
    expect(vorher.body.customDomain).toBeNull();

    // 2) Die Verifikation setzt die Domain in der Datenbank.
    const start = await fetch(`${BASE}/api/dns/${kanzleiId}/start-verification`, {
      method: 'POST',
      headers: head(),
      body: JSON.stringify({ customDomain: domain }),
    });
    const startText = await start.text();
    expect(start.status, `Antwort: ${startText.slice(0, 200)}`).toBe(200);

    const inDb = await prisma.kanzlei.findUniqueOrThrow({
      where: { id: kanzleiId },
      select: { customDomain: true },
    });
    expect(inDb.customDomain, 'die Domain muss in der Datenbank stehen').toBe(domain);

    // 3) Und die Branding-API muss denselben Stand liefern — ohne Wartezeit
    //    und ohne Reload.
    const nachher = await branding();
    expect(
      nachher.body.customDomain,
      'die Branding-API lieferte einen veralteten Wert (der Cache wurde nicht ' +
        'invalidiert)',
    ).toBe(domain);
  });
});
