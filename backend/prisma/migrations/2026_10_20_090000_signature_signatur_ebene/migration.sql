-- BEFUND 2026-10-20 (Nachtrag 60, TODO-8.15): Die Bezugsachsen sagten nicht,
-- WAS die Signatur bescheinigt.
--
-- Gemessen: eine GuV-Signatur, deren GuV zu einem Jahresabschluss gehoert,
-- wurde auf die `jahresabschlussId`-Achse gelegt (`entityType`/`entityId`
-- = null). Der Datensatz war damit von einer Abschluss-Signatur nicht
-- unterscheidbar — ein Auditor las „der Jahresabschluss ist signiert",
-- obwohl nur die GuV geprueft war.
--
-- ENTSCHEIDUNG 2026-10-20: Komponentensignaturen bleiben zulaessig (in der
-- Praxis prueft der WP die GuV, bevor der Abschluss final ist), werden
-- aber getrennt gekennzeichnet:
--
--   * "ABSCHLUSS"   — der Jahresabschluss selbst wurde signiert
--   * "BESTANDTEIL" — ein Bestandteil wurde geprueft
--
-- Der Default ist "BESTANDTEIL" — das ist der **sichere** Default: eine
-- Komponentensignatur wird nicht versehentlich als Endabnahme gelesen.
--
-- Die Altbestandszeilen werden nachgetragen: als "ABSCHLUSS" gilt nur, was
-- selbst ein WORM-Objekt vom Typ "ABSCHLUSS_PDF_SIGNED" mit derselben ID
-- traegt. Alles andere bleibt "BESTANDTEIL" — im Zweifel die niedrigere
-- Stufe.

ALTER TABLE "signature" ADD COLUMN "signaturEbene" TEXT NOT NULL DEFAULT 'BESTANDTEIL';

UPDATE "signature" s
   SET "signaturEbene" = 'ABSCHLUSS'
 WHERE s."entityType" IS NULL
   AND s."entityId" IS NULL
   AND s."jahresabschlussId" IS NOT NULL
   AND EXISTS (
       SELECT 1 FROM "worm_object" w
        WHERE w."entityType" = 'ABSCHLUSS_PDF_SIGNED'
          AND w."entityId" = s."jahresabschlussId"
   );
