'use client';

import { useEffect, useState } from 'react';
import {
  apiFetch,
  getAccessToken,
  getActiveMandantId,
  MANDANT_GEAENDERT,
} from '@/lib/api';

/**
 * Session und Rollen des angemeldeten Benutzers.
 *
 * BEFUND 2026-10-20 (Nachtrag 57, TODO-8.12): Der Signier-Knopf war an
 * **5 Stellen** sichtbar, ohne dass die Rolle geprueft wurde. Ein
 * STEUERBERATER konnte den P12 hochladen, das Passwort eingeben und
 * bekam dann **403** vom Server — nach der ganzen Arbeit.
 *
 * Der `SessionUser`-Typ stand dabei an zwei Stellen kopiert
 * (`AppHeader.tsx`, `WPView.tsx`). Eine dritte Kopie waere keine
 * Verbesserung, deshalb liegt er hier.
 *
 * ## Die Regel, die das Backend wirklich anwendet
 *
 * `RolesGuard` (Nachtrag 40) prueft **nicht** global, sondern **pro
 * aktivem Mandant**:
 *
 *     const rollenDesMandanten = user.mandanten
 *       .filter((m) => m.id === mandantId)
 *       .flatMap((m) => m.rolle);
 *     if (rollenDesMandanten.some((r) => erlaubt.includes(r))) return true;
 *
 * Drei Feinheiten, die hier 1:1 gespiegelt sind:
 *
 *  1. **Alle** Rollen des Mandanten zaehlen, nicht die erste. Ein User kann
 *     auf demselben Mandanten mehrere Rollen haben
 *     (`@@unique([userId, mandantId, rolle])`).
 *  2. Eine Rolle aus einem **anderen** Mandanten berechtigt nicht. Wer auf
 *     "Test AG" Berater ist, darf dort nicht signieren, auch wenn er auf
 *     "Beispiel GmbH" Wirtschaftspruefer ist.
 *  3. `SYSTEM_ADMIN` darf alles (der Guard gibt ihn frei).
 *
 * Die Oberflaeche bildet **dieselbe** Regel ab. Sie ersetzt die
 * Serverpruefung nicht — sie verhindert nur, dass der Anwender einen Weg
 * geht, der mit 403 endet.
 */

export type MandantRolle =
  | 'GF'
  | 'STEUERBERATER'
  | 'WIRTSCHAFTSPRUEFER'
  | 'KANZLEI_ADMIN';

export type SessionUser = {
  id: string;
  email: string;
  vorname: string;
  nachname: string;
  globalRole: 'USER' | 'SYSTEM_ADMIN';
  mandanten: Array<{
    id: string;
    firmenname: string;
    rolle: MandantRolle;
  }>;
};

/**
 * Rollen, die `POST /api/signatur/sign-bilanz|guv|anhang` akzeptieren.
 *
 * GEMESSEN am Controller (`@Roles('WIRTSCHAFTSPRUEFER', 'STEUERBERATER')`)
 * — nicht angenommen. TODO-8.12 behauptete, `POST /api/signatur/*` sei
 * durchgehend auf Wirtschaftspruefer beschraenkt; das stimmt nur fuer
 * `sign-abschluss`.
 */
export const SIGNATUR_ROLLEN: readonly MandantRolle[] = [
  'WIRTSCHAFTSPRUEFER',
  'STEUERBERATER',
];

/**
 * Rollen fuer `POST /api/signatur/sign-abschluss`.
 *
 * Die Endabnahme des **Jahresabschlusses** ist die Vier-Augen-Kontrolle
 * selbst — dort ist ausschliesslich der Wirtschaftspruefer zustaendig
 * (`@Roles('WIRTSCHAFTSPRUEFER')`).
 */
export const SIGNATUR_ABSCHLUSS_ROLLEN: readonly MandantRolle[] = [
  'WIRTSCHAFTSPRUEFER',
];

/**
 * Alle Rollen, die der User auf **diesem** Mandanten hat.
 *
 * Leeres Array, wenn der User dem Mandanten nicht zugewiesen ist — dann
 * darf die Oberflaeche nichts anzeigen, was der Server ohnehin ablehnen
 * wuerde.
 */
export function rollenAufMandant(
  user: SessionUser | null,
  mandantId: string | null,
): MandantRolle[] {
  if (!user || !mandantId) return [];
  return user.mandanten
    .filter((m) => m.id === mandantId)
    .flatMap((m) => (Array.isArray(m.rolle) ? m.rolle : [m.rolle]));
}

