import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Audit-Integrity-Service (M4 Sprint 5).
 *
 * Hash-Chain für Audit-Trail (GoBD §147 AO + IDW PS 880).
 *
 * Konzept:
 *   Jeder Audit-Eintrag erhält einen `entryHash` = SHA-256(prevHash + entry).
 *   Der `prevHash` ist der `entryHash` des vorherigen Eintrags.
 *   Genesis-PrevHash = "0" * 64.
 *
 * Nachträgliche Manipulation:
 *   Wird ein Eintrag geändert, ändert sich sein entryHash.
 *   Alle nachfolgenden Einträge haben aber noch den alten prevHash
 *   → Integrity-Verification bricht ab.
 *
 * Performance:
 *   entryHash wird NICHT on-the-fly für jeden Read berechnet (zu teuer
 *   bei 100k+ Einträgen). Stattdessen:
 *   - Write-Path: hash beim record() mitberechnen + als Cache speichern
 *   - Read-Path: bei explizitem verifyIntegrity() alle Einträge scannen
 *
 * Schema-Migration erforderlich:
 *   ALTER TABLE audit_log
 *     ADD COLUMN entry_hash VARCHAR(64),  -- SHA-256 hex
 *     ADD COLUMN prev_hash VARCHAR(64);  -- vorheriger entryHash oder genesis
 *   CREATE INDEX idx_audit_log_created_hash ON audit_log(created_at, entry_hash);
 *
 * Bis zur Migration ist prevHash/entryHash leer. verifyIntegrity()
 * erkennt das und liefert "PARTIAL" als Status (Chain nur für neue
 * Einträge verifizierbar).
 */
@Injectable()
export class AuditIntegrityService {
  private readonly logger = new Logger(AuditIntegrityService.name);
  private static readonly GENESIS_HASH = '0'.repeat(64);

  /**
   * Serialisiert die Hash-Berechnung.
   *
   * Warum (Befund 2026-10-03): `record()` ruft `computeHashForEntry()`
   * fire-and-forget auf. Drei Audit-Einträge innerhalb von 35 ms lesen
   * dann GLEICHZEITIG denselben Vorgänger (`createdAt < current`) — zwei
   * davon leiten denselben `prevHash` ab, und die Kette verzweigt. Im
   * Betrieb lieferte `verifyIntegrity()` daraufhin `BROKEN` nach zwei
   * Einträgen, mit zwei verschiedenen Hashes an derselben Position.
   *
   * Statt zu rennen wird jede Berechnung hinten angereiht: der Vorgänger
   * ist dann garantiert schon gehasht, wenn der Nachfolger ihn liest.
   *
   * Ein Fehler bricht die Kette nicht ab — der Eintrag bleibt ungehasht
   * und `verifyIntegrity()` meldet für ihn `PARTIAL`.
   */
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Legt einen Eintrag in die Hash-Berechnungs-Kette ein.
   *
   * Der Aufrufer bekommt die Auswertung nicht zurück — wie bisher
   * fire-and-forget. Die Reihenfolge der Einträge bleibt die des
   * Audit-Logs, nicht die des Aufrufs.
   */
  enqueue(auditLogId: string): void {
    this.chain = this.chain
      .then(() => this.computeHashForEntry(auditLogId))
      .catch((err: unknown) => {
        this.logger.warn(
          `Hash-Berechnung für ${auditLogId} fehlgeschlagen: ${String(err)}`,
        );
      });
  }

  /**
   * Wie `enqueue`, gibt die Auswertung aber zurück — für Aufrufstellen,
   * die den Fehler zählen wollen.
   */
  enqueueWithCounting(auditLogId: string): Promise<void> {
    const next = this.chain.then(() => this.computeHashForEntry(auditLogId));
    // Der Fehler wird weitergereicht, die Kette darf aber nicht reißen.
    this.chain = next.catch(() => undefined);
    return next.then(() => undefined);
  }

  /**
   * Nur für Tests: wartet, bis die Kette leer gelaufen ist.
   */
  async drain(): Promise<void> {
    await this.chain;
  }

