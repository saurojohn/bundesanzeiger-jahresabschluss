import { describe, it, expect, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { MandantService } from './mandant.service';
import type { AuthUser } from '../../auth/types/auth-user.types';

/**
 * BEFUND 2026-10-09 — `DELETE /api/mandant/:id` war ein HARD DELETE.
 *
 * Das Schema haengt per `onDelete: Cascade` an:
 *   Mandant -> Bilanz -> BilanzPosition / WPNotiz / WPPruefungsAbschluss
 *   Mandant -> GuV, Anhang, Jahresabschluss -> Signature (qeS), BanzSubmission
 *
 * Live gemessen (HTTP-Pfad, Prisma-Messung) VOR dem Fix:
 *   HTTP 204, Bilanz 1 -> 0, Audit-Eintraege mit Mandantbezug 2 -> 0,
 *   auditWriteFailures 1 -> 2.
 */

const MANDANT = '11111111-1111-4111-8111-111111111111';
const KANZLEI = '22222222-2222-4222-8222-222222222222';

const admin = {
  id: '33333333-3333-4333-8333-333333333333',
  globalRole: 'SYSTEM_ADMIN',
  mandanten: [],
} as unknown as AuthUser;

const ctx = { ip: null, userAgent: null };

const mandantRow = {
  id: MANDANT,
  kanzleiId: KANZLEI,
  firmenname: 'Muster GmbH',
  rechtsform: 'GmbH',
  groessenklasse: 'KLEINST',
  publishChannel: 'PDF_DIRECT',
};

/** Zaehler, die der Service im Stand VOR dem Fix gar nicht abgefragt hat. */
function buildService(bestand: {
  jahresabschluss?: number;
  bilanz?: number;
  guv?: number;
  anhang?: number;
  submission?: number;
}) {
  const counts = {
    jahresabschluss: bestand.jahresabschluss ?? 0,
    bilanz: bestand.bilanz ?? 0,
    guv: bestand.guv ?? 0,
    anhang: bestand.anhang ?? 0,
    submission: bestand.submission ?? 0,
  };

  const mandantDelete = vi.fn().mockResolvedValue(mandantRow);
  const countFn = (n: number) => vi.fn().mockResolvedValue(n);

  const tx = {
    jahresabschluss: { count: countFn(counts.jahresabschluss) },
    bilanz: { count: countFn(counts.bilanz) },
    guV: { count: countFn(counts.guv) },
    anhang: { count: countFn(counts.anhang) },
    banzSubmission: { count: countFn(counts.submission) },
    mandant: { delete: mandantDelete },
  };

  // Der Aufrufer braucht einen echten Transaktions-Wrapper, damit der
  // ConflictException-Wurf aus dem Callback den Test wirklich erreicht.
  const $transaction = vi.fn(
    async (cb: (t: typeof tx) => Promise<unknown>, _opts?: unknown) => cb(tx),
  );

  // WICHTIG fuer die Negativprobe: `mandant.delete` existiert auch auf dem
  // Top-Level-Client, damit der Code VOR dem Fix (`prisma.mandant.delete`)
  // wirklich loescht. Sonst scheitert die alte Fassung an einem TypeError
  // aus der Mock-Form und der Test sieht den Produktfehler nur indirekt.
  const prisma = {
    mandant: { findUnique: vi.fn().mockResolvedValue(mandantRow), delete: mandantDelete },
    $transaction,
  };

  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const cache = { invalidate: vi.fn().mockResolvedValue(undefined) };

  const service = new MandantService(prisma as never, audit as never, cache as never);
  return { service, tx, mandantDelete, audit, prisma };
}

describe('Mandant-Löschung: § 147 AO sperrt Mandanten mit Buchhaltungsdaten', () => {
  it('ein Mandant mit Bilanz wird NICHT gelöscht', async () => {
    const { service, mandantDelete } = buildService({ bilanz: 1 });

    await expect(service.delete(MANDANT, admin, ctx)).rejects.toBeInstanceOf(ConflictException);
    expect(mandantDelete).not.toHaveBeenCalled();
  });

  it('ein Mandant mit Jahresabschluss wird NICHT gelöscht', async () => {
    const { service, mandantDelete } = buildService({ jahresabschluss: 3 });

    await expect(service.delete(MANDANT, admin, ctx)).rejects.toBeInstanceOf(ConflictException);
    expect(mandantDelete).not.toHaveBeenCalled();
  });

  it('jede der fuenf Aufbewahrungs-Arten sperft fuer sich allein', async () => {
    // einzeln pruefen: ein zaehlender Guard, der eine Kategorie vergisst,
    // faellt hier sofort auf.
    for (const key of ['jahresabschluss', 'bilanz', 'guv', 'anhang', 'submission'] as const) {
      const { service, mandantDelete } = buildService({ [key]: 1 });
      await expect(service.delete(MANDANT, admin, ctx), `${key} muss sperren`).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(mandantDelete, `${key} darf nicht loeschen`).not.toHaveBeenCalled();
    }
  });

  it('die Sperrmeldung nennt den Bestand und § 147 AO', async () => {
    const { service } = buildService({ bilanz: 2, jahresabschluss: 1 });

    const fehler = await service.delete(MANDANT, admin, ctx).catch((e: unknown) => e);
    expect(fehler).toBeInstanceOf(ConflictException);
    const text = (fehler as ConflictException).message;
    expect(text).toContain('1 Jahresabschluss');
    expect(text).toContain('2 Bilanz');
    expect(text).toContain('147');
  });

  it('ein Mandant OHNE Buchhaltungsdaten bleibt loeschbar', async () => {
    // Korrektur einer frischen Anlage und Testdaten muessen weiter gehen —
    // eine Sperre, die den einzigen Pfad zum Entfernen zubaut, waere ein
    // Ausfall, keine Erfuellung.
    const { service, mandantDelete } = buildService({});

    await service.delete(MANDANT, admin, ctx);
    expect(mandantDelete).toHaveBeenCalledWith({ where: { id: MANDANT } });
  });

  it('der Audit-Eintrag des DELETE traegt KEINE geloeschte mandantId', async () => {
    // `AuditLog.mandant` ist eine optionale FK ohne `onDelete` (= SetNull).
    // Ein Eintrag mit `mandantId: <gerade geloeschte Zeile>` verletzt den
    // Fremdschluessel, `record()` schluckt den Fehler, `failedWrites`
    // steigt und `/health/ready` bleibt dauerhaft degraded. Live gemessen.
    const { service, audit } = buildService({});

    await service.delete(MANDANT, admin, ctx);

    expect(audit.record).toHaveBeenCalledTimes(1);
    const params = audit.record.mock.calls[0][0];
    expect(params.mandantId).toBeNull();
    // Der Bezug muss trotzdem erhalten bleiben, sonst ist die Loeschung
    // spaeter nicht mehr nachvollziehbar.
    expect(params.entityId).toBe(MANDANT);
    expect(params.kanzleiId).toBe(KANZLEI);
  });

  it('zählen und löschen laufen in EINER Transaktion', async () => {
    // Count-then-Delete ohne gemeinsame Transaktion ist ein TOCTOU: ein
    // Abschluss, der zwischen Zaehlen und Loeschen entsteht, rutscht durch
    // das Cascade.
    //
    // Bewusst KEINE Isolation-Level-Pruefung: Serializable wurde hier
    // ausprobiert und wieder verworfen. Postgres SSI bricht dieses Muster
    // mit P2034 ab (live: HTTP 500 beim Loeschen eines LEEREN Mandanten)
    // und schliesst das Restfenster trotzdem nicht — in der seriellem
    // Reihenfolge darf der konkurrierende Insert nach dem Delete liegen.
    const { service, prisma, tx } = buildService({});

    await service.delete(MANDANT, admin, ctx);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    // Das DELETE muss ueber den Transaction-Client laufen.
    expect(tx.mandant.delete).toHaveBeenCalledWith({ where: { id: MANDANT } });
  });

  it('ein nicht existierender Mandant bleibt 404', async () => {
    const { service, prisma } = buildService({});
    prisma.mandant.findUnique.mockResolvedValue(null);

    await expect(service.delete(MANDANT, admin, ctx)).rejects.toBeInstanceOf(NotFoundException);
  });
});