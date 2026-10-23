import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

/**
 * BEFUND 2026-10-24 (Nachtrag 91): Der User-Override im DATEV-Import hat
 * die Bilanzseite aus dem Nummernformat abgeleitet (`startsWith('A.')` →
 * AKTIVA). Nach § 266 HGB stehen A./B./C. auf BEIDEN Bilanzseiten — die
 * Kontonummer allein bestimmt die Seite nicht.
 *
 * **GEMESSEN** an der laufenden API (DATEV-Konto '3300' = Verbindlichkeiten
 * aus Lieferungen und Leistungen, 1000 EUR):
 *
 *     Auto-Mapping : AKTIVA B.IV. 1000.00 | PASSIVA C.4. 1000.00  (ausgeglichen)
 *     User-Override: AKTIVA B.IV. 1000.00 | AKTIVA  C.4. 1000.00  (NICHT ausgeglichen)
 *
 * Der Import meldete dabei `importedCount=2, skippedCount=0` und **keine**
 * Warnung — die unausgeglichene Bilanz sah wie ein Erfolg aus.
 *
 * Der Test prüft die **Wirkung** am Ergebnis der API:
 *   1. Der Override auf 'C.4.' legt die Position auf die Passiva-Seite
 *      (und die Bilanz ist ausgeglichen).
 *   2. Gegenprobe: das Auto-Mapping legt dieselbe Position auf dieselbe Seite.
 *   3. Eine mehrdeutige Position wird **abgelehnt** (fail-closed) — das
 *      Konto wird übersprungen und der Grund genannt.
 */
const BASE = 'http://localhost:3000';

