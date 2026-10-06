import PDFDocument from 'pdfkit';
import type { Mandant } from '@prisma/client';
import type { BilanzEntity } from '../../../common/repositories/bilanz.repository';
import type { GuVEntity } from '../../../common/repositories/guv.repository';
import type { AnhangEntity } from '../../../common/repositories/anhang.repository';
import {
  PDF_LAYOUT,
  type PdfKitDoc,
  type PdfBrandingSnapshot,
} from './bilanz.template';
import { formatBetrag } from '../utils/pdf-format.utils';

/**
 * Rendert einen KOMPLETTEN Jahresabschluss (Bilanz + GuV + Anhang) als
 * ein einzelnes PDF mit mehreren Seiten.
 *
 * Anders als die einzelnen Renderer ruft dieser Helper NICHT `doc.end()`
 * am Ende — der Aufrufer schließt das Dokument, damit z.B. weitere
 * Seiten (Lagebericht, M2) angehängt werden können.
 *
 * Implementierungs-Strategie: Wir nutzen EIN PDFDocument und rufen
 * `doc.addPage()` zwischen den Sektionen. Layout-Werte (Header/Footer)
 * werden via `pageAdded`-Listener konsistent gehalten.
 */
export interface AbschlussParts {
  bilanz: BilanzEntity;
  guv: GuVEntity;
  anhang: AnhangEntity;
}

export interface AbschlussRenderOptions {
  erstelltAm: Date;
  erstelltVonEmail: string;
  wormObjectKey: string;
  sha256Hash: string;
  branding?: PdfBrandingSnapshot | null;
}

/**
 * Erstellt das PDFKit-Dokument für den Abschluss. Der Aufrufer ist
 * für das Schließen (`doc.end()`) verantwortlich.
 */
