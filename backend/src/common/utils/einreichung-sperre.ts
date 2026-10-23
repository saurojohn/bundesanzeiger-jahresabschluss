/**
 * Nach der Einreichung beim Bundesanzeiger wird der Datenbestand **nicht
 * mehr fortgeschrieben**.
 *
 * BEFUND 2026-10-24 (Nachtrag 95): Nach der Einreichung (SUBMITTED) bzw.
 * der Veroeffentlichung (PUBLISHED) war der Inhalt des Anhangs weiterhin
 * änderbar.
 *
 * **GEMESSEN** an der laufenden API (Abschluss SUBMITTED, Bestellnummer
 * MESS-… gesetzt):
 *
 *     PATCH /api/anhang/<id> { bilanzierungsMethoden: '…' } -> HTTP 200
 *     in der Datenbank: "NACHTRAG nach der Einreichung"
 *
 * Das ist ein Loch **mit Folgen**: eine erneute Signatur ist für einen
 * eingereichten Abschluss gesperrt (Nachtrag 78), der Einreichungsweg
 * setzt den Status `SIGNED` voraus — die Änderung konnte also **nie**
 * nachgezogen werden. Der Datenbestand wäre dauerhaft vom eingereichten
 * Dokument abgewichen (§ 147 AO: das eingereichte Dokument ist die Fassung).
 *
 * Die Regel folgt aus den bestehenden Entscheidungen: Nachtrag 78
 * („SUBMITTED/PUBLISHED bleiben gesperrt"), Nachtrag 76/77 (der Bestand wird
 * nach der Einreichung nicht fortgeschrieben) und § 147 AO.
 *
 * **Bis zur Einreichung bleibt der Korrekturvorgang offen** — das ist die
 * Entscheidung der Fachverantwortlichen vom 2026-10-14: „Soll das Signieren
 * die Bilanz/GuV/Anhang gegen Änderung sperren?" → **Nein**. Nach der
 * Signatur (`SIGNED`) darf also geändert und danach neu signiert werden.
 *
 * Diese Datei ist die **eine** Stelle, an der festgelegt ist, welche
 * Abschluss-Status den Bestand einfrieren und was der Nutzer dann liest.
 */

/** Die Abschluss-Status, in denen der Bestand eingefroren ist. */
export const EINGEREICHTE_ABSCHLUSS_STATUS = ['SUBMITTED', 'PUBLISHED'] as const;

/**
 * Ist der Jahresabschluss eingereicht (oder veroeffentlicht)?
 */
export function istEingereicht(status: string | null | undefined): boolean {
  if (!status) return false;
  return (EINGEREICHTE_ABSCHLUSS_STATUS as readonly string[]).includes(status);
}

/**
 * Die Meldung, die der Nutzer liest, wenn der Bestand eingefroren ist.
 */
export function eingereichtSperrtext(status: string): string {
  return (
    `Der Jahresabschluss ist eingereicht (Status ${status}) — der Inhalt ist ` +
    'unveraenderlich. Die eingereichte Fassung liegt beim Bundesanzeiger; ' +
    'eine Aenderung koennte nicht mehr nachgezogen werden (§ 147 AO).'
  );
}
