-- BEFUND 2026-10-22 (Nachtrag 83): Die Custom-Domain-Verifikation hat den
-- Token, den sie selbst ausgestellt hat, **nirgends gespeichert**.
--
-- `startVerification()` erzeugte einen Token und gab ihn dem Client mit
-- ("banz-verify=<token>" als TXT-Record-Wert). `verifyVerification()` las den
-- erwarteten Wert aber **aus dem DNS selbst** und verglich ihn nur mit dem
-- oeffentlichen DNS. Damit war die Pruefung:
--
--     "Es existiert ein TXT-Record mit dem Praefix 'banz-verify='
--      unter _banz-verify.<domain>."
--
-- und nicht:
--
--     "Der TXT-Record enthaelt genau das Token, das diese Kanzlei
--      gerade erhalten hat."
--
-- Folge: Ein Record, der von einem anderen Verifikationslauf (oder einem
-- Dritten) stammte, liess die Verifikation gelingen. Zusammen mit der
-- case-sensitiven Domain-Eindeutigkeit (zwei Kanzleien konnten dieselbe
-- Domain beanspruchen) war das eine Uebernahme fremder Domains.
--
-- Die Spalten binden die Verifikation an die Anfrage:
--   - `customDomainVerificationToken`         — das ausgestellte Token
--   - `customDomainVerificationRequestedAt`    — wann es ausgestellt wurde
--
-- Nach einer erfolgreichen Verifikation wird das Token geloescht (einmalig
-- verwendbar). Ohne Token ist keine Verifikation moeglich (fail-closed).

ALTER TABLE "kanzlei"
  ADD COLUMN "customDomainVerificationToken" TEXT,
  ADD COLUMN "customDomainVerificationRequestedAt" TIMESTAMP(3);
