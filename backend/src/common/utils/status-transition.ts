/**
 * Statusuebergang fuer die Abschluss-Bestandteile (Bilanz, GuV, Anhang).
 *
 * BEFUND 2026-10-09 — `status` kam ungeprueft aus dem Request. Die
 * Sperre „Positionen nur in DRAFT" war damit ein Schloss ohne
 * Schluessel-Zwang: ein einziger PATCH `{ status: 'DRAFT' }` hat sie
 * wieder geoeffnet.
 *
 * Live gemessen, vier Requests ueber die oeffentliche API:
 *
 *   PATCH { status: 'VALIDATED' }   -> 200   (DB: VALIDATED)
 *   PATCH { positionen: [...] }     -> 400   "nur in DRAFT-Phase"   <- korrekt
 *   PATCH { status: 'DRAFT' }       -> 200   (DB: DRAFT)           <- die Umgehung
 *   PATCH { positionen: [...] }     -> 200   (Betraege wirklich neu)
 *
 * Betroffen sind Bilanz, GuV und Anhang identisch. Betroffen war auch der
 * Vier-Augen-Freigabestand: die WP-Pruefung setzt `APPROVED` direkt
 * (`setBilanzStatus`), und von dort aus genuegte derselbe PATCH, um die
 * Freigabe einer Wirtschaftsprüferin anschliessend wegzurechnen — die
 * Kontrolle war damit auf zwei Requests verteilt und damit keine.
 *
 * REGEL
 *
 * `DRAFT` heisst „in Bearbeitung" und ist ein monotoner Zustand: wer ihn
 * einmal verlassen hat, kann nicht zurueck. Alles andere bleibt
 * unveraendert erlaubt (VALIDATED -> ARCHIVED ist ein vorwaertsgerichteter
 * Schritt und wird nicht angefasst).
 *
 * Bewusst NICHT erfunden: eine vollstaendige Zustandsmaschine
 * (welcher Uebergang wann erlaubt ist) waere eine Fachentscheidung. Hier
 * wird genau der nachgewiesene Weg geschlossen und sonst nichts.
 *
 * Diese Datei ist die einzige Quelle der Wahrheit fuer die Regel. Vorher
 * hatte jeder Service seine eigene Kopie der Pruefung — und Bilanz, GuV
 * und Anhang auch noch unterschiedliche Fehlermeldungen fuer denselben
 * Sachverhalt.
 */
import { BadRequestException } from '@nestjs/common';

/**
 * Der Bearbeitungszustand. Alles andere gilt als abgeschlossen.
 */
export const BEARBEITUNGSSTATUS = 'DRAFT';

/**
 * Wirft, wenn ein abgeschlossener Datensatz ueber den Request wieder in
 * den Bearbeitungszustand zurueckgesetzt werden soll.
 *
 * @param aktuell   Status in der Datenbank
 * @param angefordert Status aus dem Request (undefined = unveraendert)
 * @param bezeichnung Anzeigename des Bestandteils, z. B. "Bilanz"
 */
export function assertKeinZuruecksetzenInBearbeitung(
  aktuell: string,
  angefordert: string | undefined,
  bezeichnung: string,
): void {
  if (angefordert === undefined || angefordert === aktuell) return;

  if (aktuell !== BEARBEITUNGSSTATUS && angefordert === BEARBEITUNGSSTATUS) {
    throw new BadRequestException(
      `${bezeichnung} ist im Status ${aktuell} und kann nicht wieder in Bearbeitung ` +
        `(${BEARBEITUNGSSTATUS}) gesetzt werden. Abgeschlossene Abschlussunterlagen sind ` +
        `unveränderbar (§ 147 AO); die Bearbeitungssperre auf Positionen und Abschnitte ` +
        `wäre sonst mit einem einzigen Request aufzuheben.`,
    );
  }
}

/**
 * Ist der Datensatz noch in Bearbeitung? Dann duerfen Positionen,
 * Abschnitte und Inhalte geaendert werden.
 */
export function istInBearbeitung(status: string): boolean {
  return status === BEARBEITUNGSSTATUS;
}