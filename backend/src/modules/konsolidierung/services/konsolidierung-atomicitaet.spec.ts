/**
 * Regressionstest: `applyKonsolidierung()` schreibt ATOMAR.
 *
 * Bugfix 2026-10-08. Konzern-Bilanz, Konzern-GuV und der
 * Einheit-Status wurden in DREI unabhaengigen Transaktionen
 * geschrieben. Ein Fehler im letzten Schritt hinterliess eine
 * `VALIDATED`-Konzern-Bilanz OHNE Konzern-GuV — beide sofort
 * markiert, obwohl die Einheit noch nicht `COMPLETED` war.
 *
 * Danach war die Konsolidierung fuer dieses Jahr tot: Der partielle
 * Unique-Index auf `(mandantId, geschaeftsjahr, konzernEinheitId)`
 * verhindert jeden weiteren Versuch, und der Aufrufer bekam „loeschen
 * Sie den vorhandenen Satz", ohne zu wissen welchen.
 *
 * Zwei Ebenen:
 *   1. VERHALTEN — die Repository-Methode nutzt einen uebergebenen
 *      Transaktionsclient tatsaechlich (echte DB, echter Rollback).
 *   2. VERKABELUNG — `apply` ruft beide `createWithPositionen` INNERHALB
 *      einer einzigen `$transaction` auf.
 *
 * Der erste Versuch war ein Stichprobentest mit fünf gestubbten
 * Abhaengigkeiten. Der pruefte am Ende nichts mehr, weil sich die
 * Aufrufkette staendig aenderte und nicht mehr erreichbar war —
 * aehnlich wertlos wie eine Fixture, die den Fehler nicht auftreten
 * laesst.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaService } from '../../../prisma/prisma.service';
import { BilanzRepository } from '../../../common/repositories/bilanz.repository';
import { GuVRepository } from '../../../common/repositories/guv.repository';

const suffix = () => Math.random().toString(36).slice(2, 8);

describe('Konsolidierung: atomares Anwenden', () => {
  let prisma: PrismaService;
  let bilanzRepo: BilanzRepository;
  let guvRepo: GuVRepository;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    bilanzRepo = new BilanzRepository(prisma);
    guvRepo = new GuVRepository(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function mandant(): Promise<string> {
    const kanzlei = await prisma.kanzlei.create({
      data: {
        name: `Atomicitaet ${suffix()}`,
        rechtsform: 'Einzelkanzlei',
        adresse: { strasse: 'Testweg 5', plz: '10999', ort: 'München', land: 'DE' },
      },
    });
    const m = await prisma.mandant.create({
      data: {
        kanzleiId: kanzlei.id,
        firmenname: `Atomicitaet-Mandant ${suffix()}`,
        rechtsform: 'GmbH',
        adresse: { strasse: 'Testweg 5', plz: '10999', ort: 'München', land: 'DE' },
        geschaeftsfuehrer: [
          { name: 'Test', geburtsdatum: '1970-01-01', anteilProzent: 100 },
        ],
        groessenklasse: 'KLEINST',
        publishChannel: 'Bundesanzeiger',
      },
    });
    return m.id;
  }

  it('Rollt zurueck, wenn spaeter in derselben Transaktion etwas scheitert', async () => {
    const mandantId = await mandant();
    const einheit = await prisma.konsolidierungsEinheit.create({
      data: {
        kanzleiId: (await prisma.mandant.findUniqueOrThrow({ where: { id: mandantId } }))
          .kanzleiId,
        mutterMandantId: mandantId,
        tochterMandantIds: [],
        geschaeftsjahr: 2096,
        konsolidierungsArt: 'VOLLKONSOLIDIERUNG',
        beteiligungsquote: '100',
        anschaffungskosten: '0',
        eigenkapitalTochter: '0',
        jahresueberschussTochter: '0',
      },
    });

    await expect(
      prisma.$transaction(async (tx) => {
        // Beide Schreibvorgaenge laufen INNERHALB der Transaktion —
        // genau das ist der Fix.
        await bilanzRepo.createWithPositionen(
          {
            mandantId,
            geschaeftsjahr: 2096,
            status: 'VALIDATED',
            konzernEinheitId: einheit.id,
            hinweise: 'Konzern-Bilanz',
            positionen: [
              {
                seite: 'AKTIVA',
                kontonummer: 'A.II.1.',
                bezeichnung: 'Gebaeude',
                betragVorjahr: null,
                betragAktuell: 100000,
                reihenfolge: 1,
              },
            ],
          },
          tx,
        );
        await guvRepo.createWithPositionen(
          {
            mandantId,
            geschaeftsjahr: 2096,
            status: 'VALIDATED',
            konzernEinheitId: einheit.id,
            hinweise: 'Konzern-GuV',
            positionen: [],
          },
          tx,
        );
        // Der dritte Schritt scheitert.
        await tx.konsolidierungsEinheit.update({
          where: { id: 'ffffffff-0000-4000-8000-000000000000' },
          data: { status: 'COMPLETED' },
        });
      }),
    ).rejects.toBeTruthy();

    // Nichts darf uebrig sein — weder Bilanz noch GuV.
    const bilanzen = await prisma.bilanz.findMany({
      where: { konzernEinheitId: einheit.id },
    });
    const guvs = await prisma.guV.findMany({ where: { konzernEinheitId: einheit.id } });
    expect(
      bilanzen.length,
      `nach dem Fehlschlag darf kein Konzernsatz zurueckbleiben — gefunden: ${bilanzen.length}`,
    ).toBe(0);
    expect(guvs.length, 'ebenso keine Konzern-GuV').toBe(0);
  });

  it('OHNE uebergebenen Client wird eine eigene Transaktion geoeffnet', async () => {
    // Der Aufrufer darf nicht gezwungen werden, eine Transaktion zu
    // liefern — ohne Argument muss es nach wie vor funktionieren.
    const mandantId = await mandant();
    const satz = await bilanzRepo.createWithPositionen({
      mandantId,
      geschaeftsjahr: 2095,
      status: 'DRAFT',
      positionen: [
        {
          seite: 'AKTIVA',
          kontonummer: 'A.II.1.',
          bezeichnung: 'Gebaeude',
          betragVorjahr: null,
          betragAktuell: 50000,
          reihenfolge: 1,
        },
      ],
    });
    expect(satz.id).toBeTruthy();
    const positionen = await prisma.bilanzPosition.count({
      where: { bilanzId: satz.id },
    });
    expect(positionen, 'Positionen muessen mitgeschrieben sein').toBe(1);
  });

  it('VERKABELUNG: apply() nutzt eine Transaktion fuer beide Saetze', () => {
    // Strukturelle Absicherung. Das Verhalten ist oben echt geprueft;
    // hier steht nur, dass `apply` die beiden `createWithPositionen`
    // INNERHALB von `$transaction` aufruft und den Client uebergibt.
    //
    // Bewusst strukturell und nicht ueber Stubs: `applyKonsolidierung`
    // hat fuenf Abhaengigkeiten und rund ein Dutzend Aufrufe. Ein
    // Stichprobentest davon prueft staendig Code, den es nicht mehr
    // gibt — und scheitert dann an einem Wegwerf-Fehler statt an der
    // Eigenschaft, die eigentlich bewiesen werden soll.
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    const { join } = require('node:path') as typeof import('node:path');
    const code = readFileSync(
      join(process.cwd(), 'src/modules/konsolidierung/services/konsolidierung.service.ts'),
      'utf-8',
    );

    const start = code.indexOf('const ergebnis = await this.prisma.$transaction(');
    expect(start, 'apply muss eine gemeinsame Transaktion oeffnen').toBeGreaterThan(-1);
    const block = code.slice(start, code.indexOf('const { konzernBilanz, konzernGuv } = ergebnis;', start));

    // Beide Erstellungen liegen im Block …
    expect(block).toContain('this.bilanzRepository.createWithPositionen(');
    expect(block).toContain('this.guvRepository.createWithPositionen(');
    // … und bekommen den Client der Transaktion uebergeben.
    const bilanzAufruf = block.slice(
      block.indexOf('this.bilanzRepository.createWithPositionen('),
      block.indexOf('this.guvRepository.createWithPositionen('),
    );
    expect(bilanzAufruf).toMatch(/\},\s*tx,\s*\)/);
    expect(block).toMatch(/\},\s*tx,\s*\)/);
    // Der Einheit-Status wird IN der Transaktion gesetzt, nicht danach.
    expect(block).toContain('tx.konsolidierungsEinheit.update(');
    expect(block).toContain("status: 'COMPLETED'");
  });
});