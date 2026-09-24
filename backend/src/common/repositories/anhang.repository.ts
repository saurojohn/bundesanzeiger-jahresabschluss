import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CursorCodec } from '../dto/pagination.dto';

/**
 * Typen für Anhang-spezifische Eingaben.
 */
export type AnhangEntity = Prisma.AnhangGetPayload<{
  include: { abschnitte: true };
}>;

export type AnhangWithoutAbschnitte = Prisma.AnhangGetPayload<Record<string, never>>;

export interface AnhangAbschnittInput {
  titel: string;
  inhalt: string;
  reihenfolge: number;
}

export interface AnhangCreateInput {
  mandantId: string;
  geschaeftsjahr: number;
  status?: string;
  bilanzierungsMethoden?: string | null;
  bewertungsMethoden?: string | null;
  sonstigePflichtangaben?: string | null;
  createdById?: string | null;
  abschnitte?: AnhangAbschnittInput[];
}

export interface AnhangUpdateInput {
  status?: string;
  bilanzierungsMethoden?: string | null;
  bewertungsMethoden?: string | null;
  sonstigePflichtangaben?: string | null;
  updatedById?: string | null;
  abschnitte?: AnhangAbschnittInput[];
}

/**
 * Mandant-isoliertes Repository für Anhang und AnhangAbschnitt.
 */
@Injectable()
export class AnhangRepository {
  constructor(private readonly prismaService: PrismaService) {}

  static readonly entityName = 'Anhang';

  async findByMandantAndJahr(
    mandantId: string,
    jahr?: number,
  ): Promise<AnhangWithoutAbschnitte[]> {
    return this.prismaService.anhang.findMany({
      where: {
        mandantId,
        ...(typeof jahr === 'number' ? { geschaeftsjahr: jahr } : {}),
      },
      orderBy: { geschaeftsjahr: 'desc' },
    });
  }

  /**
   * Wie findByMandantAndJahr, aber zusätzlich mit jüngstem
   * WORM-PDF-ObjectKey pro Datensatz. Performance: 1 zusätzlicher
   * grouped query statt N+1.
   */
  async findByMandantAndJahrWithWorm(
    mandantId: string,
    jahr?: number,
  ): Promise<
    Array<AnhangWithoutAbschnitte & { wormObjectKey: string | null }>
  > {
    const anhaenge = await this.findByMandantAndJahr(mandantId, jahr);
    if (anhaenge.length === 0) return [];
    const wormObjects = await this.prismaService.wormObject.findMany({
      where: {
        entityType: 'ANHANG_PDF',
        entityId: { in: anhaenge.map((a) => a.id) },
      },
      orderBy: { uploadedAt: 'desc' },
    });
    const map = new Map<string, string>();
    for (const w of wormObjects) {
      if (!map.has(w.entityId)) map.set(w.entityId, w.objectKey);
    }
    return anhaenge.map((a) => ({
      ...a,
      wormObjectKey: map.get(a.id) ?? null,
    }));
  }

