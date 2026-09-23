import type { PrismaService } from '../../prisma/prisma.service';

/**
 * Generische Basis-Repository-Klasse (Mandant-isolation).
 *
 * Stellt mandant-isolierte CRUD-Methoden bereit. Konkrete Repositories
 * definieren ihre eigenen typed Methoden (siehe BilanzRepository,
 * GuVRepository, AnhangRepository). Diese Klasse kann alternativ als
 * Superklasse genutzt werden, wenn das Domain-Modell dem einfachen
 * MandantEntity-Pattern folgt.
 *
 * Motivation: ESLint verbietet direkten prisma.X-Zugriff in
 * src/modules/ - nur Repositories (dieser Layer) duerfen das.
 *
 * Type-Parameter:
 *   - T: Entity-Typ (z.B. Bilanz, GuV)
 *   - K: WhereInput-Typ aus Prisma
 */
export abstract class PrismaRepositoryBase<T, K> {
  /** Menschenlesbarer Entity-Name (fuer Logs, Audit). */
  protected abstract readonly entityName: string;

  constructor(protected readonly prisma: PrismaService) {}

  /**
   * Findet einen Datensatz per ID, gefiltert auf Mandant.
   *
   * Konkrete Repositories ueberschreiben diese Methode typischerweise,
   * um mandant-spezifische Where-Clauses zu nutzen (z.B. zusaetzliche
   * include-Felder oder Relationen).
   */
  async findById(id: string, _mandantId: string): Promise<T | null> {
    void id;
    throw new Error('findById() muss in der konkreten Repository-Klasse implementiert werden');
  }

  /**
   * Findet alle Datensaetze eines Mandanten.
   */
  async findByMandant(_mandantId: string, _extraWhere: Record<string, unknown> = {}): Promise<T[]> {
    throw new Error('findByMandant() muss in der konkreten Repository-Klasse implementiert werden');
  }

  /**
   * Mandant-gefilterte Loesch-Operation.
   */
  async deleteById(_id: string, _mandantId: string): Promise<T | null> {
    throw new Error('deleteById() muss in der konkreten Repository-Klasse implementiert werden');
  }

  /**
   * Re-export des WhereInput-Typs fuer Konsumenten.
   */
  protected get whereInput(): K {
    return undefined as unknown as K;
  }
}