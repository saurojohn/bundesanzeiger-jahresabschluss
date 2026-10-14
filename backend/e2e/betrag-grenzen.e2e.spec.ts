import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Betragsfelder: Kunden-Eingaben gehoeren in die Validierung, nicht in
 * eine Exception des Datenbanktreibers.
 *
 * BEFUND 2026-10-14: Vier Felder nahmen beliebige Werte an. Gemessen, alle
 * vier mit HTTP 500 und unbehandeltem Prisma-Fehler:
 *
 *   POST /api/bilanz   betragAktuell: 1e20
 *                      -> 22003 numeric field overflow
 *   POST /api/mandant  bilanzsummeVorjahr: "keine-zahl"
 *                      -> ungueltiger Decimal
 *   POST /api/mandant  bilanzsummeVorjahr: "999999999999999999999999"
 *                      -> numeric field overflow
 *   POST /api/mandant  mitarbeiterAnzahl: 99999999999
 *                      -> value out of range (Int4)
 *
 * Ein Klick im Formular genuegte. Die Grenzen sind aus dem Schema
 * abgeleitet (Decimal(18,2) / Int4), nicht geschaetzt — siehe
 * `common/utils/betrag-grenzen.ts`.
 *
 * Diese Spec prueft beide Richtungen: dass die Ausreisser abgelehnt werden
 * UND dass regulaere Werte weiterhin durchgehen. Ein Test, der nur die
 * Ablehnung prueft, wuerde einen Fix belohnen, der pauschal alles
 * zurueckweist.
 */

const BASE = 'http://localhost:3000';

interface LoginResponse {
  accessToken: string;
  user: { mandanten: Array<{ id: string; firmenname: string }> };
}

