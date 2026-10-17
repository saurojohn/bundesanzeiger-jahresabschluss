/**
 * Nur Diagnose: Anhang mit unaufgeloesten Platzhaltern — wird er akzeptiert?
 * Wird nach der Analyse geloescht.
 */
const BASE = 'http://localhost:3000';

async function main() {
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'steuerberater@kanzlei.de', password: 'Demo123!' }),
  });
  const token = (await login.json()).accessToken;
  const me = await (await fetch(`${BASE}/api/auth/me`, {
    headers: { authorization: `Bearer ${token}` },
  })).json();
  const mid = me.mandanten.find((m) => m.firmenname === 'Demo GmbH').id;
  const h = { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-mandant-id': mid };

  const tpl = await (await fetch(`${BASE}/api/anhang/templates`, { headers: h })).json();

  const create = await fetch(`${BASE}/api/anhang?mandantId=${mid}`, {
    method: 'POST', headers: h,
    body: JSON.stringify({
      mandantId: mid,
      geschaeftsjahr: 2069,
      abschnitte: tpl.map((a) => ({ titel: a.titel, reihenfolge: a.reihenfolge, inhalt: a.inhaltVorlage })),
    }),
  });
  const body = await create.json();
  const id = body.anhang?.id ?? body.id;
  console.log(`1. Anhang MIT Vorlage angelegt: HTTP ${create.status}  (id=${id ? id.slice(0, 8) : '—'})`);

  const detail = await (await fetch(`${BASE}/api/anhang/${id}?mandantId=${mid}`, { headers: h })).json();
  const inhalt = (detail.anhang?.abschnitte ?? detail.abschnitte ?? []).map((a) => a.inhalt).join('\n');
  const platzhalter = inhalt.match(/\[[^\]\n]{1,40}\]/g) || [];
  console.log(`2. Platzhalter im gespeicherten Anhang: ${platzhalter.length} -> ${[...new Set(platzhalter)].join(', ')}`);

  // Validieren — die Huerde, die ein unfertiger Anhang nehmen muss
  let validStatus = '(keine Route)';
  for (const p of [`/api/anhang/${id}/validate`, `/api/bilanz/${id}/validate`]) {
    const r = await fetch(`${BASE}${p}?mandantId=${mid}`, { method: 'POST', headers: h, body: JSON.stringify({}) });
    if (r.status !== 404) {
      const b = await r.text();
      validStatus = `${p.split('/').slice(-1)[0]} -> HTTP ${r.status}  ${b.slice(0, 150)}`;
      break;
    }
  }
  console.log(`3. Validieren: ${validStatus}`);

  // Abschluss erzeugen (Jahresabschluss) — der Weg zum Bundesanzeiger
  const abschluss = await fetch(`${BASE}/api/pdf/anhang/${id}/generate?mandantId=${mid}`, {
    method: 'POST', headers: h,
  });
  console.log(`4. PDF erzeugen: HTTP ${abschluss.status}`);

  await fetch(`${BASE}/api/anhang/${id}?mandantId=${mid}`, { method: 'DELETE', headers: h, body: JSON.stringify({}) });
}

main().catch((e) => { console.error('FEHLER', e.message); process.exit(1); });
