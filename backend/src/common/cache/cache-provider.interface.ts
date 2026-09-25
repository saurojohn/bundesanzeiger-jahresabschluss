/**
 * Cache-Provider-Abstraktion (M4 Sprint 0).
 *
 * Hintergrund: Der bestehende InMemoryCacheService ist Single-VM-only.
 * Für Multi-VM-Setups (Production M4) brauchen wir Redis. Diese
 * Schnittstelle erlaubt einen transparenten Wechsel — der CacheManager
 * wählt anhand der Konfiguration + Health den passenden Provider.
 *
 * Implementierungen:
 *   - MemoryCacheProvider   (Single-VM, kein Netzwerk-Hop)
 *   - RedisCacheProvider    (Multi-VM, persistent, via KeyV + ioredis)
 *
 * WICHTIG: Alle Methoden sind async — auch der Memory-Provider —
 * damit der Code-Switch zwischen den Implementierungen transparent ist
 * (Caller warten bereits auf das Promise).
 */
export interface CacheProvider {
  /**
   * Liefert den Wert zu einem Key. `null` wenn nicht vorhanden oder
   * abgelaufen.
   */
  get<T>(key: string): Promise<T | null>;

  /**
   * Speichert einen Wert mit TTL in Millisekunden.
   */
  set<T>(key: string, value: T, ttlMs: number): Promise<void>;

  /**
   * Invalidiert alle Keys mit gegebenem Prefix (z.B. 'mandant:abc').
   *
   * Implementation-Hinweis: Manche Backends (KeyV/Redis) bieten kein
   * natives Prefix-Delete; wir emulieren das via Iterator + delete.
   * Performance: Bei großen Caches kann SCAN-basierte Invalidation
   * einige hundert ms dauern — bei M4-Pilot (3 Kanzleien + 15 Mandanten)
   * ist das < 10ms pro Invalidation.
   */
  invalidate(prefix: string): Promise<void>;

  /**
   * Prüft, ob ein Key existiert (auch wenn abgelaufen → false).
   */
  has(key: string): Promise<boolean>;

  /**
   * Health-Check: liefert true, wenn der Provider einsatzbereit ist.
   *
   * Wird vom CacheManager alle 30s aufgerufen — bei false wird auf
   * Fallback gewechselt.
   */
  isHealthy(): Promise<boolean>;

  /**
   * Identifier für Logs / Diagnose-Endpunkte.
   */
  getType(): 'memory' | 'redis';
}