export function createAbschlussPdfDoc(
  parts: AbschlussParts,
  mandant: Mandant,
  options: AbschlussRenderOptions,
): PdfKitDoc {
  const doc = new PDFDocument({
    size: PDF_LAYOUT.pageSize,
    margins: PDF_LAYOUT.margins,
    info: {
      Title: `Jahresabschluss ${parts.bilanz.geschaeftsjahr} — ${mandant.firmenname}`,
      Author: options.erstelltVonEmail,
      Subject: 'Bundesanzeiger Jahresabschluss',
      Creator: 'Bundesanzeiger Jahresabschluss Backend',
      Producer: 'PDFKit',
      CreationDate: options.erstelltAm,
    },
  });

  // Brand-Color für die interne Verwendung (Titelseite).
  const brandColor = options.branding?.primaryColor ?? PDF_LAYOUT.colors.accent;
  const brandAccent =
    options.branding?.accentColor ?? PDF_LAYOUT.colors.primary;
  const logoBuffer = options.branding?.logoBuffer;

  // Header + Footer (für jede Seite).
  doc.on('pageAdded', () => drawHeaderFooter(doc, options, mandant));
  // Erste Seite
  drawHeaderFooter(doc, options, mandant);

  // ============== Titelseite ==============
  // Logo zentriert oben, falls vorhanden.
  if (logoBuffer && logoBuffer.length > 0) {
    try {
      const pageCenter = doc.page.width / 2;
      doc.image(logoBuffer, pageCenter - 60, 40, { width: 120, height: 48 });
      doc.y = 100;
    } catch {
      // Bei defektem Logo überspringen wir es sauber.
    }
  }

  doc.fontSize(20).fillColor(brandColor).text('Jahresabschluss', {
    align: 'center',
  });
  doc.moveDown(0.5);
  doc
    .fontSize(16)
    .fillColor(brandAccent)
    .text(`${mandant.firmenname}`, { align: 'center' });
  doc
    .fontSize(12)
    .text(
      `${mandant.rechtsform}${mandant.handelsregister ? ` · ${mandant.handelsregister}` : ''}`,
      { align: 'center' },
    );
  doc.moveDown(1);
  doc
    .fontSize(18)
    .fillColor(brandColor)
    .text(`Geschäftsjahr ${parts.bilanz.geschaeftsjahr}`, { align: 'center' });
  doc.moveDown(2);

  doc.fontSize(10).fillColor(brandAccent);
  doc.text(
    `Dieser Jahresabschluss besteht aus den nach § 264 HGB erforderlichen Bestandteilen:`,
    { align: 'center' },
  );
  doc.moveDown(0.5);
  doc.text('• Bilanz (§ 266 HGB)', { align: 'center' });
  doc.text('• Gewinn- und Verlustrechnung (§ 275 HGB)', { align: 'center' });
  doc.text('• Anhang (§§ 284–289 HGB)', { align: 'center' });
  doc.moveDown(2);

  doc
    .fontSize(9)
    .fillColor(PDF_LAYOUT.colors.rule)
    .text(
      'PDF/A-3-konform · WORM-archiviert (S3 Object Lock, COMPLIANCE, 3650 Tage)',
      { align: 'center' },
    );

  // ============== Bilanz-Seite ==============
  doc.addPage();
  doc.fontSize(13).fillColor(PDF_LAYOUT.colors.accent).text(
    `Bilanz zum 31.12.${parts.bilanz.geschaeftsjahr}`,
  );
  doc.moveDown(0.5);
  doc
    .fontSize(10)
    .fillColor(PDF_LAYOUT.colors.primary)
    .text(
      `${mandant.firmenname}, ${mandant.rechtsform}${mandant.handelsregister ? ` · ${mandant.handelsregister}` : ''}`,
    );
  doc.moveDown(0.8);

  const aktiva = parts.bilanz.positionen.filter((p) => p.seite === 'AKTIVA');
  const passiva = parts.bilanz.positionen.filter((p) => p.seite === 'PASSIVA');
  let aktivaSumme = 0;
  let passivaSumme = 0;

  const tableLeft = PDF_LAYOUT.margins.left;
  const tableWidth =
    doc.page.width - PDF_LAYOUT.margins.left - PDF_LAYOUT.margins.right;
  const colWidthAktiva = (tableWidth - 20) / 2;
  const colWidthPassiva = colWidthAktiva;

  doc.fontSize(10).font('Helvetica-Bold').fillColor(PDF_LAYOUT.colors.accent);
  doc.text('AKTIVA', tableLeft, doc.y, {
    width: colWidthAktiva,
    align: 'left',
  });
  doc.text('PASSIVA', tableLeft + colWidthAktiva + 20, doc.y - 12, {
    width: colWidthPassiva,
    align: 'left',
  });
  doc.font('Helvetica');
  doc.moveDown(0.5);

  const maxLen = Math.max(aktiva.length, passiva.length);
  for (let i = 0; i < maxLen; i += 1) {
    const y = doc.y;
    if (i % 2 === 0) {
      doc
        .save()
        .rect(
          tableLeft - 4,
          y - 2,
          tableWidth + 8,
          14,
        )
        .fill(PDF_LAYOUT.colors.zebra)
        .restore();
    }
    const akt = aktiva[i];
    const pas = passiva[i];
    doc.fontSize(9).fillColor(PDF_LAYOUT.colors.primary);
    if (akt) {
      const betrag = Number(akt.betragAktuell);
      aktivaSumme += betrag;
      doc.text(`${akt.kontonummer}  ${akt.bezeichnung}`, tableLeft, y, {
        width: colWidthAktiva - 80,
        align: 'left',
        lineBreak: false,
      });
      doc.text(formatBetrag(betrag), tableLeft + colWidthAktiva - 80, y, {
        width: 80,
        align: 'right',
        lineBreak: false,
      });
    }
    if (pas) {
      const betrag = Number(pas.betragAktuell);
      passivaSumme += betrag;
      doc.text(
        `${pas.kontonummer}  ${pas.bezeichnung}`,
        tableLeft + colWidthAktiva + 20,
        y,
        { width: colWidthPassiva - 80, align: 'left', lineBreak: false },
      );
      doc.text(
        formatBetrag(betrag),
        tableLeft + colWidthAktiva + 20 + colWidthPassiva - 80,
        y,
        { width: 80, align: 'right', lineBreak: false },
      );
    }
    doc.y = y + 14;
  }

  doc.moveDown(0.5);
  doc.fontSize(11).font('Helvetica-Bold').fillColor(PDF_LAYOUT.colors.accent);
  doc.text(`Bilanzsumme: ${formatBetrag(Math.max(aktivaSumme, passivaSumme))} €`, {
    align: 'center',
  });
  doc.font('Helvetica').fillColor(PDF_LAYOUT.colors.primary);

  // ============== GuV-Seite ==============
  doc.addPage();
  doc.fontSize(13).fillColor(PDF_LAYOUT.colors.accent).text(
    `Gewinn- und Verlustrechnung ${parts.guv.geschaeftsjahr}`,
  );
  doc.moveDown(0.5);
  doc
    .fontSize(10)
    .fillColor(PDF_LAYOUT.colors.primary)
    .text(
      `${mandant.firmenname}, ${mandant.rechtsform}${mandant.handelsregister ? ` · ${mandant.handelsregister}` : ''}`,
    );
  doc.fontSize(9).text(
    `Verfahren: ${parts.guv.verfahren === 'GKV' ? 'Gesamtkostenverfahren (§ 275 Abs. 2 HGB)' : 'Umsatzkostenverfahren (§ 275 Abs. 3 HGB)'}`,
  );
  doc.moveDown(0.8);

  for (const pos of parts.guv.positionen) {
    const y = doc.y;
    if (parts.guv.positionen.indexOf(pos) % 2 === 0) {
      doc.save().rect(tableLeft - 4, y - 2, tableWidth + 8, 14).fill(PDF_LAYOUT.colors.zebra).restore();
    }
    const betrag = Number(pos.betragAktuell);
    doc.fontSize(9).fillColor(PDF_LAYOUT.colors.primary);
    doc.text(`${pos.kontonummer}  ${pos.bezeichnung}`, tableLeft, y, {
      width: tableWidth - 100,
      align: 'left',
      lineBreak: false,
    });
    doc.text(formatBetrag(betrag), tableLeft + tableWidth - 100, y, {
      width: 100,
      align: 'right',
      lineBreak: false,
    });
    doc.y = y + 14;
  }
  doc.moveDown(0.5);
  doc.fontSize(12).font('Helvetica-Bold').fillColor(PDF_LAYOUT.colors.accent);
  doc.text(
    `Jahresergebnis: ${formatBetrag(Number(parts.guv.ergebnis))} €`,
    { align: 'right' },
  );
  doc.font('Helvetica').fillColor(PDF_LAYOUT.colors.primary);

  // ============== Anhang-Seiten ==============
  doc.addPage();
  doc.fontSize(13).fillColor(PDF_LAYOUT.colors.accent).text(
    `Anhang für das Geschäftsjahr ${parts.anhang.geschaeftsjahr}`,
  );
  doc.moveDown(0.5);
  doc
    .fontSize(10)
    .fillColor(PDF_LAYOUT.colors.primary)
    .text(
      `${mandant.firmenname}, ${mandant.rechtsform}${mandant.handelsregister ? ` · ${mandant.handelsregister}` : ''}`,
    );
  doc.moveDown(0.8);

  const sections: Array<{ titel: string; inhalt: string | null | undefined }> = [
    { titel: 'Bilanzierungsmethoden (§ 284 Abs. 2 Nr. 1 HGB)', inhalt: parts.anhang.bilanzierungsMethoden },
    { titel: 'Bewertungsmethoden (§ 284 Abs. 2 Nr. 2 HGB)', inhalt: parts.anhang.bewertungsMethoden },
    { titel: 'Sonstige Pflichtangaben (§ 285 HGB)', inhalt: parts.anhang.sonstigePflichtangaben },
  ];
  for (const sec of sections) {
    if (!sec.inhalt) continue;
    doc.fontSize(11).font('Helvetica-Bold').fillColor(PDF_LAYOUT.colors.accent);
    doc.text(sec.titel);
    doc.font('Helvetica').fontSize(9).fillColor(PDF_LAYOUT.colors.primary);
    doc.text(sec.inhalt);
    doc.moveDown(0.5);
  }

  // `abschnitte` kann bei unvollstaendigen Entities fehlen — dann rendern wir
  // den Anhang-Teil ohne Abschnitte, statt eine TypeError zu werfen. Ein
  // fehlender Anhang-Abschnitt ist ein Daten-, kein Renderfehler.
  for (const abschnitt of parts.anhang.abschnitte ?? []) {
    doc.fontSize(10).font('Helvetica-Bold').fillColor(PDF_LAYOUT.colors.accent);
    doc.text(abschnitt.titel);
    doc.font('Helvetica').fontSize(9).fillColor(PDF_LAYOUT.colors.primary);
    doc.text(abschnitt.inhalt);
    doc.moveDown(0.5);
  }

  // Mock-Signatur-Hinweis auf der letzten Seite
  doc.moveDown(1);
  doc
    .fontSize(8)
    .fillColor(PDF_LAYOUT.colors.rule)
    .text(
      'Mock-Signatur (M1) — In M2 wird dieser Jahresabschluss qualifiziert signiert (qeS, § 2 Nr. 3 SigG).',
      { align: 'center' },
    );

  return doc;
}

