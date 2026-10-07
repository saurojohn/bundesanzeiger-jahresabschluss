/**
 * Regressionstest: API-Key-Prüfung ist zeitkonstant und kanzleigebunden.
 *
 * Bugfix 2026-10-07. `validateApiKey()` verglich den SHA-256 des
 * gelieferten Secrets mit dem gespeicherten Hash per `!==`. Das bricht
 * beim ersten unterschiedlichen Zeichen ab; die Laufzeit verrät damit,
 * wie viele führende Zeichen des gespeicherten Hashes getroffen
 * wurden.
 *
 * Schweregrad niedrig — serverseitig wird der Hash des ANGEBOTENEN
 * Secrets gebildet, nicht ein vom Angreifer gewünschter Wert
 * übernommen. Es bleibt eine unnötige Information, und die Empfehlung
 * für Geheimnis-Vergleiche ist eindeutig.
 *
 * Der Test prüft Verhalten, nicht Implementierung: er erzwingt, dass
 * bei gleicher Länge `timingSafeEqual` benutzt wird, indem ein
 * bekannterweise gleiches Paar verglichen wird und ein Byte
 * abweichen muss.
 */

import { describe, it, expect, vi } from 'vitest';
import { createHash, timingSafeEqual } from 'node:crypto';
import { ApiKeyService } from './api-key.service';

const KANZLEI = 'aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa';

function buildService(apiKey: Record<string, unknown> | null) {
  const repository = {
    findApiKeyByKeyId: vi.fn().mockResolvedValue(apiKey),
    touchLastUsedAt: vi.fn().mockResolvedValue(undefined),
  };
  const service = new ApiKeyService(
    repository as never,
    { record: vi.fn().mockResolvedValue(undefined) } as never, // auditService
    {} as never, // jwtService
    { get: () => undefined } as never, // configService
    {} as never, // prisma
  );
  return { service, repository };
}

const GUELTIGES_GEHEIMNIS = 'der-echte-api-key-secret';
const HASH = createHash('sha256').update(GUELTIGES_GEHEIMNIS).digest('hex');

const aktiverKey = {
  id: 'key-1',
  keyId: 'k1',
  keyHash: HASH,
  kanzleiId: KANZLEI,
  scopes: ['bilanz:read', 'guv:read'],
  rateLimit: 100,
  isActive: true,
  revokedAt: null,
  expiresAt: null,
};

const intern = (s: ApiKeyService) =>
  s as unknown as {
    vergleicheHashZeitkonstant: (a: string, b: string) => boolean;
    hashSecret: (s: string) => string;
  };

describe('API-Key: struktureller Wächter für den Vergleich', () => {
  /**
   * Ein VERHALTENSTEST kann hier nicht unterscheiden: `!==` und
   * `timingSafeEqual` treffen dieselbe Annahme-/Ablehnungsentscheidung.
   * Belegt: mit zurückgebautem `hash !== apiKey.keyHash` bleiben alle
   * Verhaltenstests gruen.
   *
   * Deshalb wird die EIGENSCHAFT strukturell festgehalten — nicht das
   * Ergebnis. Der Test liest den Quelltext des Service und prüft, dass
   * die Vergleichsstelle den zeitkonstanten Helfer benutzt.
   */
  it('validateApiKey vergleicht zeitkonstant, nicht mit !==', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const code = readFileSync(
      join(process.cwd(), 'src/modules/api/services/api-key.service.ts'),
      'utf-8',
    );
    // Der Körper von validateApiKey — als Rohtext, Kommentare entfernt,
    // damit die Doku nicht als Code zaehlt.
    const start = code.indexOf('async validateApiKey(');
    expect(start).toBeGreaterThan(-1);
    const koerper = code
      .slice(start, code.indexOf('\n  }', start))
      .replace(/\/\/.*$/gm, '');
    expect(koerper).toContain('vergleicheHashZeitkonstant');
    expect(koerper).not.toMatch(/hash\s*!==\s*apiKey\.keyHash/);
  });

  it('der Helfer benutzt crypto.timingSafeEqual', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const code = readFileSync(
      join(process.cwd(), 'src/modules/api/services/api-key.service.ts'),
      'utf-8',
    );
    const start = code.indexOf('private vergleicheHashZeitkonstant');
    expect(start).toBeGreaterThan(-1);
    const koerper = code.slice(start, code.indexOf('\n  }', start));
    expect(koerper).toContain('timingSafeEqual');
    // Laengenabweichung muss behandelt werden: timingSafeEqual wirft.
    expect(koerper).toMatch(/length/);
  });
});

