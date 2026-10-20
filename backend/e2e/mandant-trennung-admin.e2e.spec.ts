import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

/**
 * Mandantentrennung beim **Schreiben** — nicht nur in der Liste.
 *
 * BEFUND 2026-10-21 (Nachtrag 70): Nachtrag 68 hat die Mandanten**liste**
 * repariert. Dieselbe lose Logik stand an der Schreibstelle:
 * `mandant.service.ts` -> `assertMandantAccess()` verglich die Kanzlei des
 * Ziel-Mandanten mit `resolveKanzleiId(user)` — der Kanzlei des **ersten**
 * Mandanten des Users (Sortierung: Firmenname).
 *
 * Zwei Angaben, die auseinanderlaufen koennen:
 *
 *     istKanzleiAdmin = "Admin IRGENDWO"  (irgendein Mandant hat die Rolle)
 *     kanzleiId       = Kanzlei des ERSTEN Mandanten (nicht die Admin-Kanzlei)
 *
 * **Gemessen** (ueber die oeffentliche API, Kontext-Header auf dem
 * Zielmandanten selbst):
 *
 *     GET   /api/mandant/<Bravo>              -> 200   (Firmenname, USt-Id, Adresse)
 *     PATCH /api/mandant/<Bravo>              -> 200   (umbenannt!)
 *     PATCH /api/mandant/<Bravo>/archivierung -> 200   (archiviert!)
 *
 * Der User war KANZLEI_ADMIN in Kanzlei A und in Kanzlei B nur
 * STEUERBERATER (Mandant „Aaa GmbH"). „Bravo GmbH" ist ein Mandant der
 * Kanzlei B, in dem der User **keine Rolle** hat — er war fuer ihn weder
 * sichtbar (Nachtrag 68) noch mutierbar (dieser Befund). Unsichtbar, aber
 * veraenderbar: die Liste war repariert, der Schreibpfad nicht.
 *
 * Der Kontext-Header war dabei der Schluessel: der `RolesGuard` laesst einen
 * User durch, wenn er die Rolle irgendwo hat und der Kontext-Mandant ihm
 * nicht zugewiesen ist — mit der Annahme, der `MandantGuard` entscheide.
 * Auf `PATCH/DELETE /api/mandant/:id` gibt es aber **keinen**
 * `MandantGuard`; dort war die Service-Pruefung die einzige Schranke.
 *
 * **Die Regel jetzt:** ein KANZLEI_ADMIN darf die Mandanten der Kanzleien
 * verwalten, in denen er KANZLEI_ADMIN ist — plus seine eigenen Mandanten.
 * Dieselbe Bindung wie in der Liste.
 *
 * **Gegenprobe (positiv).** Dieser Test prueft nicht nur "403", sondern
 * auch, dass die erlaubten Wege erlaubt bleiben: der eigene Mandant und
 * der Mandant der eigenen Admin-Kanzlei muessen weiterhin bearbeitbar sein.
 * Sonst waere ein Test, der alles sperrt, auch gruen.
 */
const BASE = 'http://localhost:3000';

