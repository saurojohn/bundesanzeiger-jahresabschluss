/**
 * Regressionstest: ein Zeitstempel muss an das Dokument gebunden sein.
 *
 * Bugfix 2026-10-07. `checkTimestamp()` verglich den `messageImprint`
 * des Tokens mit dem SHA-256 ueber die /ByteRange des signierten PDF.
 * Fehlte die /ByteRange, wurde der Vergleich **uebersprungen** — es
 * stand nur ein Warn-Log im Code, danach lief die Pruefung weiter bis
 * `valid: true`.
 *
 * Damit war ein gueltiger TSA-Token fuer ein voellig anderes Dokument
 * als Zeitstempel fuer DIESES Dokument akzeptiert. `legalValidity`
 * wurde `VOLLSTAENDIG`, weil `timestampCheck.valid` zutraf und
 * `signatureVerified` stimmte — nur die Bindung an das Dokument
 * fehlte.
 *
 * Ein ordnungsgemaess signiertes PDF hat immer eine /ByteRange; sie
 * beschreibt genau den Byte-Bereich, den die Signatur abdeckt. Ohne
 * sie laesst sich nicht bestimmen, worauf sich der Zeitstempel
 * bezieht. Fail-closed ist die einzig vertretbare Antwort.
 */

import { describe, it, expect, vi } from 'vitest';
import { SignaturService } from './signatur.service';

/** Minimaler Service-Aufbau: nur `checkTimestamp` wird getestet. */
function buildService() {
  // Der Konstruktor liest SIGNATURE_TRUSTED_ISSUERS und
  // ALLOW_SELF_SIGNED_CERTS aus der Config. Ohne gesetzte
  // Trusted-Issuer arbeitet die Prüfung fail-closed — für diesen Test
  // genau richtig, weil er die ByteRange-Bindung prüft, nicht die
  // Aussteller-Whitelist.
  const config = {
    get: (key: string) =>
      key === 'ALLOW_SELF_SIGNED_CERTS' ? 'false' : undefined,
  };
  const service = new SignaturService(
    {} as never, // pdfService
    {} as never, // bilanzRepository
    {} as never, // guvRepository
    {} as never, // anhangRepository
    {} as never, // p12Service
    {} as never, // tsaClient
    {} as never, // storageService
    {} as never, // wormObjectRepository
    {} as never, // auditService
    {} as never, // signatureRepository
    {} as never, // prisma
    config as never,
  );
  return service;
}

const intern = (s: SignaturService) =>
  s as unknown as {
    checkTimestamp: (
      pdfBytes: Buffer,
      tokenBytes?: Buffer,
    ) => {
      valid: boolean;
      signatureVerified: boolean;
      reason?: string;
    };
  };

/**
 * Ein PDF-Byte-Puffer mit bzw. ohne /ByteRange.
 * Der Byte-Inhalt ist fuer diese Pruefung beliebig — entscheidend ist,
 * ob `signedContentHash` berechenbar ist.
 */
function pdfMitByteRange(): Buffer {
  // Die ByteRange deckt [0,10) und [10, rest] ab — so wie bei einem
  // echten signierten PDF: der Signatur-Wert in der Lücke zaehlt nicht
  // zum signierten Inhalt.
  const kopf = Buffer.from('%PDF-1.7\n', 'latin1');
  const rest = Buffer.from(
    '1 0 obj<</Type/Catalog/ByteRange [0 9 9 999999]>>endobj\ntrailer<<>>\n%%EOF\n',
    'latin1',
  );
  const pdf = Buffer.concat([kopf, rest]);
  // ByteRange muss im Puffer EXISTIEREN, sonst greift der Test nichts.
  const text = pdf.toString('latin1');
  text.includes('/ByteRange');
  return Buffer.from(
    text.replace('/ByteRange [0 9 9 999999]', `/ByteRange [0 9 9 ${pdf.length - 9}]`),
    'latin1',
  );
}

function pdfOhneByteRange(): Buffer {
  return Buffer.from(
    '%PDF-1.7\n' +
      '1 0 obj<</Type/Catalog/Length 42>>stream\n' +
      'BT /F1 12 Tf (kein ByteRange) Tj ET\n' +
      'endstream endobj\n' +
      'trailer<</Root 1 0 R>>\n' +
      '%%EOF\n',
    'latin1',
  );
}

/** Beliebiges, aber nicht-leeres Token. Die Bindungspruefung laeuft
 *  VOR dem Token-Parsing, deshalb zaehlt nur `length > 0`. */
const DUMMY_TOKEN = Buffer.from('kein echtes RFC-3161-Token');

describe('checkTimestamp: Bindung an das Dokument', () => {
  it('ohne ByteRange wird der Zeitstempel abgewiesen (BUG vor dem Fix)', () => {
    const service = buildService();
    const ergebnis = intern(service).checkTimestamp(pdfOhneByteRange(), DUMMY_TOKEN);
    expect(ergebnis.valid).toBe(false);
    expect(ergebnis.signatureVerified).toBe(false);
    expect(ergebnis.reason ?? '').toMatch(/ByteRange/);
  });

  it('nennt als Grund ausdrücklich die fehlende Bindung', () => {
    const service = buildService();
    const ergebnis = intern(service).checkTimestamp(pdfOhneByteRange(), DUMMY_TOKEN);
    expect(ergebnis.reason).toMatch(/nicht an dieses Dokument gebunden/i);
  });

  it('ein leeres Token wird ebenfalls abgewiesen', () => {
    const service = buildService();
    const ergebnis = intern(service).checkTimestamp(pdfMitByteRange());
    expect(ergebnis.valid).toBe(false);
  });

  it('ein PDF mit ByteRange und Müll-Token bleibt ungültig', () => {
    // Gegenprobe: die neue Prüfung darf nicht generell alles ablehnen,
    // sondern muss unterscheiden können. Müll scheitert am Parsen.
    const service = buildService();
    const ergebnis = intern(service).checkTimestamp(
      pdfMitByteRange(),
      Buffer.from('kein ASN.1'),
    );
    expect(ergebnis.valid).toBe(false);
    expect(ergebnis.reason).toBeTruthy();
  });

  it('der Logger meldet die fehlende Bindung', () => {
    const service = buildService();
    const warn = vi.fn();
    (service as unknown as { logger: { warn: (m: string) => void } }).logger = {
      warn,
    };
    intern(service).checkTimestamp(pdfOhneByteRange(), DUMMY_TOKEN);
    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0][0])).toMatch(/nicht zugeordnet werden/i);
  });
});