import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fuehreVierAugenPruefungDurch } from './helpers/wp-vier-augen';

/**
 * BEFUND 2026-10-22 (Nachtrag 86): Der Einreichungsbeleg eines
 * XML-Kanals trug das **signierte PDF** — nicht das eingereichte Dokument.
 *
 * **Gemessen** an der laufenden API:
 *
 *     POST /api/jahresabschluss/<id>/einreichen   (Mandant: XML_XBRL)
 *       -> HTTP 200, channel: "XML_XBRL"
 *     SELECT "channel", "payloadFormat", "rawPayload" FROM banz_submission
 *       -> XML_XBRL | PDF | "%PDF-1.3" … (23.665 Bytes)
 *
 * Das PDF war bei diesem Kanal nie eingereicht worden (der E-Bilanz-Upload
 * findet laut Verfahrensdokumentation ausserhalb der Anwendung statt). Das
 * Schema sagt dagegen: "rawPayload: Generierte XML/XBRL/PDF-Daten" und
 * "payloadFormat: XML | XBRL | PDF | ZIP".
 *
 * ENTSCHEIDUNG der Fachverantwortlichen (2026-10-23): Die beim Einreichen
 * erzeugte XBRL wird im WORM abgelegt (zehn Jahre, eigener EntityType) und
 * als Nutzlast protokolliert. Das signierte PDF bleibt als Beweisdokument
 * im WORM.
 */
const BASE = 'http://localhost:3000';
const P12_PATH = './tmp/test-certs/test-token.p12';
const P12_PASSWORD = 'Test1234!';

