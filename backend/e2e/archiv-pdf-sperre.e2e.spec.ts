import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

/**
 * Ein archivierter Mandant darf **keine neuen Belege** bekommen — der
 * Bestand bleibt zur Nachvollziehbarkeit erhalten (§ 147 AO).
 *
 * BEFUND 2026-10-21 (Nachtrag 75): Gesperrt waren bisher Bilanz, GuV,
 * Anhang, Konsolidierung, DATEV-Import, WP-Strecke und die qeS-Signatur.
 * Die **PDF-Erzeugung** war nicht gesperrt — und sie legt ein WORM-Objekt an
 * (zehnjaehrige Aufbewahrung):
 *
 *     POST /api/pdf/bilanz/<id>/generate -> HTTP 200
 *     WORM-Objekte vorher/nachher: 13 / 14
 *     Audit: {"action":"CREATE","entityType":"WormObject"}
 *
 * Das WORM-PDF ist nicht nur eine Darstellung, es ist das
 * **Veroeffentlichungsobjekt** — ein neuer Beleg im Bestand. Der Bestand
 * eines archivierten Mandanten wuchs damit weiter.
 *
 * Der Kommentar im Signatur-Service behauptete, „alle anderen Schreibpfade
 * waeren bereits ueber `assertMandantNichtArchiviert` gesperrt" — eine
 * Behauptung, kein Beleg.
 *
 * **Gegenprobe (positiv):** der **Download** bleibt offen. Der Bestand
 * eines archivierten Mandanten muss zur Nachvollziehbarkeit abrufbar
 * bleiben (§ 147 AO) — nur das *Fortschreiben* ist verboten.
 */
const BASE = 'http://localhost:3000';