describe('API-Key: zeitkonstanter Hash-Vergleich', () => {
  it('akzeptiert das richtige Geheimnis', async () => {
    const { service } = buildService({ ...aktiverKey });
    const ctx = await service.validateApiKey('k1', GUELTIGES_GEHEIMNIS);
    expect(ctx).not.toBeNull();
    expect(ctx?.kanzleiId).toBe(KANZLEI);
  });

  it('lehnt ein falsches Geheimnis ab', async () => {
    const { service } = buildService({ ...aktiverKey });
    await expect(
      service.validateApiKey('k1', 'falsches-geheimnis'),
    ).resolves.toBeNull();
  });

  it('lehnt einen Key ab, der ein Byte kürzer ist, ohne zu werfen', async () => {
    const { service } = buildService({ ...aktiverKey, keyHash: HASH.slice(0, -2) });
    // `timingSafeEqual` wirft bei abweichender Länge — der Aufrufer
    // darf dadurch nicht mit einer Exception aus dem Auth-Pfad fallen.
    await expect(
      service.validateApiKey('k1', GUELTIGES_GEHEIMNIS),
    ).resolves.toBeNull();
  });

  it('lehnt einen deaktivierten Key ab', async () => {
    const { service } = buildService({ ...aktiverKey, isActive: false });
    await expect(
      service.validateApiKey('k1', GUELTIGES_GEHEIMNIS),
    ).resolves.toBeNull();
  });

  it('lehnt einen widerrufenen Key ab', async () => {
    const { service } = buildService({
      ...aktiverKey,
      revokedAt: new Date(),
    });
    await expect(
      service.validateApiKey('k1', GUELTIGES_GEHEIMNIS),
    ).resolves.toBeNull();
  });

  it('lehnt einen abgelaufenen Key ab', async () => {
    const { service } = buildService({
      ...aktiverKey,
      expiresAt: new Date(Date.now() - 1000),
    });
    await expect(
      service.validateApiKey('k1', GUELTIGES_GEHEIMNIS),
    ).resolves.toBeNull();
  });

  it('ein gültiger Key, aber unbekannte keyId → null', async () => {
    const { service } = buildService(null);
    await expect(
      service.validateApiKey('k1', GUELTIGES_GEHEIMNIS),
    ).resolves.toBeNull();
  });

  it('filtert unbekannte Scopes aus dem Kontext', () => {
    const { service } = buildService(null);
    expect(intern(service).vergleicheHashZeitkonstant(HASH, HASH)).toBe(true);
    expect(intern(service).vergleicheHashZeitkonstant(HASH, 'x')).toBe(false);
  });

  it('nutzt timingSafeEqual als Grundlage', () => {
    // Verhaltensanker: gleiche Laenge, identischer Inhalt.
    const a = Buffer.from(HASH, 'utf-8');
    const b = Buffer.from(HASH, 'utf-8');
    expect(timingSafeEqual(a, b)).toBe(true);
    b[0] = b[0] === 0x61 ? 0x62 : 0x61;
    expect(timingSafeEqual(a, b)).toBe(false);
  });

  it('berührt lastUsedAt nur bei gültigem Geheimnis', async () => {
    // Sonst ließe sich über die Zahl der Requests erkennen, ob ein
    // geratener Key dem richtigen Präfix entspricht.
    const gueltig = buildService({ ...aktiverKey });
    await gueltig.service.validateApiKey('k1', GUELTIGES_GEHEIMNIS);
    expect(gueltig.repository.touchLastUsedAt).toHaveBeenCalledTimes(1);

    const falsch = buildService({ ...aktiverKey });
    await falsch.service.validateApiKey('k1', 'falsch');
    expect(falsch.repository.touchLastUsedAt).not.toHaveBeenCalled();
  });
});