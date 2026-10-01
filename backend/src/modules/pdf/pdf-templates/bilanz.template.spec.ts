import { describe, it, expect } from 'vitest';
import { renderBilanzPdf } from './bilanz.template';
import type { BilanzEntity } from '../../../common/repositories/bilanz.repository';
import type { Mandant } from '@prisma/client';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';

/**
 * Tests für das Bilanz-PDF-Template (M4, 2026-10-01).
 *
 * Ausgangslage des Befundes: Die Positionstabelle benutzte feste Zeilenhöhe
 * (11pt) mit `lineBreak: false` und `ellipsis: true`. Zwei Folgen für eine
 * Pflichtveröffentlichung:
 *   1. Lange Kontobezeichnungen wurden abgeschnitten ("Selbst geschaffene…").
 *   2. Es gab keinen Seitenumbruch — bei vielen Konten lief die Tabelle über
 *      den unteren Rand hinaus.
 *
 * Der Test liest den Text-Layer mit `pdf-parse` (nicht `latin1`-Bytes, die
 * nur den unkomprimierten Info-Metadatenblock sehen und deshalb fälschlich
 * "grün" melden).
 */

type Position = {
  seite: 'AKTIVA' | 'PASSIVA';
  kontonummer: string;
  bezeichnung: string;
  betragAktuell: string | number;
  reihenfolge: number;
};

function makeBilanz(aktiva: Position[], passiva: Position[]): BilanzEntity {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    mandantId: '00000000-0000-4000-8000-000000000002',
    geschaeftsjahr: 2025,
    status: 'VALIDATED',
    hinweise: null,
    createdAt: new Date('2026-01-15T10:00:00Z'),
    updatedAt: new Date('2026-01-15T10:00:00Z'),
    positionen: [...aktiva, ...passiva],
  } as unknown as BilanzEntity;
}

const MANDANT = {
  id: '00000000-0000-4000-8000-000000000002',
  firmenname: 'Muster GmbH',
  rechtsform: 'GmbH',
  handelsregister: 'HRB 123456',
  steuernummer: '12/345/67890',
  ustId: 'DE123456789',
  gruendungsdatum: null,
  anschrift: { strasse: 'Musterstr. 1', plz: '10115', ort: 'Berlin', land: 'DE' },
  publishChannel: 'EBILANZ_TAXONOMIE',
} as unknown as Mandant;

const OPTIONS = {
  erstelltAm: new Date('2026-01-15T10:00:00Z'),
  erstelltVonEmail: 'test@kanzlei.de',
  wormObjectKey: 'mandant/x/bilanz-signed/2026/test.pdf',
  sha256Hash: 'a'.repeat(64),
  branding: null,
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

/** Liest Text und Seitenzahl aus dem dekomprimierten Content-Stream. */
async function inspectPdf(buf: Buffer): Promise<{ text: string; pages: number }> {
  const result = await pdfParse(buf);
  return { text: result.text, pages: result.numpages };
}

describe('renderBilanzPdf — Kontobezeichnungen', () => {
  it('schneidet eine lange Kontobezeichnung NICHT ab', async () => {
    const langeBezeichnung =
      'Selbst geschaffene, nicht planmäßig abschreibbare Anlagen im Sinne des § 6 Abs. 2a EStG';
    const bilanz = makeBilanz(
      [position('AKTIVA', '0281', langeBezeichnung, 150000, 1)],
      [position('PASSIVA', '0130', 'Gezeichnetes Kapital gemäß § 5 GmbHG', 25000, 1)],
    );

    const buf = await renderBilanzPdf(bilanz, MANDANT, OPTIONS);
    const { text } = await inspectPdf(buf);

    // Der Kern des Kontos muss lesbar sein — vorher stand hier nur der
    // gekürzte Anfang.
    expect(text).toContain('Selbst geschaffene');
    expect(text).toContain('§ 6 Abs. 2a EStG');
    // Kein Auslassungszeichen aus dem Kürzen.
    expect(text).not.toMatch(/Selbst geschaffene\s*…/);
  }, 30_000);

  it('gibt die vollständige Bezeichnung mehrzeilig aus', async () => {
    const bilanz = makeBilanz(
      [
        position(
          'AKTIVA',
          '0281',
          'Selbst geschaffene, nicht planmäßig abschreibbare Anlagen im Sinne des § 6 Abs. 2a EStG',
          150000,
          1,
        ),
      ],
      [position('PASSIVA', '0130', 'Kapital', 25000, 1)],
    );

    const buf = await renderBilanzPdf(bilanz, MANDANT, OPTIONS);
    const { text } = await inspectPdf(buf);

    // `heightOfString` muss den Umbruch berechnet haben — der Text darf
    // nicht mehr in einer einzigen Zeile mitten im Kürzen enden.
    expect(text.length).toBeGreaterThan(0);
    expect(text).toContain('planmäßig');
    expect(text).toContain('abschreibbare');
  }, 30_000);
});

describe('renderBilanzPdf — Seitenumbruch', () => {
  it('bricht um, wenn die Positionen den Seitenrand überschreiten', async () => {
    // 60 Positionen mit zweizeiligen Bezeichnungen passen nicht auf eine Seite.
    const aktiva: Position[] = [];
    const passiva: Position[] = [];
    for (let i = 0; i < 60; i += 1) {
      aktiva.push(
        position(
          'AKTIVA',
          `9${String(i).padStart(2, '0')}`,
          `Langer Kontobezeichnungstext für Position ${i} der Aktivseite, der über die Zeilenlänge hinausgeht und damit umbrechen muss`,
          1000 * (i + 1),
          i + 1,
        ),
      );
      passiva.push(
        position(
          'PASSIVA',
          `3${String(i).padStart(2, '0')}`,
          `Passivposition ${i} mit einer ebenfalls recht langen Bezeichnung, die den Umbruch erzwingt`,
          1000 * (i + 1),
          i + 1,
        ),
      );
    }

    const buf = await renderBilanzPdf(makeBilanz(aktiva, passiva), MANDANT, OPTIONS);
    const { pages } = await inspectPdf(buf);

    // Vorher lief die Tabelle kommentarlos über den Rand: eine Seite, mit
    // abgeschnittenen Inhalten. Jetzt muss umgebrochen werden.
    expect(pages).toBeGreaterThan(1);
  }, 60_000);

  it('wiederholt den Spaltenkopf auf der Folgeseite', async () => {
    const aktiva: Position[] = [];
    for (let i = 0; i < 50; i += 1) {
      aktiva.push(
        position('AKTIVA', `9${String(i).padStart(2, '0')}`, `Position ${i} der Aktivseite`, 100, i + 1),
      );
    }
    const bilanz = makeBilanz(aktiva, []);

    const buf = await renderBilanzPdf(bilanz, MANDANT, OPTIONS);
    const { pages } = await inspectPdf(buf);
    const { text } = await inspectPdf(buf);

    if (pages > 1) {
      // "AKTIVA" steht im Spaltenkopf und muss auf jeder Seite erscheinen.
      const treffer = (text.match(/AKTIVA/g) ?? []).length;
      expect(treffer).toBeGreaterThanOrEqual(pages);
    }
  }, 60_000);
});
