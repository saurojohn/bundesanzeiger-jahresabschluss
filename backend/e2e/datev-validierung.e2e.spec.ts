/**
 * Regressionstest: Eingabevalidierung für die DATEV-Exporte.
 *
 * Bugfix 2026-10-06. `GenerateSachkontenDto` hatte nur Typprüfungen
 * (`@IsString({each: true})`, `@IsString()`). Empirisch belegte Folgen
 * gegen die laufende Instanz, alle mit HTTP 200:
 *
 *   usedKonten: []             -> anzahlKonten: 0, nur Kopfzeile
 *   usedKonten: '0400'         -> 4 Zeilen: "0", "4", "0", "0"
 *   usedKonten: ['HACKER; DROP TABLE', '<xml/>', '', '   ']
 *                              -> woertlich in der CSV
 *   beraternummer: ''          -> Dateiname `EXTF_...__7654321.csv`
 *   beraternummer: '../etc/passwd' -> landet im Dateinamen
 *
 * Die Tests laufen ueber die echte HTTP-Schnittstelle: eine DTO-
 * Validierung, die nur in einem DTO-Test ohne ValidationPipe gruene
 * waere, waere wertlos.
 */

const BASE = 'http://localhost:3000';

// Diese Datei hat bewusst keinen Import und wäre damit ein globales
// Skript — ihre `const BASE` kollidierte im CI-Gesamtbaum-Typecheck
// (`tsc -p tsconfig.test.json`) mit der gleichnamigen Konstante in
// `pagination.e2e.spec.ts`:
//   error TS2451: Cannot redeclare block-scoped variable 'BASE'
// Der Import-freie Aufbau ist Absicht (nur fetch, keine Nest-Module),
// deshalb wird die Datei hier explizit zum Modul gemacht — genau wie
// bei den anderen 14 e2e-Dateien, die `import` haben und deshalb ihren
// `BASE` nicht in den globalen Scope legen.
export {};

async function login(): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'steuerberater@kanzlei.de', password: 'Demo123!' }),
  });
  if (!res.ok) throw new Error(`Login fehlgeschlagen: ${res.status}`);
  return ((await res.json()) as { accessToken: string }).accessToken;
}

