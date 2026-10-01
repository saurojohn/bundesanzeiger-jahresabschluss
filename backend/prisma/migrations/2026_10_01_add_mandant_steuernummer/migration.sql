-- ============================================================================
-- Migration: Mandant.steuernummer ergänzen
-- Datum: 2026-10-01
--
-- Warum: Der E-Bilanz-Generator schrieb bis hierher die Handelsregisternummer
-- in das Formularfeld `genInfo.companyInfo.taxNumber` und erfindete sonst
-- `MANDANT-<id>`. Beides ist eine falsche Angabe gegenüber dem Finanzamt.
-- Mit diesem Feld kann die echte Steuernummer gepflegt werden.
--
-- Nullable bleibt das Feld bewusst: bei Neuanlage muss die Steuernummer
-- nachgepflegt werden. Ein NOT NULL mit Default würde entweder einen
-- erfundenen Wert in die Datenbank schreiben oder die Migration an
-- bestehenden Mandanten scheitern lassen.
-- ============================================================================

ALTER TABLE mandant
  ADD COLUMN IF NOT EXISTS "steuernummer" TEXT;

COMMENT ON COLUMN mandant."steuernummer"
  IS 'Finanzamt-Steuernummer, z.B. 12/345/67890 (E-Bilanz genInfo.companyInfo.taxNumber). Bis 2026-10-01 nicht vorhanden — der Generator schrieb stattdessen die Handelsregisternummer.';
