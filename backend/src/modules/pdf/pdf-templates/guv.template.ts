import PDFDocument from 'pdfkit';
import type { Mandant } from '@prisma/client';
import type { GuVEntity } from '../../../common/repositories/guv.repository';
import {
  drawHeaderFooter,
  PDF_LAYOUT,
} from './bilanz.template';
import { formatBetrag, guvKategorieLabel } from '../utils/pdf-format.utils';

/**
 * Rendert eine GuV in einen PDFKit-Stream.
 *
 * Layout (Gesamtkostenverfahren, § 275 HGB):
 *   - Header
 *   - Positionen gruppiert nach Kategorie
 *   - Jahresergebnis
 *   - Footer (WORM, SHA-256)
 */
export async function renderGuVPdf(
  guv: GuVEntity,
  mandant: Mandant,
  options: {
    erstelltAm: Date;
    erstelltVonEmail: string;
    wormObjectKey: string;
    sha256Hash: string;
  },
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: PDF_LAYOUT.pageSize,
      margins: PDF_LAYOUT.margins,
      info: {
        Title: `GuV ${guv.geschaeftsjahr} — ${mandant.firmenname}`,
        Author: options.erstelltVonEmail,
        Subject: 'Bundesanzeiger Jahresabschluss — GuV',
        Creator: 'Bundesanzeiger Jahresabschluss Backend',
        Producer: 'PDFKit',
        CreationDate: options.erstelltAm,
      },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    drawHeaderFooter(doc, {
      firmenname: mandant.firmenname,
      rechtsform: mandant.rechtsform,
      geschaeftsjahr: guv.geschaeftsjahr,
      seiteTitel: `Gewinn- und Verlustrechnung ${guv.geschaeftsjahr} (${guv.verfahren})`,
      wormObjectKey: options.wormObjectKey,
      sha256Hash: options.sha256Hash,
      erstelltAm: options.erstelltAm,
      erstelltVonEmail: options.erstelltVonEmail,
    });

    // Titel
    doc
      .fontSize(13)
      .fillColor(PDF_LAYOUT.colors.accent)
      .text(`Gewinn- und Verlustrechnung für das Geschäftsjahr ${guv.geschaeftsjahr}`, {
        align: 'left',
      });
    doc
      .fontSize(10)
      .fillColor(PDF_LAYOUT.colors.primary)
      .text(
        `${mandant.firmenname}, ${mandant.rechtsform}${mandant.handelsregister ? ` · ${mandant.handelsregister}` : ''}`,
      );
    doc
      .fontSize(9)
      .fillColor(PDF_LAYOUT.colors.primary)
      .text(`Verfahren: ${guv.verfahren === 'GKV' ? 'Gesamtkostenverfahren (§ 275 Abs. 2 HGB)' : 'Umsatzkostenverfahren (§ 275 Abs. 3 HGB)'}`);
    doc.moveDown(1);

    // Positionen gruppiert nach Kategorie (deutsche Labels).
    const positionen = guv.positionen;

    const kategorien: string[] = [];
    for (const p of positionen) {
      if (!kategorien.includes(p.kategorie)) kategorien.push(p.kategorie);
    }

    const tableLeft = PDF_LAYOUT.margins.left;
    const tableWidth = doc.page.width - PDF_LAYOUT.margins.left - PDF_LAYOUT.margins.right;

    for (const kat of kategorien) {
      const filtered = positionen.filter((p) => p.kategorie === kat);
      if (filtered.length === 0) continue;

      doc.fontSize(11).font('Helvetica-Bold').fillColor(PDF_LAYOUT.colors.accent);
      doc.text(guvKategorieLabel(kat), { align: 'left' });
      doc.font('Helvetica');

      let katSumme = 0;
      for (let i = 0; i < filtered.length; i += 1) {
        const pos = filtered[i];
        const y = doc.y;
        if (i % 2 === 0) {
          doc
            .save()
            .rect(tableLeft - 4, y - 2, tableWidth + 8, 14)
            .fill(PDF_LAYOUT.colors.zebra)
            .restore();
        }
        const betrag = Number(pos.betragAktuell);
        katSumme += betrag;
        doc.fontSize(9).fillColor(PDF_LAYOUT.colors.primary);
        doc.text(
          `${pos.kontonummer}  ${pos.bezeichnung}`,
          tableLeft,
          y,
          { width: tableWidth - 100, align: 'left', lineBreak: false },
        );
        doc.text(
          formatBetrag(betrag),
          tableLeft + tableWidth - 100,
          y,
          { width: 100, align: 'right', lineBreak: false },
        );
        doc.y = y + 14;
      }
      doc.moveDown(0.3);
      doc.fontSize(9).fillColor(PDF_LAYOUT.colors.accent).font('Helvetica-Bold');
      doc.text(`Summe ${guvKategorieLabel(kat)}: ${formatBetrag(katSumme)} €`, {
        align: 'right',
      });
      doc.font('Helvetica').fillColor(PDF_LAYOUT.colors.primary);
      doc.moveDown(0.5);
    }

    // Jahresergebnis
    doc.moveDown(0.5);
    const yErgebnis = doc.y;
    doc
      .fontSize(12)
      .font('Helvetica-Bold')
      .fillColor(PDF_LAYOUT.colors.accent)
      .text('Jahresergebnis (Jahresüberschuss / -fehlbetrag):', tableLeft, yErgebnis, {
        width: tableWidth - 200,
        align: 'left',
      });
    doc.text(
      formatBetrag(Number(guv.ergebnis)),
      tableLeft + tableWidth - 200,
      yErgebnis,
      { width: 200, align: 'right' },
    );
    doc.font('Helvetica');
    doc.y = yErgebnis + 24;

    // Status + Hinweise
    doc.moveDown(0.5);
    doc.fontSize(9).fillColor(PDF_LAYOUT.colors.primary);
    doc.text(`Status: ${guv.status}`);
    if (guv.hinweise) {
      doc.moveDown(0.3);
      doc.text(`Hinweise: ${guv.hinweise}`);
    }

    // Mock-Signatur
    doc.moveDown(1);
    doc
      .fontSize(8)
      .fillColor(PDF_LAYOUT.colors.rule)
      .text(
        'Mock-Signatur (M1) — In M2 wird dieses Dokument qualifiziert signiert (qeS, § 2 Nr. 3 SigG).',
        { align: 'center' },
      );

    doc.end();
  });
}