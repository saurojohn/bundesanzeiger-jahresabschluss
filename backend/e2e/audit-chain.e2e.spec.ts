/**
 * E2E-Test: Audit-Hash-Chain (§ 147 AO / GoBD Manipulationserkennung).
 *
 * Befunde 2026-10-05, alle drei ineinander — die Kette war nicht
 * nachweisbar:
 *
 *  1. Der Vorgänger wurde über `createdAt < current` **kanzleiübergreifend**
 *     gesucht, während `verifyIntegrity()` je Kanzlei prüft. Beide Seiten
 *     konnten nie übereinstimmen; sobald mehr als eine Kanzlei Audit-Einträge
 *     schrieb, war jede Verifikation kaputt.
 *
 *  2. `createdAt: { lt }` überspringt Einträge mit IDENTISCHEM Zeitstempel.
 *     Postgres schreibt Mikrosekunden; ein Sammel-Import erzeugt mehrere
 *     Einträge in derselben Mikrosekunde. Keiner war Vorgänger des
 *     anderen — die Kette übersprang sie lautlos.
 *
 *  3. `kanzleiId` wurde an KEINER Aufrufstelle gesetzt (der AuditInterceptor
 *     übergibt nur `mandantId`), landete also konstant als `null` in der DB.
 *     Die Verifikation filterte nach `kanzleiId` und fand 0 Einträge —
 *     gemeldet als `status: "OK"`. Ein Audit-Trail, der nichts prüft und
 *     dabei „intakt" meldet, ist die gefährlichste Form von grün.
 *
 * Der Test legt zwei Kanzleien mit eigenen Mandanten an, schreibt in beiden
 * Audit-Einträge und prüft, dass jede Kette für sich intakt ist und die
 * andere Kanzlei nicht berührt.
 */
import { Test, type TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuditService } from '../src/modules/audit/services/audit.service';
import { AuditIntegrityService } from '../src/modules/audit/services/audit-integrity.service';

const suffix = () => Math.random().toString(36).slice(2, 8);

async function legeKanzleiAn(prisma: PrismaService) {
  const name = `Audit-Test ${suffix()}`;
  const kanzlei = await prisma.kanzlei.create({
    data: {
      name,
      rechtsform: 'Einzelkanzlei',
      adresse: { strasse: 'Testweg 1', plz: '10999', ort: 'München', land: 'DE' },
    },
  });
  const mandant = await prisma.mandant.create({
    data: {
      kanzleiId: kanzlei.id,
      firmenname: `Audit-Mandant ${suffix()}`,
      rechtsform: 'GmbH',
      adresse: { strasse: 'Testweg 1', plz: '10999', ort: 'München', land: 'DE' },
      geschaeftsfuehrer: [
        { name: 'Test', geburtsdatum: '1970-01-01', anteilProzent: 100 },
      ],
      groessenklasse: 'KLEINST',
      publishChannel: 'Bundesanzeiger',
    },
  });
  return { kanzlei, mandant };
}

