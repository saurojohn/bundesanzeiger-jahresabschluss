import { describe, expect, it } from 'vitest';
import { AuditInterceptor } from './audit.interceptor';

/**
 * Redigierung sensibler Felder im Audit-Trail.
 *
 * Auslöser (2026-10-01): Der Interceptor schrieb den kompletten Response-Body.
 * `POST /api/api-keys` gibt zwar ein `plaintextSecret` zurück, dieses kam
 * (empirisch geprüft) NICHT im Audit-Log an — WARUM, ließ sich aus dem Code
 * nicht belegen. Eine Sicherheit, die man nicht erklären kann, hält der
 * nächsten Änderung an einem Controller nicht stand.
 *
 * Deshalb wird hier explizit redigiert, und diese Tests sichern das unabhängig
 * davon ab, wie das Response-Shape eines Controllers aussieht.
 */
describe('AuditInterceptor — Redigierung', () => {
  // Der Interceptor wird per Nest-DI gebunden; fuer die reine Redact-Logik
  // genuegt eine Instanz ohne Konstruktorargumente.
  const ic = new AuditInterceptor(undefined as never);

  // safeJson ist privat; über den Runtime-Zugriff prüfen ist hier Absicht:
  // es geht um das Verhalten, nicht um die Sichtbarkeit.
  const redact = (v: unknown) =>
    (ic as unknown as { safeJson(v: unknown): unknown }).safeJson(v);

  it('ersetzt Passwörter und Secrets durch [redigiert]', () => {
    const out = redact({
      email: 'a@b.de',
      password: 'SuperGeheim123',
      plaintextSecret: 'Yv6Y4GN5J7Pk...',
      clientSecret: 'cs_abc',
    }) as Record<string, unknown>;

    expect(out['password']).toBe('[redigiert]');
    expect(out['plaintextSecret']).toBe('[redigiert]');
    expect(out['clientSecret']).toBe('[redigiert]');
    expect(out['email']).toBe('a@b.de'); // unbedenkliche Felder bleiben
  });

  it('erfasst auch Token- und Key-Felder', () => {
    const out = redact({
      accessToken: 'eyJhbGciOi...',
      refreshToken: 'rt_xyz',
      privateKey: '-----BEGIN...',
      totpSecret: 'JBSWY3DP',
      apiKey: 'ak_123',
    }) as Record<string, unknown>;
    for (const k of ['accessToken', 'refreshToken', 'privateKey', 'totpSecret', 'apiKey']) {
      expect(out[k], `${k} muss redigiert sein`).toBe('[redigiert]');
    }
  });

  it('greift rekursiv in verschachtelte Objekte und Arrays', () => {
    const out = redact({
      user: { name: 'Max', credentials: { password: 'p4ssw0rd' } },
      keys: [{ plaintextSecret: 's1' }, { plaintextSecret: 's2' }],
    }) as unknown as { user: { name: string; credentials: { password: string } }; keys: Array<{ plaintextSecret: string }> };

    expect(out.user.credentials.password).toBe('[redigiert]');
    expect(out.keys[0]!.plaintextSecret).toBe('[redigiert]');
    expect(out.keys[1]!.plaintextSecret).toBe('[redigiert]');
    expect(out.user.name).toBe('Max');
  });

  it('kürzt ungeheure Textfelder (PDF-Base64) statt das Log zu sprengen', () => {
    const out = redact({ content: 'A'.repeat(50_000) }) as Record<string, string>;
    expect(out['content']!.length).toBeLessThan(2_100);
    expect(out['content']).toContain('50000 Zeichen');
  });

  it('überlebt Zyklen und unendliche Tiefe', () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic['self'] = cyclic;
    expect(() => redact(cyclic)).not.toThrow();

    let deep: unknown = { value: 'unten' };
    for (let i = 0; i < 20; i += 1) deep = { child: deep };
    expect(() => redact(deep)).not.toThrow();
  });
});
