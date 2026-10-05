import { expect, test, type Page } from '@playwright/test';

/**
 * Wirtschaftsprüfung: Plausi-Regeln → Prüfung starten → Notiz anlegen →
 * Notiz-Status ändern → Prüfung abschließen.
 *
 * Bisher nur rendernd geprüft. Fünf Schreibpfade — das Backend ist hier
 * strenger als sonst: `POST /wp/notizen`, `POST /wp/pruefungen` und
 * `pruefungen/:id/finalize` erlauben NUR WIRTSCHAFTSPRUEFER, während
 * Notiz-Status und Plausi-Lauf auch für STEUERBERATER offen sind.
 *
 * Der zweite Test prüft ausdrücklich, dass die Oberfläche die Sperre
 * abbildet (`isWP`), statt Aktionen anzubieten, die immer mit 403 enden.
 */
async function anmelden(page: Page, email: string) {
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

test('WP: Prüfung starten → Regeln → Notiz → Notiz-Status → abschließen', async ({ page }) => {
  await anmelden(page, 'wp@kanzlei.de');
  const aufrufe = aufzeichnung(page);

  await page.goto('http://localhost:3001/de-DE/wp');
  await page.waitForTimeout(3000);

  const mandantSelect = page.locator('main select').first();
  await expect(mandantSelect, 'WP-Seite muss einen Mandanten-Picker zeigen').toBeVisible();
  await mandantSelect.selectOption({ index: 1 });
  await page.waitForTimeout(2500);

  const bilanzSelect = page.locator('main select').nth(1);
  const bilanzOptionen = await bilanzSelect.locator('option').count();
  expect(bilanzOptionen, 'es muss Bilanzen zum Auswählen geben').toBeGreaterThan(1);

  // Determinismus: eine Bilanz OHNE bestehende Prüfung wählen.
  //
  // Mein erster Ansatz nahm einfach `index: 1`. Nach dem ersten Lauf existiert
  // für diese Bilanz bereits eine Prüfung, der Knopf "Prüfung starten"
  // entfällt, und der Klick lief in einen 30-s-Timeout. Der Test wäre
  // also ab dem zweiten Lauf gescheitert bzw. nichts geprüft worden.
  const indexOhnePruefung = await page.evaluate(async () => {
    const t = localStorage.getItem('accessToken');
    const mandantId = localStorage.getItem('activeMandantId');
    const sel = document.querySelectorAll('main select')[1] as HTMLSelectElement;
    for (let i = 1; i < sel.options.length; i++) {
      const bilanzId = sel.options[i].value;
      const r = await fetch(`/api/wp/bilanz/${bilanzId}/pruefungen`, {
        headers: { Authorization: `Bearer ${t}`, 'x-mandant-id': mandantId ?? '' },
      });
      if (!r.ok) continue;
      const liste = (await r.json()) as unknown[];
      if (Array.isArray(liste) && liste.length === 0) return i;
    }
    return 0;
  });
  expect(
    indexOhnePruefung,
    'es muss mindestens eine Bilanz ohne bestehende WP-Prüfung geben',
  ).toBeGreaterThan(0);
  console.log('GEWÄHLTE BILANZ (Index):', indexOhnePruefung);
  await bilanzSelect.selectOption({ index: indexOhnePruefung });
  await page.waitForTimeout(2500);
  // ID einmalig hier festhalten und weiterreichen. Aus dem DOM erneut lesen
  // war unzuverlaessig: nach Zustandswechseln (Plausilauf, Notiz) war
  // querySelectorAll('main select')[1] nicht mehr die Bilanzauswahl, die
  // Notiz-Liste blieb dadurch leer und die Vier-Augen-Proben liefen ins Leere.
  const bilanzId = await bilanzSelect.evaluate(
    (el) => (el as HTMLSelectElement).value,
  );
  expect(bilanzId, 'Bilanz-ID muss ermittelt sein').toBeTruthy();
  console.log('BILANZ-ID:', bilanzId);

  // --- 1) Prüfung starten
  console.log('SCHRITT 1: Prüfung starten');
  await page.getByRole('button', { name: 'Prüfung starten' }).click();
  const start = await page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().includes('/wp/pruefungen'),
    { timeout: 20_000 },
  );
  const startBody = (await start.json().catch(() => ({}))) as { message?: string };
  expect(start.status(), `Prüfung starten schlug fehl: ${startBody.message ?? ''}`).toBeLessThan(400);
  await page.waitForTimeout(2500);

  // --- 2) Plausibilitätsregeln ausführen
  console.log('SCHRITT 2: Plausi');
  const plausi = page.getByRole('button', { name: 'Plausi neu ausführen' });
  await expect(plausi, 'nach dem Start muss "Plausi neu ausführen" verfügbar sein').toBeVisible();
  await plausi.click();
  const regelLauf = await page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().includes('/regeln/run'),
    { timeout: 20_000 },
  );
  const regelBody = (await regelLauf.json().catch(() => ({}))) as { message?: string };
  expect(regelLauf.status(), `Regellauf schlug fehl: ${regelBody.message ?? ''}`).toBeLessThan(400);
  await page.waitForTimeout(2000);

  // --- 3) Notiz anlegen
  //
  // Das Notiz-Formular ist IMMER sichtbar (WPView:723, `isWP && !isFinalized`)
  // — es gibt keinen Aufklapp-Knopf. Der einzige Knopf heißt "Notiz
  // hinzufügen" und ist deaktiviert, solange das Textfeld leer ist
  // (`disabled={... || !props.newNotizText.trim()}`).
  //
  // Mein erster Versuch klickte den Knopf VOR dem Ausfüllen und lief in
  // einen 30-s-Timeout: Playwright wartet auf einen aktiven Knopf. Die
  // Reihenfolge ist hier Teil des Vertrags.
  const notizFormular = page.locator('main textarea').first();
  await expect(notizFormular, 'das Notiz-Formular muss sichtbar sein').toBeVisible();
  await notizFormular.fill('Plausibilitätsprüfung Testnotiz: Forderungen aus Vorjahr prüfen.');

  const sendeKnopf = page.getByRole('button', { name: 'Notiz hinzufügen' });
  await expect(sendeKnopf, 'nach dem Ausfüllen muss der Knopf aktiv sein').toBeEnabled();

  console.log('SCHRITT 4: Notiz senden');
  const notizPost = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().endsWith('/wp/notizen'),
    { timeout: 20_000 },
  );
  await sendeKnopf.click();
  const notizResp = await notizPost;
  const notizBody = (await notizResp.json().catch(() => ({}))) as { message?: string };
  expect(notizResp.status(), `Notiz anlegen schlug fehl: ${notizBody.message ?? ''}`).toBeLessThan(400);
  await page.waitForTimeout(2000);

  console.log('BUTTONS NACH NOTIZ:', JSON.stringify(await page.getByRole('button').allInnerTexts()));

  // --- 4) Vier-Augen-Prinzip: der Ersteller darf seine eigene Notiz nicht
  //        freigeben — weder in der Oberfläche noch über die API.
  //
  // Die Oberfläche deaktiviert den Knopf (`disabled={props.isSelf}`,
  // WPView:863), das Backend wirft 403 (WPNotizService.updateStatus). Mein
  // erster Test hat blind auf "Freigeben" geklickt und lief in einen Timeout
  // — der Knopf ist zu Recht deaktiviert.
  const freigeben = page.getByRole('button', { name: 'Freigeben' }).first();
  await expect(
    freigeben,
    'die neue Notiz muss eine Status-Aktion anbieten',
  ).toBeVisible();
  await expect(
    freigeben,
    'Freigeben der eigenen Notiz muss deaktiviert sein (Vier-Augen-Prinzip)',
  ).toBeDisabled();

  // Gegenprobe auf der API: derselbe Versuch muss 403 liefern.
  const selfAck = await page.evaluate(async (bilanzId: string) => {
    const t = localStorage.getItem('accessToken');
    const mid = localStorage.getItem('activeMandantId');
    // `x-mandant-id` ist Pflicht: `apiFetch` setzt ihn zentral, ein roher
    // fetch nicht. Ohne ihn blieb die Notizliste leer und die Vier-Augen-
    // Probe lief ins Leere — bei einem `if (kein Grund) prüfe`-Muster
    // hätte der Test dadurch grün gemeldet, ohne etwas zu prüfen.
    const notizen = (await (
      await fetch(`/api/wp/notizen?bilanzId=${bilanzId}`, {
        headers: { Authorization: `Bearer ${t}`, 'x-mandant-id': mid ?? '' },
      })
    ).json()) as Array<{ id: string }>;
    if (!notizen.length) return { grund: 'keine Notiz sichtbar' } as const;
    const r = await fetch(`/api/wp/notizen/${notizen[0].id}/status`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${t}`,
        'x-mandant-id': mid ?? '',
      },
      body: JSON.stringify({ status: 'APPROVED' }),
    });
    return { status: r.status, body: (await r.text()).slice(0, 160) } as const;
  }, bilanzId);
  console.log('SELF-ACK (eigene Notiz):', JSON.stringify(selfAck));
  expect(
    selfAck,
    'Selbst-Freigabe muss den Vier-Augen-Pfad erreichen, nicht an einer leeren Liste scheitern',
  ).not.toHaveProperty('grund');
  if (!('grund' in selfAck)) {
    expect(
      selfAck.status,
      `Self-Acknowledgement muss 403 sein: ${selfAck.body}`,
    ).toBe(403);
    expect(selfAck.body, 'die Meldung muss das Vier-Augen-Prinzip nennen').toContain(
      'Self-Acknowledgement',
    );
  }

  // Bestätigung durch einen ANDEREN Benutzer: das Backend erlaubt jedem
  // User mit Mandant-Zugriff das Acknowledgement — nur der Ersteller nicht.
  const fremdAck = await page.evaluate(async (bilanzId: string) => {
    const login = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'steuerberater@kanzlei.de', password: 'Demo123!' }),
    });
    if (!login.ok) return { grund: 'Login fehlgeschlagen' } as const;
    const token = ((await login.json()) as { accessToken: string }).accessToken;
    const mid = localStorage.getItem('activeMandantId');
    const notizen = (await (
      await fetch(`/api/wp/notizen?bilanzId=${bilanzId}`, {
        headers: { Authorization: `Bearer ${token}`, 'x-mandant-id': mid ?? '' },
      })
    ).json()) as Array<{ id: string }>;
    if (!notizen.length) return { grund: 'keine Notiz sichtbar' } as const;
    const r = await fetch(`/api/wp/notizen/${notizen[0].id}/status`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${token}`,
        'x-mandant-id': mid ?? '',
      },
      body: JSON.stringify({ status: 'APPROVED' }),
    });
    return { status: r.status, body: (await r.text()).slice(0, 160) } as const;
  }, bilanzId);
  console.log('FREMD-ACK (anderer User):', JSON.stringify(fremdAck));
  expect(
    fremdAck,
    'Fremd-Freigabe muss ebenfalls den Vier-Augen-Pfad erreichen',
  ).not.toHaveProperty('grund');
  if (!('grund' in fremdAck)) {
    expect(
      fremdAck.status,
      `Fremdes Acknowledgement muss möglich sein: ${fremdAck.body}`,
    ).toBeLessThan(400);
  }
  // Reload setzt die Auswahl zurueck — Mandant und Bilanz muessen neu
  // gewaehlt werden, sonst zeigt die Seite gar keine Pruefung mehr.
  await page.reload();
  await page.waitForTimeout(3000);
  await page.locator('main select').first().selectOption({ index: 1 });
  await page.waitForTimeout(2500);
  await page.locator('main select').nth(1).selectOption(bilanzId);
  await page.waitForTimeout(2500);

  // --- 5) Prüfung abschließen
  //
  // Zweistufig wie die Notiz: der erste Klick öffnet das Abschluss-Panel
  // (setShowFinalize), der Senden-Knopf ist deaktiviert, bis die
  // Zusammenfassung gefüllt ist (WPView:813). Ohne den Zwischenschritt
  // lief der Test in einen 30-s-Timeout — Playwright wartet auf einen
  // aktiven Knopf.
  console.log('SCHRITT 5: Abschließen');
  const abschliessen = page.getByRole('button', { name: 'Prüfung abschließen' });
  await expect(abschliessen, 'nach der Notiz muss "Prüfung abschließen" verfügbar sein').toBeVisible();
  await abschliessen.first().click();
  await page.waitForTimeout(1200);

  const textareas = page.locator('main textarea');
  const anzahl = await textareas.count();
  const zusammenfassung = textareas.nth(anzahl - 1);
  await expect(zusammenfassung, 'das Abschluss-Panel muss eine Zusammenfassung erwarten').toBeVisible();
  await zusammenfassung.fill(
    'Prüfung abgeschlossen: IDW PS 880 geprüft, keine wesentlichen Beanstandungen.',
  );
  await page.waitForTimeout(300);

  const finPost = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().includes('/finalize'),
    { timeout: 20_000 },
  );
  await page.getByRole('button', { name: 'Prüfung abschließen' }).last().click();
  const fin = await finPost;
  const finBody = (await fin.json().catch(() => ({}))) as { message?: string };
  expect(fin.status(), `Abschließen schlug fehl: ${finBody.message ?? ''}`).toBeLessThan(400);
  await page.waitForTimeout(2000);

  const schreibzugriffe = aufrufe.filter((a) => a.methode !== 'GET');
  console.log('ALLE SCHREIBZUGRIFFE:', JSON.stringify(schreibzugriffe));

  // Der 403 beim Self-Acknowledgement ist BEABSICHTIGT und oben bereits
  // einzeln geprüft. Er darf nicht noch einmal in die "alles ok"-Schleife
  // fallen — sonst scheitert der Test an seiner eigenen Probe.
  const selbstfreigabe = schreibzugriffe.filter(
    (a) => a.methode === 'PATCH' && a.url.includes('/wp/notizen/') && a.status === 403,
  );
  expect(
    selbstfreigabe.length,
    'der Self-Acknowledgement-Versuch muss genau einmal mit 403 gekommen sein',
  ).toBe(1);

  const echteFehler = schreibzugriffe.filter(
    (a) => !(a.methode === 'PATCH' && a.url.includes('/wp/notizen/') && a.status === 403),
  );
  for (const a of echteFehler) {
    expect(a.status, `${a.methode} ${a.url} → ${a.status}`).toBeLessThan(400);
  }

  // Erwartete Schreibpfade der Kette — alle müssen wirklich gelaufen sein.
  const pfade = echteFehler.map((a) => `${a.methode} ${a.url}`).join(' | ');
  for (const erwartet of [
    'POST /api/wp/pruefungen',
    'regeln/run',
    'POST /api/wp/notizen',
    'finalize',
  ]) {
    expect(pfade, `Pfad ${erwartet} wurde nicht ausgeführt`).toContain(erwartet);
  }
});