/**
 * Interne Helper für Header+Footer im Abschluss-PDF.
 */
/**
 * Dokumente, fuer die die pageAdded-Listener bereits registriert wurden.
 * Verhindert das Wachstum der Listener-Zahl ueber die Seitenzahl hinweg.
 */
const renderedDocs = new WeakSet<PdfKitDoc>();

function drawHeaderFooter(
  doc: PdfKitDoc,
  options: AbschlussRenderOptions,
  mandant: Mandant,
): void {
  // Brand-Color (M3 Sprint 4+5)
  const brandColor = options.branding?.primaryColor ?? PDF_LAYOUT.colors.accent;
  const brandAccent =
    options.branding?.accentColor ?? PDF_LAYOUT.colors.primary;
  const logoBuffer = options.branding?.logoBuffer;

  // Footer + Header auf JEDE Seite.
  //
  // Bugfix 2026-09-28: `drawHeaderFooter` wird aus einem `pageAdded`-Listener
  // heraus bei jeder addPage() erneut aufgerufen (siehe renderAbschlussPdf).
  // Die beiden inneren `doc.on('pageAdded', ...)` wurden dadurch bei JEDER
  // Seite erneut registriert, ohne dass alte entfernt wurden: bei 120
  // Bilanzpositionen 311 Listener, dazu eine
  // MaxListenersExceededWarning und spürbarer Performance-Overhead
  // (7,8 s für ein 4-seitiges Dokument).
  //
  // Fix: pro PDFDocument nur EINMAL registrieren. Das WeakSet haelt die
  // bereits verdrahteten Dokumente; prozedurale Renderings erzeugen ohnehin
  // ein neues PDFDocument, es entsteht also kein Leck zwischen Dokumenten.
  if (!renderedDocs.has(doc)) {
    renderedDocs.add(doc);
    doc.on('pageAdded', () => drawFooter());
    doc.on('pageAdded', () => drawHeader());
  }
  drawFooter();
  drawHeader();

  function drawHeader(): void {
    const y = 30;
    let titleLeftOffset = PDF_LAYOUT.margins.left;

    // Logo (links oben), falls vorhanden
    if (logoBuffer && logoBuffer.length > 0) {
      try {
        doc.image(logoBuffer, PDF_LAYOUT.margins.left, 20, {
          width: 100,
          height: 40,
        });
        titleLeftOffset = PDF_LAYOUT.margins.left + 110;
      } catch {
        // Logo-Fehler werden geschluckt (kein Crash).
      }
    }

    doc
      .fontSize(14)
      .fillColor(brandColor)
      .text('Bundesanzeiger Jahresabschluss', titleLeftOffset, y, {
        width: doc.page.width - titleLeftOffset - PDF_LAYOUT.margins.right,
        align: 'left',
      });
    doc
      .fontSize(9)
      .fillColor(brandAccent)
      .text(
        `${mandant.firmenname} · ${mandant.rechtsform}`,
        titleLeftOffset,
        y + 18,
        {
          width: doc.page.width - titleLeftOffset - PDF_LAYOUT.margins.right,
          align: 'left',
        },
      );
    doc.y = y + 32;
  }

  function drawFooter(): void {
    // Bugfix 2026-09-28: identischer Fehler wie in bilanz.template.ts —
    // `+ 20` legte den Footer jenseits des beschreibbaren Bereichs, was
    // PDFKit mit addPage() beantwortete; der 'pageAdded'-Listener rief
    // drawFooter() erneut auf (endlose Seitenschleife). 48pt Reserve fuer
    // die vier Footer-Zeilen à 12pt.
    const y = doc.page.height - PDF_LAYOUT.margins.bottom - 48;
    doc
      .fontSize(8)
      .fillColor(PDF_LAYOUT.colors.rule)
      .text(
        `Bundesanzeiger Jahresabschluss — GoBD-konform archiviert`,
        PDF_LAYOUT.margins.left,
        y,
        {
          width: doc.page.width - PDF_LAYOUT.margins.left - PDF_LAYOUT.margins.right,
          align: 'left',
        },
      )
      .text(
        `WORM-Hinweis: Dieses Dokument ist gem. § 147 AO 10 Jahre unveränderlich archiviert.`,
        PDF_LAYOUT.margins.left,
        y + 12,
        {
          width: doc.page.width - PDF_LAYOUT.margins.left - PDF_LAYOUT.margins.right,
          align: 'left',
        },
      )
      .text(
        `Erstellt am ${options.erstelltAm.toISOString()} · ${options.erstelltVonEmail} · BAnz-WORM-ID: ${options.wormObjectKey}`,
        PDF_LAYOUT.margins.left,
        y + 24,
        {
          width: doc.page.width - PDF_LAYOUT.margins.left - PDF_LAYOUT.margins.right,
          align: 'left',
        },
      );
    doc.text(
    // KEIN SHA-256 im Dokument: ein PDF kann seinen eigenen Hash nicht
          // enthalten. Der Hash des finalen Puffers steht im WORM-Manifest,
          // im Audit-Log und in der API-Antwort (`sha256Hash`). Bis 2026-10-06
          // stand hier ein Platzhalter — jedes erzeugte PDF trug woertlich
          // „SHA-256: PENDING-PLACEHOL…" und behauptete damit eine
          // Integritaetsangabe, die es nicht gab.
      `WORM-Objekt: ${options.sha256Hash.slice(0, 16)}`,
      PDF_LAYOUT.margins.left,
      y + 36,
      {
        width: doc.page.width - PDF_LAYOUT.margins.left - PDF_LAYOUT.margins.right,
        align: 'right',
      },
    );
  }
}

/**
 * Rendert den kompletten Abschluss als Buffer.
 */
export async function renderAbschlussPdf(
  parts: AbschlussParts,
  mandant: Mandant,
  options: AbschlussRenderOptions,
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = createAbschlussPdfDoc(parts, mandant, options);
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}