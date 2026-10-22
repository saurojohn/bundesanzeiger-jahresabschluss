/**
 * BEFUND 2026-10-22 (Nachtrag 83): Der Vergleich des TXT-Records war
 * `value === expectedValue || value.includes(expectedValue)`.
 *
 * Das `includes` ist kein Notbehelf, sondern eine Abschwächung: ein
 * fremder Record, der den erwarteten Wert nur **enthaelt**
 * ("banz-verify=<token>-x"), wurde als Treffer akzeptiert. Da die
 * Verifikation an einem Token haengt, muss der Vergleich **exakt** sein.
 *
 * Der Test mockt nur das DNS-Modul (die Umgebung). Die Vergleichslogik
 * selbst ist die echte aus `dns-provider.service.ts`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const resolveTxt = vi.fn();
vi.mock('dns', () => ({
  promises: {
    resolveTxt: (...args: unknown[]) => resolveTxt(...args),
  },
}));

import { DnsProviderService } from './dns-provider.service';

describe('DnsProviderService: exakter TXT-Record-Vergleich (Nachtrag 83)', () => {
  beforeEach(() => {
    resolveTxt.mockReset();
  });

  const service = () => new DnsProviderService({ get: () => undefined } as never);

  it('akzeptiert genau den erwarteten Wert', async () => {
    resolveTxt.mockResolvedValue([['banz-verify=abc123']]);
    await expect(
      service().verifyTxtRecordViaPublicDns('_banz-verify.example.de', 'banz-verify=abc123'),
    ).resolves.toBe(true);
  });

  it('weist einen fremden Wert ab', async () => {
    resolveTxt.mockResolvedValue([['banz-verify=fremd']]);
    await expect(
      service().verifyTxtRecordViaPublicDns('_banz-verify.example.de', 'banz-verify=abc123'),
    ).resolves.toBe(false);
  });

  it('weist einen Wert ab, der den erwarteten nur ENTHAELT (BUG vor dem Fix)', async () => {
    // Das war der alte Fehler: `includes` akzeptierte das.
    resolveTxt.mockResolvedValue([['banz-verify=abc123-x']]);
    await expect(
      service().verifyTxtRecordViaPublicDns('_banz-verify.example.de', 'banz-verify=abc123'),
    ).resolves.toBe(false);
  });

  it('akzeptiert den Wert auch mit umschliessenden Anfuehrungszeichen', async () => {
    // Manche Resolver liefern den TXT-Wert in Quotes.
    resolveTxt.mockResolvedValue([['"banz-verify=abc123"']]);
    await expect(
      service().verifyTxtRecordViaPublicDns('_banz-verify.example.de', 'banz-verify=abc123'),
    ).resolves.toBe(true);
  });

  it('behandelt einen nicht aufloesbaren Namen als "nicht gefunden"', async () => {
    resolveTxt.mockRejectedValue(new Error('ENOTFOUND'));
    await expect(
      service().verifyTxtRecordViaPublicDns('_banz-verify.example.de', 'banz-verify=abc123'),
    ).resolves.toBe(false);
  });
});