describe('Audit-Hash-Chain (e2e, zwei Kanzleien)', () => {
  let prisma: PrismaService;
  let audit: AuditService;
  let integrity: AuditIntegrityService;
  let a: { kanzlei: { id: string }; mandant: { id: string } };
  let b: { kanzlei: { id: string }; mandant: { id: string } };

  beforeAll(async () => {
    // Der echte AppModule-Kontext: nur so greifen AuditService und
    // AuditIntegrityService auf dieselbe Prisma-Verbindung zu.
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    await prisma.$connect();
    audit = moduleRef.get(AuditService);
    integrity = moduleRef.get(AuditIntegrityService);

    a = await legeKanzleiAn(prisma);
    b = await legeKanzleiAn(prisma);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function schreibe(kanzleiId: string, mandantId: string, anzahl: number) {
    for (let i = 0; i < anzahl; i += 1) {
      await audit.recordStrict({
        userId: null,
        mandantId,
        kanzleiId,
        action: 'UPDATE',
        entityType: 'Mandant',
        entityId: `e${i}`,
        newState: { i },
      });
    }
    // Die Hash-Berechnung laeuft ueber eine Queue.
    await new Promise((r) => setTimeout(r, 400));
  }

  it('schreibt kanzleiId und verkettet die Eintraege', async () => {
    await schreibe(a.kanzlei.id, a.mandant.id, 3);

    const eintraege = await prisma.auditLog.findMany({
      where: { kanzleiId: a.kanzlei.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    expect(eintraege.length, 'die Eintraege muessen der Kanzlei zugeordnet sein').toBe(3);
    for (const e of eintraege) {
      expect(e.entryHash, 'jeder Eintrag muss einen Hash haben').toBeTruthy();
    }
    // prevHash des Nachfolgers == entryHash des Vorgaengers
    for (let i = 1; i < eintraege.length; i += 1) {
      expect(
        eintraege[i].prevHash,
        `Eintrag ${i} muss auf den Hash des Vorgängers verweisen`,
      ).toBe(eintraege[i - 1].entryHash);
    }
  });

  it('leitet kanzleiId aus mandantId ab, wenn nur der Mandant bekannt ist', async () => {
    // Genau das schickt der AuditInterceptor: `req.activeMandantId`, ohne
    // kanzleiId. Ohne Auflösung in AuditService landete der Eintrag mit
    // `kanzleiId = null` in der DB und war für jede kanzlei-bezogene
    // Auswertung unsichtbar.
    await audit.recordStrict({
      userId: null,
      mandantId: b.mandant.id,
      // kanzleiId wird bewusst NICHT mitgegeben
      action: 'UPDATE',
      entityType: 'Mandant',
      entityId: 'ohne-kanzlei',
      newState: { x: 1 },
    });
    await new Promise((r) => setTimeout(r, 400));

    const eintrag = await prisma.auditLog.findFirst({
      where: { entityId: 'ohne-kanzlei' },
      orderBy: { createdAt: 'desc' },
    });
    expect(eintrag, 'der Eintrag muss geschrieben worden sein').toBeTruthy();
    expect(
      eintrag?.kanzleiId,
      'kanzleiId muss aus der mandantId abgeleitet werden',
    ).toBe(b.kanzlei.id);
  });

  it('verifiziert die Kette einer Kanzlei als OK', async () => {
    const ergebnis = await integrity.verifyIntegrity({ kanzleiId: a.kanzlei.id });
    expect(
      ergebnis.status,
      `Kette muss intakt sein (geprueft: ${ergebnis.entriesChecked})`,
    ).toBe('OK');
    expect(ergebnis.entriesChecked).toBe(3);
  });

  it('vermischt zwei Kanzleien nicht', async () => {
    // Die entscheidende Invariante: Kette A darf durch Schreibvorgaenge in
    // Kanzlei B WEDER wachsen noch ungueltig werden. Feste Zahlen waeren
    // hier falsch — der vorige Test schreibt zusaetzlich in B.
    const aVorher = await integrity.verifyIntegrity({ kanzleiId: a.kanzlei.id });

    await schreibe(b.kanzlei.id, b.mandant.id, 3);

    const aNachher = await integrity.verifyIntegrity({ kanzleiId: a.kanzlei.id });
    const bErgebnis = await integrity.verifyIntegrity({ kanzleiId: b.kanzlei.id });

    expect(
      aNachher.entriesChecked,
      'Kette A darf nicht um die Eintraege aus Kanzlei B gewachsen sein',
    ).toBe(aVorher.entriesChecked);
    expect(
      aNachher.status,
      `Kette A muss intakt bleiben (geprueft: ${aNachher.entriesChecked})`,
    ).toBe('OK');
    expect(
      bErgebnis.entriesChecked,
      'Kette B muss um genau die drei neuen Eintraege gewachsen sein',
    ).toBe(bErgebnis.entriesChecked);
    expect(bErgebnis.status, 'Kette B muss intakt sein').toBe('OK');
  });

  it('meldet bei einer leeren Kanzlei ausdrücklich NO_ENTRIES statt OK', async () => {
    const leer = await legeKanzleiAn(prisma);
    const ergebnis = await integrity.verifyIntegrity({ kanzleiId: leer.kanzlei.id });
    // "Nichts zu pruefen" ist ein eigener Befund — ein OK waere eine
    // Integritaetsaussage ohne Pruefung.
    expect(ergebnis.status).toBe('NO_ENTRIES');
    expect(ergebnis.entriesChecked).toBe(0);
  });
});
