/**
 * Regel fuer den Archivzustand eines Mandanten.
 *
 * PRODUKTENTSCHEIDUNG 2026-10-09: „Archivieren statt Loeschen" — ein
 * Mandant, der weg muss, wird auf archiviert geschaltet. Der Bestand
 * bleibt lesbar und nachvollziehbar (§ 147 AO), es entstehen keine neuen
 * Belege.
 *
 * Diese Datei enthaelt die pure Regel, damit sie ohne Datenbank testbar
 * ist. Der Datenzugriff liegt in `MandantRepository`.
 *
 * Bewusst KEINE Aussage darueber, ob Archivierte Mandanten noch
 * gesperrt werden muessen, wer sie einsehen darf oder wie lange sie
 * aufbewahrt werden. Das sind Fachentscheidungen; hier steht nur, was
 * beim Schreiben passiert.
 */
import { ConflictException } from '@nestjs/common';

/**
 * Wirft, wenn der Mandant archiviert ist.
 *
 * @param archiviertAt Archivzeitpunkt des Mandanten, null = aktiv
 * @param aktion       Was abgelehnt wird, fuer die Fehlermeldung
 */
export function assertMandantNichtArchiviert(
  archiviertAt: Date | null | undefined,
  aktion: string,
): void {
  if (!archiviertAt) return;

  throw new ConflictException(
    `Mandant ist archiviert (seit ${archiviertAt.toISOString()}). ` +
      `„${aktion}" ist fuer archivierte Mandanten nicht moeglich. ` +
      `Der Bestand bleibt zur Nachvollziehbarkeit erhalten (§ 147 AO), ` +
      `wird aber nicht fortgeschrieben. Archivierung aufheben: ` +
      `PATCH /api/mandant/:id/archivierung/aufheben.`,
  );
}