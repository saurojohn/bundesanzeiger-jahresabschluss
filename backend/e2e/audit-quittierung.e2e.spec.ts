import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuditService } from '../src/modules/audit/services/audit.service';
import { MandantService } from '../src/modules/mandant/services/mandant.service';
import type { AuthUser } from '../src/modules/auth/types/auth-user.types';
import type { CreateMandantDto } from '../src/modules/mandant/dto/create-mandant.dto';

/**
 * Audit-Trail: Die Quittierung darf nicht vor dem Nachweis erfolgen.
 *
 * BEFUND 2026-10-19 (Nachtrag 56, TODO-8.8): Alle 51 Aufrufstellen von
 * `auditService.record()` standen auf `void` — der Audit-Eintrag wurde
 * **nach** der HTTP-Antwort geschrieben, und die Hash-Kette lief noch
 * weiter hinten nach.
 *
 * Gemessen ueber die oeffentliche API, 20 Mandanten-Anlagen in Folge. Unmittelbar
 * nach dem Eintreffen der 201-Antwort nachgeschaut:
 *
 *     Audit-Eintrag fehlt vollstaendig      : 80 %
 *     Eintrag vorhanden, aber noch ungehasht  : 15 %
 *     vollstaendig (Eintrag + Hash)          :  5 %
 *
 * Das ist keine theoretische Sorge: die Aktion war quittiert, der
 * Nachweis (§ 146 AO) existierte noch nicht. Ein Prozessabbruch in diesem
 * Fenster verliert den Eintrag endgueltig.
 *
 * ## Der erste Test ist die Negativprobe — und sie ist deterministisch.
 *
 * Ein Test, der misst, ob der Eintrag "irgendwann" da ist, waere ein
 * Wettlauf: ohne den Fix waere er zu etwa 80 % rot, mit dem Fix immer
 * gruen. Ein solcher Test ist als Regressionsschutz brauchbar, als
 * Nachweis aber schwach — und ein Test, der nur manchmal rot wird, wird
 * irgendwann als "flaky" abgetan und stillschweigend entschaerft.
 *
 * Deshalb wird die **Reihenfolge** gemessen, nicht das Zeitfenster: der
 * Audit-Write wird in einer Sperre angehalten, und geprüft wird, ob die
 * Fachmethode **darauf wartet**. Das ist eine Eigenschaft des Codes, keine
 * Frage des Timings:
 *
 *   - mit dem Fix  : die Fachmethode kehrt nicht zurück  -> gruen
 *   - ohne den Fix : die Fachmethode kehrt sofort zurück  -> rot
 *
 * (Zur Erinnerung aus Nachtrag 54: "Wer eine Funktion zum Vergleich
 * nachbaut, misst die Nachbildung." Der Test ruft die echte
 * `MandantService.create()` auf; ersetzt wird nur der Audit-Schritt, und
 * nur durch eine Sperre, die nichts an der Reihenfolge aendert.)
 */

/** Eine nuetzliche Seite Abstand, damit ein laufender Promise-Tick Zeit hat. */
const WARTEZEIT_MS = 150;

function dto(firmenname: string): CreateMandantDto {
  return {
    firmenname,
    rechtsform: 'GmbH',
    adresse: { strasse: 'Quittierweg 1', plz: '10999', ort: 'Muenchen', land: 'DE' },
    geschaeftsfuehrer: [{ name: 'Test', geburtsdatum: '1970-01-01', anteilProzent: 100 }],
    groessenklasse: 'KLEINST',
    publishChannel: 'PDF_DIRECT',
  } as CreateMandantDto;
}

