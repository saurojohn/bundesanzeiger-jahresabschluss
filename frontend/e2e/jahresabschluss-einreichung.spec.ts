import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Jahresabschluss einreichen und veroeffentlichen — der Bedienweg.
 *
 * BEFUND 2026-10-20 (Nachtrag 62, TODO-8.10): Die Zustandsmaschine
 * `SIGNED -> SUBMITTED -> PUBLISHED` hatte keinen Schreibpfad — und damit
 * auch keinen Bedienweg. `banzBestellnummer` und `veroeffentlichtAm` blieben
 * unbeschrieben.
 *
 * Der Test geht den Weg, den eine Kanzlei geht:
 *   1. Abschluss signieren lassen (der WP bescheinigt)
 *   2. "Einreichung melden" -> Bestellnummer eintragen
 *   3. Der Status steht auf "Eingereicht"
 *
 * **Und die Gegenprobe:** der Wirtschaftspruefer sieht den Knopf **nicht**.
 * Er bescheinigt, die Kanzlei reicht ein. Ein Knopf, der bei einer
 * unerlaubten Rolle in einen 403 fuehrt, ist schlimmer als kein Knopf
 * (Nachtrag 57).
 */
const P12_PATH = join(
  process.cwd(),
  '..',
  'backend',
  'tmp',
  'test-certs',
  'test-token.p12',
);
const P12_PASSWORD = 'Test1234!';
const P12_BASE64 = readFileSync(P12_PATH).toString('base64');
const JAHR = 2094;

async function anmelden(page: Page, email = 'steuerberater@kanzlei.de') {
  await page.goto('http://localhost:3001/de-DE/login');
  await page.getByLabel(/e-?mail/i).fill(email);
  await page.getByLabel(/passwort/i).fill('Demo123!');
  await page.getByRole('button', { name: /anmelden/i }).click();
  await page.waitForURL('**/de-DE/dashboard', { timeout: 30_000 });
}

/**
 * Legt die drei Saetze an, schliesst sie, legt den Abschluss an,
 * schliesst ihn ab und **signiert** ihn als Wirtschaftspruefer.
 *
 * Das Signieren passiert ueber die API mit einem eigenen WP-Token: der
 * Browser bleibt in der Kanzlei-Sitzung — genau so ist der Ablauf in der
 * Praxis (der WP zeichnet, die Kanzlei reicht ein).
 */
