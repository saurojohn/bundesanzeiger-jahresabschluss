import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { request as httpRequest } from 'node:http';
import { pinnedAgentFor } from './dns-pinning';
import { assertResolvesToPublicAddress } from './ssrf-guard';

/**
 * DNS-Pinning gegen Rebinding.
 *
 * Der Fehler, den dieser Test verhindert (Audit M-4):
 *
 *   await assertResolvesToPublicAddress(url);   // prüft DNS-Lösung #1
 *   await axios.post(url, body);               // verbindet gegen Lösung #2
 *
 * Wer die DNS-Autorität kontrolliert, liefert erst eine öffentliche IP und
 * dann 127.0.0.1. Der Test simuliert das über eine /etc/hosts-Umleitung auf
 * 127.0.0.1 und beweist, dass der gepinnte Agent SICHER genau die geprüfte
 * Adresse benutzt — bzw. gar nicht erst zu einem ungeprüften Host greift.
 */

let local: Server;
let localUrl: string;

beforeAll(async () => {
  // Ein lokaler HTTP-Server, der "von außen" wie ein fremder Dienst wirkt.
  local = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ hit: true, url: req.url }));
  });
  await new Promise<void>((resolve) => local.listen(0, '127.0.0.1', resolve));
  const addr = local.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  localUrl = `http://localhost:${port}/webhook`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => local.close(() => resolve()));
});

/** Minimale GET-Anfrage über den gepinnten Agent. */
function getViaAgent(url: string, addresses: string[]): Promise<{ status: number; body: string }> {
  const parsed = new URL(url);
  const agent = pinnedAgentFor(parsed, addresses);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname,
        method: 'GET',
        agent: agent as never,
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += String(c)));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

describe('pinnedAgentFor', () => {
  it('verweigert die Konstruktion ohne geprüfte Adresse', () => {
    expect(() => pinnedAgentFor(new URL('http://example.com/'), [])).toThrow(
      /keine geprüfte Adresse/i,
    );
  });

  it('verbindet auf die ÜBERGEBENE Adresse, nicht auf eine neu aufgelöste', async () => {
    // "localhost" zeigt in dieser Sandbox auf 127.0.0.1. Wir pinnen auf eine
    // nicht-loopback-Adresse und erwarten, dass der WIRKLICHE Verbindungs-
    // auftritt (hier also ein Fehlschlag) — hätte der Agent selbst
    // aufgelöst, wäre der lokale Server (also loopback) erreicht worden.
    const result = await getViaAgent(localUrl, ['203.0.113.9']).catch((e) => ({
      status: -1,
      body: String(e),
    }));

    // Der gepinnte Host ist nicht erreichbar → Fehler, KEIN lokaler Treffer.
    expect(result.status, 'darf den lokalen Server nicht erreichen').not.toBe(200);
    expect(result.body).not.toContain('"hit":true');
  });

  it('erreicht das Ziel, wenn die gepinnte Adresse stimmt', async () => {
    const res = await getViaAgent(localUrl, ['127.0.0.1']);
    expect(res.status).toBe(200);
    expect(res.body).toContain('"hit":true');
  });
});

describe('assertResolvesToPublicAddress liefert die geprüften Adressen', () => {
  it('gibt bei einer Literal-IP genau diese zurück', async () => {
    // Loopback würde abgelehnt; hier prüfen wir das happy path über eine
    // öffentliche Literal-IP.
    const target = await assertResolvesToPublicAddress('https://93.184.216.34/hook');
    expect(target.addresses).toEqual(['93.184.216.34']);
  });

  it('lehnt interne Literal-Adressen weiterhin ab', async () => {
    await expect(assertResolvesToPublicAddress('http://127.0.0.1:5432/')).rejects.toThrow();
  });
});
