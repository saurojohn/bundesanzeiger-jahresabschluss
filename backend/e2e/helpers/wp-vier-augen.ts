/**
 * Der Vier-Augen-Ablauf fuer e2e-Specs.
 *
 * BEFUND 2026-10-21 (Nachtrag 79): Die qeS-**Endabnahme** des
 * Jahresabschlusses verlangt eine freigegebene Vier-Augen-Pruefung der
 * Bilanz (Entscheidung der Fachverantwortlichen: fail-closed). Wer einen
 * Jahresabschluss signieren will, muss also vorher:
 *
 *   1. die WP-Pruefung starten (WP A)  — POST /api/wp/pruefungen
 *   2. sie von einer **anderen** Person freigeben (WP B) —
 *      POST /api/wp/pruefungen/:id/finalize
 *      (das setzt `bilanz.status = 'APPROVED'`)
 *   3. den Abschluss signieren
 *
 * Dieser Helfer erledigt 1. und 2. — die Specs muessen ihn nur aufrufen.
 * Er ist bewusst ein Helper und **keine** Spec-Datei (die vitest-Include
 * sammelt nur `*.spec.ts`).
 */

export interface VierAugenOptionen {
  base: string;
  mandantId: string;
  bilanzId: string;
  guvId?: string | null;
  /** Token des Pruefenden (WP A) — startet die Pruefung. */
  tokenPruefend: string;
  /** Token der **zweiten** Person (WP B) — gibt die Pruefung frei. */
  tokenFreigebend: string;
}

export interface VierAugenErgebnis {
  pruefungId: string;
  /** true, wenn der Abschluss danach signierbar ist. */
  nachweisVorhanden: boolean;
}

function headers(token: string, mandantId: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${token}`,
    'x-mandant-id': mandantId,
  };
}

/**
 * Fuehrt die Vier-Augen-Pruefung durch und gibt die Pruefungs-ID zurueck.
 *
 * Wirft, wenn ein Schritt fehlschlaegt — der Aufrufer soll einen roten
 * Test sehen, nicht einen stillschweigend uebersprungenen.
 */
export async function fuehreVierAugenPruefungDurch(
  opts: VierAugenOptionen,
): Promise<VierAugenErgebnis> {
  const start = await fetch(`${opts.base}/api/wp/pruefungen`, {
    method: 'POST',
    headers: headers(opts.tokenPruefend, opts.mandantId),
    body: JSON.stringify({
      bilanzId: opts.bilanzId,
      guvId: opts.guvId ?? undefined,
      zusammenfassung: 'Vier-Augen-Vorbereitung im Test',
    }),
  });
  const startText = await start.text();
  if (start.status !== 201) {
    throw new Error(
      `WP-Pruefung konnte nicht starten (HTTP ${start.status}): ${startText.slice(0, 200)}`,
    );
  }
  const startBody = JSON.parse(startText) as { pruefung?: { id: string }; id?: string };
  const pruefungId = startBody.pruefung?.id ?? startBody.id ?? '';
  if (!pruefungId) {
    throw new Error(`WP-Pruefung ohne ID: ${startText.slice(0, 200)}`);
  }

  // Die Freigabe muss von einer ANDEREN Person kommen (Vier-Augen-Prinzip).
  const freigabe = await fetch(`${opts.base}/api/wp/pruefungen/${pruefungId}/finalize`, {
    method: 'POST',
    headers: headers(opts.tokenFreigebend, opts.mandantId),
    body: JSON.stringify({
      status: 'APPROVED',
      zusammenfassung: 'Freigabe durch die zweite Person (Test)',
    }),
  });
  const freigabeText = await freigabe.text();
  if (freigabe.status !== 200) {
    throw new Error(
      `Vier-Augen-Freigabe fehlgeschlagen (HTTP ${freigabe.status}): ${freigabeText.slice(0, 200)}`,
    );
  }

  return { pruefungId, nachweisVorhanden: true };
}
