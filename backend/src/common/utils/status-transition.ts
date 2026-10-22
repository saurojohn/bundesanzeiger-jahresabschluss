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
 * Der **Freigabemarker** der Vier-Augen-Pruefung.
 *
 * Er wird von der WP-Freigabe gesetzt (`setBilanzStatus`); per API ist er
 * nicht setzbar (`BILANZ_STATUS` enthaelt ihn bewusst nicht).
 */
export const FREIGABEMARKER = 'APPROVED';

/**
 * Wirft, wenn der Freigabemarker der Vier-Augen-Pruefung veraendert werden
 * soll.
 *
 * BEFUND 2026-10-22 (Nachtrag 81): Die Regel blockierte bisher **nur** den
 * Uebergang nach `DRAFT`. Jeder andere Uebergang aus `APPROVED` war frei —
 * also liess sich der Marker mit einem PATCH wegraeumen:
 *
 *     Vier-Augen-Freigabe   -> HTTP 200, Status der Bilanz: APPROVED
 *     PATCH {status:VALIDATED} -> HTTP 200, Status der Bilanz: VALIDATED
 *
 * Die Daten blieben dabei geschuetzt (die Positionen sind ab VALIDATED
 * eingefroren) und der Pruefdatensatz lebte weiter. Aber das PDF druckt
 * `Status: ${bilanz.status}` — im **signierten und veroeffentlichten**
 * Dokument stand danach "VALIDATED" statt "Freigegeben (WP)". Der Audit-Trail
 * (Pruefdatensatz) und das Dokument widersprachen sich.
 *
 * Der Nachtrag-29-Bericht hatte genau diesen Angriff benannt ("Freigabe einer
 * Wirtschaftsprueferin zurueckrechnen"); behoben wurde damals nur die
 * zweite Haelfte — die Datenaenderung. Das Wegrechnen des Markers blieb offen.
 *
 * ENTSCHEIDUNG der Fachverantwortlichen vom 2026-10-22: fail-closed. Der
 * Freigabestatus ist der Endzustand des Statusfelds.
 *
 * Die Freigabe selbst ist davon **nicht** betroffen: sie schreibt den Status
 * direkt (nicht ueber den Update-Pfad) und setzt damit `APPROVED`.
 */
export function assertFreigabemarkerUnveraendert(
  aktuell: string,
  angefordert: string | undefined,
  bezeichnung: string,
): void {
  if (angefordert === undefined || angefordert === aktuell) return;
  if (aktuell !== FREIGABEMARKER) return;

  throw new BadRequestException(
    `${bezeichnung} ist durch die Vier-Augen-Freigabe des Wirtschaftsprüfers ` +
      `freigegeben (Status ${aktuell}). Dieser Freigabestatus darf nicht mehr ` +
      `geaendert werden: Er weist die Prüfung im signierten und veroeffentlichten ` +
      `Dokument aus (§ 146 AO, § 147 AO). Ein veraenderter Status wuerde im ` +
      `Dokument einen anderen Prüfstand ausweisen als der Audit-Trail.`,
  );
}

/**
 * Ist der Datensatz noch in Bearbeitung? Dann duerfen Positionen,
 * Abschnitte und Inhalte geaendert werden.
 */
export function istInBearbeitung(status: string): boolean {
  return status === BEARBEITUNGSSTATUS;
}