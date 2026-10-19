import clsx, { type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const BASE_API = '/api';

type FetchOptions = RequestInit & { accessToken?: string };

/**
 * Erneuert die Sitzung einmalig und teilt sich den Versuch zwischen allen
 * parallelen Aufrufen (Single-Flight).
 *
 * BEFUND 2026-10-16: `POST /api/auth/refresh` existierte im Backend, wurde
 * aber von **keiner** Stelle der Oberflaeche aufgerufen. Gemessen:
 * `expiresIn: 900` — der Access-Token ist 15 Minuten gueltig, der Benutzer
 * wurde also alle 15 Minuten zum Login geschickt, mitten in einer
 * Abschlussarbeit. Der Mechanismus, der genau das verhindern soll, war
 * vorhanden und unerreichbar.
 *
 * `null` heisst: kein Refresh-Token vorhanden oder der Versuch ist
 * gescheitert. In beiden Faellen bleibt der alte 401-Zweig.
 */
let refreshLaeuft: Promise<string | null> | null = null;

function sitzungErneuern(): Promise<string | null> {
  if (refreshLaeuft) return refreshLaeuft;
  if (typeof window === 'undefined') return Promise.resolve(null);

  const refreshToken = localStorage.getItem('refreshToken');
  if (!refreshToken) return Promise.resolve(null);

  refreshLaeuft = fetch(`${BASE_API}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  })
    .then(async (r) => {
      if (!r.ok) return null;
      const daten = (await r.json()) as {
        accessToken?: string;
        refreshToken?: string;
      };
      if (!daten.accessToken) return null;
      localStorage.setItem('accessToken', daten.accessToken);
      // Der Server kann einen neuen Refresh-Token zurueckgeben (Rotation).
      // Solange er nicht rotiert, ist das hier ein No-op.
      if (daten.refreshToken && daten.refreshToken !== refreshToken) {
        localStorage.setItem('refreshToken', daten.refreshToken);
      }
      return daten.accessToken;
    })
    .catch(() => null)
    .finally(() => {
      refreshLaeuft = null;
    });

  return refreshLaeuft;
}

export async function apiFetch<T = unknown>(
  path: string,
  options: FetchOptions = {},
): Promise<T> {
  const { accessToken, ...init } = options;
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json');
  }
  if (accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }
  // Mandant-Kontext zentral mitgeben.
  //
  // `MandantGuard` löst den aktiven Mandanten über params → header →
  // query → body auf. Ohne einen dieser vier Wege wirft er 403
  // "mandantId erforderlich" — und der Header wird gesetzt, wenn der
  // Aufrufer ihn nicht selbst mitgibt. Betroffen waren 16 Aufrufe in
  // fünf Komponenten (Bilanz/GuV/Anhang/Detail, Mutation, WP), die den
  // aktiven Mandanten aus dem `MandantSwitcher` kannten, ihn aber nicht
  // mitsendeten. `getActiveMandantId()` liest genau den Wert, den der
  // Switcher in localStorage legt.
  if (!headers.has('x-mandant-id')) {
    const mandantId =
      typeof window === 'undefined' ? null : localStorage.getItem('activeMandantId');
    if (mandantId) headers.set('x-mandant-id', mandantId);
  }
  // Bugfix 2026-10-05: Netzwerkfehler und kaputte Antworten werden hier
  // ZU EINER verständlichen deutschen Meldung zusammengefasst.
  //
  // Vorher bekam der Anwender bei jedem Verbindungsproblem die rohe
  // Browser-Meldung „Failed to fetch" bzw. „Unexpected token '<' in JSON"
  // — englisch, nichtssagend, in einer durchgehend deutschen Oberfläche.
  // Sieben Komponenten zeigen `(err as Error).message` ungefiltert an; die
  // deutsche Formulierung existierte bereits als `errors.network.message`,
  // wurde aber nur als Rückfallwert benutzt, den dieser Pfad nie erreichte.
  let response: Response;
  try {
    response = await fetch(`${BASE_API}${path}`, {
      ...init,
      headers,
      credentials: 'include',
    });
  } catch {
    const err = new Error(
      'Die Verbindung zum Server konnte nicht hergestellt werden. Bitte Internetverbindung und Serverstatus prüfen.',
    );
    (err as Error & { status?: number; code?: string }).code = 'NETWORK_ERROR';
    throw err;
  }

  if (response.status === 401) {
    // Bugfix 2026-10-05: Es gab keinen 401-Zweig. Lief die Session ab
    // (Token-TTL 15 min), blieb der Benutzer auf der Fachseite stehen und
    // sah nur ein Fehlerband „Nicht authentifiziert" — jede weitere Aktion
    // scheiterte identisch. Der Arbeitsstand war tot, ohne dass er es
    // merken konnte.
    //
    // Bugfix 2026-10-16: Der 401-Zweig raeumte sofort auf und leitete zum
    // Login. Dabei wurde behauptet, der Refresh-Mechanismus nutze ein
    // separates `refreshToken`-Cookie — **das gibt es nicht**. Der Token
    // liegt in `localStorage` (siehe `LoginForm`), und `/auth/refresh`
    // wurde von **keiner** Stelle aufgerufen. Gemessen: `expiresIn: 900`.
    // Der Benutzer wurde also alle 15 Minuten rausgeworfen, und der
    // Mechanismus, der das verhindert, war vorhanden und unerreichbar.
    //
    // Jetzt wird ZUERST erneuert und der Aufruf einmal wiederholt.
    // Erst wenn das scheitert, wird aufgeräumt und zum Login gefuehrt.
    const istLoginOderRefresh =
      path.includes('/auth/refresh') || path.includes('/auth/login');
    if (!istLoginOderRefresh) {
      const neuerToken = await sitzungErneuern();
      if (neuerToken) {
        return apiFetch<T>(path, { ...options, accessToken: neuerToken });
      }
    }

    if (typeof window !== 'undefined') {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('activeMandantId');
      const ziel = window.location.pathname;
      window.location.href = `/${ziel.split('/')[1] ?? 'de-DE'}/login?expired=1`;
    }
  }

  if (!response.ok) {
    // Der Server kann auch HTML liefern (Reverse-Proxy im Fehlerfall) —
    // `.json()` würde dann mit einem SyntaxError werfen und die echte
    // Fehlermeldung verschlucken.
    const body = (await response.json().catch(() => ({}))) as {
      message?: string | string[];
      code?: string;
      [k: string]: unknown;
    };
    const meldung = Array.isArray(body.message)
      ? body.message.join(', ')
      : body.message || `HTTP ${response.status} ${response.statusText}`;
    const err = new Error(meldung);
    (err as Error & { status?: number; code?: string }).status = response.status;
    (err as Error & { status?: number; code?: string }).code = body.code;
    // Der vollstaendige Body bleibt am Fehler haengen.
    //
    // BEFUND 2026-10-17: `POST /api/jahresabschluss/:id/finalize` antwortet
    // bei 409 mit einer Liste beanstandeter Punkte (`pruefungen`). Nur
    // `message` weiterzugeben hat diese Information vernichtet — die
    // Oberflaeche konnte die Pruefung nicht anzeigen, sondern nur einen
    // nackten Fehlertext. Strukturierte Fehlerdetails des Servers gehen
    // damit nicht mehr verloren.
    (err as Error & { body?: unknown }).body = body;
    throw err;
  }
  if (response.status === 204) return undefined as T;
  try {
    return (await response.json()) as T;
  } catch {
    const err = new Error(
      `Die Antwort des Servers war kein gültiges JSON (HTTP ${response.status}).`,
    );
    (err as Error & { status?: number; code?: string }).status = response.status;
    (err as Error & { status?: number; code?: string }).code = 'INVALID_JSON';
    throw err;
  }
}

/**
 * Wandelt einen rohen `fetch`-Fehler in eine verständliche deutsche Meldung.
 *
 * Für Stellen, die direkt `fetch` nutzen statt `apiFetch` (LoginForm) — dort
 * würde sonst die englische Browser-Meldung "Failed to fetch" im Fehlerband
 * landen.
 */
export function alsNutzerMeldung(err: unknown): string {
  if (err instanceof TypeError) {
    return 'Die Verbindung zum Server konnte nicht hergestellt werden. Bitte Internetverbindung und Serverstatus prüfen.';
  }
  if (err instanceof Error && err.message) return err.message;
  return '';
}

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('accessToken');
}

export function getActiveMandantId(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('activeMandantId');
}

/**
 * Aktiven Mandanten setzen — das Gegenstueck zu `getActiveMandantId()`.
 *
 * BEFUND 2026-10-13: Die WP-Seite hat einen eigenen Mandant-Picker. Der hat
 * seinen Wert nur in React-State gehalten und `localStorage` **nicht**
 * geschrieben. `apiFetch` setzt `x-mandant-id` aber genau aus
 * `localStorage`, und der Header hat im Backend Vorrang vor dem
 * Query-Parameter. Gemessen:
 *
 *   GET /api/bilanz?mandantId=<Demo GmbH> + x-mandant-id: <Beispiel GmbH>
 *     -> 0 Treffer
 *   GET /api/bilanz?mandantId=<Demo GmbH>, kein Header
 *     -> 1 Treffer
 *
 * Der Picker sah also nach einem Wechsel nach "Demo GmbH" aus, geladen
 * wurden aber die Bilanzen des Header-Mandanten — oder, wie hier, gar
 * keine. Jede Komponente mit eigener Mandant-Wahl muss diesen setter
 * benutzen, sonst zeigt ihre Auswahl etwas anderes an, als sie sendet.
 */
export function setActiveMandantId(id: string | null): void {
  if (typeof window === 'undefined') return;
  if (id) {
    localStorage.setItem('activeMandantId', id);
  } else {
    localStorage.removeItem('activeMandantId');
  }
  // BEFUND 2026-10-20 (Nachtrag 57, TODO-8.12): Der aktive Mandant stand
  // nur in `localStorage` — und wer ihn brauchte, musste ihn **raten**:
  // ein `useEffect`, der `localStorage` liest, sieht den Wert erst, wenn
  // ihn jemand geschrieben hat.
  //
  // Das war ein Wettrennen: der `MandantSwitcher` schrieb den Mandanten in
  // seinem eigenen Effect, die abhaengigen Komponenten lasen ihn in
  // theirs. Wer zuerst kam, gewann — und der Signier-Knopf blieb bei
  // manchen Nutzern unsichtbar, obwohl die Rolle vorhanden war.
  //
  // Das Ereignis macht den Wechsel **beobachtbar**: wer den Mandanten
  // schreibt, meldet es; wer ihn braucht, hoert zu.
  window.dispatchEvent(new CustomEvent(MANDANT_GEAENDERT, { detail: { id } }));
}

/**
 * Ereignis: der aktive Mandant hat sich geaendert.
 *
 * `localStorage` loest beim Schreiben **kein** `storage`-Event im selben
 * Tab aus (das passiert nur in anderen Tabs). Deshalb ein eigenes
 * Ereignis.
 */
export const MANDANT_GEAENDERT = 'mandant-aktualisiert';
