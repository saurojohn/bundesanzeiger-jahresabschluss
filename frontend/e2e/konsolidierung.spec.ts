import { expect, test, type Page } from '@playwright/test';

/**
 * Konsolidierung: create → calculate → apply → finalize.
 *
 * Bisher war diese Fachseite ausschließlich rendernd geprüft. Sie hat vier
 * Schreibpfade — mehr als jedes andere Modul — und ist ein Zustandsautomat
 * (calculate ist nach apply gesperrt, finalize setzt VALIDATED).
 *
 * Gefundener Defekt 2026-10-04: `apply` legt Konzern-Bilanz UND Konzern-GuV
 * für (Mutter, Geschäftsjahr) an, beide unter Unique-Constraint. Existiert
 * für das Jahr schon ein Satz, kam HTTP 500 "Internal server error". Das ist
 * der Normalfall: die Mutter hat für jedes Jahr eine Jahresbilanz. Der Test
 * prüft zusätzlich den Konfliktpfad — er soll eine verständliche 400 liefern,
 * nicht 500.
 */
async function anmelden(page: Page, email = 'wp@kanzlei.de') {
  await page.goto('http://localhost:3001/de-DE/login');
  await page.getByLabel(/e-?mail/i).fill(email);
  await page.getByLabel(/passwort/i).fill('Demo123!');
  await page.getByRole('button', { name: /anmelden/i }).click();
  await page.waitForURL('**/de-DE/dashboard', { timeout: 30_000 });
}

function aufzeichnung(page: Page) {
  const aufrufe: Array<{ methode: string; url: string; status: number }> = [];
  page.on('response', (r) => {
    if (r.url().includes('/api/')) {
      aufrufe.push({
        methode: r.request().method(),
        url: r.url().replace(/^https?:\/\/[^/]+/, '').split('?')[0],
        status: r.status(),
      });
    }
  });
  return aufrufe;
}

/** Liest alle Mandantenjahre, die für den Mandanten NICHT frei sind. */
async function belegteJahre(
  page: Page,
  mandantId: string,
  resourcen: Array<'bilanz' | 'guv'>,
): Promise<Set<number>> {
  return page.evaluate(
    async ({ id, res }: { id: string; res: Array<'bilanz' | 'guv'> }) => {
      const t = localStorage.getItem('accessToken');
      const belegt = new Set<number>();
      for (const r of res) {
        const resp = await fetch(`/api/${r}?mandantId=${id}`, {
          headers: { Authorization: `Bearer ${t}`, 'x-mandant-id': id },
        });
        if (!resp.ok) continue;
        const liste = (await resp.json()) as Array<{ geschaeftsjahr: number }>;
        for (const e of liste) belegt.add(e.geschaeftsjahr);
      }
      return [...belegt];
    },
    { id: mandantId, res: resourcen },
  ).then((a) => new Set(a));
}

