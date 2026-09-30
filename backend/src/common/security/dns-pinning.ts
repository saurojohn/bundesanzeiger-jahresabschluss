import { Agent as HttpAgent } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';
import type { LookupFunction } from 'node:net';

/**
 * DNS-Pinning für ausgehende HTTP(S)-Verbindungen.
 *
 * Problem (Audit-Befund M-4, DNS-Rebinding / TOCTOU):
 *
 *   await assertResolvesToPublicAddress(url);   // DNS-Lösung #1 → geprüft
 *   await axios.post(url, body);               // DNS-Lösung #2 → verbunden
 *
 * Der HTTP-Client löst **ein zweites Mal** auf. Wer die DNS-Autorität des
 * Ziels kontrolliert, liefert beim ersten Mal eine öffentliche Adresse (die
 * Prüfung besteht) und beim zweiten Mal `127.0.0.1` — der Request landet
 * intern, während die Prüfung „grün" war. Der Kommentar im Code behauptete
 * bisher, die Prüfung fange Rebinding; das tat sie nur für den Sprung
 * Registrierung → Zustellung, nicht für Prüfung → Verbindung.
 *
 * Lösung: die geprüfte Adresse festhalten und dem Client geben. Der `lookup`
 * wird genau einmal aufgerufen und liefert danach immer dieselbe, bereits
 * geprüfte IP. Für HTTPS bleibt der Hostnamen als SNI/Host erhalten — nur die
 * Ziel-IP ist gepinnt.
 */

/** Zyklisch über die geprüften IPs, falls ein Host mehrere A-Records hat. */
function makePinnedLookup(addresses: readonly string[]): LookupFunction {
  let cursor = 0;
  return (_hostname, options, callback) => {
    // Node 20+ ruft `lookup` teils mit `all: true` auf und erwartet dann ein
    // Array. Beide Formen muessen bedient werden, sonst bricht der Agent mit
    // "Invalid IP address: undefined" ab.
    if (options?.all) {
      callback(
        null,
        addresses.map((a) => ({ address: a, family: a.includes(':') ? 6 : 4 })),
      );
      return;
    }
    const address = addresses.length > 0
      ? addresses[cursor % addresses.length]!
      : undefined;
    if (cursor < addresses.length) cursor += 1;
    if (!address) {
      callback(new Error('keine gepinnte Adresse vorhanden'), '', 4);
      return;
    }
    callback(null, address, address.includes(':') ? 6 : 4);
  };
}

/**
 * Baut einen HTTP(S)-Agent, der ausschließlich auf `addresses` verbindet.
 * Wird eine leere Liste übergeben, wird ein Agent **ohne** Pinning zurückgegeben
 * — das ist dann ein Fehler des Aufrufers und darf nicht stillschweigend
 * ungeprüft weitergehen.
 */
export function pinnedAgentFor(
  url: URL,
  addresses: readonly string[],
): HttpAgent | HttpsAgent {
  if (addresses.length === 0) {
    throw new Error('pinnedAgentFor: keine geprüfte Adresse übergeben');
  }
  const lookup = makePinnedLookup(addresses);
  return url.protocol === 'https:'
    ? new HttpsAgent({ lookup, keepAlive: true })
    : new HttpAgent({ lookup, keepAlive: true });
}
