'use client';

import { useEffect } from 'react';

/**
 * Service-Worker-Registrar (M4 Sprint 4).
 *
 * Registriert /sw.js beim ersten Page-Load. Bei Updates wird der neue
 * Worker aktiviert sobald alle Tabs geschlossen sind (skipWaiting +
 * clients.claim steuert das im sw.js selbst).
 *
 * Sicherheit:
 *   - Läuft nur in Production (`process.env.NODE_ENV === 'production'`)
 *     damit Dev-Server nicht durch stale SW beeinträchtigt wird.
 *   - Service-Worker hat keine Auth-Tokens — alle API-Calls werden
 *     normal via Cookie/Header weitergeleitet.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;

    void navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((reg) => {
        // eslint-disable-next-line no-console
        console.info('[SW] registriert mit Scope:', reg.scope);
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error('[SW] Registrierung fehlgeschlagen:', err);
      });
  }, []);

  return null;
}