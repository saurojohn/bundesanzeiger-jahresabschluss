/* ============================================================================
 * Bundesanzeiger Jahresabschluss — Service Worker (M4 Sprint 4)
 * ============================================================================
 * Zweck:
 *   - Offline-Cache für statische Assets (CSS, JS, Fonts)
 *   - Background-Sync für ausstehende API-Mutationen (geplant Sprint 5)
 *   - Push-Notifications für Webhook-Events (z.B. Bilanz-Reminder, Sprint 5)
 *
 * Strategie:
 *   - Stale-while-revalidate für statische Assets
 *   - Network-first für API-Calls (kein veralteter Cache)
 *   - Cache-First für Bilder + Fonts
 *
 * Hinweis: Für Production ist ein Workbox-Setup empfohlen. Dieser SW
 * ist absichtlich minimal gehalten — kein Bundler, keine Dependencies.
 * ============================================================================ */

const CACHE_VERSION = 'v1';
const STATIC_CACHE = `banz-static-${CACHE_VERSION}`;
const RUNTIME_CACHE = `banz-runtime-${CACHE_VERSION}`;

const PRECACHE_URLS = [
  '/',
  '/de-DE/dashboard',
  '/de-DE/login',
  '/manifest.json',
  '/icons/icon.svg',
];

// ---------------------------------------------------------------------------
// Install: statische Assets vorab cachen
// ---------------------------------------------------------------------------
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      // Best-Effort: wenn ein Asset nicht erreichbar ist (z.B. während
      // Development), brechen wir nicht ab.
      return Promise.allSettled(
        PRECACHE_URLS.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch((err) => {
            console.warn('[SW] precache fehlgeschlagen:', url, err);
          }),
        ),
      );
    }),
  );
  self.skipWaiting();
});

// ---------------------------------------------------------------------------
// Activate: alte Caches aufräumen
// ---------------------------------------------------------------------------
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((name) => name !== STATIC_CACHE && name !== RUNTIME_CACHE)
          .map((name) => caches.delete(name)),
      ),
    ),
  );
  self.clients.claim();
});

// ---------------------------------------------------------------------------
// Fetch: Strategie pro Request-Typ
// ---------------------------------------------------------------------------
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // API-Calls: Network-First, kein Cache (immer frische Daten)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request).catch(() => {
        // Offline-Fallback: 503 für GETs, nichts für Mutationen
        return new Response(
          JSON.stringify({
            error: 'offline',
            message: 'Keine Netzwerkverbindung — API-Calls können nicht offline ausgeführt werden.',
          }),
          { status: 503, headers: { 'Content-Type': 'application/json' } },
        );
      }),
    );
    return;
  }

  // Statische Assets: Stale-While-Revalidate
  if (
    request.destination === 'style' ||
    request.destination === 'script' ||
    request.destination === 'font' ||
    request.destination === 'image'
  ) {
    event.respondWith(
      caches.open(RUNTIME_CACHE).then((cache) =>
        cache.match(request).then((cached) => {
          const fetchPromise = fetch(request)
            .then((response) => {
              if (response.ok) cache.put(request, response.clone());
              return response;
            })
            .catch(() => cached);
          return cached || fetchPromise;
        }),
      ),
    );
    return;
  }

  // Navigation: Network-First mit Cache-Fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match(request).then((r) => r || caches.match('/'))),
    );
  }
});

// ---------------------------------------------------------------------------
// Push-Notifications (Vorbereitung Sprint 5)
// ---------------------------------------------------------------------------
self.addEventListener('push', (event) => {
  if (!event.data) return;
  try {
    const data = event.data.json();
    event.waitUntil(
      self.registration.showNotification(data.title ?? 'Bundesanzeiger Jahresabschluss', {
        body: data.body ?? '',
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        tag: data.tag,
        data: data.url,
      }),
    );
  } catch (err) {
    console.error('[SW] Push-Event ungültig:', err);
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data ?? '/de-DE/dashboard';
  event.waitUntil(clients.openWindow(targetUrl));
});