import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Filter-Parameter: Datum und Jahr muessen an der Grenze validiert werden.
 *
 * BEFUND 2026-10-15: Mehrere Listen-Endpoints reichten die Roh-Strings an
 * Prisma-DateTime- bzw. Int-Spalten weiter. Gemessen, jeweils HTTP 500:
 *
 *   GET /api/audit?from=abc                    -> 500
 *   GET /api/audit?to=31.12.2025               -> 500   (deutsches Format)
 *   GET /api/audit?from=2025-13-45             -> 500   (kein Kalenderdatum)
 *   GET /api/bilanz?geschaeftsjahr=abc         -> 500
 *   GET /api/bilanz?geschaeftsjahr=99999999999 -> 500   (Int4-Ueberlauf)
 *
 * `to=31.12.2025` ist keine Fantasie: das ist die Schreibweise, in der ein
 * Anwender ein Datum eingibt.
 *
 * Nebenbei ein stiller Datenfehler derselben Ursache: `geschaeftsjahr=42abc`
 * lieferte previously 200 und wurde zu 42 — die Liste zeigte damit das
 * FALSCHE Jahr, ohne jede Fehlermeldung. Der Test haelt beides fest.
 */

const BASE = 'http://localhost:3000';

describe('Filter-Parameter: Datum und Jahr werden an der Grenze validiert', () => {
  let token = '';
  let mandantId = '';

  beforeAll(async () => {
    const login = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'kanzlei-admin@kanzlei.de', password: 'Demo123!' }),
    });
    expect(login.status).toBe(200);
    const body = (await login.json()) as {
      accessToken: string;
      user: { mandanten: Array<{ id: string; firmenname: string }> };
    };
    token = body.accessToken;
    mandantId = body.user.mandanten.find((m) => m.firmenname === 'Demo GmbH')?.id ?? '';
    expect(mandantId, 'Demo GmbH muss im Mandanten des Admins liegen').not.toBe('');
  });

  function headers(): Record<string, string> {
    return { authorization: `Bearer ${token}`, 'x-mandant-id': mandantId };
  }

  async function get(url: string): Promise<Response> {
    return fetch(`${BASE}${url}`, { headers: headers() });
  }

  // =========================================================================
  // 1. Audit: Datumsfilter
  // =========================================================================
  const DATUMS_FAELLE = [
    { q: 'from=abc', begruendung: 'Freitext' },
    { q: 'to=31.12.2025', begruendung: 'deutsches Datumsformat' },
    { q: 'from=2025-13-45', begruendung: 'kein Kalenderdatum (Monat 13)' },
    { q: 'from=2025-02-30', begruendung: 'kein Kalenderdatum (30. Februar)' },
  ];

  for (const f of DATUMS_FAELLE) {
    it(`Audit ?${f.q} → 400 (${f.begruendung})`, async () => {
      const res = await get(`/api/audit?mandantId=${mandantId}&${f.q}`);
      const text = await res.text();
      expect(res.status, `Audit ?${f.q} war ${res.status}: ${text.slice(0, 120)}`).toBe(400);
      expect(text).not.toContain('500');
    });
  }

  it('Audit mit gueltigem ISO-Zeitraum → 200', async () => {
    const res = await get(
      `/api/audit?mandantId=${mandantId}&from=2000-01-01&to=2099-12-31`,
    );
    expect(res.status, 'ein regulaerer Zeitraum muss abfragbar bleiben').toBe(200);
  });

  // =========================================================================
  // 2. geschaeftsjahr in den Listen-Endpoints
  // =========================================================================
  const JAHR_FAELLE = [
    { q: 'geschaeftsjahr=abc', begruendung: 'Freitext' },
    { q: 'geschaeftsjahr=99999999999', begruendung: 'Int4-Ueberlauf' },
    { q: 'geschaeftsjahr=42abc', begruendung: 'stille Umwandlung zu 42' },
  ];

  for (const pfad of ['/api/bilanz', '/api/guv', '/api/anhang']) {
    for (const f of JAHR_FAELLE) {
      it(`${pfad}?${f.q} → 400 (${f.begruendung})`, async () => {
        const res = await get(`${pfad}?mandantId=${mandantId}&${f.q}`);
        const text = await res.text();
        expect(res.status, `${pfad}?${f.q} war ${res.status}: ${text.slice(0, 120)}`).toBe(400);
      });
    }
  }

  it('Bilanz?geschaeftsjahr=2025 → 200', async () => {
    const res = await get(`/api/bilanz?mandantId=${mandantId}&geschaeftsjahr=2025`);
    expect(res.status, 'ein regulaeres Jahr muss abfragbar bleiben').toBe(200);
  });
});
