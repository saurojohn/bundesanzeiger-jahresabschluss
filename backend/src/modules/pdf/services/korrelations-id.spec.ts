import { describe, it, expect } from 'vitest';
import { PdfService } from './pdf.service';

/**
 * BEFUND 2026-10-11 — Die Footer-Korrelations-ID war je Mandant konstant.
 *
 * `buildKorrelationsId` nahm die ERSTEN 16 Zeichen des bereinigten
 * WORM-Objektschlüssels. Bei
 *
 *   mandant/<uuid>/<typ>/<jahr>/<uuid4>.pdf
 *
 * sind das "mandant" + die ersten 9 Zeichen der Mandanten-UUID — der
 * eindeutige uuid4-Anteil am Ende wurde abgeschnitten.
 *
 * Gemessen: Bilanz 2025, Bilanz 2026, GuV 2025 und Abschluss 2025
 * desselben Mandanten ergaben ALLE `mandant9e69d380c`. Der Footer
 * behauptete damit für vier verschiedene WORM-Objekte dieselbe Zuordnung.
 *
 * Der Aufrufkommentar nennt den Zweck ausdrücklich: "eine
 * Korrelations-ID auf den WORM-Eintrag — sie ist VOR dem Rendern
 * bekannt". Der Zweck war verfehlt; behoben.
 */

const MANDANT = '9e69d380-cd51-4359-a0f4-40ba1e4bc0e3';

const KEY = (typ: string, jahr: number, uuid: string) =>
  `mandant/${MANDANT}/${typ}/${jahr}/${uuid}.pdf`;

function intern() {
  // Der Konstruktor wird nicht gebraucht: die Methode ist stateless.
  const service = Object.create(PdfService.prototype) as PdfService;
  return service as unknown as { buildKorrelationsId: (k: string) => string };
}

describe('BEFUND 2026-10-11: Korrelations-ID unterscheidet Dokumente', () => {
  const fn = intern().buildKorrelationsId;

  it('vier Dokumente eines Mandanten erhalten vier verschiedene IDs', () => {
    const ids = [
      fn(KEY('bilanz', 2025, '11111111-1111-4111-8111-111111111111')),
      fn(KEY('bilanz', 2026, '22222222-2222-4222-8222-222222222222')),
      fn(KEY('guv', 2025, '33333333-3333-4333-8333-333333333333')),
      fn(KEY('abschluss', 2025, '44444444-4444-4444-8444-444444444444')),
    ];
    expect(new Set(ids).size, `IDs waren: ${ids.join(', ')}`).toBe(4);
  });

  it('dokumenttyp und Geschäftsjahr beeinflussen die ID nicht — die uuid schon', () => {
    // Der uuid-Anteil ist der einzige Unterschied zwischen zwei gleich
    // typisierten Dokumenten desselben Jahres. Genau er muss durchschlagen.
    const a = fn(KEY('bilanz', 2025, 'aaaaaaaa-1111-4111-8111-111111111111'));
    const b = fn(KEY('bilanz', 2025, 'bbbbbbbb-2222-4222-8222-222222222222'));
    expect(a).not.toBe(b);
  });

  it('das Format bleibt 16 alphanumerische Zeichen', () => {
    expect(fn(KEY('bilanz', 2025, '11111111-1111-4111-8111-111111111111'))).toMatch(
      /^[A-Za-z0-9]{16}$/,
    );
  });

  it('kurze Eingaben crashen nicht und liefern 16 Zeichen', () => {
    expect(fn('x')).toMatch(/^[A-Za-z0-9]{16}$/);
    expect(fn('wurm/jahresabschluss/2025/bilanz.pdf')).toMatch(/^[A-Za-z0-9]{16}$/);
  });

  it('die ID steht im Schlüssel — sie ist nachprüfbar, nicht geraten', () => {
    // Nachvollziehbarkeit heißt: wer den WORM-Schlüssel hat, kann die ID
    // nachrechnen. Deshalb ist es der Schlüssel-Anteil und kein Hash.
    const key = KEY('bilanz', 2025, '11111111-1111-4111-8111-111111111111');
    const erwartet = key.replace(/[^A-Za-z0-9]/g, '').slice(-16);
    expect(fn(key)).toBe(erwartet);
  });
});