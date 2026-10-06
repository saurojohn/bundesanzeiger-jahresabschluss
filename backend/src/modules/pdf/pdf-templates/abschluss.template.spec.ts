/**
 * Regressionstest: Abschluss-PDF — Saldo-Sichtbarkeit, Umbruch, Dateiname.
 *
 * Bugfix 2026-10-06. Drei Defekte im veroeffentlichungsrelevanten
 * Gesamtdokument:
 *
 * 1. `Math.max(aktivaSumme, passivaSumme)` als „Bilanzsumme": bei
 *    Aktiva ≠ Passiva wurde die GROESSERE Summe ausgegeben, ohne
 *    Saldo-Hinweis und ohne Differenzangabe. Das Einzel-Bilanz-PDF
 *    wies dieselbe Differenz rot aus — das Gesamtdokument
 *    verschwieg sie. Eine Ausgleichsposition von 5,00 war unsichtbar.
 *
 * 2. Keine Umbruchlogik in der Positionsschleife: `doc.y = y + 14`
 *    ohne Pruefung. Empirisch belegt: 60 Positionen ergaben Zeilen
 *    bis y=90, also unterhalb des Satzspiegels (A4 841,9 hoch,
 *    Textbereich endet ~714). Nicht abgeschnitten, aber aus dem
 *    Seitenraster gedraengt.
 *
 * 3. Titelblatt behauptete „PDF/A-3-konform". Das PDF enthielt kein
 *    /Metadata, kein /OutputIntent, kein /ICCProfile, kein
 *    /StructTreeRoot, und die Schriften waren nicht eingebettet.
 *
 * Zusätzlich: Der Download-Dateiname trug `new Date().getUTCFullYear()`
 * statt des Geschaeftsjahres.
 *
 * Die Tests lesen den Text-Layer mit `pdf-parse` — nicht `latin1`-Bytes,
 * die nur den unkomprimierten Info-Block sehen und deshalb faelschlich
 * gruen melden.
 */

import { describe, it, expect } from 'vitest';
import { renderAbschlussPdf } from './abschluss.template';
import { PdfService } from '../services/pdf.service';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';

type Position = {
  seite: 'AKTIVA' | 'PASSIVA';
  kontonummer: string;
  bezeichnung: string;
  betragAktuell: string | number;
  reihenfolge: number;
};

function position(
  seite: 'AKTIVA' | 'PASSIVA',
  kontonummer: string,
  bezeichnung: string,
  betrag: number,
  reihenfolge: number,
): Position {
  return { seite, kontonummer, bezeichnung, betragAktuell: betrag, reihenfolge };
}

/** Minimaler, aber vollstaendiger Abschluss-Teil-Satz. */
function teileMit(aktiva: Position[], passiva: Position[]) {
  return {
    bilanz: {
      geschaeftsjahr: 2025,
      status: 'VALIDATED',
      hinweise: null,
      positionen: [...aktiva, ...passiva],
    },
    guv: {
      geschaeftsjahr: 2025,
      status: 'VALIDATED',
      verfahren: 'GKV',
      hinweise: null,
      ergebnis: '0',
      positionen: [],
    },
    anhang: {
      geschaeftsjahr: 2025,
      status: 'VALIDATED',
      bilanzierungsMethoden: null,
      bewertungsMethoden: null,
      sonstigePflichtangaben: null,
      abschnitte: [],
    },
  } as never;
}

const MANDANT = {
  id: 'm1',
  firmenname: 'Muster GmbH',
  rechtsform: 'GmbH',
  handelsregister: 'HRB 123456',
  steuernummer: '12/345/67890',
  ustId: 'DE123456789',
  gruendungsdatum: null,
  anschrift: {
    strasse: 'Musterstr. 1',
    plz: '10115',
    ort: 'Berlin',
    land: 'DE',
  },
  publishChannel: 'EBILANZ_TAXONOMIE',
} as never;

/**
 * Liest den Text-Layer und NORMALISIERT den Whitespace.
 *
 * PDFKit bricht umbrochene Zeilen an jedem Wort um; `pdf-parse`
 * liefert sie mit Zeilenumbruecken. Ohne Normalisierung passen
 * Formulierungen wie „nicht ausgeglichen" nicht auf einen
 * zusammenhaengenden Regex — der Test wuerde dann an der
 * Formatierung statt am Inhalt scheitern.
 */
async function text(buf: Buffer): Promise<string> {
  return (await pdfParse(buf)).text.replace(/\s+/g, ' ');
}

