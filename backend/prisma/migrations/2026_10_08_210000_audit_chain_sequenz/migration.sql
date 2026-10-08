-- Audit-Hash-Kette: monotone Sequenz statt (createdAt, Zufalls-UUID)
--
-- BUGFIX 2026-10-08. Die Kette wurde über `(createdAt, id)` verketten.
-- `id` ist eine ZUFALLS-UUID (uuid v4), die Verarbeitung läuft aber in
-- Einfügereihenfolge (`AuditIntegrityService.enqueue`). Entstehen zwei
-- Einträge in derselben Millisekunde — bei einem Sammel-Import Regelfall —
-- entscheidet die UUID statt der Einfügereihenfolge. Wird der später
-- eingefügte Eintrag mit einer kleineren UUID verarbeitet, findet er den
-- ersten nicht als Vorgänger und beginnt die Kette neu (GENESIS).
--
-- Ein Hash-Kette braucht eine TOTALORDNUNG aus der Datenbank. BIGSERIAL
-- liefert sie unabhängig von Uhr, Client und Zufall.

ALTER TABLE "audit_log" ADD COLUMN "sequenz" BIGSERIAL;

CREATE INDEX "audit_log_kanzleiId_sequenz_idx" ON "audit_log"("kanzleiId", "sequenz");