/**
 * Darf der User auf diesem Mandanten eine der erlaubten Rollen ausueben?
 *
 * Spiegelt `RolesGuard.canActivate()`.
 */
export function hatRolle(
  user: SessionUser | null,
  mandantId: string | null,
  erlaubt: readonly MandantRolle[],
): boolean {
  if (!user) return false;
  if (user.globalRole === 'SYSTEM_ADMIN') return true;
  const rollen = rollenAufMandant(user, mandantId);
  return rollen.some((r) => erlaubt.includes(r));
}

/**
 * Laedt den angemeldeten Benutzer einmalig.
 *
 * Das Muster stand bisher zweimal im Code (AppHeader, WPView) — mit
 * jeweils eigener Kopie des Typs. Jetzt gibt es eine Quelle.
 */
export function useSessionUser(): {
  user: SessionUser | null;
  laedt: boolean;
} {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [laedt, setLaedt] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = getAccessToken();
        if (!token) return;
        const me = await apiFetch<SessionUser>('/auth/me', { accessToken: token });
        if (!cancelled) setUser(me);
      } catch {
        // Kein Benutzer -> keine Rolle -> keine Knöpfe. Der Fehler wird
        // hier nicht angezeigt: er betrifft die Session, nicht diesen
        // Knopf, und wird an anderer Stelle behandelt.
      } finally {
        if (!cancelled) setLaedt(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { user, laedt };
}

/**
 * Der aktive Mandant — **dieselbe Berechnung wie der `MandantSwitcher`**.
 *
 * BEFUND 2026-10-20 (Nachtrag 57, TODO-8.12): Es gab zwei Berechnungen des
 * aktiven Mandanten, und sie liefen auseinander:
 *
 *  - der `MandantSwitcher`: gespeicherter Wert, sonst der erste Mandant
 *    des Users (und er **schreibt** ihn in localStorage)
 *  - die abhaengigen Komponenten: nur **lesen** — und damit sahen sie
 *    einen Wert, den es noch nicht gab
 *
 * Das war ein Wettrennen zwischen zwei Effects: der Switcher schrieb, die
 * Komponente las, und wer zuerst kam, gewann. Bei manchen Nutzern blieb
 * der Signier-Knopf unsichtbar, obwohl die Rolle vorhanden war — der Test
 * schlug genau an dieser Stelle fehl.
 *
 * Jetzt gibt es **eine** Berechnung, und beide benutzen sie.
 */
export function aktiverMandantId(user: SessionUser | null): string | null {
  if (!user) return null;
  const gespeichert = getActiveMandantId();
  if (gespeichert && user.mandanten.some((m) => m.id === gespeichert)) {
    return gespeichert;
  }
  return user.mandanten[0]?.id ?? null;
}

/**
 * Der aktive Mandant, **beobachtbar**.
 *
 * Laeuft mit, wenn der Mandantwechseler den Mandanten schreibt (das
 * Ereignis `MANDANT_GEAENDERT`), und faellt auf den ersten Mandanten des
 * Users zurueck, solange noch nichts gespeichert ist.
 */
export function useAktiverMandantId(user: SessionUser | null): string | null {
  const [mandantId, setMandantId] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const neu = () => setMandantId(aktiverMandantId(user));
    neu();
    window.addEventListener(MANDANT_GEAENDERT, neu);
    return () => window.removeEventListener(MANDANT_GEAENDERT, neu);
  }, [user]);

  return mandantId;
}

/**
 * Darf der angemeldete Benutzer auf dem **aktiven** Mandanten signieren?
 *
 * `ziel` unterscheidet die beiden Signaturarten:
 *  - `'bestandteil'` — Bilanz, GuV, Anhang
 *  - `'abschluss'`    — der Jahresabschluss (Endabnahme)
 *
 * Solange die Session geladen wird, ist die Antwort `false`: ein Knopf,
 * der im Flackern erscheint und wieder verschwindet, ist schlimmer als
 * ein Knopf, der etwas spaeter kommt.
 */
export function useSignaturBerechtigung(
  ziel: 'bestandteil' | 'abschluss',
): boolean {
  const { user } = useSessionUser();
  const mandantId = useAktiverMandantId(user);

  const erlaubt =
    ziel === 'abschluss' ? SIGNATUR_ABSCHLUSS_ROLLEN : SIGNATUR_ROLLEN;
  return hatRolle(user, mandantId, erlaubt);
}
