/**
 * Regressionstest: XBRL-Dokument muss Namespace-Praefixe binden.
 *
 * Bugfix 2026-10-06. `buildXbrlXml()` schrieb `xlink:type` und
 * `xlink:href` in `link:schemaRef`, deklarierte `xmlns:xlink` aber
 * nicht. Ergebnis: das Dokument war namespace-invalid.
 *
 * Belege VOR dem Fix (gegen die echte API-Antwort der Demo GmbH):
 *   - Python `xml.etree.ElementTree`: `ParseError: unbound prefix: line 1`
 *   - `xmllint`: `namespace prefix xlink for href on schemaRef is not defined`
 *
 * `XbrlValidatorService` meldete die Datei trotzdem als gueltig:
 * `XMLValidator` aus fast-xml-parser prueft die Wohlgeformtheit OHNE
 * Namespace-Aufloesung. Genau diese Luecke wird hier geschlossen —
 * ein Test allein gegen die Generator-Ausgabe haette den Validator-
 * Defekt nicht gefunden.
 */

import { describe, it, expect, vi } from 'vitest';
import { XMLValidator } from 'fast-xml-parser';
import { XbrlGeneratorService } from './xbrl-generator.service';
import { XbrlValidatorService } from './xbrl-validator.service';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { BilanzRepository } from '../../../common/repositories/bilanz.repository';
import type { GuVRepository } from '../../../common/repositories/guv.repository';
import type { AnhangRepository } from '../../../common/repositories/anhang.repository';
import type { AuditService } from '../../audit/services/audit.service';

const MANDANT_ID = 'aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa';