  /**
   * Berechnet den Hash für einen NEUEN Audit-Eintrag.
   *
   * Wird vom AuditService.record() aufgerufen NACHDEM der Eintrag in der DB
   * steht. Aktualisiert dann prevHash + entryHash via UPDATE.
   *
   * @returns entryHash + prevHash für Speicherung
   */
  async computeHashForEntry(auditLogId: string): Promise<{
    prevHash: string;
    entryHash: string;
  }> {
    // Hole den gerade erstellten Eintrag + den letzten vorherigen Eintrag
    const current = await this.prisma.auditLog.findUnique({
      where: { id: auditLogId },
    });
    if (!current) {
      throw new Error(`AuditLog nicht gefunden: ${auditLogId}`);
    }

    // Vorheriger Eintrag — Bugfix 2026-10-05, zwei Fehler in EINER Zeile:
    //
    // (a) Es fehlte der `kanzleiId`-Filter. Die Kette lief damit über ALLE
    //     Mandanten hinweg, während `verifyIntegrity()` je Kanzlei prüft.
    //     Beide konnten nie übereinstimmen — die Prüfung meldete dauerhaft
    //     BROKEN, sobald mehr als eine Kanzlei Audit-Einträge schrieb.
    //
    // (b) `createdAt: { lt }` überspringt Einträge mit IDENTISCHEM Zeitstempel.
    //     Postgres schreibt createdAt mit Mikrosekunden; mehrere Einträge
    //     innerhalb derselben Mikrosekunde (sehr wahrscheinlich bei einem
    //     Sammel-Import) gelten für alle drei Prädikate als "gleichzeitig",
    //     und keiner von ihnen wurde Vorgänger des anderen. Die Kette
    //     übersprang sie lautlos.
    //
    // BUGFIX 2026-10-08: Die Kette wird jetzt über die monotone
    // Spalte `sequenz` (BIGSERIAL) gebildet, NICHT über
    // `(createdAt, id)`.
    //
    // Das Problem mit `id` war nicht der Gleichstand von `createdAt`,
    // sondern die ZUFALLS-UUID: die Verarbeitung laeuft in
    // Einfuegereihenfolge (`enqueue`), die Sortierung entschied aber
    // nach UUID. Entstehen zwei Eintraege in derselben Millisekunde —
    // bei einem Sammel-Import Regelfall — und hat der spaeter
    // eingefuegte die kleinere UUID, findet er den ersten nicht als
    // Vorgaenger und beginnt die Kette neu (GENESIS). Die Verifikation
    // meldete daraufhin BROKEN.
    //
    // Das war die Ursache der sporadisch roten `audit-chain`-e2e-Tests.
    // Eine Hash-Kette braucht eine TOTALORDNUNG aus der Datenbank, nicht
    // aus Zufallswerten.
    const previous = await this.prisma.auditLog.findFirst({
      where: {
        kanzleiId: current.kanzleiId,
        ...(current.sequenz !== null
          ? { sequenz: { lt: current.sequenz } }
          : {
              // Altbestand ohne Sequenz (vor der Migration): auf
              // createdAt/id zurueckfallen.
              OR: [
                { createdAt: { lt: current.createdAt } },
                { createdAt: current.createdAt, id: { lt: current.id } },
              ],
            }),
      },
      orderBy: current.sequenz !== null ? { sequenz: 'desc' } : [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true, entryHash: true },
    });

    const prevHash = previous?.entryHash ?? AuditIntegrityService.GENESIS_HASH;

    const entryString = this.serializeForHashing(current);
    const entryHash = crypto.createHash('sha256').update(prevHash + entryString).digest('hex');

    // Update in DB (ein zusätzlicher Roundtrip — akzeptabel für Audit-Writes).
    //
    // Bugfix 2026-10-01 (Befund aus AUDIT-ATOMICITY-REVIEW.md, Abschnitt 2.2):
    // `data` war ein LEERES OBJEKT. Der Hash wurde berechnet, aber nie
    // persistiert — `as never` unterdrückte zusätzlich den TypeScript-Fehler,
    // der auf das leere data aufmerksam gemacht hätte. Folge: entryHash und
    // prevHash blieben für IMMER null, verifyIntegrity() meldete dauerhaft
    // PARTIAL, und die als "Manipulationserkennung" verkaufte Hash-Chain
    // (M4 Sprint 5) hat noch nie einen einzigen Hash gespeichert.
    //
    // Die Spalten existieren im Prisma-Modell und in beiden Migrationen —
    // es war nie ein Migrationsproblem, sondern ein Logik-Problem.
    await this.prisma.auditLog.update({
      where: { id: auditLogId },
      data: { entryHash, prevHash },
    });

    return { prevHash, entryHash };
  }

