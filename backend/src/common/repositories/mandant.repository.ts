import { Injectable } from '@nestjs/common';
import type { Mandant } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Archivzustand eines Mandanten.
 *
 * BEFUND 2026-10-09: `DELETE /api/mandant/:id` war ein Hard Delete und
 * riss ueber `onDelete: Cascade` Bilanz, GuV, Anhang, Jahresabschluss und
 * die qeS-Signaturen mit. Der Pfad ist gesperrt (HTTP 409 bei Bestand).
 *
 * Damit ein Mandant, der weg muss, trotzdem aus dem aktiven Bestand
 * verschwinden kann, gibt es stattdessen die Archivierung: keine neuen
 * Belege mehr, Bestand bleibt les- und nachvollziehbar.
 *
 * Eigenes Repository, weil die Schreibpfade (Bilanz/GuV/Anhang) den
 * Archivzustand pruefen muessen, ohne das MandantModule zu importieren —
 * und weil `MandantService` die Fachlogik (Rollen, Audit) besitzt, nicht
 * die Datenzugriffe der anderen Module.
 */
@Injectable()
export class MandantRepository {
  static readonly entityName = 'Mandant';

  constructor(private readonly prismaService: PrismaService) {}

  /**
   * Liest den Archivzustand. Liefert null, wenn der Mandant nicht
   * existiert — der Aufrufer entscheidet, ob das ein 404 ist.
   */
  async findArchivierung(
    mandantId: string,
  ): Promise<{ archiviertAt: Date | null; firmenname: string } | null> {
    return this.prismaService.mandant.findUnique({
      where: { id: mandantId },
      select: { archiviertAt: true, firmenname: true },
    });
  }

  /**
   * Setzt den Archivzustand. `archiviert=false` hebt die Archivierung auf
   * und leert auch `archiviertVonId` — ein zurueckgenommenes Archiv darf
   * keinen alten Bearbeiter stehen lassen.
   */
  async setArchiviert(
    mandantId: string,
    archiviert: boolean,
    vonUserId: string,
    now: Date,
  ): Promise<{ id: string; archiviertAt: Date | null }> {
    return this.prismaService.mandant.update({
      where: { id: mandantId },
      data: archiviert
        ? { archiviertAt: now, archiviertVonId: vonUserId }
        : { archiviertAt: null, archiviertVonId: null },
      select: { id: true, archiviertAt: true },
    });
  }

  async findById(mandantId: string): Promise<Mandant | null> {
    return this.prismaService.mandant.findUnique({ where: { id: mandantId } });
  }
}