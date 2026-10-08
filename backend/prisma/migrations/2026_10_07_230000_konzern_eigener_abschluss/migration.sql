-- Konzernabschluss als EIGENER Abschluss neben dem Einzelsatz (HGB §301, IDW RS 11)
--
-- Ausgangslage: `@@unique([mandantId, geschaeftsjahr])` auf `bilanz` und `guv`
-- verhinderte, dass der Einzelsatz der Mutter und ihr Konzernsatz für dasselbe
-- Geschäftsjahr gleichzeitig existieren. `apply` speicherte den Konzernsatz
-- unter `mutterMandantId` und verdrängte damit den Einzelsatz — oder
-- scheiterte an genau diesem Constraint.
--
-- Lösung: `konzernEinheitId` (nullable) kennzeichnet den Konzernsatz.
-- Zwei PARTIELLE Unique-Indizes statt eines Spalten-Defaults:
--
--   Ein Spalten-DEFAULT wie `konzernEinheitId int NOT NULL DEFAULT 0` wäre
--   NICHT ausreichend. Postgres vergleicht beim Zeilenscan auch
--   COALESCE-Ausdrücke des Indizes: zwei Einzelsätze (0,0) und ein
--   Konzernsatz (0,0) wären weiterhin ein Konflikt. Erst ein partieller
--   Index mit `WHERE` trennt die beiden Räume.

-- 1) Spalten ergänzen
ALTER TABLE "bilanz" ADD COLUMN "konzernEinheitId" UUID;
ALTER TABLE "guv"    ADD COLUMN "konzernEinheitId" UUID;

-- 2) Alten Global-Constraint entfernen
DROP INDEX IF EXISTS "bilanz_mandantId_geschaeftsjahr_key";
DROP INDEX IF EXISTS "guv_mandantId_geschaeftsjahr_key";

-- 3) Partielle Unique-Indizes: genau dieselbe Schutzwirkung wie vorher,
--    aber getrennt nach Einzelsatz und Konzernsatz.
CREATE UNIQUE INDEX "bilanz_einzelsatz_jahr_uniq"
  ON "bilanz" ("mandantId", "geschaeftsjahr")
  WHERE "konzernEinheitId" IS NULL;

CREATE UNIQUE INDEX "bilanz_konzernsatz_einheit_jahr_uniq"
  ON "bilanz" ("mandantId", "geschaeftsjahr", "konzernEinheitId")
  WHERE "konzernEinheitId" IS NOT NULL;

CREATE UNIQUE INDEX "guv_einzelsatz_jahr_uniq"
  ON "guv" ("mandantId", "geschaeftsjahr")
  WHERE "konzernEinheitId" IS NULL;

CREATE UNIQUE INDEX "guv_konzernsatz_einheit_jahr_uniq"
  ON "guv" ("mandantId", "geschaeftsjahr", "konzernEinheitId")
  WHERE "konzernEinheitId" IS NOT NULL;

-- 4) Fremdschlüssel auf die Konsolidierungseinheit.
--    ON DELETE SET NULL: wird eine Einheit geloescht, bleiben die
--    Konzernsaetze als Einzelsaetze stehen, statt zu verschwinden —
--    sie sind Aufzeichnungsstand.
ALTER TABLE "bilanz"
  ADD CONSTRAINT "bilanz_konzernEinheitId_fkey"
  FOREIGN KEY ("konzernEinheitId") REFERENCES "konsolidierungs_einheit"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "guv"
  ADD CONSTRAINT "guv_konzernEinheitId_fkey"
  FOREIGN KEY ("konzernEinheitId") REFERENCES "konsolidierungs_einheit"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
