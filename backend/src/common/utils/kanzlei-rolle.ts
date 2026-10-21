/**
 * Rollenbindung an eine Kanzlei.
 *
 * BEFUND 2026-10-11 — Vier Services hatten denselben Fehler:
 *
 *     const isAdmin = user.mandanten.some((m) => m.rolle === 'KANZLEI_ADMIN');
 *     ...
 *     await this.assertKanzleiAccess(kanzleiId, user);
 *
 * Zwei Prüfungen, unabhängig voneinander. Die erste belegt „Admin
 * IRGENDWO", die zweite „Mandant in der Ziel-Kanzlei" — aber nicht
 * „Admin IN dieser Kanzlei". Wer in Kanzlei A KANZLEI_ADMIN ist und in
 * Kanzlei B STEUERBERATER, besteht beide Prüfungen für Kanzlei B und darf
 * dort Subscription kündigen, API-Keys anlegen, Webhooks registrieren und
 * die Custom-Domain verifizieren.
 *
 * Die Kommentare an den Fundstellen kannten das Problem — in
 * `webhook.service.ts` steht wörtlich, die Prüfung belege „nur Admin
 * IRGENDWO". Die Korrektur vom 2026-10-06 hat den `kanzleiId`-Zugriff
 * ergänzt, aber Rolle und Kanzlei nicht miteinander verbunden.
 *
 * Diese Datei ist die einzige Stelle, die die Bindung herstellt. Wie bei
 * `status-transition.ts`: vorher gab es drei Kopien derselben Prüfung mit
 * drei verschiedenen Fehlermeldungen.
 *
 * BEFUND 2026-10-21 (Nachtrag 71): Es waren **fuenf** Services, nicht vier.
 * Nach dem 2026-10-11 waren Subscription, API-Keys, Webhooks und
 * Custom-Domain auf diesen Helfer umgestellt — das Branding (`branding.service.ts`)
 * stand weiterhin auf der alten Logik („Admin IRGENDWO" + „Mandant in der
 * Ziel-Kanzlei") und wurde erst am 2026-10-21 nachgezogen. Die Zahl der
 * bereits gefixten Stellen sagt nichts ueber die Zahl der noch offenen.
 *
 * Auch im Mandant-Modul stand die Frage noch an zwei Stellen
 * (`assertMandantAccess()`, `assertKanzleiAdminFuerMandant()`) — dort ist
 * die Bindung ueber `rollenBindung()` hergestellt, weil der Kanzlei-Admin
 * ueber Mandanten gebunden ist und nicht ueber eine Kanzlei-ID im Token.
 */
import { ForbiddenException } from '@nestjs/common';

/** Mandanten-Zugriff aus der Auth-Session. */
export interface MandantZugriff {
  id: string;
  rolle: string;
}

/**
 * Besitzt der User die Admin-Rolle in einem der genannten Mandanten?
 *
 * @param mandantIdsInKanzlei Mandant-IDs, die zur Ziel-Kanzlei gehören
 *                              (bereits per DB-Abfrage ermittelt)
 * @param userMandanten       Mandanten-Zugriffe aus der Session
 */
export function hatAdminRolleInKanzlei(
  mandantIdsInKanzlei: string[],
  userMandanten: MandantZugriff[],
): boolean {
  if (mandantIdsInKanzlei.length === 0) return false;
  const inKanzlei = new Set(mandantIdsInKanzlei);
  return userMandanten.some((m) => m.rolle === 'KANZLEI_ADMIN' && inKanzlei.has(m.id));
}

/**
 * Wirft, wenn der User nicht Admin genau in dieser Kanzlei ist.
 *
 * Reihenfolge ist Absicht: erst der Kanzlei-Bezug, dann die Rolle. Wer
 * gar keinen Mandanten dort hat, bekommt die Zugriffs-Meldung und nicht
 * die Rollen-Meldung — das ist die Information, die beim Debugging fehlt,
 * wenn beides gleich klingt.
 */
export function assertAdminInKanzlei(
  mandantIdsInKanzlei: string[],
  userMandanten: MandantZugriff[],
  rolleMeldung: string,
): void {
  if (mandantIdsInKanzlei.length === 0) {
    throw new ForbiddenException('Kein Zugriff auf diese Kanzlei');
  }
  if (!hatAdminRolleInKanzlei(mandantIdsInKanzlei, userMandanten)) {
    throw new ForbiddenException(rolleMeldung);
  }
}