describe('Mandantentrennung beim Schreiben (Nachtrag 70)', () => {
  const prisma = new PrismaClient();
  let token = '';
  /** Kanzlei B — vom Admin verwaltet? nein. */
  let kanzleiBId = '';
  /** „Aaa…": Mandant in Kanzlei B, in dem der Admin STEUERBERATER ist. */
  let mandantAaaId = '';
  /** „Bravo…": Mandant in Kanzlei B, in dem der Admin KEINE Rolle hat. */
  let mandantBravoId = '';
  /** Mandant der Kanzlei A, in der der Admin KANZLEI_ADMIN ist. */
  let mandantAdminKanzleiId = '';

  const login = async (email: string, pw = 'Demo123!') => {
    const r = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: pw }),
    });
    const d = (await r.json()) as {
      accessToken: string;
      user: { mandanten: Array<{ id: string; firmenname: string; rolle: string }> };
    };
    expect(d.accessToken, `Login ${email}`).toBeTruthy();
    return d;
  };

  const mandantAnlegen = async (firmenname: string, kanzleiId: string) => {
    const m = await prisma.mandant.create({
      data: {
        kanzleiId,
        firmenname,
        rechtsform: 'GmbH',
        adresse: { strasse: 'Trennweg 1', plz: '10999', ort: 'Muenchen', land: 'DE' },
        geschaeftsfuehrer: [
          { name: 'Test', geburtsdatum: '1970-01-01', anteilProzent: 100 },
        ],
        groessenklasse: 'KLEINST',
        publishChannel: 'PDF_DIRECT',
      },
      select: { id: true },
    });
    return m.id;
  };

  beforeAll(async () => {
    // Der Zeitstempel haelt die Firmennamen eindeutig — "Aaa-<ts>" und
    // "Bravo-<ts>" existieren in keinem anderen Spec.
    const ts = Date.now();

    const admin = await prisma.user.findFirstOrThrow({
      where: { email: 'kanzlei-admin@kanzlei.de' },
      select: { id: true },
    });

    // Kanzlei B: eine eigene, in der der Admin KEIN Admin ist.
    const kanzleiB = await prisma.kanzlei.create({
      data: {
        name: `Trennung-Kanzlei-B-${ts}`,
        rechtsform: 'Einzelkanzlei',
        adresse: { strasse: 'Trennweg 1', plz: '10999', ort: 'Muenchen', land: 'DE' },
      },
      select: { id: true },
    });
    kanzleiBId = kanzleiB.id;

    // "Aaa-<ts>" sortiert VOR "Beispiel GmbH" (Kanzlei A) — damit ist es der
    // ERSTE Mandant des Users. Genau darauf beruhte der Fehler: die Kanzlei
    // des ersten Mandanten war Kanzlei B, die Admin-Kanzlei war Kanzlei A.
    mandantAaaId = await mandantAnlegen(`Aaa-${ts}`, kanzleiB.id);
    mandantBravoId = await mandantAnlegen(`Bravo-${ts}`, kanzleiB.id);

    await prisma.userMandantRole.create({
      data: { userId: admin.id, mandantId: mandantAaaId, rolle: 'STEUERBERATER' },
    });

    // Der Mandant der Admin-Kanzlei (Kanzlei A) — die Gegenprobe.
    const eigener = await prisma.user.findFirstOrThrow({
      where: { email: 'kanzlei-admin@kanzlei.de' },
      select: {
        mandantRoles: {
          where: { rolle: 'KANZLEI_ADMIN' },
          select: { mandantId: true },
        },
      },
    });
    mandantAdminKanzleiId = eigener.mandantRoles[0]!.mandantId;

    const session = await login('kanzlei-admin@kanzlei.de');
    token = session.accessToken;

    // **Vorbedingung.** "Aaa" muss der ERSTE Mandant der Session sein —
    // sonst prueft dieser Test nicht die Regel, sondern einen Zufall.
    const reihenfolge = session.user.mandanten.map((m) => m.firmenname);
    expect(
      reihenfolge[0],
      'der fremde Mandant muss der erste der Session sein — sonst trifft die ' +
        'alte Regel nicht zu und der Test waere gruener als die Wirklichkeit',
    ).toContain('Aaa-');
    expect(
      session.user.mandanten.some((m) => m.id === mandantBravoId),
      'Vorbedingung: der Admin darf "Bravo" nicht in der Session haben',
    ).toBe(false);
  });

  afterAll(async () => {
    await prisma.userMandantRole.deleteMany({ where: { mandantId: mandantAaaId } });
    await prisma.mandant.deleteMany({
      where: { id: { in: [mandantAaaId, mandantBravoId] } },
    });
    if (kanzleiBId) {
      await prisma.kanzlei.deleteMany({ where: { id: kanzleiBId } });
    }
    await prisma.$disconnect();
  });

  const h = (mandantId?: string) => ({
    'content-type': 'application/json',
    authorization: `Bearer ${token}`,
    ...(mandantId ? { 'x-mandant-id': mandantId } : {}),
  });

  it('liest einen Mandanten ohne jede Rolle nicht', async () => {
    const res = await fetch(`${BASE}/api/mandant/${mandantBravoId}`, {
      headers: h(mandantBravoId),
    });
    const body = await res.text();
    expect(
      res.status,
      'ein Mandant, in dem der User keine Rolle hat, ist kein lesbarer ' +
        `Mandant — Antwort: ${body.slice(0, 160)}`,
    ).toBe(403);
  });

  it('veraendert einen Mandanten ohne jede Rolle nicht', async () => {
    const res = await fetch(`${BASE}/api/mandant/${mandantBravoId}`, {
      method: 'PATCH',
      headers: h(mandantBravoId),
      body: JSON.stringify({ firmenname: 'Bravo (HIERARCHIE-VERLETZT)' }),
    });
    const body = await res.text();
    expect(
      res.status,
      `ein KANZLEI_ADMIN einer anderen Kanzlei darf diesen Mandanten nicht ` +
        `umbenennen — Antwort: ${body.slice(0, 160)}`,
    ).toBe(403);
  });

  it('archiviert einen Mandanten ohne jede Rolle nicht', async () => {
    const res = await fetch(`${BASE}/api/mandant/${mandantBravoId}/archivierung`, {
      method: 'PATCH',
      headers: h(mandantBravoId),
      body: JSON.stringify({}),
    });
    const body = await res.text();
    expect(
      res.status,
      `ein KANZLEI_ADMIN einer anderen Kanzlei darf diesen Mandanten nicht ` +
        `archivieren — Antwort: ${body.slice(0, 160)}`,
    ).toBe(403);
  });

  it('der fremde Mandant ist unveraendert geblieben', async () => {
    // Der **Zustandsbeleg** zu den drei Negativpruefungen: nicht nur der
    // Statuscode, sondern der Mandant selbst.
    const zustand = await prisma.mandant.findUnique({
      where: { id: mandantBravoId },
      select: { firmenname: true, archiviertAt: true },
    });
    expect(zustand?.firmenname).not.toContain('HIERARCHIE-VERLETZT');
    expect(zustand?.archiviertAt, 'der Mandant darf nicht archiviert sein').toBeNull();
  });

  // ===========================================================================
  // Gegenprobe (positiv) — die erlaubten Wege muessen erlaubt bleiben.
  //
  // Ohne diese beiden Tests waere ein "alles sperren" gruen: die
  // Negativpruefungen allein beweisen nur, dass irgendetwas blockiert.
  // ===========================================================================
  it('Gegenprobe: der eigene Mandant bleibt lesbar', async () => {
    const res = await fetch(`${BASE}/api/mandant/${mandantAaaId}`, {
      headers: h(mandantAaaId),
    });
    expect(
      res.status,
      'der Mandant, in dem der User STEUERBERATER ist, bleibt sein Mandant — ' +
        'er darf ihn lesen',
    ).toBe(200);
  });

  it('Gegenprobe: der Mandant der eigenen Admin-Kanzlei bleibt bearbeitbar', async () => {
    const res = await fetch(`${BASE}/api/mandant/${mandantAdminKanzleiId}`, {
      method: 'PATCH',
      headers: h(mandantAdminKanzleiId),
      body: JSON.stringify({ handelsregister: `HRB-Mess-${Date.now()}` }),
    });
    const body = await res.text();
    expect(
      res.status,
      'der KANZLEI_ADMIN muss die Mandanten seiner eigenen Kanzlei weiterhin ' +
        `bearbeiten koennen — Antwort: ${body.slice(0, 160)}`,
    ).toBe(200);
  });

  it('legt keinen Mandanten in einer Kanzlei an, in der der Admin es nicht ist', async () => {
    // Der Kontext-Mandant bestimmt die Kanzlei des neuen Mandanten
    // (Nachtrag 69). "Aaa" liegt in der Kanzlei B, in der der User nur
    // STEUERBERATER ist — mit diesem Kontext darf er dort nichts anlegen.
    const firmenname = `Anlegen-Fremd-${Date.now()}`;
    const res = await fetch(`${BASE}/api/mandant`, {
      method: 'POST',
      headers: h(mandantAaaId),
      body: JSON.stringify({
        firmenname,
        rechtsform: 'GmbH',
        adresse: { strasse: 'Trennweg 9', plz: '10999', ort: 'Muenchen', land: 'DE' },
        geschaeftsfuehrer: [
          { name: 'Test', geburtsdatum: '1970-01-01', anteilProzent: 100 },
        ],
        groessenklasse: 'KLEIN',
        publishChannel: 'PDF_DIRECT',
      }),
    });
    const body = await res.text();
    expect(
      res.status,
      'mit einem Kontext, auf dem der User nur STEUERBERATER ist, darf kein ' +
        `Mandant entstehen — Antwort: ${body.slice(0, 160)}`,
    ).toBe(403);

    const entstanden = await prisma.mandant.findFirst({
      where: { firmenname },
      select: { id: true },
    });
    expect(entstanden, 'es darf kein Mandant entstanden sein').toBeNull();
  });
});
