-- BEFUND 2026-10-20 (Nachtrag 62, TODO-8.10): `banzBestellnummer` war im
-- Kommentar als `@unique` beschrieben, im Schema aber **nicht** eindeutig.
--
-- Zwei Jahresabschluesse koennten dieselbe BAnz-Vorgangsnummer tragen. Die
-- Eindeutigkeit ist eine Eigenschaft der **Daten**, nicht des Anwendungs-
-- codes: der Service prueft sie zwar, aber zwei gleichzeitige Einreichungen
-- laufen an dieser Pruefung vorbei (Pruefen, dann Schreiben — die Luecke
-- dazwischen).
--
-- Der Schreibpfad (Nachtrag 62) macht die Nummer zur Pflicht: sie ist der
-- einzige Beleg, dass die Einreichung beim Bundesanzeiger angekommen ist.
-- Zwei Abschluesse auf denselben Vorgang waeren dann ein Datenfehler, kein
-- Zufall — und der muesste sich ausschliessen lassen.
--
-- Nullable bleibt die Spalte: NULL bedeutet "nicht eingereicht", und
-- mehrere Abschluesse ohne Einreichung vertragen sich (Postgres erlaubt
-- mehrere NULLs in einem UNIQUE-Index).

ALTER TABLE "jahresabschluss"
  ADD CONSTRAINT "jahresabschluss_banzBestellnummer_key" UNIQUE ("banzBestellnummer");