describe('Einreichungsbeleg: die Nutzlast folgt dem Kanal (Nachtrag 86)', () => {
  const prisma = new PrismaClient();
  let xmlToken = '';
  let pdfToken = '';
  let wpToken = '';
  let wp2Token = '';
  let p12Base64 = '';
  let xmlMandantId = '';
  let pdfMandantId = '';
  const jahre = { xml: 2094, pdf: 2095 };

  async function anmelden(email: string): Promise<string> {
    const r = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'Demo123!' }),
    });
    expect(r.status, `Login ${email}`).toBe(200);
    return ((await r.json()) as { accessToken: string }).accessToken;
  }

  function head(token: string, mandantId: string): Record<string, string> {
    return {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      'x-mandant-id': mandantId,
    };
  }

  /** Legt Abschluss an, schliesst, prueft (Vier-Augen) und signiert ihn. */
  async function abschlussEinreichen(
    mandantId: string,
    jahr: number,
    sbToken: string,
    bestellnummer: string,
  ): Promise<string> {
    const h = head(sbToken, mandantId);
    const b = await fetch(`${BASE}/api/bilanz?mandantId=${mandantId}`, {
      method: 'POST', headers: h,
      body: JSON.stringify({
        mandantId, geschaeftsjahr: jahr,
        positionen: [
          { seite: 'AKTIVA', kontonummer: 'B.IV.', bezeichnung: 'Kasse', betragAktuell: 1000, reihenfolge: 1 },
          { seite: 'PASSIVA', kontonummer: 'A.I.', bezeichnung: 'Kapital', betragAktuell: 1000, reihenfolge: 1 },
        ],
      }),
    });
    expect(b.status, 'Bilanz anlegen').toBe(201);
    const bilanzId = ((await b.json()) as { bilanz: { id: string } }).bilanz.id;

    const g = await fetch(`${BASE}/api/guv?mandantId=${mandantId}`, {
      method: 'POST', headers: h,
      body: JSON.stringify({
        mandantId, geschaeftsjahr: jahr, verfahren: 'GKV',
        positionen: [{ kontonummer: '1.', bezeichnung: 'Umsatz', kategorie: 'ERLOES', betragAktuell: 1000, reihenfolge: 1 }],
      }),
    });
    expect(g.status, 'GuV anlegen').toBe(201);
    const guvId = ((await g.json()) as { guv: { id: string } }).guv.id;

    const a = await fetch(`${BASE}/api/anhang?mandantId=${mandantId}`, {
      method: 'POST', headers: h,
      body: JSON.stringify({
        mandantId, geschaeftsjahr: jahr,
        abschnitte: [{ titel: 'Allgemeine Angaben', reihenfolge: 1, inhalt: 'Sitz: Berlin' }],
      }),
    });
    expect(a.status, 'Anhang anlegen').toBe(201);
    const anhangId = ((await a.json()) as { id: string }).id;

    await prisma.bilanz.update({ where: { id: bilanzId }, data: { status: 'VALIDATED' } });
    await prisma.guV.update({ where: { id: guvId }, data: { status: 'VALIDATED' } });
    await prisma.anhang.update({ where: { id: anhangId }, data: { status: 'VALIDATED' } });

    const ja = await fetch(`${BASE}/api/jahresabschluss?mandantId=${mandantId}`, {
      method: 'POST', headers: h,
      body: JSON.stringify({ mandantId, geschaeftsjahr: jahr }),
    });
    expect(ja.status, 'Abschluss anlegen').toBe(201);
    const abschlussId = ((await ja.json()) as { id: string }).id;

    const fin = await fetch(`${BASE}/api/jahresabschluss/${abschlussId}/finalize?mandantId=${mandantId}`, {
      method: 'POST', headers: h, body: JSON.stringify({}),
    });
    expect(fin.status, `Abschluss abschliessen: ${await fin.text()}`).toBe(200);

    // Vier-Augen-Pruefung der Bilanz (Nachtrag 79): die qeS-Endabnahme
    // verlangt einen freigegebenen Pruefungsnachweis.
    await fuehreVierAugenPruefungDurch({
      base: BASE,
      mandantId,
      bilanzId,
      guvId,
      tokenPruefend: wpToken,
      tokenFreigebend: wp2Token,
    });

    const sign = await fetch(`${BASE}/api/signatur/sign-abschluss?mandantId=${mandantId}`, {
      method: 'POST', headers: head(wpToken, mandantId),
      body: JSON.stringify({ mandantId, jahresabschlussId: abschlussId, p12Base64, p12Password: P12_PASSWORD }),
    });
    expect(sign.status, `Signieren: ${await sign.text()}`).toBe(200);

    const einreichen = await fetch(`${BASE}/api/jahresabschluss/${abschlussId}/einreichen?mandantId=${mandantId}`, {
      method: 'POST', headers: head(sbToken, mandantId),
      body: JSON.stringify({ banzBestellnummer: bestellnummer }),
    });
    expect(einreichen.status, `Einreichen: ${await einreichen.text()}`).toBe(200);

    return abschlussId;
  }

  beforeAll(async () => {
    p12Base64 = readFileSync(join(process.cwd(), P12_PATH)).toString('base64');
    xmlToken = await anmelden('steuerberater@kanzlei.de');
    pdfToken = await anmelden('steuerberater@kanzlei.de');
    wpToken = await anmelden('wp@kanzlei.de');
    wp2Token = await anmelden('wp2@kanzlei.de');

    // "Beispiel GmbH" hat im Seed den Kanal XML_XBRL, "Demo GmbH" PDF_DIRECT.
    const xml = await prisma.mandant.findFirstOrThrow({ where: { firmenname: 'Beispiel GmbH' } });
    const pdf = await prisma.mandant.findFirstOrThrow({ where: { firmenname: 'Demo GmbH' } });
    expect(xml.publishChannel, 'der Mess-Mandant muss XML_XBRL sein').toBe('XML_XBRL');
    expect(pdf.publishChannel, 'der Gegenprobe-Mandant muss PDF_DIRECT sein').toBe('PDF_DIRECT');
    xmlMandantId = xml.id;
    pdfMandantId = pdf.id;
  });

  afterAll(async () => {
    for (const mandantId of [xmlMandantId, pdfMandantId]) {
      if (!mandantId) continue;
      await prisma.banzSubmission.deleteMany({ where: { mandantId } });
      await prisma.wormObject.deleteMany({ where: { mandantId, entityType: 'ABSCHLUSS_XBRL' } });
      await prisma.jahresabschluss.deleteMany({ where: { mandantId } });
      for (const jahr of Object.values(jahre)) {
        await prisma.bilanz.deleteMany({ where: { mandantId, geschaeftsjahr: jahr } });
        await prisma.guV.deleteMany({ where: { mandantId, geschaeftsjahr: jahr } });
        await prisma.anhang.deleteMany({ where: { mandantId, geschaeftsjahr: jahr } });
      }
    }
    await prisma.signature.deleteMany({ where: { userId: { not: undefined } } });
    await prisma.$disconnect();
  });

  it('XML-Kanal: der Beleg enthaelt die XBRL — und sie liegt im WORM', async () => {
    const abschlussId = await abschlussEinreichen(
      xmlMandantId, jahre.xml, xmlToken, `MESS-XML-${String(Date.now())}`,
    );

    const sub = await prisma.banzSubmission.findFirstOrThrow({
      where: { jahresabschlussId: abschlussId },
      select: {
        channel: true, payloadFormat: true, payloadHash: true,
        rawPayload: true, banzBestellnummer: true,
      },
    });

    expect(sub.channel).toBe('XML_XBRL');
    // Das ist der Kern: die Nutzlast ist das **eingereichte** Dokument.
    expect(sub.payloadFormat).toBe('XBRL');
    const roh = Buffer.from(sub.rawPayload ?? Buffer.alloc(0));
    expect(roh.subarray(0, 5).toString('utf-8'), 'die Nutzlast muss XML sein').toBe('<?xml');
    // Der Hash passt zur Nutzlast (nicht zu einem anderen Dokument).
    expect(sub.payloadHash).toBe(createHash('sha256').update(roh).digest('hex'));

    // Und die Datei liegt im WORM — zehn Jahre, mit Legal Hold.
    const worm = await prisma.wormObject.findFirstOrThrow({
      where: { mandantId: xmlMandantId, entityType: 'ABSCHLUSS_XBRL', entityId: abschlussId },
      select: { objectKey: true, sha256Hash: true, retentionDays: true, legalHold: true, objectLockMode: true },
    });
    expect(worm.sha256Hash).toBe(sub.payloadHash);
    expect(worm.retentionDays).toBe(3650);
    expect(worm.legalHold).toBe(true);
    expect(worm.objectLockMode).toBe('COMPLIANCE');
    expect(worm.objectKey).toContain('abschluss_xbrl');
  });

  it('Gegenprobe: PDF-Kanal — der Beleg enthaelt weiterhin das signierte PDF', async () => {
    const abschlussId = await abschlussEinreichen(
      pdfMandantId, jahre.pdf, pdfToken, `MESS-PDF-${String(Date.now())}`,
    );

    const sub = await prisma.banzSubmission.findFirstOrThrow({
      where: { jahresabschlussId: abschlussId },
      select: { channel: true, payloadFormat: true, payloadHash: true, rawPayload: true },
    });

    expect(sub.channel).toBe('PDF_DIRECT');
    expect(sub.payloadFormat).toBe('PDF');
    const roh = Buffer.from(sub.rawPayload ?? Buffer.alloc(0));
    expect(roh.subarray(0, 4).toString('latin1'), 'die Nutzlast muss ein PDF sein').toBe('%PDF');
    expect(sub.payloadHash).toBe(createHash('sha256').update(roh).digest('hex'));
  });
});
