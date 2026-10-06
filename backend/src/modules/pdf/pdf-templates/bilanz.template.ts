import PDFDocument from 'pdfkit';
import type { Mandant } from '@prisma/client';
import type { BilanzEntity } from '../../../common/repositories/bilanz.repository';
import { formatBetrag } from '../utils/pdf-format.utils';

/**
 * Alias für den PDFKit-Document-Typ. `PDFKit` ist ein TypeScript-
 * Namespace aus `@types/pdfkit` und als solcher eslint nicht als
 * "defined" bekannt — wir referenzieren es daher über einen
 * dokumentierten Alias.
 */
// eslint-disable-next-line no-undef
export type PdfKitDoc = PDFKit.PDFDocument;

/**
 * Layout-Optionen für das Bilanz-PDF (A4 Hochformat, 60px Margins).
 *
 * Werden von allen Templates genutzt (Bilanz/GuV/Anhang/Abschluss).
 */
export const PDF_LAYOUT = {
  pageSize: 'A4' as const,
  margins: {
    top: 60,
    right: 60,
    bottom: 80, // Platz für WORM-Footer
    left: 60,
  },
  font: {
    size: 10,
  },
  colors: {
    primary: '#1a1a1a',
    accent: '#003366', // HGB-Blau
    zebra: '#f4f6f8',
    rule: '#cccccc',
    // Warnfarbe fuer Saldo-/Abweichungshinweise (Bugfix 2026-10-06).
    danger: '#c0392b',
  },
} as const;

/**
 * Branding-Snapshot, den das PDF-Template nutzt.
 *
 * Backwards-Compat: Alle Felder außer `logoBuffer` haben Defaults
 * (primaryColor/accentColor fallen auf das Layout-Default zurück).
 */
export interface PdfBrandingSnapshot {
  /** Hex-Color der Brand-Primärfarbe. Default = Layout-Accent (#003366). */
  primaryColor?: string;
  /** Hex-Color der Brand-Sekundärfarbe. Default = Layout-Primary (#1a1a1a). */
  accentColor?: string;
  /** Logo-Buffer (PNG/JPEG/SVG). Optional — wenn nicht gesetzt, kein Logo. */
  logoBuffer?: Buffer | null;
  /** Content-Type des Logos. */
  logoContentType?: string;
}

/**
 * Render-Helper für Header + Footer einer Seite.
 *
 * Wird in jedem Template am Ende der `pipe()` registriert.
 */
