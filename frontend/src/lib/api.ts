import clsx, { type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const BASE_API = '/api';

type FetchOptions = RequestInit & { accessToken?: string };

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
    // Jetzt wird die Sitzung aufgeräumt und zum Login geführt. Der
    // Refresh-Mechanismus des Projekts nutzt ein separates
    // refreshToken-Cookie; ein Redirect ist der einzige Weg, den
    // Benutzer zuverlaessig zurueckzubringen.
    if (typeof window !== 'undefined') {
      localStorage.removeItem('accessToken');
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
    };
    const meldung = Array.isArray(body.message)
      ? body.message.join(', ')
      : body.message || `HTTP ${response.status} ${response.statusText}`;
    const err = new Error(meldung);
    (err as Error & { status?: number; code?: string }).status = response.status;
    (err as Error & { status?: number; code?: string }).code = body.code;
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