/**
 * E2E-Test: Public API v1 + OAuth2 (client_credentials).
 *
 * Diese Oberfläche war nie end-to-end geprüft — sie ist der Einstieg für
 * externe Integrationspartner (DATEV, Addison, ERP) und wird nach außen
 * ausgeliefert, ist also die Stelle, an der ein Fehler den Partner direkt
 * trifft.
 *
 * Gefundene Befunde (2026-10-05) und ihre Absicherung:
 *
 *  1. `scope` war trotz `scope?` und `required: false` PFLICHT für die
 *     ValidationPipe (`@IsString()` ohne `@IsOptional()`). Ein
 *     spezifikationskonformer Client, der `scope` weglässt, bekam
 *     400 "scope must be a string" — noch BEVOR die Zugangsdaten geprüft
 *     wurden. RFC 6749 §4.4.2: scope ist beim client_credentials-Grant
 *     optional; weggelassen bedeutet alle Scopes des Keys.
 *
 *  2. Die Swagger-Doku kündigte 401 für ungültige Zugangsdaten an, der
 *     Code lieferte 400. Laut RFC 6749 §5.2 ist 401 nur MANDATISCH, wenn
 *     der Client den `Authorization`-Header nutzt; dieser Server
 *     akzeptiert nur Body-Credentials, also ist 400 korrekt. Die Doku
 *     wurde angeglichen, nicht der Code.
 */
import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../src/app.module';

const BASE = 'http://localhost:3000';
const API = `${BASE}/api`;

interface LoginResponse {
  accessToken: string;
}

interface CreateKeyResponse {
  apiKey: { id: string; keyId: string };
  plaintextSecret: string;
}

