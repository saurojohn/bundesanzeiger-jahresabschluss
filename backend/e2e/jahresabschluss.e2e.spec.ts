import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

/**
 * Jahresabschluss anlegen und lesen (§ 314 HGB).
 *
 * BEFUND 2026-10-17 (Nachtrag 27): Zu diesem Objekt gab es keinen
 * Schreibpfad. `GET /api/jahresabschluss` lieferte 404, und die Oberflaeche
 * behandelte das als leere Liste — eine Seite, die nie Inhalt haben konnte,
 * zaehlte im Smoke-Test als "geladen".
 *
 * Geprueft wird:
 *   1. Anlegen ohne GuV          -> 409  (§ 314 verlangt alle drei)
 *   2. Anlegen ohne Anhang       -> 409
 *   3. Anlegen mit allen dreien  -> 201, DRAFT, verweist auf DIESE Saetze
 *   4. Zweites Anlegen           -> 409  (einer je Mandant und Jahr)
 *   5. GET listet den Abschluss
 *   6. Die IDs stammen vom Service, nicht vom Aufrufer — sonst koennte man
 *      drei Saetze unterschiedlicher Mandanten zusammenschieben
 *   7. Ein fremder Mandant bleibt unsichtbar
 *
 * Kein `createNestApplication()` — die Spec spricht per HTTP mit dem Server
 * auf :3000. Fuer das Aufraeumen genuegt `PrismaClient`; ein zweiter
 * Nest-Container wuerde eine eigene `AuditIntegrityService`-Kette bekommen.
 */

const BASE = 'http://localhost:3000';
const JAHR = 2075;
const MANDANT = 'Demo GmbH';
const MANDANT2 = 'Test AG';

interface LoginAntwort {
  accessToken: string;
  user: { mandanten: Array<{ id: string; firmenname: string }> };
}