describe('DATEV-Import: der User-Override legt die Bilanzseite richtig (Nachtrag 91)', () => {
  const prisma = new PrismaClient();
  let mandantId = '';
  let token = '';
  const bilanzIds: string[] = [];
  const jahre: number[] = [];

  async function j(path: string, opts: Record<string, unknown> = {}) {
    const res = await fetch(`${BASE}${path}`, {
      ...opts,
      headers: {
        'content-type': 'application/json',
        ...((opts.headers as Record<string, string>) ?? {}),
      },
    });
    const text = await res.text();
    let body: unknown = text;
    try { body = JSON.parse(text); } catch { /* Klartext */ }
    return { status: res.status, body: body as Record<string, unknown>, text };
  }

  /** Eine echte Geschäftsbuchung: 1000 EUR Verbindlichkeiten gegen Bank. */
  function csv(jahr: number): string {
    const zeile =
      '"1000,00";"H";"EUR";"";"";"";"3300";"1800";"0";"3112";"RG1";"";"";"Bank an Verbindlichkeiten";"0";"";""';
    return [
      '"Formatname";"Version";"Berater";"Mandant";"WJ-Beginn";"WJ-Ende";"Sachkontenlaenge";"Datum-von";"Datum-bis";"Bezeichnung";"Diktat";"Buchungstyp";"Rechnungslegungszweck"',
      `"EXTF_Buchungsstapel";"12";"12345";"67890";"01.01.${jahr}";"31.12.${jahr}";"4";"01.01.${jahr}";"31.12.${jahr}";"Messung";"Buchhaltung";"1";"00"`,
      '"Umsatz";"SH";"WKZ";"Kurs";"Basis";"BWKZ";"Konto";"Gegenkonto";"BUSchluessel";"Belegdatum";"Belegfeld1";"Belegfeld2";"Skonto";"Buchungstext";"Postensperre";"Adressnummer";"PartnerBLZ"',
      zeile,
    ].join('\r\n');
  }

  async function importieren(jahr: number, overrides?: Record<string, string>) {
    const res = await j('/api/datev-import/execute', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({
        csvBase64: Buffer.from(csv(jahr), 'utf-8').toString('base64'),
        mandantId,
        geschaeftsjahr: jahr,
        skrPlan: 'SKR04',
        ...(overrides ? { userMappingOverrides: overrides } : {}),
      }),
    });
    expect(res.status, `Import ${jahr}: ${res.text.slice(0, 200)}`).toBe(201);
    const body = res.body as {
      bilanzId: string | null;
      importedCount: number;
      skippedCount: number;
      warnings: string[];
    };
    if (body.bilanzId) bilanzIds.push(body.bilanzId);
    const bilanz = body.bilanzId
      ? await prisma.bilanz.findUnique({
          where: { id: body.bilanzId },
          include: { positionen: true },
        })
      : null;
    const positionen = bilanz?.positionen ?? [];
    return {
      body,
      positionen,
      aktiva: positionen
        .filter((p) => p.seite === 'AKTIVA')
        .reduce((s, p) => s + Number(p.betragAktuell), 0),
      passiva: positionen
        .filter((p) => p.seite === 'PASSIVA')
        .reduce((s, p) => s + Number(p.betragAktuell), 0),
    };
  }

  beforeAll(async () => {
    const login = await j('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'steuerberater@kanzlei.de', password: 'Demo123!' }),
    });
    token = (login.body as { accessToken: string }).accessToken;
    const mandanten = await prisma.mandant.findMany({
      where: { firmenname: 'Demo GmbH' },
    });
    const mandant = mandanten[0];
    if (!mandant) throw new Error('Seed-Mandant fehlt');
    mandantId = mandant.id;
    // Freie Jahre (die anderen Specs belegen 2086-2090 und 2092-2099).
    for (let jahr = 2096; jahr <= 2099; jahr++) {
      const belegt =
        (await prisma.bilanz.count({ where: { mandantId, geschaeftsjahr: jahr } })) +
        (await prisma.guV.count({ where: { mandantId, geschaeftsjahr: jahr } }));
      if (belegt === 0) jahre.push(jahr);
    }
    expect(jahre.length, 'drei freie Jahre finden').toBeGreaterThanOrEqual(3);
  });

  afterAll(async () => {
    for (const id of bilanzIds) {
      await prisma.bilanzPosition.deleteMany({ where: { bilanzId: id } });
      await prisma.bilanz.deleteMany({ where: { id } });
    }
    for (const jahr of jahre) {
      await prisma.guVPosition.deleteMany({
        where: { guv: { mandantId, geschaeftsjahr: jahr } },
      });
      await prisma.guV.deleteMany({ where: { mandantId, geschaeftsjahr: jahr } });
    }
    await prisma.$disconnect();
  });

  it('der User-Override auf "C.4." legt die Position auf die Passiva-Seite (BUG vor dem Fix)', async () => {
    const { positionen, aktiva, passiva } = await importieren(jahre[0], {
      '3300': 'C.4.',
    });
    const c4 = positionen.find((p) => p.kontonummer === 'C.4.');
    expect(c4, 'die Position C.4. muss im Bilanz stehen').toBeTruthy();
    expect(
      c4!.seite,
      'C.4. (Verbindlichkeiten aus L+L) ist eine Passiva-Position',
    ).toBe('PASSIVA');
    // Und die Bilanz muss ausgeglichen sein — vorher standen 2000 auf der
    // Aktiva-Seite und 0 auf der Passiva-Seite.
    expect(Math.abs(aktiva - passiva)).toBeLessThan(0.01);
  });

  it('Gegenprobe: das Auto-Mapping legt dieselbe Position auf dieselbe Seite', async () => {
    const { positionen, aktiva, passiva } = await importieren(jahre[1]);
    const c4 = positionen.find((p) => p.kontonummer === 'C.4.');
    expect(c4?.seite).toBe('PASSIVA');
    expect(Math.abs(aktiva - passiva)).toBeLessThan(0.01);
  });

  it('eine mehrdeutige Position wird abgelehnt — mit Begründung (fail-closed)', async () => {
    // 'A.' existiert nach § 266 HGB auf beiden Seiten ("Anlagevermögen" und
    // "Eigenkapital") und steht in keiner der Mapping-Tabellen.
    const { body, positionen } = await importieren(jahre[2], { '3300': 'A.' });
    const a = positionen.find((p) => p.kontonummer === 'A.');
    expect(a, 'die mehrdeutige Position darf nicht importiert werden').toBeUndefined();
    expect(body.skippedCount).toBeGreaterThan(0);
    expect(
      body.warnings.join(' '),
      'der Grund der Ablehnung muss genannt werden',
    ).toMatch(/mehrdeutig/i);
  });
});
