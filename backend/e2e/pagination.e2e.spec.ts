import { afterAll, beforeAll } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

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
  /**
   * Nur fuer den Test „Cursor verliert keine Datensaetze bei Gleichstand".
   * Der Befund braucht Bilanzen mit IDENTISCHEM `updatedAt` — ueber die API
   * kaeme jeder `now()` einzeln, also muessen sie direkt geschrieben werden.
   * Der TestingModule wird dafuer gebaut und sonst nirgends benutzt.
   */
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    prisma = moduleRef.get(PrismaService);
  });

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

  /**
   * Raeumt den eigenen Bestand wieder weg.
   *
   * BEFUND 2026-10-14: Die Spec legt sechs Bilanzen an und liess sie stehen.
   * Weil `globalSetup` nur EINMAL pro Lauf zuruecksetzt und die Specs in
   * keiner festen Reihenfolge ablaufen, sahen spaetere Specs diesen Bestand —
   * `bilanz.e2e` stiess dadurch auf 409 fuer GJ 2031. Ein eigener
   * Jahresbereich (2040-2045) verhindert die Ueberschneidung waehrend des
   * Laufs; das Aufräumen verhindert die Spuren danach.
   */
  afterAll(async () => {
    const loginRes = await loginAs('steuerberater@kanzlei.de', 'Demo123!');
    const mandant = loginRes.user.mandanten[0];
    await prisma.bilanz.deleteMany({
      where: {
        mandantId: mandant.id,
        geschaeftsjahr: { gte: 2040, lte: 2045 },
      },
    });
  });

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
  // Eigener Geschaeftsjahr-Bereich: 2040-2045
  //
  // BEFUND 2026-10-14: Diese Spec legte ihren Bestand fuer GJ 2030-2035 an —
  // und GJ 2031 ist zugleich der Jahreswert von `bilanz.e2e`. Die Specs
  // laufen in KEINER alphabetischen Reihenfolge (gemessen: signatur, ebilanz,
  // api, datev-import, mandant-quelle, pagination, …, bilanz, wp, …), und
  // `mandanten[0]` war nach der zugesagten Sortierung Beispiel GmbH statt
  // Demo GmbH. Damit legte `pagination` die 2031 fuer Beispiel GmbH an und
  // `bilanz` stiess danach auf 409.
  //
  // Zwei unabhaengige Kopplungen: ein fremdes Geschäftsjahr und eine
  // Mandantenwahl ueber Position. Beide sind jetzt weg — der Bereich
  // 2040-2045 ist von keiner anderen Spec belegt.
  // ===========================================================================
  // 2. GET /api/bilanz mit cursor → nächste 20 Items + nextCursor
  // ===========================================================================
  it('GET /api/bilanz mit cursor → Folgepage mit anderen Items', async () => {
    const loginRes = await loginAs('steuerberater@kanzlei.de', 'Demo123!');
    const mandant = loginRes.user.mandanten[0];
    const headers = await authHeaders(loginRes.accessToken);

    // Der Test braucht garantiert genug Datensaetze. Statt darauf zu vertrauen,
    // dass der Seed eine bestimmte Menge anlegt (und im Zweifel still zu
    // ueberspringen), erzeugt er seinen eigenen Bestand fuer GJ 2040-2045.
    //
    // BEFUND 2026-10-13: Der Vorgaenger fragte GJ 2090 ab und benutzte dessen
    // Trefferzahl fuer die Anzahl der zu erzeugenden Bilanzen im Bereich
    // 2040-2045. Das sind zwei verschiedene Mengen. Solange 2090 leer war,
    // stimmte der Zufall; sobald eine Bilanz fuer 2090 existierte, wurde
    // weniger oder nichts erzeugt und der Test sagte an anderer Stelle "Zu
    // wenig Daten" — eine Meldung, die die eigentliche Ursache nicht nannte.
    const beruecksichtigte = new Set<number>();
    for (let gj = 2040; gj <= 2045; gj += 1) {
      const vorhanden = await fetch(
        `${BASE}/api/bilanz?mandantId=${mandant.id}&geschaeftsjahr=${gj}&pageSize=100`,
        { headers },
      );
      const treffer =
        (((await vorhanden.json()) as PaginatedResponse<BilanzSummary>).items ?? []);
      if (treffer.length > 0) beruecksichtigte.add(gj);
    }

    for (let gj = 2040; gj <= 2045 && beruecksichtigte.size < 6; gj += 1) {
      if (beruecksichtigte.has(gj)) continue;
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
      if (!r.ok) {
        // Nur der Status reicht nicht als Diagnose: 409 heisst "GJ existiert
        // schon", 429 "Throttler", 400 "Validation". Der Body sagt, welcher.
        throw new Error(
          `Bilanz GJ ${gj} konnte nicht angelegt werden: ${r.status} ${r.statusText} — ${await r.text()}`,
        );
      }
      beruecksichtigte.add(gj);
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
  // 7b. Cursor-Pagination verliert keine Datensaetze bei Gleichstand
  //
  // BEFUND 2026-10-14: Sieben Aufrufstellen filterten nur nach dem
  // Zeitstempel und warfen die `id` aus dem Token weg, obwohl `encode()` sie
  // hineingeschrieben hatte. Bei zwei Datensaetzen mit identischem
  // `updatedAt` bedeutet `< cursorDate`: alles mit GLEICHEM Zeitstempel
  // faellt weg. Gemessen (5 Bilanzen mit identischem Zeitstempel,
  // `pageSize=2`): Seite 1 lieferte 2 Items, Seite 2 lieferte 0 —
  // 4 von 5 Belegen waren unerreichbar, waehrend `total` weiterhin sechs
  // behauptete. Fuer eine Kanzlei heisst das: uebersehene Belege.
  //
  // Die Bilanzen werden hier ueber `prisma` mit IDENTISCHEN Zeitstempeln
  // angelegt — ueber die API kaeme jedes `now()` einzeln.
  // ===========================================================================
  it('Cursor verliert keine Datensaetze bei identischem updatedAt', async () => {
    const loginRes = await loginAs('steuerberater@kanzlei.de', 'Demo123!');
    const mandant = loginRes.user.mandanten[0];
    const headers = await authHeaders(loginRes.accessToken);

    const zeitstempel = new Date('2026-03-15T09:00:00.000Z');
    const jahre = [2050, 2051, 2052, 2053, 2054];
    for (const jahr of jahre) {
      await prisma.bilanz.create({
        data: {
          mandantId: mandant.id,
          geschaeftsjahr: jahr,
          status: 'DRAFT',
          hinweise: 'Pagination-Regressionsprobe',
          createdAt: zeitstempel,
          updatedAt: zeitstempel,
        },
      });
    }

    try {
      const gesehen = new Set<number>();
      let cursor: string | null = null;
      let seiten = 0;
      do {
        const url = cursor
          ? `${BASE}/api/bilanz?mandantId=${mandant.id}&pageSize=2&cursor=${encodeURIComponent(cursor)}`
          : `${BASE}/api/bilanz?mandantId=${mandant.id}&pageSize=2`;
        const res = await fetch(url, { headers });
        expect(res.status).toBe(200);
        const data = (await res.json()) as PaginatedResponse<BilanzSummary>;
        for (const b of data.items) {
          if (jahre.includes(b.geschaeftsjahr)) gesehen.add(b.geschaeftsjahr);
        }
        cursor = data.nextCursor;
        seiten += 1;
        if (seiten > 20) break;
      } while (cursor !== null);

      expect(
        [...gesehen].sort((a, b) => a - b),
        'jede Bilanz mit identischem Zeitstempel muss erreichbar sein',
      ).toEqual(jahre);
    } finally {
      // Mandantengefiltert: ein ungefiltertes `deleteMany` waere eine
      // Fixture, die Datensaetze ANOTHER Mandant loescht. Genau das ist in
      // dieser Suite einmal passiert (siehe Nachtrag zum Tier-Naming).
      await prisma.bilanz.deleteMany({
        where: { mandantId: mandant.id, geschaeftsjahr: { in: jahre } },
      });
    }
  });

  // ===========================================================================
  // 7c. Ein Cursor, den der Server nie ausgegeben hat, wird abgelehnt
  //
  // Vorher fiel ein unlesbarer Cursor auf `null` zurueck und die Anfrage
  // lief als "erste Seite" weiter — 200 mit denselben Daten, ohne jede
  // Fehlermeldung. Der Kommentar versprach hier 400 ("Selbst-validierend").
  // ===========================================================================
  it('ungueltiger Cursor → 400 statt stiller erster Seite', async () => {
    const loginRes = await loginAs('steuerberater@kanzlei.de', 'Demo123!');
    const mandant = loginRes.user.mandanten[0];
    const headers = await authHeaders(loginRes.accessToken);

    for (const muell of ['notbase64', '!!!!', 'x']) {
      const res = await fetch(
        `${BASE}/api/bilanz?mandantId=${mandant.id}&cursor=${muell}`,
        { headers },
      );
      expect(res.status, `cursor="${muell}" muss abgelehnt werden`).toBe(400);
    }

    // Der Fall, der die Decoder-Regel wirklich festnagelt: ein Token OHNE
    // Trenner, dessen Inhalt als Sortierwert taugt. Der alte Fallback las
    // die ganze Zeichenkette als `id` UND `sortValue` — bei `firmenname`
    // (String statt Datum) kam "Berlin" durch, und `id: { … 'Berlin' }` auf
    // einer UUID-Spalte liess Postgres scheitern:
    //
    //   Inconsistent column data: Error creating UUID,
    //   invalid character: … found `r` at 3          -> HTTP 500
    //
    // Ein einzelner Query-Param hat damit den Server abgeschossen. Der
    // strenge Decoder macht daraus eine 400 mit klarer Meldung.
    const ohneTrenner = Buffer.from('Berlin', 'utf-8').toString('base64');
    const mandantRes = await fetch(
      `${BASE}/api/mandant?cursor=${encodeURIComponent(ohneTrenner)}`,
      { headers },
    );
    expect(
      mandantRes.status,
      'ein Cursor ohne Trenner darf keinen Serverfehler erzeugen',
    ).toBe(400);
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

// Ohne diese Zeile waere die Datei fuer TypeScript ein GLOBALSKRIPT statt
// eines Moduls — ihre `const BASE` auf oberster Ebene kollidierte dann mit
// den anderen Specs (TS2451). Der Import der entfernten App war vorher der
// Grund, warum sie ueberhaupt ein Modul war.
export {};
