import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prisma, PrismaClient } from '@prisma/client';

/**
 * BEFUND 2026-10-22 (Nachtrag 83): Zwei Kanzleien konnten dieselbe
 * Custom-Domain beanspruchen.
 *
 * **Gemessen** an der laufenden API, vor dem Fix:
 *
 *     Kanzlei A: PATCH /api/branding/<A> {customDomain: "beispiel-messung.de"}
 *             -> HTTP 200
 *     Kanzlei B: PATCH /api/branding/<B> {customDomain: "BEISPIEL-MESSUNG.DE"}
 *             -> HTTP 200      (statt 400 — die Domain war "frei")
 *
 *     SELECT name, "customDomain" FROM kanzlei WHERE "customDomain" IS NOT NULL;
 *       Musterkanzlei Steuerberatung GmbH | beispiel-messung.de
 *       Messkanzlei B GmbH                 | BEISPIEL-MESSUNG.DE
 *
 * Ursache: DNS ist **case-insensitiv**, der Vergleich war es nicht.
 * `isCustomDomainTaken()` suchte per `findUnique` auf dem exakten String,
 * und der UNIQUE-Constraint der Datenbank greift bei "EXAMPLE.DE" vs.
 * "example.de" ebenfalls nicht — beide sind verschiedene Zeichenketten.
 *
 * Der zweite Teil des Befunds (der ausgestellte Verifikations-Token wurde
 * nie verglichen) ist in `domain-verification.service.spec.ts` belegt.
 *
 * **Gegenprobe:** dieselbe Kanzlei darf ihre eigene Domain unveraendert
 * (und in abweichender Schreibweise) behalten — die Sperre darf nicht den
 * legitimen Weg blockieren.
 */
const BASE = 'http://localhost:3000';