describe('Abschluss-PDF: Saldo, Umbruch, Konformitätsaussage', () => {
  it('nennt bei ungleichen Summen die Differenz (BUG: Math.max verschwieg sie)', async () => {
    const buf = await renderAbschlussPdf(
      teileMit(
        [position('AKTIVA', 'A.II.1.', 'Grundstuecke', 100000, 1)],
        [position('PASSIVA', 'A.I.', 'Gezeichnetes Kapital', 99995, 1)],
      ),
      MANDANT,
      {
        erstelltAm: new Date('2026-01-15T10:00:00Z'),
        erstelltVonEmail: 'test@kanzlei.de',
        wormObjectKey: 'mandant/m1/abschluss/2025/x.pdf',
        sha256Hash: 'a'.repeat(64),
        branding: null,
      },
    );
    const t = await text(buf);
    expect(t).toMatch(/nicht ausgeglichen/i);
    expect(t).toContain('100.000,00');
    expect(t).toContain('99.995,00');
    expect(t).toContain('5,00');
  });

  it('bleibt bei ausgeglichener Bilanz ohne Warnung', async () => {
    const buf = await renderAbschlussPdf(
      teileMit(
        [position('AKTIVA', 'A.II.1.', 'Grundstuecke', 100000, 1)],
        [position('PASSIVA', 'A.I.', 'Gezeichnetes Kapital', 100000, 1)],
      ),
      MANDANT,
      {
        erstelltAm: new Date('2026-01-15T10:00:00Z'),
        erstelltVonEmail: 'test@kanzlei.de',
        wormObjectKey: 'mandant/m1/abschluss/2025/x.pdf',
        sha256Hash: 'a'.repeat(64),
        branding: null,
      },
    );
    expect(await text(buf)).not.toMatch(/nicht ausgeglichen/i);
  });

  it('bricht bei vielen Positionen um (BUG: Zeilen unter y=90)', async () => {
    const aktiva: Position[] = [];
    const passiva: Position[] = [];
    for (let i = 1; i <= 60; i += 1) {
      aktiva.push(position('AKTIVA', `A.II.${i}.`, `Aktiva-Position ${i}`, 1000, i));
      passiva.push(position('PASSIVA', `C.${i}.`, `Passiva-Position ${i}`, 1000, i));
    }

    const buf = await renderAbschlussPdf(
      teileMit(aktiva, passiva),
      MANDANT,
      {
        erstelltAm: new Date('2026-01-15T10:00:00Z'),
        erstelltVonEmail: 'test@kanzlei.de',
        wormObjectKey: 'mandant/m1/abschluss/2025/x.pdf',
        sha256Hash: 'a'.repeat(64),
        branding: null,
      },
    );

    const result = await pdfParse(buf);
    const t = result.text.replace(/\s+/g, ' ');
    // Jede Position muss im Text-Layer auftauchen — unabhaengig davon,
    // auf welcher Seite sie steht.
    expect(t).toContain('Aktiva-Position 60');
    expect(t).toContain('Passiva-Position 60');
    expect(t).toContain('Aktiva-Position 1');

    // Die eigentliche Pruefung ist die SEITENZAHL. Ein Text-Test
    // allein kann den Defekt nicht fangen: die Zeilen waren ja im
    // Text-Layer vorhanden, nur an falscher Position.
    //
    // 60 Zeilen passen auf ~46 Zeilen pro Bilanz-Seite, also
    // Titel + 2 Bilanz-Seiten + GuV + Anhang = 5 Seiten. Gemessen.
    // OHNE Umbruchlogik entstehen 35 Seiten, weil jede Zeile unter
    // den Satzspiegel laeuft und PDFKit fuer jede eine neue Seite
    // aufmacht. Die Schwelle ist bewusst grosszuegig gewaehlt —
    // sie muss den Defekt sicher fangen, ohne an einer
    // Formatierungsfeinheit zu zitieren.
    expect(result.numpages).toBeGreaterThan(1);
    expect(result.numpages, `Seitenzahl bei 60 Positionen`).toBeLessThanOrEqual(8);
  });

  it('behauptet keine PDF/A-3-Konformitaet mehr', async () => {
    const buf = await renderAbschlussPdf(
      teileMit(
        [position('AKTIVA', 'A.II.1.', 'Grundstuecke', 100000, 1)],
        [position('PASSIVA', 'A.I.', 'Gezeichnetes Kapital', 100000, 1)],
      ),
      MANDANT,
      {
        erstelltAm: new Date('2026-01-15T10:00:00Z'),
        erstelltVonEmail: 'test@kanzlei.de',
        wormObjectKey: 'mandant/m1/abschluss/2025/x.pdf',
        sha256Hash: 'a'.repeat(64),
        branding: null,
      },
    );
    const t = await text(buf);
    // Die Konformitaetsaussage war falsch: kein /Metadata, kein
    // /OutputIntent, kein /ICCProfile, keine eingebetteten Fonts.
    expect(t).not.toMatch(/PDF\/A/i);
    // Was tatsaechlich gilt, steht dort.
    expect(t).toMatch(/WORM-archiviert/i);
  });

  it('der Download-Dateiname traegt das Geschaeftsjahr, nicht das laufende Jahr', () => {
    const svc = { buildFilename: undefined } as unknown as PdfService;
    // buildFilename ist privat; ueber den Prototypen pruefen.
    const proto = PdfService.prototype as unknown as {
      buildFilename: (
        t: string,
        m: unknown,
        w: string,
        jahr?: number,
      ) => string;
    };
    const name = proto.buildFilename.call(
      svc,
      'BILANZ',
      { firmenname: 'Muster GmbH' },
      'bilanz',
      2025,
    );
    expect(name).toBe('bilanz-muster-gmbh-2025.pdf');
  });
});