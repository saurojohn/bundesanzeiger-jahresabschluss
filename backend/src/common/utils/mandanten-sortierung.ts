import type { Prisma } from '@prisma/client';

/**
 * Sortierung fuer die Mandantenliste eines Users.
 *
 * BEFUND 2026-10-13: Sechs Abfragen ueber `UserMandantRole` lieferten ihre
 * Mandanten OHNE `orderBy` — Login, Refresh, `me`, `resolveAuthUser`,
 * `getMandantenAccessibleByUser` (Auth) und dasselbe im MandantService.
 *
 * Gemessen wurde: fuer `steuerberater@kanzlei.de` lieferte die API
 * `Demo GmbH, Beispiel GmbH, Test AG`. Das ist weder alphabetisch noch die
 * Seed-Reihenfolge garantiert — Postgres gibt ohne `ORDER BY` keine
 * Reihenfolge zu, und sie aendert sich, sobald Zeilen aktualisiert werden
 * (ein UPDATE schreibt eine neue Heap-Version an das Zeilenende).
 *
 * Warum das ein Produktdefekt ist und nicht nur ein Testproblem: die API
 * liefert ein Array, und jedes Array hat eine Position. Ohne vertraglich
 * zugesicherte Sortierung ist jedes clientseitige `mandanten[0]` auf ein
 * nicht zugesagtes Verhalten gestellt. Ein Kommentar in `wp.e2e` behauptete
 * sogar, die API sortiere alphabetisch — das war eine Annahme, kein Befund,
 * und sie traf nicht zu.
 *
 * `firmenname` ist bewusst der Sortierschluessel: Er ist im Gegensatz zur
 * UUID ueber die Mandanten hinweg stabil und fuer Menschen lesbar, und er
 * entspricht der Reihenfolge, die die Clients ohnehin anzeigen.
 *
 * Nach Firmenname ist der Name allein nicht eindeutig (zwei Mandanten eines
 * Kanzleis duerfen denselben Firmennamen haben, die Tabelle legt das nicht
 * fest). Deshalb folgt als zweite Sortierung die ID — ohne sie waere die
 * Reihenfolge zwischen zwei Mandanten mit gleichem Namen wieder offen, und
 * genau solche Faelle wuerden die Suite nur selten, aber dann unerklaerbar
 * flakig machen.
 *
 * FORM: als ARRAY, nicht als Objekt. Prisma typisiert `orderBy` als
 * `Input | Input[]`, deshalb akzeptiert `tsc` beide Formen — zur Laufzeit
 * verlangt Prisma 5 fuer eine Sortierung ueber eine RELATION aber das
 * Array und wirft bei einem Objekt:
 *
 *   Argument `orderBy`: Invalid value provided.
 *   Expected UserMandantRoleOrderByWithRelationInput[], provided Object.
 *
 * Das ist eine Luecke, die nur der Laufzeittest findet: `npm run typecheck`
 * ist hier gruen.
 */
export const MANDANTEN_SORTIERUNG = [
  { mandant: { firmenname: 'asc' } },
  { mandantId: 'asc' },
] satisfies Prisma.UserMandantRoleOrderByWithRelationInput[];
