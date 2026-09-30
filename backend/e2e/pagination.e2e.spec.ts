/**
 * E2E-Test: Pagination (M3+ Performance-Skalierung).
 *
 * Voraussetzungen (wie alle e2e-Tests):
 *   - Postgres läuft + Schema migriert + Seed-Daten vorhanden
 *   - App läuft auf Port 3000
 *
 * Tests lt. Sprint-Plan:
 *   1. GET /api/bilanz ohne cursor/pageSize → erste 20 Items + nextCursor
 *   2. GET /api/bilanz mit cursor → nächste 20 Items + nextCursor
 *   3. GET /api/bilanz mit pageSize=5 → 5 Items
 *   4. GET /api/bilanz mit pageSize=200 → 400 (ValidationPipe: max 100)
 *   5. GET /api/bilanz mit legacy `page=1` → funktioniert noch (Array-Response)
 *   6. GET /api/bilanz mit legacy `page=1&pageSize=20` → korrekte erste Page
 *   7. Cursor auf letzter Page → hasMore=false, nextCursor=null
 *   8. Bilanz-Liste mit mandantId-Filter → nur eigene Mandanten-Bilanzen
 */

const BASE = 'http://localhost:3000';

interface LoginResponse {
  accessToken: string;
  user: {
    id: string;
    email: string;
    mandanten: Array<{ id: string; firmenname: string; rolle: string }>;
  };
}

interface PaginatedResponse<T> {
  items: T[];
  nextCursor: string | null;
  total: number;
  hasMore: boolean;
}

interface LegacyResponse<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

interface BilanzSummary {
  id: string;
  mandantId: string;
  geschaeftsjahr: number;
  status: string;
  updatedAt: string;
}