async function post(
  token: string,
  pfad: string,
  body: unknown,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${BASE}${pfad}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

/** Alle Meldungen des 400-Responses zusammen. */
function meldungen(json: Record<string, unknown>): string {
  const m = json.message;
  if (Array.isArray(m)) return m.join(' | ');
  return typeof m === 'string' ? m : JSON.stringify(json);
}

describe('DATEV-Eingabevalidierung: generate-sachkonten', () => {
  let token: string;

  beforeAll(async () => {
    token = await login();
  });

  const gueltig = {
    usedKonten: ['4400', '5000', '1800'],
    skrPlan: 'SKR04',
    beraternummer: '12345',
    mandantennummer: '67890',
  };

  it('akzeptiert eine gültige Anfrage', async () => {
    const { status, json } = await post(token, '/api/datev/generate-sachkonten', gueltig);
    expect(status, JSON.stringify(json)).toBe(200);
    expect(json.anzahlKonten).toBe(3);
    expect(String(json.filename)).toBe(
      'EXTF_Sachkontobeschriftungen_12345_67890.csv',
    );
  });

  it('lehnt eine leere Kontenliste ab', async () => {
    const { status, json } = await post(token, '/api/datev/generate-sachkonten', {
      ...gueltig,
      usedKonten: [],
    });
    expect(status).toBe(400);
    expect(meldungen(json)).toMatch(/mindestens ein Konto/i);
  });

  it('lehnt eine leere Mandantennummer ab', async () => {
    const { status, json } = await post(token, '/api/datev/generate-sachkonten', {
      ...gueltig,
      mandantennummer: '',
    });
    expect(status).toBe(400);
    expect(meldungen(json)).toMatch(/mandantennummer/i);
  });

  it('lehnt eine leere Beraternummer ab', async () => {
    const { status, json } = await post(token, '/api/datev/generate-sachkonten', {
      ...gueltig,
      beraternummer: '',
    });
    expect(status).toBe(400);
    expect(meldungen(json)).toMatch(/beraternummer/i);
  });

  it('lehnt Sonderzeichen in den Nummern ab — sie landen im Dateinamen', async () => {
    const { status, json } = await post(token, '/api/datev/generate-sachkonten', {
      ...gueltig,
      beraternummer: '../etc/passwd',
      mandantennummer: '"; DROP',
    });
    expect(status).toBe(400);
    expect(meldungen(json)).toMatch(/Ziffern/i);
  });

  it('lehnt zu kurze und zu lange Nummern ab', async () => {
    for (const beraternummer of ['1', '1234', '123456789']) {
      const { status } = await post(token, '/api/datev/generate-sachkonten', {
        ...gueltig,
        beraternummer,
      });
      expect(status, `beraternummer=${beraternummer}`).toBe(400);
    }
  });

  it('lehnt nichtnumerische Sachkonten ab', async () => {
    const { status, json } = await post(token, '/api/datev/generate-sachkonten', {
      ...gueltig,
      usedKonten: ['HACKER; DROP TABLE', '<xml/>', '', '   '],
    });
    expect(status).toBe(400);
    expect(meldungen(json)).toMatch(/Ziffernfolgen/i);
  });

  it('lehnt usedKonten als String ab (wurde zeichenweise iteriert)', async () => {
    const { status, json } = await post(token, '/api/datev/generate-sachkonten', {
      ...gueltig,
      usedKonten: '0400',
    });
    expect(status).toBe(400);
    expect(meldungen(json)).toMatch(/array/i);
  });

  it('akzeptiert 3- bis 5-stellige Sachkonten', async () => {
    // Nicht im Projekt hinterlegte Sachkonten muessen durchgehen
    // koennen — sonst waere die Pruefung zu streng fuer echte
    // Kanzlei-Kontenplaene.
    for (const konto of ['400', '4400', '44001']) {
      const { status, json } = await post(token, '/api/datev/generate-sachkonten', {
        ...gueltig,
        usedKonten: [konto],
      });
      expect(status, `konto=${konto}: ${JSON.stringify(json)}`).toBe(200);
    }
  });

  it('lehnt zu viele Konten ab', async () => {
    const { status } = await post(token, '/api/datev/generate-sachkonten', {
      ...gueltig,
      usedKonten: Array.from({ length: 2001 }, (_, i) => String(1000 + i)),
    });
    expect(status).toBe(400);
  });

  it('generate-buchungsstapel nutzt dieselbe Nummernregel', async () => {
    // Gleiche Fehlerklasse, gleicher Endpunkt-Nachbar: der
    // Buchungsstapel ging mit leerer Beraternummer genauso durch.
    const loginRes = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'steuerberater@kanzlei.de', password: 'Demo123!' }),
    });
    const l = (await loginRes.json()) as {
      accessToken: string;
      user: { mandanten: Array<{ id: string; firmenname: string }> };
    };
    const mandant = l.user.mandanten.find((m) => m.firmenname === 'Demo GmbH');
    if (!mandant) throw new Error('Demo GmbH nicht gefunden');

    const guvs = (await (
      await fetch(`${BASE}/api/guv?mandantId=${mandant.id}&geschaeftsjahr=2025`, {
        headers: { authorization: `Bearer ${l.accessToken}` },
      })
    ).json()) as Array<{ id: string }>;

    const { status, json } = await post(token, '/api/datev/generate-buchungsstapel', {
      guvId: guvs[0].id,
      mandantId: mandant.id,
      beraternummer: '',
      mandantennummer: '',
    });
    expect(status).toBe(400);
    expect(meldungen(json)).toMatch(/Ziffern/i);
  });
});