test('WP: STEUERBERATER sieht keine WP-Aktionen (kein 403 durch Anklicken)', async ({ page }) => {
  await anmelden(page, 'steuerberater@kanzlei.de');
  const aufrufe = aufzeichnung(page);
  await page.goto('http://localhost:3001/de-DE/wp');
  await page.waitForTimeout(3000);

  const mandantSelect = page.locator('main select').first();
  if ((await mandantSelect.count()) > 0) {
    await mandantSelect.selectOption({ index: 1 });
    await page.waitForTimeout(2500);
    const bilanzSelect = page.locator('main select').nth(1);
    if ((await bilanzSelect.locator('option').count()) > 1) {
      await bilanzSelect.selectOption({ index: 1 });
      await page.waitForTimeout(2500);
    }
  }

  const body = await page.locator('body').innerText();
  expect(body, 'die Seite darf nicht abstürzen').not.toContain('Application error');

  // Die WP-exklusiven Aktionen dürfen für einen STEUERBERATER gar nicht
  // erst angeboten werden — sonst klickt der Anwender sie und bekommt 403.
  const start = page.getByRole('button', { name: 'Prüfung starten' });
  const abschliessen = page.getByRole('button', { name: 'Prüfung abschließen' });
  const notiz = page.getByRole('button', { name: 'Notiz hinzufügen' });
  console.log(
    'STEUERBERATER sieht — starten:',
    await start.count(),
    '| abschließen:',
    await abschliessen.count(),
    '| Notiz:',
    await notiz.count(),
  );
  expect(
    await start.count(),
    '„Prüfung starten" ist WIRTSCHAFTSPRUEFER-exklusiv und darf nicht angeboten werden',
  ).toBe(0);
  expect(await abschliessen.count(), '„Prüfung abschließen" darf nicht angeboten werden').toBe(0);
  expect(await notiz.count(), '„Notiz hinzufügen" darf nicht angeboten werden').toBe(0);

  // Und ohne Klick darf es keine Schreibzugriffe geben.
  const schreibzugriffe = aufrufe.filter((a) => a.methode !== 'GET');
  expect(schreibzugriffe, 'keine Schreibzugriffe ohne Aktion').toHaveLength(0);
});
