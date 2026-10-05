import { apiFetch } from './api';

/**
 * Ermittelt die kanzleiId des ersten Mandanten des angemeldeten Users.
 *
 * Warum es diesen Helper gibt (Bugfix 2026-10-05):
 *
 * `GET /api/auth/me` liefert `mandanten: [{ id, firmenname, rolle }]` —
 * **ohne** `kanzleiId`. Zwei Stellen nahmen sie trotzdem an:
 *
 *   - `SubscriptionView`  (Zeile 94)
 *   - `CustomDomainWizard` (Zeile 82)
 *
 * Beide lasen `me.mandanten[0]?.kanzleiId`, bekamen `undefined` und
 * hielten danach bei `null`. Folge im `SubscriptionView`: Die aktuelle
 * Subscription wurde nie geladen, und die Tarif-Knöpfe waren sichtbar
 * und aktiv, täten aber nichts — `handleUpgrade` beginnt mit
 * `if (!kanzleiId) return;`. Ein stiller Tot-Knopf, ohne jede
 * Fehlermeldung.
 *
 * Die TypeScript-Schnittstelle behauptete `{ kanzleiId: string }` und
 * hielt den Compiler ruhig — dieselbe Klasse wie der
 * `abschnitte`-Fehler in der Anhang-Liste: der Typ sagt etwas, das die
 * Antwort nicht hergibt.
 *
 * Der korrekte Weg ist die Mandanten-Route: `GET /api/mandant` für die
 * ID, dann `GET /api/mandant/:id` — die Detailantwort enthält die
 * kanzleiId. `BrandingEditor` und `ApiKeysView` machen es bereits so,
 * nur an zwei Stellen kopiert.
 *
 * Pilot-Annahme: der User gehört genau einer Kanzlei. Für spätere
 * Mehrkanzlei-Fälle muss der UI eine Kanzlei-Auswahl bekommen.
 *
 * @returns die kanzleiId oder `null`, wenn der User keinen Mandanten hat.
 */
export async function resolveKanzleiId(
  accessToken: string,
): Promise<string | null> {
  const mandanten = await apiFetch<Array<{ id: string }>>('/mandant', {
    accessToken,
  });
  const erster = mandanten[0];
  if (!erster) return null;

  const detail = await apiFetch<{ kanzleiId: string }>(`/mandant/${erster.id}`, {
    accessToken,
  });
  return detail.kanzleiId ?? null;
}