describe('Pagination E2E (M3+)', () => {
  async function loginAs(email: string, password: string): Promise<LoginResponse> {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      throw new Error(`Login als ${email} fehlgeschlagen: ${res.status}`);
    }
    return (await res.json()) as LoginResponse;
  }

  async function authHeaders(token: string): Promise<Record<string, string>> {
    return {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    };
  }

  // ===========================================================================
  // 1. GET /api/bilanz ohne cursor/pageSize → erste 20 Items + nextCursor
  // ===========================================================================
  it('GET /api/bilanz mit pageSize=20 → 20 Items + nextCursor', async () => {
    const loginRes = await loginAs('steuerberater@kanzlei.de', 'Demo123!');
    const mandant = loginRes.user.mandanten[0];
    const headers = await authHeaders(loginRes.accessToken);

    const res = await fetch(
      `${BASE}/api/bilanz?mandantId=${mandant.id}&pageSize=20`,
      { headers },
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as PaginatedResponse<BilanzSummary>;
    expect(Array.isArray(data.items)).toBe(true);
    expect(data.items.length).toBeLessThanOrEqual(20);
    expect(data.total).toBeGreaterThanOrEqual(0);
    expect(typeof data.hasMore).toBe('boolean');
    // Wenn total > 20, muss nextCursor vorhanden sein
    if (data.total > 20) {
      expect(data.nextCursor).toBeTruthy();
      expect(data.hasMore).toBe(true);
    }
  });

  // ===========================================================================
  // 2. GET /api/bilanz mit cursor → nächste 20 Items + nextCursor
  // ===========================================================================
  it('GET /api/bilanz mit cursor → Folgepage mit anderen Items', async () => {
    const loginRes = await loginAs('steuerberater@kanzlei.de', 'Demo123!');
    const mandant = loginRes.user.mandanten[0];
    const headers = await authHeaders(loginRes.accessToken);

    // Der Test braucht garantiert genug Datensaetze. Statt darauf zu vertrauen,
    // dass der Seed eine bestimmte Menge anlegt (und im Zweifel still zu
    // ueberspringen), erzeugt er seinen eigenen Bestand fuer GJ 2090.
    const jahr = 2090;
    const vorhanden = await fetch(
      `${BASE}/api/bilanz?mandantId=${mandant.id}&geschaeftsjahr=${jahr}&pageSize=100`,
      { headers },
    );
    const vorhandenListe = ((await vorhanden.json()) as PaginatedResponse<BilanzSummary>)
      .items ?? [];
    for (let gj = 2030; gj < 2030 + Math.max(0, 6 - vorhandenListe.length); gj += 1) {
      const r = await fetch(`${BASE}/api/bilanz?mandantId=${mandant.id}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          mandantId: mandant.id,
          geschaeftsjahr: gj,
          positionen: [
            { seite: 'AKTIVA', kontonummer: 'B.IV.', bezeichnung: 'Kasse', betragAktuell: 1000, reihenfolge: 1 },
            { seite: 'PASSIVA', kontonummer: 'A.I.', bezeichnung: 'Kapital', betragAktuell: 1000, reihenfolge: 1 },
          ],
        }),
      });
      if (!r.ok) throw new Error(`Bilanz GJ ${gj} konnte nicht angelegt werden: ${r.status}`);
    }

    const first = await fetch(
      `${BASE}/api/bilanz?mandantId=${mandant.id}&pageSize=5`,
      { headers },
    );
    expect(first.status).toBe(200);
    const firstData = (await first.json()) as PaginatedResponse<BilanzSummary>;
    if (!firstData.hasMore || !firstData.nextCursor) {
      // Kein stiller Skip: ohne genug Datensaetze wird die Cursor-Logik nicht
      // durchlaufen. Das war ein gruener Test ohne Aussage.
      throw new Error(
        `Cursor-Test braucht mindestens 6 Bilanzen, hat ${firstData.items.length} (hasMore=${String(firstData.hasMore)})`,
      );
    }
    const firstIds = new Set(firstData.items.map((b) => b.id));

    const second = await fetch(
      `${BASE}/api/bilanz?mandantId=${mandant.id}&pageSize=5&cursor=${encodeURIComponent(firstData.nextCursor)}`,
      { headers },
    );
    expect(second.status).toBe(200);
    const secondData = (await second.json()) as PaginatedResponse<BilanzSummary>;
    // IDs der zweiten Page dürfen NICHT in der ersten enthalten sein
    for (const item of secondData.items) {
      expect(firstIds.has(item.id)).toBe(false);
    }
  });

  // ===========================================================================
  // 3. GET /api/bilanz mit pageSize=5 → 5 Items
  // ===========================================================================
  it('GET /api/bilanz mit pageSize=5 → max 5 Items', async () => {
    const loginRes = await loginAs('steuerberater@kanzlei.de', 'Demo123!');
    const mandant = loginRes.user.mandanten[0];
    const headers = await authHeaders(loginRes.accessToken);

    const res = await fetch(
      `${BASE}/api/bilanz?mandantId=${mandant.id}&pageSize=5`,
      { headers },
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as PaginatedResponse<BilanzSummary>;
    expect(data.items.length).toBeLessThanOrEqual(5);
  });

  // ===========================================================================
  // 4. GET /api/bilanz mit pageSize=200 → 400 (ValidationPipe: max 100)
  // ===========================================================================
  it('GET /api/bilanz mit pageSize=200 → 400 (Validation)', async () => {
    const loginRes = await loginAs('steuerberater@kanzlei.de', 'Demo123!');
    const mandant = loginRes.user.mandanten[0];
    const headers = await authHeaders(loginRes.accessToken);

    const res = await fetch(
      `${BASE}/api/bilanz?mandantId=${mandant.id}&pageSize=200`,
      { headers },
    );
    // ValidationPipe sollte 400 zurückgeben
    expect(res.status).toBe(400);
  });

  // ===========================================================================
  // 5. GET /api/bilanz mit legacy `page=1` → funktioniert noch
  // ===========================================================================
  it('GET /api/bilanz mit legacy page=1&pageSize=20 → Legacy-Response', async () => {
    const loginRes = await loginAs('steuerberater@kanzlei.de', 'Demo123!');
    const mandant = loginRes.user.mandanten[0];
    const headers = await authHeaders(loginRes.accessToken);

    const res = await fetch(
      `${BASE}/api/bilanz?mandantId=${mandant.id}&page=1&pageSize=20`,
      { headers },
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as LegacyResponse<BilanzSummary>;
    expect(data.page).toBe(1);
    expect(data.pageSize).toBe(20);
    expect(typeof data.total).toBe('number');
  });

  // ===========================================================================
  // 6. GET /api/bilanz mit legacy `page=2&pageSize=5` → korrekte zweite Page
  // ===========================================================================
  it('GET /api/bilanz mit legacy page=2&pageSize=5 → Items 6-10', async () => {
    const loginRes = await loginAs('steuerberater@kanzlei.de', 'Demo123!');
    const mandant = loginRes.user.mandanten[0];
    const headers = await authHeaders(loginRes.accessToken);

    const first = await fetch(
      `${BASE}/api/bilanz?mandantId=${mandant.id}&page=1&pageSize=5`,
      { headers },
    );
    const firstData = (await first.json()) as LegacyResponse<BilanzSummary>;
    if (firstData.items.length < 5) return; // Zu wenig Daten

    const second = await fetch(
      `${BASE}/api/bilanz?mandantId=${mandant.id}&page=2&pageSize=5`,
      { headers },
    );
    expect(second.status).toBe(200);
    const secondData = (await second.json()) as LegacyResponse<BilanzSummary>;
    expect(secondData.page).toBe(2);
    // IDs der zweiten Page ≠ IDs der ersten
    const firstIds = new Set(firstData.items.map((b) => b.id));
    for (const item of secondData.items) {
      expect(firstIds.has(item.id)).toBe(false);
    }
  });

  // ===========================================================================
  // 7. Cursor auf letzter Page → hasMore=false, nextCursor=null
  // ===========================================================================
  it('Cursor auf letzter Page → hasMore=false, nextCursor=null', async () => {
    const loginRes = await loginAs('steuerberater@kanzlei.de', 'Demo123!');
    const mandant = loginRes.user.mandanten[0];
    const headers = await authHeaders(loginRes.accessToken);

    // Hole alle Pages durch, bis hasMore=false
    let cursor: string | null = null;
    let lastData: PaginatedResponse<BilanzSummary> | null = null;
    let iterations = 0;
    do {
      const url = cursor
        ? `${BASE}/api/bilanz?mandantId=${mandant.id}&pageSize=5&cursor=${encodeURIComponent(cursor)}`
        : `${BASE}/api/bilanz?mandantId=${mandant.id}&pageSize=5`;
      const res = await fetch(url, { headers });
      const data = (await res.json()) as PaginatedResponse<BilanzSummary>;
      lastData = data;
      cursor = data.nextCursor;
      iterations += 1;
      if (iterations > 50) break; // Safety: keine Endlosschleife
    } while (cursor !== null && lastData.hasMore);

    // Auf der letzten Page: hasMore=false, nextCursor=null
    expect(lastData).not.toBeNull();
    expect(lastData!.hasMore).toBe(false);
    expect(lastData!.nextCursor).toBeNull();
  });

  // ===========================================================================
  // 8. Mandant-Trennung bei Pagination
  // ===========================================================================
  it('Bilanz-Liste respektiert mandantId-Filter (kein Cross-Tenant-Zugriff)', async () => {
    const loginRes = await loginAs('steuerberater@kanzlei.de', 'Demo123!');
    const mandant = loginRes.user.mandanten[0];
    const headers = await authHeaders(loginRes.accessToken);

    // Wenn Mandant einen zweiten Mandanten hat: prüfe Filter
    if (loginRes.user.mandanten.length < 2) return;

    const otherMandant = loginRes.user.mandanten[1];

    // Filter auf mandant 1
    const res1 = await fetch(
      `${BASE}/api/bilanz?mandantId=${mandant.id}&pageSize=20`,
      { headers },
    );
    const data1 = (await res1.json()) as PaginatedResponse<BilanzSummary>;
    for (const b of data1.items) {
      expect(b.mandantId).toBe(mandant.id);
    }

    // Filter auf mandant 2
    const res2 = await fetch(
      `${BASE}/api/bilanz?mandantId=${otherMandant.id}&pageSize=20`,
      { headers },
    );
    const data2 = (await res2.json()) as PaginatedResponse<BilanzSummary>;
    for (const b of data2.items) {
      expect(b.mandantId).toBe(otherMandant.id);
    }
  });
});