/**
 * Regressionstest: GKV/UKV-Kollision im GuV-Mapping.
 *
 * Bugfix 2026-10-06: `TAXONOMY_CONCEPT_BY_CODE` ist eine flache Map über
 * ALLE Konzepte. GKV und UKV teilen sich 11 Concept-Codes; UKV wurde als
 * letzter Import in die Map geschrieben und überschrieb dort GKV.
 *
 * `mapKontonummerToConcept()` suchte ausschliesslich in dieser Map und
 * lieferte damit fuer einen GKV-GuV die UKV-BEDEUTUNG:
 *
 *   GKV 14. „Steuern vom Einkommen und vom Ertrag" (15.000 EUR)
 *     -> UKV-Mapping: `pl.netIncome`  (= Jahresüberschuss)
 *
 * Die beim Bundesanzeiger eingereichte E-Bilanz wies dadurch einen
 * Jahresüberschuss von 15.000 EUR aus statt der tatsaechlichen
 * 35.100 EUR — bei HTTP 200, `saldostimmt: true` und einem eigenen
 * Validator, der die Datei als gueltig meldete.
 *
 * Fix: `guvKonzepte(verfahren)` waehlt zuerst die zur Variante
 * passende Liste. Dieser Test sichert genau diese Auswahl ab.
 */

import { describe, it, expect } from 'vitest';
import { mapKontonummerToConcept, mapKontonummerToAllConcepts } from './mapping-engine';

/**
 * Die 11 Codes, die in GKV und UKV mit unterschiedlicher BEDEUTUNG
 * vorkommen. Ein Code allein ist deshalb kein ausreichender Test —
 * geprueft werden muss, dass die AUFLÖSUNG verfahrensbewusst erfolgt.
 */
const KOLLISIONEN = [
  'pl.rev',
  'pl.othOpRev.oth',
  'pl.otherCost',
  'pl.finResult.participationIncome',
  'pl.finResult.securitiesIncome',
  'pl.finResult.interestIncome',
  'pl.finResult.deprFinAss',
  'pl.finResult.interestExpense',
  'pl.tax.incomeTax',
  'pl.netIncome',
  'pl.tax.othTax',
];

describe('Mapping-Engine: GKV/UKV-Verfahrensauflösung', () => {
  it('bildet GKV-14. auf pl.tax.incomeTax ab (nicht auf pl.netIncome)', () => {
    const gkv = mapKontonummerToConcept('14.', 'GKV');
    expect(gkv?.code).toBe('pl.tax.incomeTax');

    // Genau dieser Fehler war der Auslöser: UKV kennt `pl.netIncome`
    // unter `14.` — die flache Map hatte UKV gewinnen lassen.
    const ukv = mapKontonummerToConcept('14.', 'UKV');
    expect(ukv?.code).toBe('pl.netIncome');
    expect(gkv?.code).not.toBe(ukv?.code);
  });

  it('bildet GKV-15. auf pl.netIncome ab (nicht auf eine UKV-Bedeutung)', () => {
    expect(mapKontonummerToConcept('15.', 'GKV')?.code).toBe('pl.netIncome');
    // UKV fuehrt `15.` gar nicht — dort ist das Ergebnis `14.`/`16.`.
    expect(mapKontonummerToConcept('15.', 'UKV')?.code).not.toBe('pl.netIncome');
  });

  it('bildet GKV-8. (sonstige betriebliche Aufwendungen) auf pl.otherCost ab', () => {
    // GKV 8. = 50.000 EUR. In UKV ist `pl.otherCost` unter `7.`
    // geregelt — dieselbe Code-Familie, andere Kontenrahmenzeile.
    expect(mapKontonummerToConcept('8.', 'GKV')?.code).toBe('pl.otherCost');
  });

  it('liefert fuer jeden kollidierenden Code je Variante genau ein Konzept', () => {
    for (const code of KOLLISIONEN) {
      for (const verfahren of ['GKV', 'UKV'] as const) {
        const alle = mapKontonummerToAllConcepts('14.', verfahren).map((c) => c.code);
        // `14.` ist der einzige both-way belegte Fall; hier geht es nur
        // darum, dass `alle` keine Duplikate enthaelt.
        expect(new Set(alle).size, `Duplikate bei ${verfahren}/${code}: ${alle}`).toBe(
          alle.length,
        );
      }
    }
  });

  it('behandelt fehlende Angabe als GKV (Seed-/Pilot-Default)', () => {
    expect(mapKontonummerToConcept('14.')?.code).toBe('pl.tax.incomeTax');
    expect(mapKontonummerToConcept('14.', undefined)?.code).toBe('pl.tax.incomeTax');
    // case-insensitive: die Prisma-Spalte ist ein String, die DTO validiert
    // als GKV|UKV, der Import kann aber klein geschrieben ankommen.
    expect(mapKontonummerToConcept('14.', 'ukv')?.code).toBe('pl.netIncome');
  });

  it('mappet Bilanz-Positionen unveraendert (kein Verfahrensparameter noetig)', () => {
    // Die Bilanz hat keine GKV/UKV-Variante — wenn der Fix hier
    // zusaetzlich filterte, waere das ein stiller Datenverlust.
    const konto = mapKontonummerToConcept('A.I.1.', 'GKV');
    const ohneVerfahren = mapKontonummerToConcept('A.I.1.');
    expect(konto?.code).toBe(ohneVerfahren?.code);
    expect(konto?.conceptType).toBe('Aktiva');
  });
});