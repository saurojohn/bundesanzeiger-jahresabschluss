# Verfahrensdokumentation (GoBD Rz. 10.3)

> **ENTWURF — Freigabe durch Compliance steht aus.**
>
> | Feld | Inhalt |
> |---|---|
> | Stand | 2026-10-20, Code-Stand `95dceed` |
> | Erstellt von | Entwicklung (aus dem Quelltext abgeleitet) |
> | **Freigabe durch** | ☐ Compliance-Beauftragter — ☐ Wirtschaftsprüfer — Datum: __________ |
> | Nächste Review | nach dem ersten externen GoBD-Audit |
> | Grundlage | § 146 Abs. 1 AO, § 147 AO, GoBD Rz. 10.3, IDW PS 880 |
>
> **Was dieses Dokument ist:** die Beschreibung des Verfahrens, wie die
> Anwendung Daten erfasst, prüft, signiert, einreicht und aufbewahrt — jede
> Aussage ist mit einer Stelle im Quelltext belegt.
>
> **Was dieses Dokument nicht ist:** keine Aussage über den organisatorischen
> Ablauf der Kanzlei (wer macht was, in welcher Reihenfolge, mit welchem
> Medium). Diese Punkte stehen in [Abschnitt 9](#9-offene-punkte) und müssen
> von der Kanzlei bestätigt werden — die Software kann sie nicht belegen.

---

## 1. Zweck und Geltungsbereich

Dieses Dokument beschreibt das Verfahren, mit dem die Anwendung
`bundesanzeiger-jahresabschluss` Buchhaltungs- und Abschlussdaten erfasst,
gesichert und aufbewahrt. Es gilt für:

- alle Mandanten einer Kanzlei, die Jahresabschlüsse nach § 314 HGB
  veröffentlichen,
- alle Nutzerrollen der Anwendung (siehe [Abschnitt 3](#3-rollen-und-verantwortlichkeiten)),
- alle Datenarten, die der Aufbewahrungspflicht unterliegen: Abschluss-PDFs,
  signierte PDFs, Audit-Trail und Einreichungsbelege.

**Nicht im Geltungsbereich:** die Kommunikation mit der Kanzlei-Website
(WordPress), die erzeugte E-Bilanz-XBRL-Datei als Eingangsformat beim
Finanzamt, sowie der Datei-Upload in ERiC/eBilanz-Online — beides findet
außerhalb der Anwendung statt.

## 2. Begriffe

| Begriff | Bedeutung in diesem Dokument |
|---|---|
| **Datensatz** | ein in der Anwendung geführter fachlicher Sachverhalt (Bilanz, GuV, Anhang, Jahresabschluss) |
| **Beleg** | das erzeugte PDF eines Datensatzes; im Beweis-Archiv mit Object-Lock abgelegt |
| **Entwurf** | ein Datensatz im Bearbeitungsstatus `DRAFT` bzw. ein daraus erzeugtes PDF **ohne** Object-Lock |
| **Protokolleintrag** | ein Datensatz in `audit_log` mit Vorher-/Nachher-Zustand |
| **WORM-Archiv** | der S3-Bucket mit Object-Lock `COMPLIANCE` und 3650 Tagen Retention |
| **Endabnahme** | die qeS-Signatur des **Jahresabschlusses** selbst (`signaturEbene = ABSCHLUSS`) |
| **Bestandteilprüfung** | die qeS-Signatur eines einzelnen Bestandteils (`signaturEbene = BESTANDTEIL`) |

## 3. Rollen und Verantwortlichkeiten

Die Rollen sind **mandantenbezogen** vergeben: eine Rolle gilt immer für
einen bestimmten Mandanten. Wer auf Mandant A Wirtschaftsprüfer ist, ist es
auf Mandant B nicht.

| Rolle | Aufgabe im Verfahren | Beleg im Code |
|---|---|---|
| **GF** (Geschäftsführer) | erfasst und prüft eigene Daten | `UserMandantRole.rolle = 'GF'` |
| **STEUERBERATER** | erfasst, schließt ab, **reicht ein**, meldet die Veröffentlichung | `abschluss.controller.ts` — `@Roles('STEUERBERATER', 'KANZLEI_ADMIN')` |
| **KANZLEI_ADMIN** | Kanzlei-Ebene: Mandantenverwaltung, Branding, API-Schlüssel, Abmeldung | `mandant.service.ts` — `assertKanzleiAdmin` |
| **WIRTSCHAFTSPRUEFER** | prüft (Plausibilitätsregeln, Vier-Augen-Freigabe) und **bescheinigt** (Endabnahme) | `signatur.controller.ts` — `@Roles('WIRTSCHAFTSPRUEFER')` an `sign-abschluss` |
| **SYSTEM_ADMIN** | technische Administration; umgeht die Rollenprüfung | `roles.guard.ts` — `if (user.globalRole === 'SYSTEM_ADMIN') return true;` |

**Die Trennung, auf die es ankommt:** Der Wirtschaftsprüfer **bescheinigt**,
die Kanzlei **reicht ein**. Das ist im System erzwungen — die
Einreichungsrouten sind auf `STEUERBERATER` und `KANZLEI_ADMIN` beschränkt
(`abschluss.controller.ts`), die Endabnahme auf `WIRTSCHAFTSPRUEFER`
(`signatur.controller.ts`). Ein Wirtschaftsprüfer kann also keinen Abschluss
einreichen, und ein Berater kann keinen abschließen.

## 4. Das Verfahren

### 4.1 Erfassung der Bestandteile

| Schritt | Was passiert | Beleg |
|---|---|---|
| 1.1 | Bilanz, GuV und Anhang werden je Mandant und Geschäftsjahr erfasst | `bilanz.controller.ts`, `guv.controller.ts`, `anhang.controller.ts` |
| 1.2 | Jeder Datensatz hat einen Bearbeitungsstatus: `DRAFT` → `VALIDATED` → `ARCHIVED`. Der Übergang ist **monoton** — ein abgeschlossener Datensatz wird nicht zurückgesetzt | `common/utils/status-transition.ts` |
| 1.3 | Ein Entwurf (DRAFT) ist veränderbar. Erst `VALIDATED` heißt „abgeschlossen" | `bilanz.service.ts` — `assertMandantNichtArchiviert`, Statusprüfung je Schreibpfad |
| 1.4 | Wird ein PDF erzeugt, entstehen **zwei** Arten: ein Entwurf (eigener EntityType, eigener Key-Praefix `entwuerfe/`, **kein** Object-Lock) und ein Beweisobjekt (Object-Lock COMPLIANCE) | `pdf.service.ts` — `entityTypeForPdf(type, istEntwurf)`, `buildObjectKey` |
| 1.5 | Jede Änderung erzeugt einen Protokolleintrag mit Vorher-/Nachher-Zustand | `audit.interceptor.ts` + 51 Aufrufstellen in den Fachservices |

### 4.2 Abschluss des Jahresabschlusses (`DRAFT` → `FINALIZED`)

| Schritt | Was passiert | Beleg |
|---|---|---|
| 2.1 | `POST /api/jahresabschluss` verknüpft die drei Sätze des Geschäftsjahres. Sie werden **ermittelt**, nicht vom Aufrufer benannt | `create-jahresabschluss.dto.ts` — keine IDs, nur Jahr |
| 2.2 | `POST /api/jahresabschluss/:id/finalize` prüft **fail-closed**: Mandant nicht archiviert · Bilanz geht auf · GuV weist ein Ergebnis aus · Anhang ohne offene Platzhalter · alle drei Sätze nicht mehr in Bearbeitung | `abschluss.service.ts` — `finalize()` |
| 2.3 | Zusätzlich: der **Saldoabgleich** zwischen `A.V.` (Bilanz) und dem GuV-Ergebnis sperrt. Ausnahme nur mit schriftlicher Begründung (≥ 20 Zeichen), die in den Audit-Trail geht | `abschluss.service.ts` — `abweichungRelevant && !begruendung` |
| 2.4 | Ein Zurücksetzen auf `DRAFT` ist **nicht** erlaubt. Ein korrigierter Abschluss wird als **neuer** Abschluss angelegt | `abschluss.service.ts` — `if (abschluss.status !== 'DRAFT') throw new ConflictException(...)` |

### 4.3 Signatur (`FINALIZED` → `SIGNED`)

| Schritt | Was passiert | Beleg |
|---|---|---|
| 3.1 | Nur ein **abgeschlossener** Abschluss kann signiert werden; ein `DRAFT` wird mit 409 abgewiesen | `signatur.service.ts` — `signAbschluss()` |
| 3.2 | Signiert wird mit einem P12-Token (qeS nach § 126 AO); das Zertifikat wird gegen die konfigurierten Vertrauens-Issuer geprüft, eine Sperrliste wird geprüft (fail-closed, wenn die Sperrliste nicht erreichbar ist) | `signatur.service.ts` — `trustedIssuers`, `requireRevocationCheck` |
| 3.3 | Das signierte PDF geht in das WORM-Archiv (Object-Lock COMPLIANCE, 3650 Tage, Legal Hold) | `signatur.service.ts` — `uploadToWorm(...)` |
| 3.4 | WORM-Manifest und Signatur-Datensatz werden in **einer** Transaktion geschrieben — ein signiertes PDF ohne Datensatz kann nicht entstehen | `signatur.service.ts` — `prisma.$transaction(...)` |
| 3.5 | Der Zeitstempel kommt vom TSA. Im Mock-Modus (ohne `TSA_URL`) trägt das Ergebnis eine **sichtbare Warnung**, dass es nicht freigabefähig ist | `signatur.service.ts` — `warnings` |
| 3.6 | Das Feld `signaturEbene` trennt die Endabnahme (`ABSCHLUSS`) von der Bestandteilprüfung (`BESTANDTEIL`) | `signature.signaturEbene` |
| 3.7 | Eine **Bestandteil**-Signatur (Bilanz/GuV/Anhang) ist erlaubt und wird in der Statusanzeige getrennt ausgewiesen: „⚠ 1× Bestandteil geprüft — nicht signiert" | `signatur.service.ts` — `anzahlBestandteilPruefungen` |

### 4.4 Einreichung (`SIGNED` → `SUBMITTED`)

**Die Anwendung reicht nicht selbst beim Bundesanzeiger ein.** Es gibt keine
öffentliche Submission-API des Verlags; der Portalzugang hängt an externen
Bedingungen (Portal-Zugang, Vorgangsnummer, Gebühren).

Was die Anwendung leistet: Sie protokolliert, **was draußen passiert ist.**

| Schritt | Was passiert | Beleg |
|---|---|---|
| 4.1 | Die Kanzlei importiert die Datei in ERiC/eBilanz-Online und sendet sie ab. Das Portal vergibt eine **Bestellnummer** | außerhalb der Anwendung |
| 4.2 | `POST /api/jahresabschluss/:id/einreichen` nimmt die Bestellnummer entgegen. Sie ist **Pflicht** (≥ 5 Zeichen) und **eindeutig** (`@unique` in der Datenbank) | `abschluss.service.ts` — `einreichen()` |
| 4.3 | Ohne Signatur gibt es keine Einreichung (409). Ohne signiertes PDF im WORM ebenso | `abschluss.service.ts` |
| 4.4 | Ein `BanzSubmission`-Beleg entsteht: Kanal, Nutzlast (das signierte PDF), SHA-256 der Nutzlast, Bestellnummer, Zeitstempel | `banz_submission` |
| 4.5 | Der Übergang steht im Audit-Trail | `abschluss.service.ts` — `auditService.record(...)` |

### 4.5 Veröffentlichung (`SUBMITTED` → `PUBLISHED`)

| Schritt | Was passiert | Beleg |
|---|---|---|
| 5.1 | Die Kanzlei stellt im Portal fest, dass der Abschluss veröffentlicht ist, und meldet das: `POST /api/jahresabschluss/:id/veroeffentlichen` | `abschluss.service.ts` — `veroeffentlichen()` |
| 5.2 | Nur ein **eingereichter** Abschluss kann als veröffentlicht gemeldet werden (409) | `abschluss.service.ts` |
| 5.3 | `veroeffentlichtAm` wird geschrieben, der `BanzSubmission`-Beleg steht auf `PUBLISHED`, der Übergang steht im Audit-Trail | `abschluss.service.ts` |

## 5. Aufbewahrung und Unveränderlichkeit

| Gegenstand | Ablage | Schutz | Retention |
|---|---|---|---|
| Abschluss-/Bestandteil-PDF (abgeschlossen) | S3, Key `mandant/<mandantId>/<typ>/<gj>/<uuid>.pdf` | Object-Lock **COMPLIANCE**, Legal Hold **ON** | **3650 Tage** (10 Jahre) |
| Signiertes PDF (qeS) | S3, Key `mandant/<mandantId>/<typ>-signed/…` | Object-Lock **COMPLIANCE**, Legal Hold **ON** | **3650 Tage** |
| Entwurfs-PDF | S3, Key `entwuerfe/mandant/…` | **kein** Object-Lock (Arbeitsstand) | keine |
| Protokoll (Audit-Trail) | PostgreSQL `audit_log` | Hash-Kette, siehe [6](#6-nachvollziehbarkeit) | DB-Aufbewahrung |
| Einreichungsbeleg | PostgreSQL `banz_submission` (Nutzlast + Hash) | Prüfsummen, Fremdschlüssel-Logik | DB-Aufbewahrung |

**Begründung der Entwurfs-Ausnahme:** Ein Entwurf ist ein Arbeitsstand — er
wird geändert, verworfen, neu erzeugt. Unwiderruflich archiviert wäre er
danach ein „Beweis" für einen Stand, den niemand freigegeben hat, und er
wäre nach zehn Jahren **nicht mehr löschbar**. Der Entwurf trägt deshalb
einen eigenen EntityType und einen eigenen Key-Praefix und ist damit im
Register eindeutig von einem Beweisobjekt unterscheidbar.

**Nachweis im System:** `audit-worm-retention.sh` prüft jede Zeile des
Registers auf `COMPLIANCE` und mindestens 3650 Tage. Entwürfe
(`object_lock_mode = 'NONE'`) werden übersprungen — und **gezählt**, damit
der Ausschluss sichtbar bleibt.

## 6. Nachvollziehbarkeit

### 6.1 Protokoll

Jede fachliche Änderung erzeugt einen Eintrag in `audit_log` mit: User,
Mandant, Zeitpunkt, Aktion, Entity-Typ und -ID, Vorher-/Nachher-Zustand,
IP und User-Agent. Der Eintrag entsteht **im selben Request**, der die
Änderung ausführt — er wird nicht nachgeliefert. (BEFUND: Vor der Korrektur
fehlte der Eintrag in 80 % der Fälle im Moment der Antwort; siehe
Nachtrag 56.)

### 6.2 Hash-Kette

```
entryHash = SHA-256(prevHash + kanonischer Inhalt des Eintrags)
prevHash  = entryHash des Vorgängers
Genesis   = "0" × 64
```

Die **Reihenfolge kommt aus der Datenbank** (`sequenz`, monoton), nicht aus
dem Aufrufer. Deshalb können sich zwei Instanzen nicht gegenseitig
überholen, und die Berechnung ist idempotent. Nachgewiesen mit zwei echten
Instanzen auf derselben Datenbank, 60 abwechselnde Schreibvorgänge je Lauf,
vier Läufe: `integrity` → **OK** (Nachtrag 45, wiederholt in Nachtrag 63).

**Der Hash schützt den Inhalt**, nicht die veränderbaren Fremdschlüssel
(`mandantId`, `userId`, `jahresabschlussId`, `kanzleiId`): die Datenbank
setzt sie bei einem Löschen auf `NULL`, und ein Hash, der sich ändert,
während er gespeichert bleibt, wäre ein Bruch ohne Ursache.

### 6.3 Integritätsprüfung

`GET /api/audit/integrity` prüft die Kette vollständig und meldet:

| Status | Bedeutung |
|---|---|
| `OK` | jeder Eintrag ist verifiziert |
| `PARTIAL` | es gibt Einträge ohne Hash (die Kette läuft noch nach) |
| `BROKEN` | ein Eintrag passt nicht zu seinem Hash (Manipulation oder Datenfehler) |
| `NO_ENTRIES` | es gibt nichts zu prüfen — ausdrücklich **kein** „OK" |

Zusätzlich weist `/health/ready` das Alter des ältesten ungehashten
Eintrags aus. Das ist die Condition auf Alter des ältesten Eintrags: ein
Alter über der Schwelle (60 s) bedeutet, dass die Kette steht.

## 7. Zugriffsschutz und Mandantentrennung

| Maßnahme | Umsetzung |
|---|---|
| **Mandantentrennung** | zweifach: `MandantGuard` (HTTP) **und** `assertMandantAccess` (Service-Ebene). Die Service-Prüfung greift auch dann, wenn ein Aufruf ohne Guard erfolgt |
| **Rollenprüfung** | `RolesGuard`, mandantenbezogen. Alle Rollen des Mandanten zählen, nicht nur die erste |
| **Vier-Augen-Prüfung** | Die WP-Freigabe einer Plausibilitätsprüfung kann nicht die eigene sein (`wp-notiz.service.ts`) — die Selbstbestätigung wird mit 403 abgewiesen |
| **Passwörter** | bcrypt |
| **Zwei-Faktor** | TOTP (RFC 6238), Secret AES-256-GCM verschlüsselt. Das Aktivieren verlangt das **Passwort** (erneute Authentifizierung), das Deaktivieren Passwort **und** Code |
| **Sitzung** | Access Token 15 Minuten, Refresh mit Rotation; die Sitzung wird serverseitig widerrufbar geführt |
| **Zertifikatsprüfung** | Aussteller muss in `SIGNATURE_TRUSTED_ISSUERS` stehen; im Pilot muss der Aussteller eingetragen werden. Selbstsignierte Zertifikate sind per Default **nicht** zugelassen |
| **Sperrlisten** | fail-closed: ist die CRL nicht erreichbar, gilt der Sperrstatus als unbekannt und das Zertifikat als nicht vertrauenswürdig |

## 8. IT-Maßnahmen (Auswahl)

| Maßnahme | Beleg |
|---|---|
| Backup & Restore | `docs/DISASTER-RECOVERY.md` — RPO/RTO je Datenbereich, Snapshot- und Replica-Strategie |
| Geheimnisse | Hetzner Cloud-Secrets / Vault, 3-2-1-Backup |
| WORM-Archiv | Object-Lock COMPLIANCE im Bucket; das Archiv selbst ist **append-only** |
| Restore-Test | **noch nicht automatisiert** — siehe [9](#9-offene-punkte), TODO-8.6 |

## 9. Offene Punkte

Diese Punkte kann die Software nicht belegen. Sie sind vom Compliance-
Beauftragten zu beantworten, bevor das Dokument freigegeben wird.

| # | Offener Punkt | Warum die Software ihn nicht belegen kann |
|---|---|---|
| 1 | **Wer ist in der Kanzlei für welchen Schritt zuständig?** | Rollen in der Anwendung beschreiben Berechtigungen, nicht Personen. Die Zuordnung „GF erfasst, STEUERBERATER schließt ab, WP bescheinigt" ist eine Festlegung der Kanzlei |
| 2 | **Zuordnungsrichtlinie (§ 158 AO)** | Die Anwendung trennt Mandant / Geschäftsjahr / Entität technisch. Ob und wie ein Beleg einem Datensatz zugeordnet wird, ist eine kanzleispezifische Regel |
| 3 | **Empfangsbestätigung des Portals** | Die Anwendung speichert das signierte PDF und die Bestellnummer. Die vom Portal erzeugte Empfangsbestätigung wird derzeit **nicht** als Beleg erfasst — das ist eine Lücke, die vor dem Pilot zu schließen ist |
| 4 | **Korrekturen nach der Signatur** | Die Software erzeugt bewusst keine Sperre, sondern weist „ABWEICHEND" aus; die alte Signatur bleibt im WORM. Ob eine erneute Signatur Pflicht ist, ist eine Fachfestlegung |
| 5 | **Verantwortlicher für die Freigabe von Abweichungen** | Der Saldoabgleich lässt sich mit Begründung freigeben. Wer darf das, und wie wird es intern geprüft? |
| 6 | **Längere Aufbewahrungsfristen** | Die Software setzt 10 Jahre (§ 147 AO). Berufshaftung kann längere Fristen verlangen — das ist eine Kanzlei-Entscheidung |
| 7 | **Automatisierter Restore-Test** | TODO-8.6 — ist bis zum Produktivbetrieb zu bauen; die Beschreibung im DR-Plan ist derzeit die einzige Grundlage |
| 8 | **Pilot-Betriebsfähigkeit des TSA** | Im Mock-Modus trägt jede Signatur eine sichtbare Warnung. Für den Pilot ist ein echter Zeitstempeldienst erforderlich |

## 10. Mitgeltende Unterlagen

| Dokument | Inhalt |
|---|---|
| `docs/GOBD-AUDIT-REPORT.md` | vollständiger Prüfbericht mit allen Messungen und Nachträgen |
| `docs/gobd-architektur.md` | technische Umsetzung der Anforderungen |
| `docs/rollen-rbac.md` | Rollen- und Berechtigungsmodell |
| `docs/DISASTER-RECOVERY.md` | Backup, RPO/RTO, Recovery-Prozeduren |
| `docs/banz-schemata.md` | Datenmodell und Schemata |
| `docs/IKS-Beschreibung.md` | Kontrollmatrix zu diesem Verfahren |
| `backend/scripts/audit-worm-retention.sh` | maschinelle Prüfung der Aufbewahrung |
| `AGENTS.md` | Engineering-Regeln, nach denen diese Anwendung gebaut und geprüft wird |