  /**
   * Verifiziert die komplette Audit-Chain für eine Kanzlei (oder alle).
   *
   * @returns Status + Anzahl verifizierter Einträge + erste Inkonsistenz
   */
  async verifyIntegrity(args?: {
    kanzleiId?: string;
    fromDate?: Date;
    toDate?: Date;
  }): Promise<{
    status: 'OK' | 'BROKEN' | 'PARTIAL' | 'NO_ENTRIES';
    entriesChecked: number;
    brokenAt?: { auditLogId: string; expectedHash: string; actualHash: string };
    oldestUnhashedEntry?: string;
  }> {
    const where: Record<string, unknown> = {};
    if (args?.kanzleiId) where['kanzleiId'] = args.kanzleiId;
    if (args?.fromDate || args?.toDate) {
      where['createdAt'] = {
        ...(args.fromDate ? { gte: args.fromDate } : {}),
        ...(args.toDate ? { lte: args.toDate } : {}),
      };
    }

    // Alle Audit-Einträge chronologisch laden.
    //
    // Bugfix 2026-10-05: Nur nach `createdAt` zu sortieren ist KEINE
    // Totalordnung — bei gleichen Zeitstempeln ist die Reihenfolge der DB
    // nicht bestimmt. Die Verifikation lief dann durch eine andere
    // Reihenfolge als der Schreibpfad in `computeHashForEntry()` und
    // meldete BROKEN, obwohl die Kette in Ordnung war. `id` als
    // Tie-Breaker macht beide Seiten deckungsgleich.
    const entries = await this.prisma.auditLog.findMany({
      where,
      // BUGFIX 2026-10-08: dieselbe Reihenfolge wie beim Bauen der
      // Kette — ueber `sequenz`, nicht ueber eine Zufalls-UUID. Ein
      // `verifyIntegrity()`, das anders sortiert als
      // `computeHashForEntry()`, meldet BROKEN fuer eine intakte Kette.
      // Sekundaer nach createdAt/id, damit ein Altbestand ohne Sequenz
      // (vor der Migration) eine stabile Reihenfolge behält.
      orderBy: [{ sequenz: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });

    if (entries.length === 0) {
      // Bugfix 2026-10-05: 'OK' bei 0 geprüften Einträgen war die
      // gefährlichste Antwort der ganzen Kette — ein Audit-Trail, der
      // nichts prüft, meldete sich als intakt. Für einen GoBD-Auditor ist
      // "nichts zu prüfen" ein eigener Befund, kein bestandener Test.
      return { status: 'NO_ENTRIES', entriesChecked: 0 };
    }

    let prevHash = AuditIntegrityService.GENESIS_HASH;
    let entriesChecked = 0;
    let oldestUnhashed: string | undefined;

    for (const entry of entries) {
       
      const entryAny = entry as any;
      const storedEntryHash = entryAny.entryHash as string | null | undefined;

      if (!storedEntryHash) {
        // Eintrag hat keinen Hash — entweder Schema-Migration pending
        // (alle Einträge) oder älterer Eintrag aus Pre-Hash-Chain-Phase.
        if (!oldestUnhashed) oldestUnhashed = entry.id;
        // Wir können diesen Eintrag nicht verifizieren, aber wir geben
        // auf und melden PARTIAL-Status.
        return {
          status: 'PARTIAL',
          entriesChecked,
          oldestUnhashedEntry: oldestUnhashed,
        };
      }

      // Berechne erwarteten Hash
      const expectedHash = crypto
        .createHash('sha256')
        .update(prevHash + this.serializeForHashing(entry))
        .digest('hex');

      if (expectedHash !== storedEntryHash) {
        // KEINE Unterscheidung "INCOMPATIBLE" — bewusst verworfen
        // (2026-10-05). Der Versuch, Altketten über den prevHash des
        // Nachfolgers von echter Manipulation zu trennen, hat den
        // bestehenden Test "erkennt eine nachträgliche Manipulation"
        // umgeworfen: Wird B.entryHash nachträglich verändert, zeigt der
        // Nachfolger C.prevHash IMMER noch auf den unveränderten Wert —
        // eine echte Manipulation sieht damit exakt aus wie eine Altkette.
        //
        // Das hätte genau die Verhaltensweise erzeugt, die dieser Bericht
        // vermeiden soll: Manipulationsverdacht als "bekannter Fall"
        // einstufen. Sicherheitsprüfungen müssen FALL-OPEN sein — im
        // Zweifel BROKEN. Eine Altkette braucht eine dokumentierte
        // Neuberechnung mit Freigabe des Wirtschaftsprüfers, keine
        // automatische Einstufung.
        return {
          status: 'BROKEN',
          entriesChecked,
          brokenAt: {
            auditLogId: entry.id,
            expectedHash,
            actualHash: storedEntryHash,
          },
        };
      }

      prevHash = storedEntryHash;
      entriesChecked++;
    }

    return { status: 'OK', entriesChecked };
  }

  /**
   * Serialisiert einen Audit-Eintrag deterministisch für den Hash.
   *
   * Wichtig: gleiche Felder + gleiche Reihenfolge = gleicher Hash.
   * Wir sortieren die JSON-Keys rekursiv.
   */
  /**
   * Serialisiert einen Audit-Eintrag deterministisch für den Hash.
   *
   * Zwei Regeln, beide erforderlich (Befund 2026-10-02):
   *
   * 1. `entryHash` und `prevHash` werden NICHT mitserialisiert. Beim Schreiben
   *    ist `entryHash` im gelesenen Datensatz noch `null`, beim Verifizieren
   *    ist er gefüllt — beide Seiten haben damit *nie* denselben Byte-Strom
   *    gesehen und die Chain konnte prinzipiell nicht verifizieren.
   *
   * 2. Die Schlüssel werden rekursiv sortiert. Prisma liefert die Felder in
   *    Schema-Reihenfolge, aber das ist keine Zusage: eine Spaltenreihenfolge
   *    in der DB, ein Prisma-Update oder ein zusätzliches `select` kann die
   *    Reihenfolge ändern. Ohne Sortierung wäre der Hash nicht reproduzierbar.
   *
   * Zeitstempel werden als ISO-8601 serialisiert, damit `Date` und der
   * bereits in der DB liegende String denselben Hash ergeben.
   */
  private serializeForHashing(entry: unknown): string {
    return JSON.stringify(this.canonicalizeForHash(entry));
  }

  /**
   * Baut aus einem Prisma-Eintrag die kanonische Form für den Hash:
   * `entryHash`/`prevHash` entfernt, Schlüssel rekursiv sortiert,
   * `Date` → ISO-String.
   */
  private canonicalizeForHash(value: unknown): unknown {
    if (value instanceof Date) return value.toISOString();
    // BigInt (Prisma-Spalte `sequenz`) kann JSON.stringify nicht
    // serialisieren. Ohne diesen Zweig wuerde die Hash-Berechnung fuer
    // jeden Eintrag werfen.
    if (typeof value === 'bigint') return value.toString();
    if (Array.isArray(value)) {
      return value.map((item) => this.canonicalizeForHash(item));
    }
    if (value !== null && typeof value === 'object') {
      const source = value as Record<string, unknown>;
      const result: Record<string, unknown> = {};
      for (const key of Object.keys(source).sort()) {
        // Die Hash-Felder selbst gehören nicht in den Hash.
        if (key === 'entryHash' || key === 'prevHash') continue;
        // `sequenz` ist die Verkettungsreihenfolge, NICHT der Inhalt
        // des Eintrags. Würde sie in den Hash eingehen, wäre jeder
        // bestehende Hash ungültig — die Spalte kam nachträglich dazu
        // und ist für die Aussage des Eintrags ohne Bedeutung.
        if (key === 'sequenz') continue;
        result[key] = this.canonicalizeForHash(source[key]);
      }
      return result;
    }
    return value;
  }
}