describe('Betragsgrenzen: Ausreisser werden abgelehnt, Werte nicht', () => {
  let steuerberaterToken = '';
  let adminToken = '';
  let mandantId = '';

  async function login(email: string): Promise<LoginResponse> {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'Demo123!' }),
    });
    expect(res.status, `Login ${email}`).toBe(200);
    return (await res.json()) as LoginResponse;
  }

  function headers(token: string): Record<string, string> {
    return { 'content-type': 'application/json', authorization: `Bearer ${token}` };
  }

  beforeAll(async () => {
    const sb = await login('steuerberater@kanzlei.de');
    steuerberaterToken = sb.accessToken;
    mandantId = sb.user.mandanten.find((m) => m.firmenname === 'Demo GmbH')?.id ?? '';
    expect(mandantId, 'Demo GmbH muss im Mandanten des Steuerberaters liegen').not.toBe('');

    adminToken = (await login('kanzlei-admin@kanzlei.de')).accessToken;
  });

  /** Baut einen gueltigen Mandanten-Körper; `overrides` überschreibt Felder. */
  function mandantKoerper(overrides: Record<string, unknown>): Record<string, unknown> {
    return {
      firmenname: 'Betragsgrenze-Probe',
      rechtsform: 'GmbH',
      groessenklasse: 'KLEIN',
      publishChannel: 'PDF_DIRECT',
      adresse: { strasse: 'Hauptstr. 1', plz: '12345', ort: 'Berlin', land: 'DE' },
      geschaeftsfuehrer: [{ name: 'Max Mustermann', geburtsdatum: '1980-01-01', anteilProzent: 100 }],
      ...overrides,
    };
  }

  function bilanzKoerper(betrag: number): Record<string, unknown> {
    return {
      mandantId,
      geschaeftsjahr: 2065,
      positionen: [
        { seite: 'AKTIVA', kontonummer: 'B.IV.', bezeichnung: 'Kasse', betragAktuell: betrag, reihenfolge: 1 },
        { seite: 'PASSIVA', kontonummer: 'A.I.', bezeichnung: 'Kapital', betragAktuell: betrag, reihenfolge: 1 },
      ],
    };
  }

  // =========================================================================
  // 1. Bilanz-Positionen
  // =========================================================================
  it('Bilanz: betragAktuell ausserhalb Decimal(18,2) → 400, nicht 500', async () => {
    const zuGross = await fetch(`${BASE}/api/bilanz?mandantId=${mandantId}`, {
      method: 'POST',
      headers: { ...headers(steuerberaterToken), 'x-mandant-id': mandantId },
      body: JSON.stringify(bilanzKoerper(1e20)),
    });
    expect(zuGross.status, 'ein Betrag jenseits der Spaltenbreite ist ein 400').toBe(400);
    const text = await zuGross.text();
    expect(text).toContain('betragAktuell');
    expect(text, 'kein Serverfehler').not.toContain('500');

    // Gegenprobe: ein regulaerer Betrag muss weiterhin durchgehen.
    const regulaer = await fetch(`${BASE}/api/bilanz?mandantId=${mandantId}`, {
      method: 'POST',
      headers: { ...headers(steuerberaterToken), 'x-mandant-id': mandantId },
      body: JSON.stringify({ ...bilanzKoerper(123456.78), geschaeftsjahr: 2066 }),
    });
    expect(regulaer.status, 'ein regulaerer Betrag muss angenommen werden').toBe(201);
  });

  it('Bilanz: negative Betraege bleiben erlaubt (Verlustvortrag)', async () => {
    // Kein @Min(0) — das waere eine erfundene Fachregel. Eine GuV-/EK-Position
    // kann negativ sein (§ 266 Abs. 3 HGB: Verlustvortrag). Dieser Test haelt
    // fest, dass die Betragsgrenze NICHT zur Vorzeichengrenze geworden ist.
    const res = await fetch(`${BASE}/api/bilanz?mandantId=${mandantId}`, {
      method: 'POST',
      headers: { ...headers(steuerberaterToken), 'x-mandant-id': mandantId },
      body: JSON.stringify({ ...bilanzKoerper(-50000), geschaeftsjahr: 2067 }),
    });
    expect(res.status, 'negative Betraege sind fachlich zulaessig').toBe(201);
  });

  // =========================================================================
  // 2. Mandant: Decimal als String
  // =========================================================================
  it('Mandant: bilanzsummeVorjahr ohne Zahlenformat → 400', async () => {
    const res = await fetch(`${BASE}/api/mandant`, {
      method: 'POST',
      headers: { ...headers(adminToken), 'x-mandant-id': mandantId },
      body: JSON.stringify(mandantKoerper({ bilanzsummeVorjahr: 'keine-zahl' })),
    });
    expect(res.status, 'Freitext in einer Decimal-Spalte ist ein 400').toBe(400);
    expect(await res.text()).toContain('bilanzsummeVorjahr');
  });

  it('Mandant: bilanzsummeVorjahr mit 24 Stellen → 400', async () => {
    const res = await fetch(`${BASE}/api/mandant`, {
      method: 'POST',
      headers: { ...headers(adminToken), 'x-mandant-id': mandantId },
      body: JSON.stringify(mandantKoerper({ bilanzsummeVorjahr: '999999999999999999999999' })),
    });
    expect(res.status, 'eine Zahl jenseits der Spaltenbreite ist ein 400').toBe(400);
  });

  it('Mandant: regulaerer Decimal-String wird angenommen', async () => {
    const res = await fetch(`${BASE}/api/mandant`, {
      method: 'POST',
      headers: { ...headers(adminToken), 'x-mandant-id': mandantId },
      body: JSON.stringify(
        mandantKoerper({ firmenname: 'Betragsgrenze-Probe ok', bilanzsummeVorjahr: '12345.67' }),
      ),
    });
    expect(res.status, '"12345.67" ist ein gueltiger Decimal').toBe(201);
  });

  // =========================================================================
  // 3. Mandant: Int4
  // =========================================================================
  it('Mandant: mitarbeiterAnzahl jenseits Int4 → 400', async () => {
    const res = await fetch(`${BASE}/api/mandant`, {
      method: 'POST',
      headers: { ...headers(adminToken), 'x-mandant-id': mandantId },
      body: JSON.stringify(mandantKoerper({ mitarbeiterAnzahl: 99999999999 })),
    });
    expect(res.status, 'eine Zahl jenseits Int4 ist ein 400').toBe(400);
    expect(await res.text()).toContain('mitarbeiterAnzahl');
  });
});