export function drawHeaderFooter(
  doc: PdfKitDoc,
  options: {
    firmenname: string;
    rechtsform: string;
    geschaeftsjahr: number;
    seiteTitel: string;
    wormObjectKey: string;
    sha256Hash: string;
    erstelltAm: Date;
    erstelltVonEmail: string;
    /**
     * Optionaler Branding-Snapshot (M3 Sprint 4+5). Wenn gesetzt, wird
     * das Logo + die Brand-Color im Header verwendet.
     */
    branding?: PdfBrandingSnapshot | null;
  },
): void {
  // Effektive Brand-Color (Default = Layout-Accent)
  const brandColor = options.branding?.primaryColor ?? PDF_LAYOUT.colors.accent;
  const brandAccent = options.branding?.accentColor ?? PDF_LAYOUT.colors.primary;
  const logoBuffer = options.branding?.logoBuffer;

  // Hilfsfunktion für Footer (unten auf jeder Seite).
  const drawFooter = (): void => {
    // Bugfix 2026-09-28: Der Footer sass mit `+ 20` JENSEITS des
    // beschreibbaren Bereichs (y = height - margins.bottom + 20 > height -
    // margins.bottom). PDFKit reagierte darauf mit einem automatischen
    // addPage() — das wiederum den 'pageAdded'-Listener ausloeste, der
    // drawFooter() erneut aufrief. Ergebnis: endlose Seitenschleife bis
    // "RangeError: Maximum call stack size exceeded"; es konnte kein
    // einziges Bilanz-PDF erzeugt werden.
    //
    // Der Footer belegt 4 Zeilen à 12pt (y, y+12, y+24, y+36). 48pt
    // Reserve halten, damit die letzte Zeile sicher innerhalb des
    // Content-Bereichs bleibt und NIE eine neue Seite triggert.
    const y = doc.page.height - PDF_LAYOUT.margins.bottom - 48;
    doc
      .fontSize(8)
      .fillColor(PDF_LAYOUT.colors.rule)
      .text(
        `Bundesanzeiger Jahresabschluss — GoBD-konform archiviert (${options.geschaeftsjahr})`,
        PDF_LAYOUT.margins.left,
        y,
        { width: doc.page.width - PDF_LAYOUT.margins.left - PDF_LAYOUT.margins.right, align: 'left' },
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
        `Erstellt am ${formatDatumDE(options.erstelltAm)} · ${options.erstelltVonEmail} · BAnz-WORM-ID: ${options.wormObjectKey}`,
        PDF_LAYOUT.margins.left,
        y + 24,
        {
          width: doc.page.width - PDF_LAYOUT.margins.left - PDF_LAYOUT.margins.right,
          align: 'left',
        },
      );
    doc
      .text(
        // KEIN SHA-256 im Dokument: ein PDF kann seinen eigenen Hash nicht
        // enthalten — der Hash aendert sich, sobald er im Dokument steht.
        // Der Hash des finalen Puffers steht im WORM-Manifest, im
        // Audit-Log und in der API-Antwort (`sha256Hash`). Bis 2026-10-06
        // stand hier ein Platzhalter: jedes erzeugte PDF trug woertlich
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
  };

  // pageAdded feuert für JEDE gerenderte Seite (auch die erste).
  doc.on('pageAdded', () => {
    drawFooter();
  });
  // Für die erste Seite muss der Footer manuell gerendert werden —
  // `pageAdded` feuert nur bei Folge-Seiten.
  drawFooter();

  // Header (auf jeder Seite neu rendern).
  doc.on('pageAdded', () => {
    drawHeader();
  });
  drawHeader();

  function drawHeader(): void {
    const y = 30;
    let xCursor = PDF_LAYOUT.margins.left;
    let titleLeftOffset = PDF_LAYOUT.margins.left;

    // Logo (links oben) — wenn vorhanden, 100×40 px, ab y=20.
    if (logoBuffer && logoBuffer.length > 0) {
      try {
        doc.image(logoBuffer, PDF_LAYOUT.margins.left, 20, {
          width: 100,
          height: 40,
        });
        xCursor = PDF_LAYOUT.margins.left + 110;
        titleLeftOffset = PDF_LAYOUT.margins.left + 110;
      } catch {
        // Wenn das Logo nicht ladbar ist (z.B. corrupt), brechen wir
        // den Header sauber ab — kein Crash.
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
        `${options.firmenname} · ${options.rechtsform} · Geschäftsjahr ${options.geschaeftsjahr}`,
        titleLeftOffset,
        y + 18,
        { width: doc.page.width - titleLeftOffset - PDF_LAYOUT.margins.right, align: 'left' },
      );
    doc
      .fontSize(11)
      .fillColor(brandAccent)
      .text(options.seiteTitel, titleLeftOffset, y + 34, {
        width: doc.page.width - titleLeftOffset - PDF_LAYOUT.margins.right,
        align: 'right',
      });
    // Trennlinie unter Header (in Brand-Color)
    doc
      .moveTo(PDF_LAYOUT.margins.left, y + 52)
      .lineTo(doc.page.width - PDF_LAYOUT.margins.right, y + 52)
      .strokeColor(brandColor)
      .lineWidth(1.5)
      .stroke();
    doc.y = y + 64; // Cursor unter Header
    void xCursor;
  }
}

/**
 * Rendert eine Bilanz in einen PDFKit-Stream.
 *
 * Layout:
 *   - Header (Mandant, GJ, "Bilanz zum 31.12.YYYY")
 *   - Aktiva (links) und Passiva (rechts) parallel
 *   - Summen-Zeile + Saldo-Hinweis
 *   - Footer (WORM-Hinweis, WORM-Objekt-ID, BAnz-ID)
 *
 * @returns Buffer mit PDF-Bytes.
 */
export async function renderBilanzPdf(
  bilanz: BilanzEntity,
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
        Title: `Bilanz ${bilanz.geschaeftsjahr} — ${mandant.firmenname}`,
        Author: options.erstelltVonEmail,
        Subject: 'Bundesanzeiger Jahresabschluss',
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
      geschaeftsjahr: bilanz.geschaeftsjahr,
      seiteTitel: `Bilanz zum 31.12.${bilanz.geschaeftsjahr}`,
      wormObjectKey: options.wormObjectKey,
      sha256Hash: options.sha256Hash,
      erstelltAm: options.erstelltAm,
      erstelltVonEmail: options.erstelltVonEmail,
      branding: options.branding ?? null,
    });

    // Bilanz-Titel
    doc
      .fontSize(13)
      .fillColor(PDF_LAYOUT.colors.accent)
      .text(`Bilanz zum 31.12.${bilanz.geschaeftsjahr}`, {
        align: 'left',
      });
    doc
      .fontSize(10)
      .fillColor(PDF_LAYOUT.colors.primary)
      .text(
        `${mandant.firmenname}, ${mandant.rechtsform}${mandant.handelsregister ? ` · ${mandant.handelsregister}` : ''}`,
      );
    doc.moveDown(1);

    // Trennung in Aktiva (links) und Passiva (rechts).
    const positionen = bilanz.positionen;
    const aktiva = positionen.filter((p) => p.seite === 'AKTIVA');
    const passiva = positionen.filter((p) => p.seite === 'PASSIVA');

    let aktivaSumme = 0;
    let passivaSumme = 0;

    const colWidthAktiva = (doc.page.width - 60 - 60 - 20) / 2; // 20px Spaltengap
    const colWidthPassiva = colWidthAktiva;
    const startX = PDF_LAYOUT.margins.left;

    // Tabelle (zwei Spalten) — wir gehen positionen-weise parallel durch.
    //
    // Zeilenhöhe und Umbruch (2026-10-01):
    //   Vorher stand hier `ellipsis: true` mit fester Zeilenhöhe 11 und
    //   `doc.y = y + 14`. Zwei Folgen für eine Pflichtveröffentlichung:
    //     1. Eine zu lange Kontobezeichnung wurde abgeschnitten
    //        („Selbst geschaffene…"). Die vollständige Bezeichnung gehört
    //        in den Anhang bzw. das Gliederungsraster.
    //     2. Es gab KEINEN Seitenumbruch. Bei vielen Konten lief die Tabelle
    //        über den unteren Rand hinaus, ohne dass die Abschnitte
    //        sichtbar wurden.
    //   Jetzt: Umbruch ist erlaubt, die Zeilenhöhe ergibt sich aus dem
    //   tatsächlichen Textumfang beider Spalten, und vor jeder Zeile wird
    //   geprüft, ob noch Platz bis zum Fußbereich ist.
    const maxLen = Math.max(aktiva.length, passiva.length);
    const textWidthAktiva = colWidthAktiva - 80;
    const textWidthPassiva = colWidthPassiva - 80;
    const FONT_SIZE_ROW = 9;
    const LINE_HEIGHT_ROW = 11;
    // Unterer Rand: Seitenhöhe minus unterer Rand (WORM-Footer-Zone).
    const pageBottom = doc.page.height - PDF_LAYOUT.margins.bottom - 30;

    // Spaltenkopf — als Funktion, damit er auf jeder Folgeseite wiederholt wird.
    const drawColumnHeader = (): void => {
      doc.fontSize(10).fillColor(PDF_LAYOUT.colors.accent);
      doc.text('AKTIVA', startX, doc.y, { width: colWidthAktiva, align: 'left' });
      doc.text('PASSIVA', startX + colWidthAktiva + 20, doc.y - 12, {
        width: colWidthPassiva,
        align: 'left',
      });
      doc.fillColor(PDF_LAYOUT.colors.primary);
      doc.moveDown(0.5);
    };

    drawColumnHeader();

    for (let i = 0; i < maxLen; i += 1) {
      const akt = aktiva[i];
      const pas = passiva[i];

      // Zeilenhöhe aus dem tatsächlichen Textumlauf bestimmen — eine Seite
      // darf mehr Zeilen benötigen als die andere.
      doc.fontSize(FONT_SIZE_ROW);
      const aktText = akt ? `${akt.kontonummer}  ${akt.bezeichnung}` : '';
      const pasText = pas ? `${pas.kontonummer}  ${pas.bezeichnung}` : '';
      const aktHeight = aktText
        ? doc.heightOfString(aktText, { width: textWidthAktiva })
        : 0;
      const pasHeight = pasText
        ? doc.heightOfString(pasText, { width: textWidthPassiva })
        : 0;
      const rowHeight = Math.max(aktHeight, pasHeight, LINE_HEIGHT_ROW);

      // Seitenumbruch, wenn die Zeile (inkl. Puffer) nicht mehr passt.
      if (doc.y + rowHeight + 6 > pageBottom) {
        doc.addPage();
        doc.fontSize(PDF_LAYOUT.font.size);
        // Spaltenkopf auf der Folgeseite wiederholen, damit AKTIVA/PASSIVA
        // auch dort eindeutig zugeordnet bleiben.
        drawColumnHeader();
      }

      const y = doc.y;
      // Zebra-Striping
      if (i % 2 === 0) {
        doc
          .save()
          .rect(
            startX - 4,
            y - 2,
            doc.page.width - PDF_LAYOUT.margins.left - PDF_LAYOUT.margins.right + 8,
            rowHeight + 4,
          )
          .fill(PDF_LAYOUT.colors.zebra)
          .restore();
      }

      doc.fontSize(FONT_SIZE_ROW).fillColor(PDF_LAYOUT.colors.primary);
      if (akt) {
        const betrag = Number(akt.betragAktuell);
        aktivaSumme += betrag;
        doc.text(aktText, startX, y, {
          width: textWidthAktiva,
          align: 'left',
          lineBreak: true,
        });
        doc.text(
          formatBetrag(betrag),
          startX + colWidthAktiva - 80,
          y,
          { width: 80, align: 'right', lineBreak: false, height: 11 },
        );
      }
      if (pas) {
        const betrag = Number(pas.betragAktuell);
        passivaSumme += betrag;
        doc.text(pasText, startX + colWidthAktiva + 20, y, {
          width: textWidthPassiva,
          align: 'left',
          lineBreak: true,
        });
        doc.text(
          formatBetrag(betrag),
          startX + colWidthAktiva + 20 + colWidthPassiva - 80,
          y,
          { width: 80, align: 'right', lineBreak: false, height: 11 },
        );
      }
      doc.y = y + rowHeight + 3;
    }

    doc.moveDown(0.5);

    // Summen-Zeile
    const ySum = doc.y;
    doc.fontSize(10).fillColor(PDF_LAYOUT.colors.accent).font('Helvetica-Bold');
    doc.text('Summe Aktiva', startX, ySum, {
      width: colWidthAktiva - 80,
      align: 'left',
    });
    doc.text(
      formatBetrag(aktivaSumme),
      startX + colWidthAktiva - 80,
      ySum,
      { width: 80, align: 'right' },
    );
    doc.text('Summe Passiva', startX + colWidthAktiva + 20, ySum, {
      width: colWidthPassiva - 80,
      align: 'left',
    });
    doc.text(
      formatBetrag(passivaSumme),
      startX + colWidthAktiva + 20 + colWidthPassiva - 80,
      ySum,
      { width: 80, align: 'right' },
    );
    doc.font('Helvetica');
    doc.y = ySum + 18;

    // Saldo-Check
    doc.moveDown(0.5);
    const saldo = Math.abs(aktivaSumme - passivaSumme);
    const saldostimmt = saldo < 0.01;
    doc.fontSize(10).fillColor(PDF_LAYOUT.colors.primary);
    if (saldostimmt) {
      doc.text(`Saldo: Aktiva = Passiva ✓ (Differenz: ${formatBetrag(saldo)} €)`);
    } else {
      doc
        .fillColor('#aa0000')
        .text(
          `Saldo: Aktiva ≠ Passiva (Differenz: ${formatBetrag(saldo)} €) — Bilanz ist NICHT ausgeglichen!`,
        );
    }
    doc.fillColor(PDF_LAYOUT.colors.primary);

    // Bilanzsumme
    const bilanzsumme = Math.max(aktivaSumme, passivaSumme);
    doc.moveDown(1);
    doc.fontSize(11).font('Helvetica-Bold').text(
      `Bilanzsumme: ${formatBetrag(bilanzsumme)} €`,
    );
    doc.font('Helvetica');

    // Status + Hinweise
    doc.moveDown(1);
    doc.fontSize(9).fillColor(PDF_LAYOUT.colors.primary);
    doc.text(`Status: ${bilanz.status}`);
    if (bilanz.hinweise) {
      doc.moveDown(0.3);
      doc.text(`Hinweise: ${bilanz.hinweise}`);
    }

    // M1 Signatur-Hinweis (Mock für M2 — qualifizierte Signatur).
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

/**
 * Hilfsfunktion: DE-Datum (intern, nicht exportiert).
 */
function formatDatumDE(d: Date): string {
  const day = String(d.getUTCDate()).padStart(2, '0');
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${day}.${month}.${d.getUTCFullYear()}`;
}