describe('Public API v1 + OAuth2 (client_credentials)', () => {
  let app: INestApplication;
  let adminToken: string;
  let mandantId: string;
  let kanzleiId: string;
  let keyId: string;
  let keyRecordId: string;
  let secret: string;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    app.setGlobalPrefix('api', { exclude: ['health'] });
    await app.init();

    const login = (await (
      await fetch(`${API}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'kanzlei-admin@kanzlei.de', password: 'Demo123!' }),
      })
    ).json()) as LoginResponse;
    adminToken = login.accessToken;

    const mandanten = (await (
      await fetch(`${API}/mandant`, {
        headers: { authorization: `Bearer ${adminToken}` },
      })
    ).json()) as Array<{ id: string }>;
    mandantId = mandanten[0].id;

    const detail = (await (
      await fetch(`${API}/mandant/${mandantId}`, {
        headers: { authorization: `Bearer ${adminToken}` },
      })
    ).json()) as { kanzleiId: string };
    kanzleiId = detail.kanzleiId;

    const created = (await (
      await fetch(`${API}/api-keys`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          kanzleiId,
          name: `E2E Public API ${Date.now()}`,
          scopes: ['mandant:read', 'bilanz:read'],
        }),
      })
    ).json()) as CreateKeyResponse;
    keyId = created.apiKey.keyId;
    // Der Widerruf läuft über die Datensatz-ID (UUID), NICHT über die keyId —
    // zwei verschiedene Bezeichner, die leicht verwechselt werden.
    keyRecordId = created.apiKey.id;
    secret = created.plaintextSecret;
  });

  afterAll(async () => {
    await app.close();
  });

  async function tokenMit(
    body: Record<string, string>,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const res = await fetch(`${API}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  }

  // ===========================================================================
  // Token-Endpunkt
  // ===========================================================================
  it('POST /oauth/token ohne scope → 200 mit allen Key-Scopes (RFC 6749 §4.4.2)', async () => {
    const { status, body } = await tokenMit({
      grant_type: 'client_credentials',
      client_id: keyId,
      client_secret: secret,
    });
    expect(status).toBe(200);
    expect(typeof body.access_token).toBe('string');
    // Ohne scope-Wunsch werden die Scopes des Keys gewährt.
    expect(String(body.scope).split(' ').sort()).toEqual(['bilanz:read', 'mandant:read']);
  });

  it('POST /oauth/token mit Teil-Scope → nur der gewünschte', async () => {
    const { status, body } = await tokenMit({
      grant_type: 'client_credentials',
      client_id: keyId,
      client_secret: secret,
      scope: 'mandant:read',
    });
    expect(status).toBe(200);
    expect(body.scope).toBe('mandant:read');
  });

  it('POST /oauth/token mit nicht gehaltenem Scope → 403 (kein Eskalieren)', async () => {
    const { status } = await tokenMit({
      grant_type: 'client_credentials',
      client_id: keyId,
      client_secret: secret,
      scope: 'bilanz:write',
    });
    expect(status).toBe(403);
  });

  it('POST /oauth/token mit falschem Secret → 400 invalid_client', async () => {
    const { status, body } = await tokenMit({
      grant_type: 'client_credentials',
      client_id: keyId,
      client_secret: 'falsches-secret',
    });
    // RFC 6749 §5.2: 401 ist nur MANDATISCH bei Authentifizierung über den
    // Authorization-Header. Dieser Server nutzt Body-Credentials → 400.
    expect(status).toBe(400);
    expect(body.message).toBe('invalid_client');
  });

  it('POST /oauth/token mit falschem grant_type → 400', async () => {
    const { status } = await tokenMit({
      grant_type: 'authorization_code',
      client_id: keyId,
      client_secret: secret,
    });
    expect(status).toBe(400);
  });

  // ===========================================================================
  // v1-Zugriff mit beiden Authentifizierungswegen
  // ===========================================================================
  it('GET /v1/mandanten mit API-Key-Bearer → 200', async () => {
    const res = await fetch(`${API}/v1/mandanten`, {
      headers: { authorization: `Bearer ${keyId}.${secret}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ id: string }> };
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.length).toBeGreaterThan(0);
  });

  it('GET /v1/mandanten mit OAuth-JWT → 200', async () => {
    const { body } = await tokenMit({
      grant_type: 'client_credentials',
      client_id: keyId,
      client_secret: secret,
    });
    const res = await fetch(`${API}/v1/mandanten`, {
      headers: { authorization: `Bearer ${String(body.access_token)}` },
    });
    expect(res.status).toBe(200);
  });

  it('GET /v1 ohne jede Authentifizierung → 401', async () => {
    const res = await fetch(`${API}/v1/mandanten`);
    expect(res.status).toBe(401);
  });

  // ===========================================================================
  // Scopes werden durchgesetzt
  // ===========================================================================
  it('Scope-Durchsetzung: Key ohne guv:read → 403 mit Nennung des Scopes', async () => {
    const res = await fetch(`${API}/v1/mandanten/${mandantId}/guv`, {
      headers: { authorization: `Bearer ${keyId}.${secret}` },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { message: string };
    expect(body.message).toContain('guv:read');
  });

  it('Scope-Durchsetzung: gehaltener Scope → 200', async () => {
    const res = await fetch(`${API}/v1/mandanten/${mandantId}/bilanzen`, {
      headers: { authorization: `Bearer ${keyId}.${secret}` },
    });
    expect(res.status).toBe(200);
  });

  it('Schreibzugriff ohne Write-Scope → 403', async () => {
    const res = await fetch(`${API}/v1/banz-submissions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${keyId}.${secret}`,
      },
      body: JSON.stringify({ mandantId }),
    });
    expect(res.status).toBe(403);
  });

  // ===========================================================================
  // Widerruf wirkt sofort
  // ===========================================================================
  it('Nach dem Widerruf des Keys ist der Zugriff gesperrt', async () => {
    const del = await fetch(`${API}/api-keys/${keyRecordId}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(del.status).toBeLessThan(400);

    const res = await fetch(`${API}/v1/mandanten`, {
      headers: { authorization: `Bearer ${keyId}.${secret}` },
    });
    expect(
      res.status,
      'ein widerrufener Key darf keinen Zugriff mehr erhalten',
    ).toBe(401);
  });
});
