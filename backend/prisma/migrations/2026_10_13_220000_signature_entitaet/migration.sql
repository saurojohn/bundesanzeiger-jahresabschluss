-- BEFUND 2026-10-13: Entitaeten-Signaturen (Bilanz/GuV/Anhang) erzeugten
-- keinen `signature`-Datensatz.
--
-- `jahresabschlussId` war NOT NULL. Ohne verknuepften Jahresabschluss konnte
-- ein Datensatz nicht gespeichert werden, und `signatur.service.ts` hat ihn
-- dann bewusst uebersprungen — die API lieferte aber weiterhin eine
-- `signatureId`. Gemessen: diese ID war in keinem Datensatz auffindbar, die
-- Tabelle blieb nach dem Signieren einer Bilanz leer (0 Zeilen), waehrend das
-- Frontend die ID dem Nutzer als "Signatur-ID" anzeigt.
--
-- Der Record traegt jetzt GENAU EINE Bezugsachse:
--   * Jahresabschluss-Signatur -> jahresabschlussId
--   * Entitaeten-Signatur       -> entityType + entityId
--
-- Bestaehende Datensaetze bleiben unberuehrt: `jahresabschlussId` ist fuer
-- sie weiterhin gesetzt, es wird nur die NOT-NOT-Pflicht aufgehoben.

ALTER TABLE "signature" ALTER COLUMN "jahresabschlussId" DROP NOT NULL;

ALTER TABLE "signature" ADD COLUMN "entityType" TEXT;
ALTER TABLE "signature" ADD COLUMN "entityId" UUID;

CREATE INDEX "signature_entityType_entityId_idx" ON "signature"("entityType", "entityId");
