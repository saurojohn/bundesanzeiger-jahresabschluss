import type { EncryptionService } from '../../modules/auth/services/encryption.service';

/**
 * Speicherformat fuer verschluesselte Geheimnisse (Webhook-HMAC-Secret).
 *
 * BEFUND 2026-10-22 (Nachtrag 82): `WebhookSubscription.secret` lag im
 * Klartext in der Datenbank. Die damalige Begruendung im DTO lautete:
 *
 *   "Wird im Klartext gespeichert (nicht hashen) — das Secret MUSS fuer
 *    HMAC-Signatur lesbar bleiben."
 *
 * Die Schlussfolgerung war falsch. Hashen ist bei einem HMAC-Secret
 * tatsaechlich unmoeglich: der Server muss selbst signieren, also braucht
 * er den geheimen Wert — ein Hash koennte nicht als HMAC-Schluessel dienen.
 * "Lesbar" ist aber nicht "entschluesselbar": AES-256-GCM erfuellt genau
 * diesen Zweck. Ein Datenbank-Dump (Backup, Restore, Leck) liefert damit
 * kein verwendbares HMAC-Secret mehr — dieselbe Massnahme, die beim
 * TOTP-Secret bereits angewendet wird.
 *
 * Das Praefix `enc:v1:` markiert den Chiffretext. Es ist zwingend, weil
 * ein Klartext-Secret (32+ Zeichen, vom Client frei gewaehlt) sonst wie
 * ein Chiffretext aussehen koennte. Der Marker ermoeglicht ausserdem die
 * Selbstheilung: eine Altzeile im Klartext wird erkannt, sofort
 * nachverschluesselt und nie stillschweigend weiterverwendet.
 *
 * Format: `enc:v1:` + base64(iv).base64(authTag).base64(cipherText)
 */
export const VERSCHLUESSELT_PRAEFIX = 'enc:v1:';

/**
 * Verschluesselt ein Geheimnis fuer die Ablage in der Datenbank.
 */
export function verschluesseln(
  encryption: EncryptionService,
  plaintext: string,
): string {
  return VERSCHLUESSELT_PRAEFIX + encryption.encrypt(plaintext);
}

/**
 * true = der gespeicherte Wert ist als verschluesselt markiert.
 *
 * Nur ein Marker-Check: ob der Chiffretext tatsaechlich lesbar ist, zeigt
 * erst `entschluesseln()`.
 */
export function istVerschluesselt(wert: string): boolean {
  return wert.startsWith(VERSCHLUESSELT_PRAEFIX);
}

/**
 * Entschluesselt ein gespeichertes Geheimnis.
 *
 * @throws Error wenn der Wert kein verschluesseltes Geheimnis ist oder der
 *         Chiffretext nicht lesbar passt (z. B. weil der Master-Key
 *         rotiert wurde). Der Aufrufer MUSS diesen Fehler behandeln — ein
 *         stilles Weiterarbeiten mit einem geratenen Secret waere genau die
 *         Art von Fehlverhalten, die diese Verschluesselung verhindern soll.
 */
export function entschluesseln(
  encryption: EncryptionService,
  wert: string,
): string {
  if (!istVerschluesselt(wert)) {
    throw new Error(
      'Wert ist kein verschluesseltes Geheimnis (Praefix fehlt)',
    );
  }
  return encryption.decrypt(wert.slice(VERSCHLUESSELT_PRAEFIX.length));
}