async function signiertenAbschlussAnlegen(page: Page): Promise<string> {
  const ergebnis = await page.evaluate(
    async ({ jahr, p12Base64, p12Password }) => {
      const t = localStorage.getItem('accessToken');
      if (!t) return { ok: false as const, grund: 'kein Token' };
      const h = {
        'content-type': 'application/json',
        Authorization: `Bearer ${t}`,
        'x-mandant-id': '',
      };

      const mandanten = (await (
        await fetch('/api/mandant', { headers: { Authorization: `Bearer ${t}` } })
      ).json()) as Array<{ id: string; firmenname: string }>;
      const m = mandanten.find((x) => x.firmenname === 'Demo GmbH') ?? mandanten[0];
      if (!m) return { ok: false as const, grund: 'kein Mandant' };
      h['x-mandant-id'] = m.id;
      localStorage.setItem('activeMandantId', m.id);

      const bilanz = await fetch(`/api/bilanz?mandantId=${m.id}`, {
        method: 'POST',
        headers: h,
        body: JSON.stringify({
          mandantId: m.id,
          geschaeftsjahr: jahr,
          positionen: [
            { seite: 'AKTIVA', kontonummer: 'B.IV.', bezeichnung: 'Kasse', betragAktuell: 1000, reihenfolge: 1 },
            { seite: 'PASSIVA', kontonummer: 'A.I.', bezeichnung: 'Kapital', betragAktuell: 1000, reihenfolge: 1 },
          ],
        }),
      });
      if (bilanz.status !== 201) {
        return { ok: false as const, grund: `Bilanz ${bilanz.status}` };
      }
      const bilanzId = ((await bilanz.json()) as { bilanz: { id: string } }).bilanz.id;

      const guv = await fetch(`/api/guv?mandantId=${m.id}`, {
        method: 'POST',
        headers: h,
        body: JSON.stringify({
          mandantId: m.id,
          geschaeftsjahr: jahr,
          verfahren: 'GKV',
          positionen: [
            { kontonummer: '1.', bezeichnung: 'Umsatzerloese', kategorie: 'ERLOES', betragAktuell: 1000, reihenfolge: 1 },
          ],
        }),
      });
      if (guv.status !== 201) return { ok: false as const, grund: `GuV ${guv.status}` };
      const guvId = ((await guv.json()) as { guv: { id: string } }).guv.id;

      const anhang = await fetch(`/api/anhang?mandantId=${m.id}`, {
        method: 'POST',
        headers: h,
        body: JSON.stringify({
          mandantId: m.id,
          geschaeftsjahr: jahr,
          abschnitte: [
            { titel: 'Allgemeine Angaben', reihenfolge: 1, inhalt: 'Sitz: Berlin' },
          ],
        }),
      });
      if (anhang.status !== 201) {
        return { ok: false as const, grund: `Anhang ${anhang.status}` };
      }
      const anhangId = ((await anhang.json()) as { id: string }).id;

      for (const [url, id] of [
        ['/api/bilanz', bilanzId],
        ['/api/guv', guvId],
        ['/api/anhang', anhangId],
      ] as const) {
        const r = await fetch(`${url}/${id}?mandantId=${m.id}`, {
          method: 'PATCH',
          headers: h,
          body: JSON.stringify({ status: 'VALIDATED' }),
        });
        if (r.status !== 200) {
          return { ok: false as const, grund: `${url} auf VALIDATED: ${r.status}` };
        }
      }

      const ja = await fetch(`/api/jahresabschluss?mandantId=${m.id}`, {
        method: 'POST',
        headers: h,
        body: JSON.stringify({ mandantId: m.id, geschaeftsjahr: jahr }),
      });
      if (ja.status !== 201) {
        return { ok: false as const, grund: `Abschluss ${ja.status}` };
      }
      const abschlussId = ((await ja.json()) as { id: string }).id;

      const fin = await fetch(`/api/jahresabschluss/${abschlussId}/finalize?mandantId=${m.id}`, {
        method: 'POST',
        headers: h,
        body: JSON.stringify({}),
      });
      if (fin.status !== 200) {
        return { ok: false as const, grund: `Abschliessen ${fin.status}` };
      }

      // Signieren als Wirtschaftspruefer — mit eigenem Token.
      const wpLogin = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'wp@kanzlei.de', password: 'Demo123!' }),
      });
      if (wpLogin.status !== 200) {
        return { ok: false as const, grund: `WP-Login ${wpLogin.status}` };
      }
      const wpToken = ((await wpLogin.json()) as { accessToken: string }).accessToken;

      // BEFUND 2026-10-21 (Nachtrag 79): Die qeS-Endabnahme verlangt einen
      // freigegebenen Vier-Augen-Pruefungsnachweis der Bilanz — also erst
      // pruefen (wp@), dann von einer zweiten Person freigeben lassen
      // (wp2@), dann signieren.
      const wp2Login = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'wp2@kanzlei.de', password: 'Demo123!' }),
      });
      if (wp2Login.status !== 200) {
        return { ok: false as const, grund: `WP2-Login ${wp2Login.status}` };
      }
      const wp2Token = ((await wp2Login.json()) as { accessToken: string }).accessToken;

      const pruefung = await fetch('/api/wp/pruefungen', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: `Bearer ${wpToken}`,
          'x-mandant-id': m.id,
        },
        body: JSON.stringify({ bilanzId }),
      });
      if (pruefung.status !== 201) {
        return { ok: false as const, grund: `WP-Pruefung starten ${pruefung.status}` };
      }
      const pruefungBody = (await pruefung.json()) as { pruefung?: { id: string }; id?: string };
      const pruefungId = pruefungBody.pruefung?.id ?? pruefungBody.id ?? '';

      const freigabe = await fetch(`/api/wp/pruefungen/${pruefungId}/finalize`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: `Bearer ${wp2Token}`,
          'x-mandant-id': m.id,
        },
        body: JSON.stringify({ status: 'APPROVED', zusammenfassung: 'Freigabe (Test)' }),
      });
      if (freigabe.status !== 200) {
        return { ok: false as const, grund: `Vier-Augen-Freigabe ${freigabe.status}` };
      }

      const sign = await fetch(`/api/signatur/sign-abschluss?mandantId=${m.id}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: `Bearer ${wpToken}`,
          'x-mandant-id': m.id,
        },
        body: JSON.stringify({
          mandantId: m.id,
          jahresabschlussId: abschlussId,
          p12Base64,
          p12Password,
        }),
      });
      if (sign.status !== 200) {
        return { ok: false as const, grund: `Signieren ${sign.status}` };
      }

      return { ok: true as const, abschlussId };
    },
    { jahr: JAHR, p12Base64: P12_BASE64, p12Password: P12_PASSWORD },
  );

  expect(ergebnis.ok, `Fixture: ${JSON.stringify(ergebnis)}`).toBe(true);
  return (ergebnis as { ok: true; abschlussId: string }).abschlussId;
}

test('Einreichen: die Kanzlei meldet die Bestellnummer, der WP sieht keinen Knopf', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  await anmelden(page);
  await signiertenAbschlussAnlegen(page);

  await page.goto('http://localhost:3001/de-DE/jahresabschluss');
  await page.waitForTimeout(3000);

  const zeile = page.locator('tr', { hasText: String(JAHR) }).first();
  await expect(zeile, 'der Jahresabschluss muss in der Liste stehen').toBeVisible();

  // 1) Die Kanzlei sieht den Knopf.
  const knopf = zeile.getByTestId('jahresabschluss-einreichen');
  await expect(
    knopf,
    'die Kanzlei muss die Einreichung melden koennen — der Weg existierte nicht',
  ).toBeVisible();

  // 2) Der Knopf ohne Nummer ist nicht aktiv (die Nummer ist Pflicht).
  await knopf.click();
  const feld = zeile.getByTestId('jahresabschluss-bestellnummer');
  await expect(feld, 'das Bestellnummer-Feld muss erscheinen').toBeVisible();
  const bestaetigen = zeile.getByTestId('jahresabschluss-einreichen-bestaetigen');
  await expect(
    bestaetigen,
    'ohne Bestellnummer darf nicht eingereicht werden — sie ist der Beleg',
  ).toBeDisabled();

  // 3) Mit Nummer geht es durch.
  await feld.fill('BAnz-Playwright-0001');
  await expect(bestaetigen).toBeEnabled();
  await bestaetigen.click();

  await expect(
    zeile,
    'der Status muss auf "Eingereicht" stehen',
  ).toContainText('Eingereicht', { timeout: 20_000 });

  // 4) **Die Gegenprobe:** der Wirtschaftspruefer sieht den Knopf nicht.
  // Er bescheinigt, die Kanzlei reicht ein.
  const wpKontext = await browser.newContext();
  try {
    const wpSeite = await wpKontext.newPage();
    await anmelden(wpSeite, 'wp@kanzlei.de');
    await wpSeite.goto('http://localhost:3001/de-DE/jahresabschluss');
    await wpSeite.waitForTimeout(3000);
    await expect(
      wpSeite.getByTestId('jahresabschluss-einreichen'),
      'der Wirtschaftspruefer darf nicht einreichen — die Vier-Augen-Kontrolle ' +
        'wuerde damit ausgehebelt',
    ).toHaveCount(0);
  } finally {
    await wpKontext.close();
  }
});