describe('Archivierung: kein neuer Beleg, aber der Bestand bleibt abrufbar (Nachtrag 75)', () => {
  const prisma = new PrismaClient();
  let token = '';
  let mandantId = '';
  let bilanzId = '';
  let wormKey = '';

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

  beforeAll(async () => {
    // Ein eigener Mandant — die Archivierung eines Seed-Mandanten wuerde
    // die anderen Specs stoeren.
    const kanzlei = await prisma.kanzlei.findFirstOrThrow({
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    const mandant = await prisma.mandant.create({
      data: {
        kanzleiId: kanzlei.id,
        firmenname: `Archiv-Test-${Date.now()}`,
        rechtsform: 'GmbH',
        adresse: { strasse: 'Archivweg 1', plz: '10999', ort: 'Muenchen', land: 'DE' },
        geschaeftsfuehrer: [{ name: 'Test', geburtsdatum: '1970-01-01', anteilProzent: 100 }],
        groessenklasse: 'KLEINST',
        publishChannel: 'PDF_DIRECT',
      },
      select: { id: true },
    });
    mandantId = mandant.id;

    // Der KANZLEI_ADMIN muss den Mandanten zugewiesen bekommen — ohne
    // Zuordnung greift der Zugriffstest schon bei der Bilanz.
    const admin = await prisma.user.findFirstOrThrow({
      where: { email: 'kanzlei-admin@kanzlei.de' },
      select: { id: true },
    });
    await prisma.userMandantRole.create({
      data: { userId: admin.id, mandantId, rolle: 'KANZLEI_ADMIN' },
    });

    // **Danach** anmelden: der JWT traegt die Mandanten des Users. Wer sich
    // vorher anmeldet, hat den neuen Mandanten nicht im Token — und der
    // Zugriffstest lehnt die Bilanz dann ab („Kein Zugriff auf diesen
    // Mandanten"), obwohl die Rolle vergeben wurde.
    token = await login('kanzlei-admin@kanzlei.de');

    // Bilanz fuer diesen Mandanten (ausgeglichen — der PDF-Pfad hat ein
    // Saldo-Gate).
    const bilanzRes = await fetch(`${BASE}/api/bilanz?mandantId=${mandantId}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'x-mandant-id': mandantId,
      },
      body: JSON.stringify({
        mandantId,
        geschaeftsjahr: 2098,
        positionen: [
          { seite: 'AKTIVA', kontonummer: 'B.IV.', bezeichnung: 'Kasse', betragAktuell: 1000, reihenfolge: 1 },
          { seite: 'PASSIVA', kontonummer: 'A.', bezeichnung: 'Gezeichnetes Kapital', betragAktuell: 1000, reihenfolge: 2 },
        ],
      }),
    });
    const bilanzBody = (await bilanzRes.json()) as { bilanz?: { id?: string } };
    bilanzId = bilanzBody.bilanz?.id ?? '';
    expect(bilanzId, `Bilanz anlegen: ${JSON.stringify(bilanzBody).slice(0, 160)}`).toBeTruthy();
    await prisma.bilanz.update({ where: { id: bilanzId }, data: { status: 'VALIDATED' } });
  });

  afterAll(async () => {
    if (mandantId) {
      await prisma.userMandantRole.deleteMany({ where: { mandantId } });
      await prisma.bilanz.deleteMany({ where: { mandantId } });
      await prisma.mandant.deleteMany({ where: { id: mandantId } });
    }
    await prisma.$disconnect();
  });

  const auth = () => ({
    'content-type': 'application/json',
    authorization: `Bearer ${token}`,
    'x-mandant-id': mandantId,
  });

  it('legt vor der Archivierung ein Beweis-PDF an (Vorbedingung)', async () => {
    const res = await fetch(`${BASE}/api/pdf/bilanz/${bilanzId}/generate`, {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({}),
    });
    const body = (await res.json()) as { wormObjectKey?: string };
    expect(res.status, 'die Erzeugung muss vor der Archivierung klappen').toBe(200);
    wormKey = body.wormObjectKey ?? '';
    expect(wormKey, 'das PDF muss in WORM liegen').toBeTruthy();
  });

  it('legt nach der Archivierung kein weiteres PDF an', async () => {
    const archiv = await fetch(`${BASE}/api/mandant/${mandantId}/archivierung`, {
      method: 'PATCH',
      headers: auth(),
      body: JSON.stringify({}),
    });
    expect(archiv.status, 'der Mandant muss sich archivieren lassen').toBe(200);

    const wormVorher = await prisma.wormObject.count({
      where: { objectKey: { startsWith: `mandant/${mandantId}/` } },
    });

    const res = await fetch(`${BASE}/api/pdf/bilanz/${bilanzId}/generate`, {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({}),
    });
    const body = await res.text();
    expect(
      res.status,
      'ein archivierter Mandant darf keinen neuen Beleg bekommen — ' +
        `Antwort: ${body.slice(0, 200)}`,
    ).toBe(409);

    const wormNachher = await prisma.wormObject.count({
      where: { objectKey: { startsWith: `mandant/${mandantId}/` } },
    });
    expect(wormNachher, 'es darf kein neues WORM-Objekt entstanden sein').toBe(wormVorher);
  });

  it('Gegenprobe: der Bestand bleibt abrufbar (Download bleibt offen)', async () => {
    const res = await fetch(`${BASE}/api/pdf/bilanz/${bilanzId}/download`, {
      headers: { authorization: `Bearer ${token}`, 'x-mandant-id': mandantId },
    });
    expect(
      res.status,
      'der Bestand eines archivierten Mandanten muss zur Nachvollziehbarkeit ' +
        'abrufbar bleiben (§ 147 AO)',
    ).toBe(200);
  });

  it('Gegenprobe: nach dem Aufheben der Archivierung klappt es wieder', async () => {
    const aufheben = await fetch(`${BASE}/api/mandant/${mandantId}/archivierung/aufheben`, {
      method: 'PATCH',
      headers: auth(),
      body: JSON.stringify({}),
    });
    expect(aufheben.status, 'die Archivierung muss sich aufheben lassen').toBe(200);

    const res = await fetch(`${BASE}/api/pdf/bilanz/${bilanzId}/generate`, {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({}),
    });
    expect(
      res.status,
      'nach dem Aufheben der Archivierung ist die Erzeugung wieder erlaubt',
    ).toBe(200);
  });
});