describe('Jahresabschluss E2E (Anlage + Lesen)', () => {
  const prisma = new PrismaClient();
  let token = '';
  let mid = '';
  let mid2 = '';

  async function anmelden(email: string): Promise<LoginAntwort> {
    const r = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'Demo123!' }),
    });
    expect(r.status, `Login ${email}`).toBe(200);
    return (await r.json()) as LoginAntwort;
  }

  async function satzAnlegen(
    art: 'bilanz' | 'guv' | 'anhang',
    mandantId: string,
    jahr: number,
  ): Promise<string> {
    const h = { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-mandant-id': mandantId };
    let res: Response;
    if (art === 'bilanz') {
      res = await fetch(`${BASE}/api/bilanz?mandantId=${mandantId}`, {
        method: 'POST', headers: h,
        body: JSON.stringify({
          mandantId, geschaeftsjahr: jahr,
          positionen: [
            { seite: 'AKTIVA', kontonummer: 'B.IV.', bezeichnung: 'Kasse', betragAktuell: 1000, reihenfolge: 1 },
            { seite: 'PASSIVA', kontonummer: 'A.I.', bezeichnung: 'Kapital', betragAktuell: 1000, reihenfolge: 1 },
          ],
        }),
      });
    } else if (art === 'guv') {
      res = await fetch(`${BASE}/api/guv?mandantId=${mandantId}`, {
        method: 'POST', headers: h,
        body: JSON.stringify({
          mandantId, geschaeftsjahr: jahr, verfahren: 'GKV',
          positionen: [
            { kontonummer: '1.', bezeichnung: 'Umsatzerloese', kategorie: 'ERLOES', betragAktuell: 1000, reihenfolge: 1 },
          ],
        }),
      });
    } else {
      res = await fetch(`${BASE}/api/anhang?mandantId=${mandantId}`, {
        method: 'POST', headers: h,
        body: JSON.stringify({
          mandantId, geschaeftsjahr: jahr,
          abschnitte: [{ titel: 'Allgemeine Angaben', reihenfolge: 1, inhalt: 'Sitz: Berlin' }],
        }),
      });
    }
    expect(res.status, `${art} GJ ${jahr} muss anlegbar sein`).toBe(201);
    const body = (await res.json()) as { id?: string; bilanz?: { id: string }; guv?: { id: string }; anhang?: { id: string } };
    return body.id ?? body.bilanz?.id ?? body.guv?.id ?? body.anhang?.id ?? '';
  }

  /**
   * Alles fuer das Jahr loeschen.
   *
   * ERSTER ENTWURF: Drei Tests teilten sich den Zustand. Test 1 legte
   * Bilanz + Anhang an, Test 2 kam mit der GuV dazu — und plötzlich waren
   * alle drei da, also 201 statt 409, und Test 3 scheiterte an einem
   * doppelten Anhang. Ein Test, der den Zustand eines anderen_tests
   * voraussetzt, prueft die Reihenfolge der Dateien statt sein Verhalten.
   */
  async function allesAufraeumen(): Promise<void> {
    for (const id of [mid, mid2]) {
      if (!id) continue;
      await prisma.jahresabschluss.deleteMany({ where: { mandantId: id, geschaeftsjahr: JAHR } });
      await prisma.bilanz.deleteMany({ where: { mandantId: id, geschaeftsjahr: JAHR } });
      await prisma.guV.deleteMany({ where: { mandantId: id, geschaeftsjahr: JAHR } });
      await prisma.anhang.deleteMany({ where: { mandantId: id, geschaeftsjahr: JAHR } });
    }
  }

  beforeAll(async () => {
    const login = await anmelden('steuerberater@kanzlei.de');
    token = login.accessToken;
    mid = login.user.mandanten.find((m) => m.firmenname === MANDANT)?.id ?? '';
    mid2 = login.user.mandanten.find((m) => m.firmenname === MANDANT2)?.id ?? '';
    expect(mid, `${MANDANT} muss erreichbar sein`).not.toBe('');
    expect(mid2, `${MANDANT2} muss fuer den Cross-Mandant-Fall da sein`).not.toBe('');
    await allesAufraeumen();
  });

  afterAll(async () => {
    await allesAufraeumen();
    await prisma.$disconnect();
  });

  // =========================================================================
  it('Anlegen ohne GuV → 409', async () => {
    await allesAufraeumen();
    await satzAnlegen('bilanz', mid, JAHR);
    await satzAnlegen('anhang', mid, JAHR);

    const res = await fetch(`${BASE}/api/jahresabschluss`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-mandant-id': mid },
      body: JSON.stringify({ mandantId: mid, geschaeftsjahr: JAHR }),
    });
    const body = await res.text();
    expect(res.status, `ohne GuV: ${body.slice(0, 160)}`).toBe(409);
    expect(body, 'die Meldung muss das fehlende Teil nennen').toContain('GuV');
    expect(body, 'und auf § 314 HGB verweisen').toContain('314');
  });

  it('Anlegen ohne Anhang → 409', async () => {
    await allesAufraeumen();
    await satzAnlegen('bilanz', mid, JAHR);
    await satzAnlegen('guv', mid, JAHR);
    const res = await fetch(`${BASE}/api/jahresabschluss`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-mandant-id': mid },
      body: JSON.stringify({ mandantId: mid, geschaeftsjahr: JAHR }),
    });
    const body = await res.text();
    expect(res.status, `ohne Anhang: ${body.slice(0, 160)}`).toBe(409);
    expect(body).toContain('Anhang');
  });

  it('Anlegen mit allen dreien → 201, DRAFT, verweist auf diese Sätze', async () => {
    await allesAufraeumen();
    await satzAnlegen('bilanz', mid, JAHR);
    await satzAnlegen('guv', mid, JAHR);
    const anhangId = await satzAnlegen('anhang', mid, JAHR);

    const res = await fetch(`${BASE}/api/jahresabschluss`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-mandant-id': mid },
      body: JSON.stringify({ mandantId: mid, geschaeftsjahr: JAHR }),
    });
    expect(res.status).toBe(201);
    const a = (await res.json()) as {
      id: string; status: string; geschaeftsjahr: number; anhangId: string;
      // Vertragsnamen der Oberflaeche:
      bilanzsumme: number; guvErgebnis: number; abgeschlossenAm: string | null;
      signiertAm: string | null; wormObjectKey: string | null;
      banzBestellnummer: string | null;
    };
    expect(a.status, 'ein neuer Abschluss ist DRAFT — nicht sofort FINALIZED').toBe('DRAFT');
    expect(a.geschaeftsjahr).toBe(JAHR);
    expect(a.anhangId, 'der Anhang ist der eben angelegte').toBe(anhangId);
    expect(a.abgeschlossenAm, 'es gibt noch kein Abschlussdatum').toBeNull();
    expect(a.signiertAm, 'es ist noch nicht signiert').toBeNull();
    expect(a.wormObjectKey, 'es liegt noch kein signiertes PDF vor').toBeNull();
    expect(typeof a.bilanzsumme, 'die Bilanzsumme muss berechnet werden').toBe('number');
    expect(typeof a.guvErgebnis, 'das GuV-Ergebnis muss berechnet werden').toBe('number');
    expect(a.banzBestellnummer, 'es wurde nichts eingereicht').toBeNull();
  });

  it('Zweites Anlegen im selben Jahr → 409', async () => {
    // setzt auf dem Abschluss aus dem vorigen Test auf
    const res = await fetch(`${BASE}/api/jahresabschluss`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-mandant-id': mid },
      body: JSON.stringify({ mandantId: mid, geschaeftsjahr: JAHR }),
    });
    expect(res.status, 'je Mandant und Jahr genau ein Abschluss').toBe(409);
  });

  it('GET listet den Abschluss', async () => {
    const res = await fetch(`${BASE}/api/jahresabschluss`, {
      headers: { authorization: `Bearer ${token}`, 'x-mandant-id': mid },
    });
    expect(res.status, 'die Route existiert jetzt — 404 ist kein Zustand').toBe(200);
    const liste = (await res.json()) as Array<{ geschaeftsjahr: number; status: string }>;
    expect(Array.isArray(liste)).toBe(true);
    expect(
      liste.some((a) => a.geschaeftsjahr === JAHR),
      'der eben angelegte Abschluss muss in der Liste stehen',
    ).toBe(true);
  });

  it('ein fremder Mandant sieht den Abschluss nicht', async () => {
    const res = await fetch(`${BASE}/api/jahresabschluss`, {
      headers: { authorization: `Bearer ${token}`, 'x-mandant-id': mid2 },
    });
    expect(res.status).toBe(200);
    const liste = (await res.json()) as Array<{ geschaeftsjahr: number; mandantId: string }>;
    expect(
      liste.some((a) => a.geschaeftsjahr === JAHR),
      'der Abschluss des anderen Mandanten darf nicht erscheinen',
    ).toBe(false);
  });

  it('der Body darf die Bestandteile nicht bestimmen', async () => {
    // Gegenprobe zur Mandanten-Zuordnung: mit `bilanzId` im Body (das der
    // DTO gar nicht kennt) darf sich nichts aendern.
    const res = await fetch(`${BASE}/api/jahresabschluss`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-mandant-id': mid },
      body: JSON.stringify({
        mandantId: mid, geschaeftsjahr: JAHR,
        bilanzId: '00000000-0000-4000-8000-000000000000',
      }),
    });
    // Unbekanntes Feld -> die ValidationPipe weist es ab (forbidNonWhitelisted).
    expect(res.status).toBe(400);
  });

  // =========================================================================
  // Mandantentrennung: 403, nicht 400.
  //
  // BEFUND 2026-10-17: `assertMandantAccess` im Jahresabschluss-Service
  // warf `BadRequestException` (400), waehrend neun Geschwisterservices
  // (bilanz, guv, anhang, pdf, datev, datev-import, ebilanz, wp-pruefung,
  // idw-pruefung, wp-notiz) fuer **denselben Sachverhalt**
  // `ForbiddenException` werfen. Angeglichen auf 403.
  //
  // **Was dieser Test prueft - und was nicht.**
  //
  // Der erste Negativprobe-Versuch blieb GRUEN, nachdem der Service wieder auf
  // 400 gebaut war. Nicht, weil der Server alten Code fuhr (Neustart und
  // Prozesszeit geprueft), sondern weil **der MandantGuard zuerst wirft**:
  //
  //     mandant.guard.ts:72   SYSTEM_ADMIN?            -> durchlassen
  //     mandant.guard.ts:77   user.mandanten enthaelt? -> sonst 403
  //
  // Das ist **dieselbe Pruefung wie im Service**, mit derselben Meldung. Da
  // jede Jahresabschluss-Route `@UseGuards(MandantGuard)` traegt und der
  // Controller zusaetzlich `dto.mandantId !== mandantId` mit 400 abweist,
  // ist der Service-Zweig ueber HTTP **nicht erreichbar**.
  //
  // Der Test belegt also die Mandantentrennung auf **Guard-Ebene** - das ist
  // die Stelle, an der Zugriffe tatsaechlich abgewiesen werden, und der Fall
  // ist der Normalfall fuer einen frisch angelegten, noch nicht zugewiesenen
  // Mandanten. **Nicht** belegt ist die Umstellung im Service: die ist eine
  // Angleichung an die Geschwister und steht unter demselben Vorbehalt wie
  // die neun anderen auch.
  // =========================================================================
  it('Mandantentrennung: nicht zugewiesener Mandant -> 403, nicht 400', async () => {
    const admin = await anmelden('kanzlei-admin@kanzlei.de');
    const neuer = await fetch(`${BASE}/api/mandant`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${admin.accessToken}` },
      body: JSON.stringify({
        firmenname: 'Mandantentrennung GmbH',
        rechtsform: 'GmbH',
        adresse: { strasse: 'Teststr 1', plz: '10115', ort: 'Berlin', land: 'DE' },
        geschaeftsfuehrer: [{ name: 'Max Muster', geburtsdatum: '1980-01-01', anteilProzent: 100 }],
        groessenklasse: 'KLEIN',
        publishChannel: 'PDF_DIRECT',
      }),
    });
    expect(neuer.status, 'Mandant anlegen').toBe(201);
    const neu = (await neuer.json()) as { id: string };
    expect(
      admin.user.mandanten.some((m) => m.id === neu.id),
      'Vorbedingung: der neue Mandant darf NICHT im JWT stehen — ' +
        'sonst prueft dieser Test nichts',
    ).toBe(false);

    try {
      const res = await fetch(`${BASE}/api/jahresabschluss?mandantId=${neu.id}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${admin.accessToken}`,
          'x-mandant-id': neu.id,
        },
        body: JSON.stringify({ mandantId: neu.id, geschaeftsjahr: 2091 }),
      });

      expect(
        res.status,
        'Mandantentrennung ist ein Zugriffsproblem (403), kein Formularfehler (400) — ' +
          'ein Client, der 400 bekommt, versucht es typischerweise erneut',
      ).toBe(403);
      const body = (await res.json()) as { message: string };
      expect(body.message).toContain('Kein Zugriff');
    } finally {
      await prisma.mandant.deleteMany({ where: { id: neu.id } });
    }
  });
});
