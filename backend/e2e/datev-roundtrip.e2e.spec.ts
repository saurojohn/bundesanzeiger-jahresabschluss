import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

/**
 * BEFUND 2026-10-23 (Nachtrag 87): Der DATEV-Export schrieb **zwei Zeilen
 * je GuV-Position** — eine Soll-Zeile und eine Haben-Zeile mit
 * **identischen** Konten.
 *
 * Im Sachkonten-Buchungsstapel ist **eine Zeile = eine Buchung** (Umsatz,
 * Soll/Haben, Konto, Gegenkonto). Die zweite Zeile war deshalb keine
 * "Gegenseite", sondern eine zweite Buchung: jedes Konto saldierte auf 0.
 *
 * **Gemessen** (Round-Trip ueber den Import der Anwendung):
 *
 *     Export einer GuV mit 1.000 Erloes + 400 Materialaufwand
 *       -> "1000,00";"S";…;"1800";"4400";…
 *          "-1000,00";"H";…;"1800";"4400";…      <- identische Konten
 *          "400,00";"S";…;"5000";"1800";…
 *          "-400,00";"H";…;"5000";"1800";…      <- identische Konten
 *     Import derselben Datei
 *       -> importedCount: 0, skippedCount: 3
 *
 * Der Import ueberspringt Konten mit Saldo 0 ("kein Buchungseffekt") — die
 * exportierte Datei war damit **ohne Buchungswirkung**. In einer echten
 * DATEV-Software heben sich die beiden Zeilen genauso auf.
 *
 * Dieser Test ist der Round-Trip: exportieren, den Import der Anwendung
 * darauf ansetzen und die importierten Positionen pruefen. Er faellt, wenn
 * der Export wieder Paare schreibt.
 */
const BASE = 'http://localhost:3000';