  /**
   * Cursor-paginierte Variante für Performance-Skalierung (M3+).
   *
   * - Sortierung: `updatedAt DESC` (Tiebreaker: id ASC)
   * - Filter: mandantId (+ optional Jahr)
   */
  async findByMandantPaginated(args: {
    mandantId: string;
    cursor?: string;
    pageSize: number;
    jahr?: number;
  }): Promise<
    Array<AnhangWithoutAbschnitte & { wormObjectKey: string | null }>
  > {
    const where: Prisma.AnhangWhereInput = {
      mandantId: args.mandantId,
      ...(typeof args.jahr === 'number' ? { geschaeftsjahr: args.jahr } : {}),
    };

    if (args.cursor) {
      const { sortValue } = CursorCodec.decode(args.cursor);
      const cursorDate = new Date(sortValue);
      if (!Number.isNaN(cursorDate.getTime())) {
        where.OR = [{ updatedAt: { lt: cursorDate } }];
      }
    }

    const anhaenge = await this.prismaService.anhang.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      take: args.pageSize + 1,
    });

    if (anhaenge.length === 0) return [];
    const wormObjects = await this.prismaService.wormObject.findMany({
      where: {
        entityType: 'ANHANG_PDF',
        entityId: { in: anhaenge.map((a) => a.id) },
      },
      orderBy: { uploadedAt: 'desc' },
    });
    const map = new Map<string, string>();
    for (const w of wormObjects) {
      if (!map.has(w.entityId)) map.set(w.entityId, w.objectKey);
    }
    return anhaenge.map((a) => ({
      ...a,
      wormObjectKey: map.get(a.id) ?? null,
    }));
  }

  /**
   * Anzahl Anhang pro Mandant (optional Jahr-Filter). Parallel zum
   * `findByMandantPaginated` via `Promise.all`.
   */
  async countByMandant(args: {
    mandantId: string;
    jahr?: number;
  }): Promise<number> {
    return this.prismaService.anhang.count({
      where: {
        mandantId: args.mandantId,
        ...(typeof args.jahr === 'number' ? { geschaeftsjahr: args.jahr } : {}),
      },
    });
  }

  async findById(id: string, mandantId: string): Promise<AnhangWithoutAbschnitte | null> {
    return this.prismaService.anhang.findFirst({
      where: { id, mandantId },
    });
  }

  async findWithAbschnitte(id: string, mandantId: string): Promise<AnhangEntity | null> {
    return this.prismaService.anhang.findFirst({
      where: { id, mandantId },
      include: { abschnitte: { orderBy: { reihenfolge: 'asc' } } },
    });
  }

  async createWithAbschnitte(input: AnhangCreateInput): Promise<AnhangEntity> {
    return this.prismaService.$transaction(async (tx) => {
      const anhang = await tx.anhang.create({
        data: {
          mandantId: input.mandantId,
          geschaeftsjahr: input.geschaeftsjahr,
          status: input.status ?? 'DRAFT',
          bilanzierungsMethoden: input.bilanzierungsMethoden ?? null,
          bewertungsMethoden: input.bewertungsMethoden ?? null,
          sonstigePflichtangaben: input.sonstigePflichtangaben ?? null,
          createdById: input.createdById ?? null,
        },
      });
      const abschnitte = await this.createAbschnitteInTx(
        tx,
        anhang.id,
        input.abschnitte ?? [],
      );
      return { ...anhang, abschnitte };
    });
  }

  async updateWithAbschnitte(
    id: string,
    mandantId: string,
    input: AnhangUpdateInput,
  ): Promise<AnhangEntity> {
    return this.prismaService.$transaction(async (tx) => {
      const existing = await tx.anhang.findFirst({
        where: { id, mandantId },
      });
      if (!existing) {
        throw new Error('Anhang nicht gefunden oder kein Zugriff');
      }

      const updated = await tx.anhang.update({
        where: { id },
        data: {
          status: input.status ?? undefined,
          bilanzierungsMethoden: input.bilanzierungsMethoden ?? undefined,
          bewertungsMethoden: input.bewertungsMethoden ?? undefined,
          sonstigePflichtangaben: input.sonstigePflichtangaben ?? undefined,
          updatedById: input.updatedById ?? null,
        },
      });

      if (input.abschnitte !== undefined) {
        await tx.anhangAbschnitt.deleteMany({ where: { anhangId: id } });
        await this.createAbschnitteInTx(tx, id, input.abschnitte);
      }

      const abschnitte = await tx.anhangAbschnitt.findMany({
        where: { anhangId: id },
        orderBy: { reihenfolge: 'asc' },
      });
      return { ...updated, abschnitte };
    });
  }

  async deleteByMandant(id: string, mandantId: string): Promise<boolean> {
    const existing = await this.findById(id, mandantId);
    if (!existing) return false;
    await this.prismaService.anhang.delete({ where: { id } });
    return true;
  }

  // ---------------------------------------------------------------------------
  // private helpers
  // ---------------------------------------------------------------------------

  private async createAbschnitteInTx(
    tx: Prisma.TransactionClient,
    anhangId: string,
    abschnitte: AnhangAbschnittInput[],
  ): Promise<Array<{
    id: string;
    anhangId: string;
    titel: string;
    inhalt: string;
    reihenfolge: number;
    createdAt: Date;
    updatedAt: Date;
  }>> {
    const created = [];
    for (const abschnitt of abschnitte) {
      const row = await tx.anhangAbschnitt.create({
        data: {
          anhangId,
          titel: abschnitt.titel,
          inhalt: abschnitt.inhalt,
          reihenfolge: abschnitt.reihenfolge,
        },
      });
      created.push(row);
    }
    return created;
  }
}