/**
 * Normalisierung einer Custom-Domain (FQDN).
 *
 * BEFUND 2026-10-22 (Nachtrag 83): Die Domain wurde unveraendert
 * gespeichert. DNS ist **case-insensitiv**, der UNIQUE-Constraint in der
 * Datenbank ist es nicht — zwei Kanzleien konnten dieselbe Domain
 * beanspruchen:
 *
 *     Kanzlei A: "beispiel-messung.de"
 *     Kanzlei B: "BEISPIEL-MESSUNG.DE"    ->  HTTP 200, keine Kollision
 *
 * Gemessen an der laufenden API. Der Unique-Constraint hat nicht ausgeloest,
 * weil "BEISPIEL-MESSUNG.DE" und "beispiel-messung.de" verschiedene Strings
 * sind — fuer DNS sind sie dieselbe Domain.
 *
 * Die Normalisierung ist deshalb **an der Grenze** Pflicht: dort, wo eine
 * Domain in die Anwendung hineinkommt (DTO/Service) und dort, wo sie
 * gespeichert wird. Ein Wert, der nur an einer Stelle normalisiert wird,
 * laesst die andere Stelle unnormalisiert durch.
 */
export function normalisiereDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/\.+$/, '');
}