function buildService(): XbrlGeneratorService {
  const prisma = {
    mandant: {
      findUnique: vi.fn().mockResolvedValue({
        id: MANDANT_ID,
        firmenname: 'Test GmbH',
        rechtsform: 'GmbH',
        handelsregister: 'HRB 1',
        steuernummer: '12/345/67890',
      }),
    },
  } as unknown as PrismaService;

  const bilanz = {
    id: 'b'.repeat(8) + '-2222-4222-8222-222222222222',
    geschaeftsjahr: 2025,
    positionen: [
      { seite: 'AKTIVA', kontonummer: 'A.', bezeichnung: 'Aktiva', betragAktuell: '100000.00' },
      { seite: 'PASSIVA', kontonummer: 'P.', bezeichnung: 'Passiva', betragAktuell: '100000.00' },
    ],
  };
  const guv = {
    id: 'c'.repeat(8) + '-2222-4222-8222-222222222222',
    geschaeftsjahr: 2025,
    verfahren: 'GKV',
    ergebnis: '0.00',
    positionen: [],
  };
  const anhang = {
    id: 'd'.repeat(8) + '-2222-4222-8222-222222222222',
    geschaeftsjahr: 2025,
    bilanzierungsMethoden: 'Nach HGB.',
    bewertungsMethoden: 'Niedrigster Wert.',
    sonstigePflichtangaben: 'Mitarbeiter: 3.',
    abschnitte: [],
  };

  return new XbrlGeneratorService(
    prisma,
    { findWithPositionen: vi.fn().mockResolvedValue(bilanz) } as unknown as BilanzRepository,
    { findWithPositionen: vi.fn().mockResolvedValue(guv) } as unknown as GuVRepository,
    { findWithAbschnitte: vi.fn().mockResolvedValue(anhang) } as unknown as AnhangRepository,
    { record: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService,
  );
}

async function generateXml(): Promise<string> {
  const result = await buildService().generateEbilanzXbrl(
    {
      bilanzId: 'b'.repeat(8) + '-2222-4222-8222-222222222222',
      guvId: 'c'.repeat(8) + '-2222-4222-8222-222222222222',
      anhangId: 'd'.repeat(8) + '-2222-4222-8222-222222222222',
      mandantId: MANDANT_ID,
    },
    {
      id: 'e'.repeat(8) + '-2222-4222-8222-222222222222',
      globalRole: null,
      mandanten: [{ id: MANDANT_ID, firmenname: 'Test GmbH', rolle: 'STEUERBERATER' }],
    } as never,
    {},
  );
  return Buffer.from(result.xbrlBase64, 'base64').toString('utf-8');
}

describe('XBRL-Namespace-Bindung', () => {
  it('Generator deklariert xmlns:xlink', async () => {
    const xml = await generateXml();
    expect(xml).toMatch(/xmlns:xlink\s*=\s*"http:\/\/www\.w3\.org\/1999\/xlink"/);
  });

  it('jedes verwendete Präfix ist im Wurzelelement gebunden', async () => {
    const xml = await generateXml();
    // Achtung: `indexOf('>')` trifft die XML-Deklaration
    // (`<?xml … ?>`), NICHT das Wurzelelement. Das Wurzelelement beginnt
    // nach dem `?>`.
    const wurzelStart = xml.indexOf('?>') + 2;
    const wurzel = xml.slice(wurzelStart, xml.indexOf('>', wurzelStart));
    const gebunden = new Set(
      [...wurzel.matchAll(/xmlns:([A-Za-z_][\w.-]*)\s*=/g)].map((m) => m[1]),
    );
    const verwendet = new Set(
      [
        ...[...xml.matchAll(/<([A-Za-z_][\w.:-]*)/g)].map((m) => m[1]),
        ...[...xml.matchAll(/\s([A-Za-z_][\w.-]*):[\w.-]+\s*=\s*"/g)].map((m) => m[1]),
      ]
        .map((n) => /^([A-Za-z_][\w.-]*):/.exec(n)?.[1])
        .filter((p): p is string => !!p),
    );

    expect(verwendet.size).toBeGreaterThan(0);
    expect([...verwendet].filter((p) => !gebunden.has(p))).toEqual([]);
  });

  it('Validator meldet eine ungebundene Präfixverwendung als Fehler', async () => {
    const validator = new XbrlValidatorService();
    const xml = await generateXml();

    // Der Originalzustand: `xmlns:xlink` entfernt, Verwendung bleibt.
    const kaputt = xml.replace(
      /\s*xmlns:xlink="http:\/\/www\.w3\.org\/1999\/xlink"/,
      '',
    );
    expect(kaputt).not.toBe(xml);
    expect(kaputt).toContain('xlink:href');

    // fast-xml-parser haelt das fuer wohlgeformt — sonst waere die
    // Fehlerklasse gar nicht erreichbar.
    expect(XMLValidator.validate(kaputt)).toBe(true);

    const ergebnis = await validator.validateXbrl(kaputt);
    expect(ergebnis.valid).toBe(false);
    expect(
      ergebnis.errors.some((e) => e.code === 'UNBOUND_NAMESPACE_PREFIX'),
      `Errors: ${JSON.stringify(ergebnis.errors)}`,
    ).toBe(true);
  });

  it('Validator akzeptiert das reparierte Dokument', async () => {
    const validator = new XbrlValidatorService();
    const ergebnis = await validator.validateXbrl(await generateXml());
    expect(ergebnis.errors.filter((e) => e.code === 'UNBOUND_NAMESPACE_PREFIX')).toEqual([]);
  });

  it('erkennt auch ungebundene Element-Präfixe, nicht nur xlink', async () => {
    const validator = new XbrlValidatorService();
    // Ein eigenes Element einfuegen statt ein vorhandenes umzubenennen:
    // ein nur einseitig umbenanntes Tag macht das XML un-wohlgeformt,
    // und der Validator steigt dann schon in Schritt 1 aus — der
    // Namespace-Check wuerde nie erreicht.
    const kaputt = (await generateXml()).replace(
      '</xbrli:xbrl>',
      '<zz:unbekannt>x</zz:unbekannt></xbrli:xbrl>',
    );
    const ergebnis = await validator.validateXbrl(kaputt);
    expect(
      ergebnis.errors.some(
        (e) =>
          e.code === 'UNBOUND_NAMESPACE_PREFIX' && e.message.includes('zz'),
      ),
      `Errors: ${JSON.stringify(ergebnis.errors)}`,
    ).toBe(true);
  });
});
