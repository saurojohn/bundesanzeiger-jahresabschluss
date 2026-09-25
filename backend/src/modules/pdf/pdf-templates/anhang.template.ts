import PDFDocument from 'pdfkit';
import type { Mandant } from '@prisma/client';
import type { AnhangEntity } from '../../../common/repositories/anhang.repository';
import {
  drawHeaderFooter,
  PDF_LAYOUT,
  type PdfBrandingSnapshot,
} from './bilanz.template';

/**
 * Rendert einen Anhang (§ 284-289 HGB) in einen PDFKit-Stream.
 *
 * Layout:
 *   - Header (Mandant, GJ, "Anhang")
 *   - Bilanzierungs-/Bewertungs-/Sonstige Methoden (falls vorhanden)
 *   - Abschnitte (sortiert nach Reihenfolge)
 *   - Footer
 */
export async function renderAnhangPdf(
  anhang: AnhangEntity,
  mandant: Mandant,
  options: {
    erstelltAm: Date;
    erstelltVonEmail: string;
    wormObjectKey: string;
    sha256Hash: string;
    branding?: PdfBrandingSnapshot | null;
  },
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: PDF_LAYOUT.pageSize,
      margins: PDF_LAYOUT.margins,
      info: {
        Title: `Anhang ${anhang.geschaeftsjahr} — ${mandant.firmenname}`,
        Author: options.erstelltVonEmail,
        Subject: 'Bundesanzeiger Jahresabschluss — Anhang',
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
      geschaeftsjahr: anhang.geschaeftsjahr,
      seiteTitel: `Anhang ${anhang.geschaeftsjahr}`,
      wormObjectKey: options.wormObjectKey,
      sha256Hash: options.sha256Hash,
      erstelltAm: options.erstelltAm,
      erstelltVonEmail: options.erstelltVonEmail,
      branding: options.branding ?? null,
    });

    // Titel
    doc
      .fontSize(13)
      .fillColor(PDF_LAYOUT.colors.accent)
      .text(`Anhang für das Geschäftsjahr ${anhang.geschaeftsjahr}`, {
        align: 'left',
      });
    doc
      .fontSize(10)
      .fillColor(PDF_LAYOUT.colors.primary)
      .text(
        `${mandant.firmenname}, ${mandant.rechtsform}${mandant.handelsregister ? ` · ${mandant.handelsregister}` : ''}`,
      );
    doc.moveDown(1);

    // Bilanzierungs-/Bewertungs-Methoden + Pflichtangaben
    const sections: Array<{ titel: string; inhalt: string | null | undefined }> = [
      { titel: 'Bilanzierungsmethoden (§ 284 Abs. 2 Nr. 1 HGB)', inhalt: anhang.bilanzierungsMethoden },
      { titel: 'Bewertungsmethoden (§ 284 Abs. 2 Nr. 2 HGB)', inhalt: anhang.bewertungsMethoden },
      { titel: 'Sonstige Pflichtangaben (§ 285 HGB)', inhalt: anhang.sonstigePflichtangaben },
    ];

    for (const sec of sections) {
      if (!sec.inhalt) continue;
      doc.fontSize(11).font('Helvetica-Bold').fillColor(PDF_LAYOUT.colors.accent);
      doc.text(sec.titel);
      doc.font('Helvetica').fontSize(9).fillColor(PDF_LAYOUT.colors.primary);
      doc.text(sec.inhalt, { align: 'left' });
      doc.moveDown(0.8);
    }

    // Abschnitte
    if (anhang.abschnitte.length > 0) {
      doc.fontSize(11).font('Helvetica-Bold').fillColor(PDF_LAYOUT.colors.accent);
      doc.text('Erläuterungen');
      doc.font('Helvetica');
      doc.moveDown(0.3);

      for (const abschnitt of anhang.abschnitte) {
        doc
          .fontSize(10)
          .fillColor(PDF_LAYOUT.colors.accent)
          .font('Helvetica-Bold')
          .text(abschnitt.titel);
        doc.font('Helvetica').fontSize(9).fillColor(PDF_LAYOUT.colors.primary);
        doc.text(abschnitt.inhalt, { align: 'left' });
        doc.moveDown(0.6);
      }
    }

    // Status + Hinweise
    if (anhang.status) {
      doc.moveDown(0.5);
      doc.fontSize(9).fillColor(PDF_LAYOUT.colors.primary);
      doc.text(`Status: ${anhang.status}`);
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