describe('DATEV: der Export erzeugt eine Datei, aus der Buchungen werden (Nachtrag 87)', () => {
  const prisma = new PrismaClient();
  const EXPORT_JAHR = 2089;
  const IMPORT_JAHR = 2090;
  let mandantAId = '';
  let mandantBId = '';
  let token = '';

  const login = async (email: string) => {
    const r = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'Demo123!' }),
    });
    expect(r.status, `Login ${email}`).toBe(200);
    return ((await r.json()) as { accessToken: string }).accessToken;
  };

  const head = (mandantId: string) => ({
    'content-type': 'application/json',
    authorization: `Bearer ${token}`,
    'x-mandant-id': mandantId,
  });

  beforeAll(async () => {
    const a = await prisma.mandant.findFirstOrThrow({ where: { firmenname: 'Demo GmbH' } });
    const b = await prisma.mandant.findFirstOrThrow({ where: { firmenname: 'Beispiel GmbH' } });
    mandantAId = a.id;
    mandantBId = b.id;
    token = await login('steuerberater@kanzlei.de');
  });

  afterAll(async () => {
    await prisma.guV.deleteMany({ where: { mandantId: mandantAId, geschaeftsjahr: EXPORT_JAHR } });
    await prisma.bilanz.deleteMany({ where: { mandantId: mandantBId, geschaeftsjahr: IMPORT_JAHR } });
    await prisma.guV.deleteMany({ where: { mandantId: mandantBId, geschaeftsjahr: IMPORT_JAHR } });
    await prisma.anhang.deleteMany({ where: { mandantId: mandantBId, geschaeftsjahr: IMPORT_JAHR } });
    await prisma.$disconnect();
  });

  it('exportiert eine Buchung je Position — und sie kommt wieder an', async () => {
    // 1) GuV mit einem Erloes- und einem Aufwands-Position anlegen
    const g = await fetch(`${BASE}/api/guv?mandantId=${mandantAId}`, {
      method: 'POST', headers: head(mandantAId),
      body: JSON.stringify({
        mandantId: mandantAId, geschaeftsjahr: EXPORT_JAHR, verfahren: 'GKV',
        positionen: [
          { kontonummer: '1.', bezeichnung: 'Umsatzerloese', kategorie: 'ERLOES', betragAktuell: 1000, reihenfolge: 1 },
          { kontonummer: '5a.', bezeichnung: 'Materialaufwand', kategorie: 'MATERIAL', betragAktuell: 400, reihenfolge: 2 },
        ],
      }),
    });
    const gText = await g.text();
    expect(g.status, `GuV anlegen: ${gText}`).toBe(201);
    const guvId = (JSON.parse(gText) as { guv: { id: string } }).guv.id;

    // 2) Exportieren
    const exp = await fetch(`${BASE}/api/datev/generate-buchungsstapel`, {
      method: 'POST', headers: head(mandantAId),
      body: JSON.stringify({
        guvId, beraternummer: '12345', mandantennummer: '67890', skrPlan: 'SKR04',
      }),
    });
    const expText = await exp.text();
    expect(exp.status, `Export: ${expText}`).toBe(200);
    const expBody = JSON.parse(expText) as { csvBase64: string };
    const csv = Buffer.from(expBody.csvBase64, 'base64').toString('utf-8');
    const zeilen = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);

    // Zeile 1 = Spaltennamen des Kopfblocks, Zeile 2 = Header-Daten,
    // Zeile 3 = Spaltennamen der Buchungszeilen, ab Zeile 4 die Buchungen.
    const buchungsZeilen = zeilen.slice(3);
    expect(
      buchungsZeilen.length,
      `je Position genau eine Buchungszeile (gefunden: ${buchungsZeilen.length}):\n` +
        buchungsZeilen.join('\n'),
    ).toBe(2);

    // Und die Zeile bucht beide Seiten: Konto auf Soll, Gegenkonto auf Haben.
    const erste = buchungsZeilen[0]!.split(';').map((f) => f.replace(/"/g, ''));
    expect(erste[0], 'der Umsatz ist der Betrag').toBe('1000,00');
    expect(erste[1], 'das Soll-Kennzeichen').toBe('S');
    expect(erste[6], 'Konto (Soll-Seite)').toBe('1800');
    expect(erste[7], 'Gegenkonto (Haben-Seite)').toBe('4400');
    // Es gibt KEINE zweite Zeile mit denselben Konten.
    const zweite = buchungsZeilen[1]!.split(';').map((f) => f.replace(/"/g, ''));
    expect(zweite[6]).toBe('5000');
    expect(zweite[7]).toBe('1800');
    expect(zweite[0]).toBe('400,00');

    // 3) Die Datei in einen zweiten Mandanten importieren
    const imp = await fetch(`${BASE}/api/datev-import/execute`, {
      method: 'POST', headers: head(mandantBId),
      body: JSON.stringify({
        csvBase64: Buffer.from(csv, 'utf-8').toString('base64'),
        mandantId: mandantBId, geschaeftsjahr: IMPORT_JAHR, skrPlan: 'SKR04',
      }),
    });
    const impText = await imp.text();
    expect(imp.status, `Import: ${impText}`).toBe(201);
    const impBody = JSON.parse(impText) as {
      importedCount: number;
      skippedCount: number;
      warnings: string[];
    };

    // 4) Die importierten Positionen — sie muessen die Betraege tragen
    const guvB = await prisma.guV.findFirst({
      where: { mandantId: mandantBId, geschaeftsjahr: IMPORT_JAHR },
      include: { positionen: true },
    });
    const positionen = guvB?.positionen ?? [];
    const summe = positionen.reduce((s, p) => s + Number(p.betragAktuell), 0);

    expect(
      impBody.importedCount,
      `nichts importiert (warnings: ${JSON.stringify(impBody.warnings)})`,
    ).toBeGreaterThan(0);
    expect(
      summe,
      'die importierten Betraege muessen den exportierten entsprechen ' +
        `(Positionen: ${JSON.stringify(positionen.map((p) => [p.kontonummer, Number(p.betragAktuell)]))})`,
    ).toBe(1400);
  });
});