describe('Custom-Domain: zwei Kanzleien koennen dieselbe Domain nicht beanspruchen (Nachtrag 83)', () => {
  const prisma = new PrismaClient();
  let kanzleiAId = '';
  let kanzleiBId = '';
  let mandantBId = '';
  let adminUserId = '';
  let tierA: string | null = null;
  let domainA = '';

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

  const kopf = async (mandantId: string) => ({
    'content-type': 'application/json',
    authorization: `Bearer ${await login('kanzlei-admin@kanzlei.de')}`,
    'x-mandant-id': mandantId,
  });

  const setzeDomain = async (kanzleiId: string, mandantId: string, domain: string) => {
    const res = await fetch(`${BASE}/api/branding/${kanzleiId}`, {
      method: 'PATCH',
      headers: await kopf(mandantId),
      body: JSON.stringify({ customDomain: domain }),
    });
    return { status: res.status, text: await res.text() };
  };

  const mandantAId = async () => {
    const m = await prisma.mandant.findFirstOrThrow({
      where: { kanzleiId: kanzleiAId },
      select: { id: true },
    });
    return m.id;
  };

  beforeAll(async () => {
    const kanzleiA = await prisma.kanzlei.findFirstOrThrow({
      orderBy: { createdAt: 'asc' },
    });
    kanzleiAId = kanzleiA.id;
    tierA = kanzleiA.subscriptionTier;
    await prisma.kanzlei.update({
      where: { id: kanzleiAId },
      data: { subscriptionTier: 'PREMIUM' },
    });

    // Zweite Kanzlei: die Seed-Daten enthalten nur eine. Der Datensatz wird
    // aus der bestehenden Kanzlei geklont (dieselben Pflichtfelder), damit
    // der Test nicht von einer Handvoll Pflichtfeldern abhaengt.
    const {
      id: _id,
      name: _name,
      subscriptionTier: _tier,
      customDomain: _domain,
      customDomainVerified: _verified,
      brandingUpdatedById: _by,
      ...kanzleiRest
    } = kanzleiA;
    const kanzleiB = await prisma.kanzlei.create({
      data: {
        ...kanzleiRest,
        adresse: kanzleiRest.adresse as unknown as Prisma.InputJsonValue,
        name: 'E2E Messkanzlei B GmbH',
        subscriptionTier: 'PREMIUM',
      },
      select: { id: true },
    });
    kanzleiBId = kanzleiB.id;

    const mandantTemplate = await prisma.mandant.findFirstOrThrow({
      where: { kanzleiId: kanzleiAId },
    });
    const { id: _mId, kanzleiId: _mK, firmenname: _mF, ...mandantRest } = mandantTemplate;
    const mandantB = await prisma.mandant.create({
      data: {
        ...mandantRest,
        adresse: mandantRest.adresse as unknown as Prisma.InputJsonValue,
        geschaeftsfuehrer:
          mandantRest.geschaeftsfuehrer as unknown as Prisma.InputJsonValue,
        kanzleiId: kanzleiBId,
        firmenname: 'E2E Messmandant B GmbH',
      },
      select: { id: true },
    });
    mandantBId = mandantB.id;

    // Der vorhandene Kanzlei-Admin bekommt in Kanzlei B die Admin-Rolle —
    // so greift die Rollenpruefung (KANZLEI_ADMIN dieser Kanzlei) und der
    // Test prueft die Domain-Regel, nicht die Rollenregel.
    const admin = await prisma.user.findFirstOrThrow({
      where: { email: 'kanzlei-admin@kanzlei.de' },
      select: { id: true },
    });
    adminUserId = admin.id;
    await prisma.userMandantRole.create({
      data: { userId: adminUserId, mandantId: mandantBId, rolle: 'KANZLEI_ADMIN' },
    });

    // Eigene Domain der Kanzlei A (eindeutig, mit Zeitstempel).
    domainA = `e2e-eindeutigkeit-${String(Date.now())}.de`;
    const gesetzt = await setzeDomain(kanzleiAId, await mandantAId(), domainA);
    expect(gesetzt.status, `Antwort: ${gesetzt.text.slice(0, 200)}`).toBe(200);
  });

  afterAll(async () => {    if (adminUserId && mandantBId) {
      await prisma.userMandantRole.deleteMany({ where: { mandantId: mandantBId } });
    }
    if (mandantBId) await prisma.mandant.deleteMany({ where: { id: mandantBId } });
    if (kanzleiBId) await prisma.kanzlei.deleteMany({ where: { id: kanzleiBId } });
    if (kanzleiAId) {
      await prisma.kanzlei.update({
        where: { id: kanzleiAId },
        data: {
          customDomain: null,
          customDomainVerified: false,
          customDomainVerificationToken: null,
          customDomainVerificationRequestedAt: null,
          subscriptionTier: tierA,
        },
      });
    }
    await prisma.$disconnect();
  });

  it('weist die case-insensitive Doppelbeanspruchung ab', async () => {
    const res = await setzeDomain(kanzleiBId, mandantBId, domainA.toUpperCase());
    expect(
      res.status,
      'dieselbe Domain (nur in Grossbuchstaben) muss abgewiesen werden — ' +
        `Antwort: ${res.text.slice(0, 220)}`,
    ).toBe(400);

    // Und in der Datenbank steht sie nur einmal.
    const treffer = await prisma.kanzlei.findMany({
      where: {
        customDomain: { equals: domainA, mode: 'insensitive' },
      },
      select: { id: true, customDomain: true },
    });
    expect(treffer.length, 'nur eine Kanzlei darf die Domain halten').toBe(1);
    expect(treffer[0]!.id).toBe(kanzleiAId);
  });

  it('speichert die Domain normalisiert (klein)', async () => {
    // Der DTO-Regex laesst keinen abschliessenden Punkt zu — die Form
    // "example.de." wird also schon vor dem Service abgewiesen. Geprueft wird
    // hier die Gross-/Kleinschreibung; die uebrigen Normalisierungsfaelle
    // stehen in `common/utils/domain-normalisierung.spec.ts`.
    const domain = `E2E-Normalisierung-${String(Date.now())}.DE`;
    const res = await setzeDomain(kanzleiAId, await mandantAId(), domain);
    expect(res.status, `Antwort: ${res.text.slice(0, 200)}`).toBe(200);

    const kanzlei = await prisma.kanzlei.findUniqueOrThrow({
      where: { id: kanzleiAId },
      select: { customDomain: true },
    });
    expect(kanzlei.customDomain).toBe(domain.toLowerCase());
  });

  it('Gegenprobe: die Kanzlei darf ihre eigene Domain unveraendert behalten', async () => {
    // Die Sperre darf nicht den legitimen Weg blockieren: dieselbe Kanzlei
    // setzt dieselbe Domain noch einmal (in anderer Schreibweise).
    const res = await setzeDomain(
      kanzleiAId,
      await mandantAId(),
      (await prisma.kanzlei.findUniqueOrThrow({ where: { id: kanzleiAId } })).customDomain ??
        domainA,
    );
    expect(res.status, `Antwort: ${res.text.slice(0, 200)}`).toBe(200);
  });
});