describe('Audit-Trail: Quittierung erst nach dem Nachweis', () => {
  let prisma: PrismaService;
  let audit: AuditService;
  let mandantService: MandantService;
  let user: AuthUser;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    await prisma.$connect();
    audit = moduleRef.get(AuditService);
    mandantService = moduleRef.get(MandantService);

    const admin = await prisma.user.findFirst({ where: { globalRole: 'SYSTEM_ADMIN' } });
    expect(admin, 'der Seed muss einen SYSTEM_ADMIN anlegen').toBeTruthy();
    user = {
      id: admin!.id,
      email: admin!.email,
      vorname: admin!.vorname,
      nachname: admin!.nachname,
      globalRole: 'SYSTEM_ADMIN',
      mandanten: [],
    };
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('kehrt nicht zurueck, bevor der Audit-Eintrag geschrieben ist', async () => {
    const original = audit.record.bind(audit);

    let freigeben!: () => void;
    const sperre = new Promise<void>((resolve) => {
      freigeben = resolve;
    });
    let schreibenBeginnt!: () => void;
    const begonnen = new Promise<void>((resolve) => {
      schreibenBeginnt = resolve;
    });

    const spy = vi.spyOn(audit, 'record').mockImplementation(async (params) => {
      schreibenBeginnt();
      await sperre;
      return original(params);
    });

    try {
      const firmenname = `Quittierung-${Date.now()}`;
      let zurueckgekehrt = false;

      const lauf = mandantService
        .create(dto(firmenname), user, {})
        .then((m) => {
          zurueckgekehrt = true;
          return m;
        });

      // Warten, bis der Audit-Schritt erreicht ist. Ab hier ist der
      // Fachvorgang geschrieben, der Nachweis fehlt aber noch.
      await begonnen;

      const mandant = await prisma.mandant.findFirst({ where: { firmenname } });
      expect(
        mandant,
        'der Mandant muss bereits geschrieben sein — sonst prueft der Test nichts',
      ).toBeTruthy();

      await new Promise((resolve) => setTimeout(resolve, WARTEZEIT_MS));

      expect(
        zurueckgekehrt,
        'die Fachmethode ist zurueckgekehrt, obwohl der Audit-Eintrag noch fehlt. ' +
          'Die Aktion wird quittiert, bevor sie nachvollziehbar ist — fuer die ' +
          'Nachvollziehbarkeit nach § 146 AO ist das ein Loch, kein Timing-Problem.',
      ).toBe(false);

      // Sperre loesen: jetzt darf der Audit-Eintrag geschrieben werden.
      freigeben();
      const ergebnis = await lauf;

      const eintraege = await prisma.auditLog.findMany({
        where: { entityId: ergebnis.id },
        select: { id: true, entryHash: true, action: true, entityType: true },
      });
      expect(eintraege.length, 'der Audit-Eintrag muss nach der Quittierung existieren')
        .toBeGreaterThan(0);
      // `toBeTypeOf` statt direkt `toMatch`: ein `null` (kein Hash gesetzt)
      // ist in JavaScript `typeof 'object'` — `toMatch` meldet dann
      // "expects to receive a string, but got object" und der Leser muss
      // erst selbst herausfinden, dass `null` gemeint war.
      expect(
        eintraege[0]!.entryHash,
        'der Audit-Eintrag muss einen Hash haben — sonst meldet die ' +
          'Integritaetspruefung PARTIAL und sieht wie ein Schaden aus',
      ).toBeTypeOf('string');
      expect(eintraege[0]!.entryHash).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      freigeben();
      spy.mockRestore();
    }
  });

  it('der Audit-Eintrag existiert ueber die oeffentliche API, sobald die Antwort da ist', async () => {
    // Schwarzbox ueber die laufende Instanz. Das ist der Weg, den ein
    // Anwender geht — und der Weg, an dem der Befund zuerst sichtbar war.
    const login = await fetch('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'kanzlei-admin@kanzlei.de', password: 'Demo123!' }),
    });
    expect(login.status, 'Login muss gelingen').toBe(200);
    const token = ((await login.json()) as { accessToken: string }).accessToken;

    const firmenname = `Quittierung-API-${Date.now()}`;
    const anlegen = await fetch('http://localhost:3000/api/mandant', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(dto(firmenname)),
    });
    expect(anlegen.status, 'Anlegen muss gelingen').toBe(201);
    const mandant = (await anlegen.json()) as { id: string };

    // Unmittelbar nach der Antwort — genau hier fehlte der Eintrag in 80 %
    // der Messungen.
    const eintraege = await prisma.auditLog.findMany({
      where: { entityId: mandant.id },
      select: { id: true, entryHash: true },
    });
    expect(
      eintraege.length,
      'unmittelbar nach der 201-Antwort existiert kein Audit-Eintrag — ' +
        'der Eintrag wird nach der Quittierung geschrieben',
    ).toBeGreaterThan(0);
    expect(
      eintraege[0]!.entryHash,
      'unmittelbar nach der 201-Antwort hat der Audit-Eintrag keinen Hash — ' +
        'die Hash-Kette laeuft der Quittierung hinterher',
    ).toBeTypeOf('string');
    expect(eintraege[0]!.entryHash).toMatch(/^[a-f0-9]{64}$/);
  });
});