test.describe('Konsolidierung: Zustandskette und Konfliktpfad', () => {
  test.beforeEach(async ({ page }) => {
    await anmelden(page);
  });

  test('Einheit anlegen → berechnen → anwenden → finalisieren', async ({ page }) => {
    const aufrufe = aufzeichnung(page);
    await page.goto('http://localhost:3001/de-DE/konsolidierung');
    await page.waitForTimeout(2500);

    // --- Wizard-Schritt 1: Mutter
    await page.getByRole('button', { name: 'Neue Konsolidierung' }).click();
    await page.waitForTimeout(1500);
    const mutterSelect = page.locator('main select').first();
    await expect(mutterSelect, 'Mutter-Auswahl muss sichtbar sein').toBeVisible();
    await mutterSelect.selectOption({ index: 1 });
    // ID JETZT lesen — nach dem Weiterschalten ist der Select weg.
    const mutterId = await mutterSelect.evaluate(
      (el) => (el as HTMLSelectElement).value,
    );
    expect(mutterId, 'Mutter muss gewählt sein').toBeTruthy();
    await page.getByRole('button', { name: 'Weiter' }).click();
    await page.waitForTimeout(1200);

    // --- Wizard-Schritt 2: Tochter
    const tochterSelect = page.locator('main select[multiple]');
    await expect(tochterSelect, 'Tochter-Auswahl muss sichtbar sein').toBeVisible();
    const tochterOptionen = tochterSelect.locator('option');
    await expect(
      tochterOptionen.first(),
      'es muss mindestens eine Tochter-Möglichkeit geben',
    ).toBeVisible();
    await tochterSelect.selectOption({ index: 0 });
    const tochterId = await tochterSelect.evaluate(
      (el) => (el as HTMLSelectElement).selectedOptions[0]?.value ?? '',
    );
    expect(
      tochterId,
      'Tochter darf nicht dieselbe sein wie die Mutter',
    ).not.toBe(mutterId);
    await page.getByRole('button', { name: 'Weiter' }).click();
    await page.waitForTimeout(1200);

    // --- Freies Jahr in ALLEN Dimensionen
    // Nicht nur auf freie Konsolidierungsjahre prüfen: apply scheitert auch,
    // wenn die Mutter für das Jahr schon eine Bilanz oder GuV hat. Ein erster
    // Testversuch prüfte nur die Einheiten und wirkte dadurch zufällig grün.
    const belegt = await belegteJahre(page, mutterId, ['bilanz', 'guv']);
    const einheiten = (await page.evaluate(async () => {
      const t = localStorage.getItem('accessToken');
      const r = await fetch('/api/konsolidierung/einheiten', {
        headers: { Authorization: `Bearer ${t}` },
      });
      return r.ok ? ((await r.json()) as Array<{ geschaeftsjahr: number }>) : [];
    })) ?? [];
    for (const e of einheiten) belegt.add(e.geschaeftsjahr);

    let freiesJahr = 0;
    for (let j = 2090; j < 2110; j++) {
      if (!belegt.has(j)) {
        freiesJahr = j;
        break;
      }
    }
    expect(
      freiesJahr,
      `kein freies Geschäftsjahr 2090-2109 (belegt: ${[...belegt].sort((a, b) => a - b).join(', ')})`,
    ).toBeGreaterThan(0);

    const jahrFeld = page.locator('main input[type=number]').first();
    await jahrFeld.fill(String(freiesJahr));
    await jahrFeld.blur();
    await page.waitForTimeout(400);

    // --- Anlegen + Berechnen (ein Knopf)
    const erstellen = page.getByRole('button', { name: 'Buchungen berechnen' });
    await erstellen.click();
    const post = await page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' &&
        r.url().includes('/konsolidierung/einheiten') &&
        !r.url().includes('calculate') &&
        !r.url().includes('apply') &&
        !r.url().includes('finalize'),
      { timeout: 20_000 },
    );
    const postBody = (await post.json().catch(() => ({}))) as { message?: string };
    expect(post.status(), `Anlegen schlug fehl: ${postBody.message ?? ''}`).toBe(201);

    // --- Anwenden: die UI muss die Ablehnung SAUBER anzeigen.
    //
    // Bugfix 2026-10-07: Bis hierher erwartete der Test `status < 400`
    // und ging dann zu „Finalisieren" weiter. Tatsaechlich lieferte
    // `apply` HTTP 201 MIT `konzernBilanzId` und `salden` — obwohl die
    // Konzernrechnung ausschliesslich die Tochtergesellschaften
    // enthielt. `assertZieljahrFrei` verlangt, dass die Mutter fuer das
    // Jahr KEINE Bilanz hat; die Ladung zwei Schritte spaeter fand sie
    // deshalb nie.
    //
    // Der Test hat damit die Oberflaeche geprueft, die einen fachlich
    // unbrauchbaren Abschluss als Erfolg darstellte. Er war nicht zu
    // streng — er pruefte das Falsche.
    const anwenden = page.getByRole('button', { name: 'Anwenden' });
    await expect(anwenden, 'nach dem Berechnen muss "Anwenden" verfügbar sein').toBeVisible();
    await anwenden.click();
    const applyResp = await page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().includes('/apply'),
      { timeout: 20_000 },
    );
    const applyBody = (await applyResp.json().catch(() => ({}))) as {
      message?: string;
      code?: string;
      konzernBilanzId?: string;
    };
    await page.waitForTimeout(2500);

    // 1. Kein 5xx — die Oberflaeche darf nicht abstuerzen.
    expect(applyResp.status(), 'kein 5xx beim Anwenden').toBeLessThan(500);

    // 2. Es darf KEINE Konzern-Bilanz entstehen. Das ist die eigentliche
    //    Zusicherung, nicht der Statuscode: ein 400 koennte auch aus
    //    einem voellig anderen Grund kommen.
    expect(
      applyBody.konzernBilanzId,
      'es darf keine Konzern-Bilanz entstehen, die die Mutter nicht enthaelt',
    ).toBeUndefined();

    // 3. Die Ablehnung muss fuer den Anwender erklaerbar sein — deutscher
    //    Text, kein "Internal server error", kein leerer Bildschirm.
    //    Erwartet wird ausdruecklich 400: das ist die ABLEHNUNG, kein
    //    Fehler der Oberflaeche.
    expect(applyResp.status()).toBe(400);
    expect(
      String(applyBody.message ?? ''),
      'die Ablehnung muss benennen, dass die Mutter fehlt',
    ).toMatch(/Muttergesellschaft/i);

    // 4. Nach der Ablehnung bleibt die Einheit unangetastet — es darf
    //    kein „Finalisieren" geben, weil es nichts zu finalisieren gibt.
    await expect(
      page.getByRole('button', { name: 'Finalisieren' }),
      'ohne Konzern-Bilanz darf die Einheit nicht finalisierbar sein',
    ).toHaveCount(0);

    // 5. Die Seite steht nicht im Fehlerzustand.
    await expect(
      page.getByRole('heading', { name: /konsolidierung/i }).first(),
      'die Fachseite muss weiterhin gerendert werden',
    ).toBeVisible();

    // Der Schreibpfad-Sweep bleibt bestehen — mit einer Ausnahme: der
    // `/apply`-Aufruf DARF 400 liefern, weil das jetzt die dokumentierte
    // Ablehnung ist. Anlegen und Berechnen muessen weiterhin 2xx sein,
    // und NICHTS darf 5xx werden.
    const schreibzugriffe = aufrufe.filter((a) => a.methode !== 'GET');
    for (const a of schreibzugriffe) {
      expect(a.status, `${a.methode} ${a.url} → ${a.status} (kein 5xx erlaubt)`).toBeLessThan(500);
      if (a.url.endsWith('/apply')) continue;
      expect(a.status, `${a.methode} ${a.url} → ${a.status}`).toBeLessThan(400);
    }
  });

  test('Konfliktpfad: Anwenden bei belegtem Jahr → verständliche 400, kein 500', async ({ page }) => {
    // Das Konfliktjahr muss zwei Bedingungen zugleich erfüllen:
    //  1. Die Mutter HAT für dieses Jahr eine Bilanz (sonst greift apply
    //     nicht und es entsteht kein Konflikt).
    //  2. Für dieses Jahr existiert noch KEINE Konsolidierungs-Einheit
    //     (sonst scheitert schon das Anlegen mit 400).
    // Ein festes Jahr wie 2085 ist unbrauchbar — es war nach den ersten
    // Läufen schon als Einheit belegt.
    const ergebnis = await page.evaluate(async () => {
      const t = localStorage.getItem('accessToken');
      const auth = { 'content-type': 'application/json', Authorization: `Bearer ${t}` };
      const liste = (await (
        await fetch('/api/mandant', { headers: auth })
      ).json()) as Array<{ id: string }>;
      if (liste.length < 2) return { grund: 'zu wenige Mandanten' } as const;
      const mutter = liste[0];
      const tochter = liste[1];
      const h = { ...auth, 'x-mandant-id': mutter.id };

      const bilanzen = (await (
        await fetch(`/api/bilanz?mandantId=${mutter.id}`, { headers: h })
      ).json()) as Array<{ geschaeftsjahr: number }>;
      const belegtJahre = new Set(bilanzen.map((b) => b.geschaeftsjahr));
      const einheiten = (await (
        await fetch('/api/konsolidierung/einheiten', { headers: h })
      ).json()) as Array<{ geschaeftsjahr: number; mutterMandantId: string }>;
      // Der Unique-Constraint gilt je MUTTER, nicht je Kanzlei. Ohne diesen
      // Filter galten Einheiten anderer Mandanten als Konflikt — deshalb
      // fand der Test kein freies Jahr und meldete "Fixture nicht baubar".
      const einheitenJahre = new Set(
        einheiten.filter((e) => e.mutterMandantId === mutter.id).map((e) => e.geschaeftsjahr),
      );

      // Nach eigenen Testläufen ist jedes Bilanzjahr auch ein Einheiten-
      // jahr (die apply-Route hat die Konzern-Bilanzen selbst erzeugt).
      // Deshalb wird das Konfliktjahr hier KÜNSTLICH erzeugt: ein Jahr
      // wählen, das weder Einheit noch Bilanz hat, dort eine Bilanz
      // anlegen, und die Einheit darauf beziehen. Nur so ist der
      // Konfliktfall garantiert und unabhängig vom Seed.
      let jahr = 0;
      for (let j = 2096; j < 2110; j++) {
        if (belegtJahre.has(j)) continue;
        jahr = j;
        break;
      }
      if (!jahr) return { grund: 'kein freies Jahr für die Fixture' } as const;

      // Die Fixture-Bilanz braucht STEUERBERATER/KANZLEI_ADMIN — der
      // WP-User darf Bilanzen nur lesen (403). Zweiter Login nur für die
      // Fixture; der apply-Aufruf unten bleibt beim WP-Token.
      const sbLogin = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'steuerberater@kanzlei.de', password: 'Demo123!' }),
      });
      if (!sbLogin.ok) return { grund: 'SB-Login fehlgeschlagen' } as const;
      const sbToken = ((await sbLogin.json()) as { accessToken: string }).accessToken;

      const bilanzAnlegen = await fetch(`/api/bilanz?mandantId=${mutter.id}`, {
        method: 'POST',
        headers: { ...h, Authorization: `Bearer ${sbToken}` },
        body: JSON.stringify({
          mandantId: mutter.id,
          geschaeftsjahr: jahr,
          positionen: [
            { seite: 'AKTIVA', kontonummer: 'B.IV.', bezeichnung: 'Kasse', betragAktuell: 1000, reihenfolge: 1 },
            { seite: 'PASSIVA', kontonummer: 'A.I.', bezeichnung: 'Kapital', betragAktuell: 1000, reihenfolge: 1 },
          ],
        }),
      });
      if (!bilanzAnlegen.ok) {
        return { grund: `Bilanz-Anlage ${bilanzAnlegen.status}` } as const;
      }

      const r = await fetch('/api/konsolidierung/einheiten', {
        method: 'POST',
        headers: h,
        body: JSON.stringify({
          mutterMandantId: mutter.id,
          tochterMandantIds: [tochter.id],
          geschaeftsjahr: jahr,
          beteiligungsquote: 100,
          konsolidierungsArt: 'VOLLKONSOLIDIERUNG',
        }),
      });
      if (!r.ok) {
        return { grund: `Anlegen ${r.status}: ${(await r.text()).slice(0, 120)}` } as const;
      }
      const body = (await r.json()) as { id?: string };
      if (!body.id) return { grund: 'Antwort ohne id' } as const;

      const apply = await fetch(`/api/konsolidierung/einheiten/${body.id}/apply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${t}` },
      });
      return {
        jahr,
        status: apply.status,
        body: (await apply.text()).slice(0, 300),
      } as const;
    });

    console.log('KONFLIKTPFAD:', JSON.stringify(ergebnis));
    // Kein leerlich-grüner Durchlauf: wenn die Fixture nicht zustande kam,
    // ist der eigentliche Pfad ungeprüft.
    expect(
      ergebnis,
      'Konflikt-Fixture konnte nicht gebaut werden — der Test würde leerlich grün',
    ).not.toHaveProperty('grund');
    if ('grund' in ergebnis) {
      expect(ergebnis.grund).toBe('UNERREICHBAR');
    }

    expect(
      ergebnis.status,
      `Anwenden darf bei belegtem Jahr kein 5xx sein: ${ergebnis.body}`,
    ).toBeLessThan(500);
    // Ausdrücklich 400 mit Handlungsanweisung — "irgendwas unter 500"
    // würde auch ein 404 oder gar kein Konflikt erfüllen.
    expect(ergebnis.status, `Konflikt muss als 400 kommen: ${ergebnis.body}`).toBe(400);
    expect(ergebnis.body, 'die 400 muss das Geschäftsjahr benennen').toContain('Geschäftsjahr');
    expect(ergebnis.body, 'die 400 muss eine Handlung nennen').toMatch(
      /löschen|anderes Geschäftsjahr/i,
    );
  });
});
