-- Archivierung statt Loeschung (§ 147 AO vs. DSGVO).
--
-- BEFUND 2026-10-09: `DELETE /api/mandant/:id` war ein Hard Delete. Über
-- `onDelete: Cascade` nahm er Bilanz, GuV, Anhang, Jahresabschluss und die
-- qeS-Signaturen mit; ausserdem wurden alle Audit-Einträge des Mandanten
-- auf `mandantId = null` gesetzt. Der Pfad ist jetzt gesperrt (HTTP 409 bei
-- Bestand), damit die Zehnjahresfrist nicht mehr über die Anwendung
-- umgangen werden kann.
--
-- Damit ein Mandant, der weg muss, trotzdem aus dem aktiven Bestand
-- verschwinden kann, bekommt er einen Archivzustand. Ein einziger
-- Zeitstempel, kein Boolean: zwei Felder, die auseinanderlaufen können,
-- sind genau die Form von "grün, aber stimmt nicht", die in diesem Audit
-- mehrfach teuer war.

-- Spalten sind nullable: bestehende Mandanten bleiben aktiv, ohne Backfill.
ALTER TABLE "mandant" ADD COLUMN "archiviertAt" TIMESTAMP(3);
ALTER TABLE "mandant" ADD COLUMN "archiviertVonId" UUID;

-- Die Schreibpfade fragen den Archivzustand häufig ab (jeder Guard-Pfad),
-- deshalb eigener Index statt eines Präfixes auf kanzleiId.
CREATE INDEX "mandant_archiviertAt_idx" ON "mandant"("archiviertAt");