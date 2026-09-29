/**
 * Typdeklaration fuer `pdf-parse`.
 *
 * `pdf-parse@1.1.1` liefert kein eigenes `.d.ts` mit. Wir importieren bewusst
 * `pdf-parse/lib/pdf-parse.js` statt des Paket-Einstiegs `pdf-parse`:
 * dessen `index.js` prueft `isDebugMode = !module.parent` und fuehrt dann
 * seinen Demo-Code aus (liest './test/data/05-versions-space.pdf') — unter
 * Vitest ist `module.parent` leer, der Import schlug deshalb mit ENOENT fehl.
 *
 * Fuer den Deep-Import existiert natuerlich keine Deklaration, daher hier.
 */
declare module 'pdf-parse/lib/pdf-parse.js' {
  interface PdfParseResult {
    /** Volltext des Text-Layers (aus den dekomprimierten Content-Streams). */
    text: string;
    numpages: number;
    numrender: number;
    info: Record<string, unknown>;
    metadata: unknown;
    version: string;
  }

  function pdfParse(data: Buffer | Uint8Array | string): Promise<PdfParseResult>;

  export default pdfParse;
}
