/**
 * Nur Diagnose: Verhalten des Refresh-Tokens.
 * Wird nach der Analyse geloescht.
 */
const BASE = 'http://localhost:3000';

async function main() {
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'steuerberater@kanzlei.de', password: 'Demo123!' }),
  });
  const s1 = await login.json();
  const T = s1.refreshToken;
  console.log(`Login              -> 200, refreshToken ${T.slice(0, 12)}… (${T.length} Zeichen)`);

  const refresh = async (token) => {
    const r = await fetch(`${BASE}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: token }),
    });
    const b = await r.json();
    return { status: r.status, refreshToken: b.refreshToken, message: b.message };
  };

  // (1) Erster Refresh
  const a = await refresh(T);
  console.log(`Refresh #1         -> ${a.status} | zurueckgegebener Token ${a.refreshToken ? 'identisch' : '—'}`);
  console.log(`                     gleicher Token? ${a.refreshToken === T ? 'JA' : 'NEIN'}`);

  // (2) Wiederverwendung desselben Tokens (Replay)
  const b = await refresh(T);
  console.log(`Refresh #2 (Replay)-> ${b.status} ${b.status === 200 ? '  <-- Wiederverwendung moeglich' : ''}`);

  // (3) Dritter Versuch
  const c = await refresh(T);
  console.log(`Refresh #3 (Replay)-> ${c.status} ${c.status === 200 ? '  <-- immer noch' : ''}`);

  // (4) Nach Logout
  const lo = await fetch(`${BASE}/api/auth/logout`, {
    method: 'POST',
    headers: { authorization: `Bearer ${s1.accessToken}` },
  });
  console.log(`Logout             -> ${lo.status}`);

  const d = await refresh(T);
  console.log(`Refresh nach Logout-> ${d.status} ${d.message ? '  (' + d.message + ')' : ''}`);

  // (5) Alter Access-Token nach Logout
  const r5 = await fetch(`${BASE}/api/auth/me`, {
    headers: { authorization: `Bearer ${s1.accessToken}` },
  });
  console.log(`Altes Access-Token -> /auth/me ${r5.status} ${r5.status === 200 ? '  <-- gilt nach Logout weiter' : ''}`);
}

main().catch((e) => { console.error('FEHLER', e.message); process.exit(1); });
