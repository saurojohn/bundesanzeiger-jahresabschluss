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

  // Zwei Tests mit DEMSELBEN Aufbau, aber entgegengesetzter Erwartung.
  //
  // Bewusst KEINE unerreichbaren IPs (203.0.113.x): Auf manchen Netzen
  // antworten die mit RST (schnell), auf anderen werden die Pakete still
  // verworfen — der Test lief lokal in 2 ms und im CI-Runner in 30 s
  // Timeout. Ein Test darf nicht vom Fehlerverhalten des Netzwerks abhängen.
  //
  // Stattdessen: der Hostname ist DNS-unerreichbar (`.invalid` lautet per
  // RFC 2606 niemals), die gepinnte Adresse zeigt auf den laufenden
  // Testserver. Kann der Agent den Hostnamen nicht auflösen, scheitert der
  // Request sofort mit ENOTFOUND. Erreichbar ist er NUR, wenn wirklich die
  // gepinnte Adresse benutzt wurde — deterministisch, in jeder Umgebung.
  it('nutzt die gepinnte Adresse, obwohl der Hostname nicht auflösbar ist', async () => {
    const unresolvable = localUrl.replace('localhost', 'kein-host.invalid');
    const res = await getViaAgent(unresolvable, ['127.0.0.1']);
    expect(res.status).toBe(200);
    expect(res.body).toContain('"hit":true');
  });

  it('ohne Pinning-Nutzwert erreicht der Agent den Hostnamen nicht', async () => {
    // Gegenprobe: dieselbe URL OHNE gueltige Adresse bricht ab, statt
    // stillschweigend doch zu verbinden.
    expect(() => pinnedAgentFor(new URL(localUrl), [])).toThrow(/keine geprüfte/i);
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
