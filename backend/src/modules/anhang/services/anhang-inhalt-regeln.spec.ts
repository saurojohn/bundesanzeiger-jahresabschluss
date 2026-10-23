import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { AnhangService } from './anhang.service';

/**
 * BEFUND 2026-10-24 (Nachtrag 93): Die Inhaltsregeln des Anhangs
 * galten nur für die ABSCHNITTE, nicht für die drei Pflichtangaben
 * (§ 284 Abs. 2 Nr. 1/2, § 285 HGB).
 *
 * GEMESSEN an der laufenden API (Anhang auf VALIDATED):
 *
 *     Abschnitte ändern      -> HTTP 400 (gesperrt)
 *     bilanzierungsMethoden  -> HTTP 200 (geändert!)
 *     bewertungsMethoden     -> HTTP 200 (geändert!)
 *     sonstigePflichtangaben -> HTTP 200 (geändert!)
 *
 * Und: die Platzhalterprüfung sah nur die Abschnitte an — ein "[Ort]" in
 * `bilanzierungsMethoden` blieb unentdeckt (Detailantwort:
 * `offenePlatzhalter: []`), obwohl dieselben Platzhalter in einem
 * Abschnitt gemeldet werden.
 */
describe('Anhang: die Inhaltsregeln gelten für Abschnitte UND Pflichtangaben (Nachtrag 93)', () => {
  const MANDANT = '11111111-1111-4111-8111-111111111111';
  const ANHANG = '22222222-2222-4222-8222-222222222222';

  function svcMitAnhang(status: string, abschlussStatus: string | null = null) {
    const anhang = {
      id: ANHANG,
      mandantId: MANDANT,
      geschaeftsjahr: 2095,
      status,
      bilanzierungsMethoden: 'Lineare Abschreibung',
      bewertungsMethoden: 'Wertaufzeichnung',
      sonstigePflichtangaben: 'Keine weiteren Angaben',
      abschnitte: [{ id: 'a1', titel: 'Grundlagen', inhalt: 'Inhalt', reihenfolge: 1 }],
    };
    const anhangRepository = {
      findWithAbschnitte: vi.fn().mockResolvedValue(anhang),
      updateWithAbschnitte: vi.fn().mockResolvedValue(anhang),
      // BEFUND 2026-10-24 (Nachtrag 95): der Status des Jahresabschlusses,
      // zu dem der Anhang gehoert.
      findJahresabschlussStatusByAnhangId: vi.fn().mockResolvedValue(abschlussStatus),
    };
    // Der Konstruktor: (anhangRepository, auditService, mandantRepository).
    // Der Mandant wird gebraucht — `assertMandantBearbeitbar` schlaegt an,
    // wenn der Mandant archiviert ist.
    const mandantRepository = {
      findArchivierung: vi.fn().mockResolvedValue({ archiviertAt: null }),
    };
    const auditService = { record: vi.fn().mockResolvedValue(undefined) };
    const service = new AnhangService(
      anhangRepository as never,
      auditService as never,
      mandantRepository as never,
    );
    const user = {
      id: 'u1',
      email: 'sb@kanzlei.de',
      globalRole: 'STEUERBERATER',
      mandanten: [{ id: MANDANT, firmenname: 'Demo GmbH', rolle: 'STEUERBERATER' }],
    } as never;
    return { service, anhangRepository, user };
  }

  it('die drei Pflichtangaben bleiben auch nach der Freigabe aenderbar (Korrekturvorgang)', async () => {
    // Entscheidung der Fachverantwortlichen vom 2026-10-14 (Nachtrag 77):
    // „Soll das Signieren die Bilanz/GuV/Anhang gegen Aenderung sperren?"
    // -> NEIN. Ein Korrekturvorgang erzeugt zwingend eine neue Signatur.
    //
    // Die Positionen der Bilanz und der GuV sind ab VALIDATED eingefroren.
    // Damit sind die drei Pflichtangaben-Felder der EINZIGE Weg, einen
    // Korrekturvorgang am signierten Jahresabschluss zu erzeugen
    // (Nachtrag 78: Re-Signatur).
    //
    // Wer diese Aenderbarkeit entfernt, zerstoert den Korrekturvorgang.
    // Dieser Test ist der Waechter dafuer.
    const { service, anhangRepository, user } = svcMitAnhang('VALIDATED');
    for (const feld of [
      'bilanzierungsMethoden',
      'bewertungsMethoden',
      'sonstigePflichtangaben',
    ] as const) {
      await service.update(
        ANHANG,
        MANDANT,
        { [feld]: 'Korrektur nach der Freigabe.' } as never,
        user,
        { ip: null, userAgent: null },
      );
    }
    expect(anhangRepository.updateWithAbschnitte).toHaveBeenCalledTimes(3);
  });

  it('die Gegenprobe: die Abschnitte waren schon gesperrt', async () => {
    const { service, user } = svcMitAnhang('VALIDATED');
    await expect(
      service.update(
        ANHANG,
        MANDANT,
        { abschnitte: [{ titel: 'Neu', inhalt: 'Neu', reihenfolge: 1 }] } as never,
        user,
        { ip: null, userAgent: null },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('im DRAFT darf der Anhang geaendert werden (der Normalweg bleibt offen)', async () => {
    const { service, anhangRepository, user } = svcMitAnhang('DRAFT');
    await service.update(
      ANHANG,
      MANDANT,
      { bilanzierungsMethoden: 'Neue Methode' } as never,
      user,
      { ip: null, userAgent: null },
    );
    expect(anhangRepository.updateWithAbschnitte).toHaveBeenCalled();
  });

  it('ein reiner Statuswechsel ist auch nach der Freigabe erlaubt', async () => {
    const { service, anhangRepository, user } = svcMitAnhang('VALIDATED');
    await service.update(
      ANHANG,
      MANDANT,
      { status: 'ARCHIVED' } as never,
      user,
      { ip: null, userAgent: null },
    );
    expect(anhangRepository.updateWithAbschnitte).toHaveBeenCalled();
  });

  it('nach der Einreichung ist der Anhang-Inhalt eingefroren (BUG vor dem Fix)', async () => {
    // BEFUND 2026-10-24 (Nachtrag 95): Nach der Einreichung beim
    // Bundesanzeiger (SUBMITTED) war der Anhang-Inhalt weiterhin
    // aenderbar — obwohl eine erneute Signatur fuer einen eingereichten
    // Abschluss gesperrt ist (Nachtrag 78). Die Aenderung konnte also nie
    // nachgezogen werden.
    const { service, anhangRepository, user } = svcMitAnhang('VALIDATED', 'SUBMITTED');
    await expect(
      service.update(
        ANHANG,
        MANDANT,
        { bilanzierungsMethoden: 'NACHTRAG nach der Einreichung.' } as never,
        user,
        { ip: null, userAgent: null },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(
      anhangRepository.updateWithAbschnitte,
      'es darf nichts geschrieben werden',
    ).not.toHaveBeenCalled();
  });

  it('nach der Veroeffentlichung ist der Anhang-Inhalt ebenfalls eingefroren', async () => {
    const { service, user } = svcMitAnhang('VALIDATED', 'PUBLISHED');
    await expect(
      service.update(
        ANHANG,
        MANDANT,
        { sonstigePflichtangaben: 'NACHTRAG nach der Veroeffentlichung.' } as never,
        user,
        { ip: null, userAgent: null },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('der Korrekturvorgang nach der Signatur bleibt moeglich (SIGNED)', async () => {
    // Entscheidung der Fachverantwortlichen vom 2026-10-14: das Signieren
    // sperrt NICHT gegen Aenderung — der Korrekturvorgang braucht einen
    // aenderbaren Bestandteil.
    const { service, anhangRepository, user } = svcMitAnhang('VALIDATED', 'SIGNED');
    await service.update(
      ANHANG,
      MANDANT,
      { bilanzierungsMethoden: 'Korrektur nach der Signatur.' } as never,
      user,
      { ip: null, userAgent: null },
    );
    expect(anhangRepository.updateWithAbschnitte).toHaveBeenCalled();
  });

  it('die Platzhalterpruefung sieht auch die Pflichtangaben (BUG vor dem Fix)', () => {
    const svc = new AnhangService(null as never, null as never, null as never);
    const offen = svc.offenePlatzhalter({
      abschnitte: [{ inhalt: 'Der Anhang wurde aufgestellt.' }],
      bilanzierungsMethoden: 'Lineare Abschreibung, Sitz [Ort]',
      bewertungsMethoden: 'Wertaufzeichnung',
      sonstigePflichtangaben: 'Steuernummer [Steuernummer]',
    });
    expect(offen.sort()).toEqual(['Ort', 'Steuernummer']);
  });

  it('ohne Platzhalter bleibt die Liste leer', () => {
    const svc = new AnhangService(null as never, null as never, null as never);
    const offen = svc.offenePlatzhalter({
      abschnitte: [{ inhalt: 'Sitz: Berlin, HRB 123456' }],
      bilanzierungsMethoden: 'Lineare Abschreibung',
      bewertungsMethoden: 'Wertaufzeichnung',
      sonstigePflichtangaben: 'Keine weiteren Angaben',
    });
    expect(offen).toEqual([]);
  });
});
