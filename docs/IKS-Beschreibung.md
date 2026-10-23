# Interne Kontrollsystem (IKS) — Beschreibung

> **ENTWURF — Freigabe durch Compliance und Wirtschaftsprüfer steht aus.**
>
> | Feld | Inhalt |
> |---|---|
> | Stand | 2026-10-20, Code-Stand `95dceed` |
> | Grundlage | § 146 Abs. 1 AO, § 147 AO, IDW PS 880 (vom WP zu bestätigen), GoBD |
> | Prozessbeschreibung | [`docs/VERFAHRENSDOKUMENTATION.md`](./VERFAHRENSDOKUMENTATION.md) |
> | **Freigabe durch** | ☐ Compliance-Beauftragter — ☐ Wirtschaftsprüfer — Datum: __________ |
>
> **Was dieses Dokument ist:** die Zuordnung von Risiken zu Kontrollen entlang
> des Verfahrens, jeweils mit dem **technischen Nachweis** im System.
>
> **Was es nicht ist:** kein Testbericht. Die Wirksamkeit einer Kontrolle
> beurteilt der Wirtschaftsprüfer anhand des Systems und der
> Stichproben; dieses Dokument sagt, *dass* die Kontrolle existiert und
> *wo* sie nachweisbar ist.

---

## 1. Die Kontrolllogik

Drei Grundsätze, die jede Kontrolle unten tragen:

1. **Fail-closed.** Eine Kontrolle, die im Fehlerfall durchlässt, ist keine
   Kontrolle. Die Umsetzung ist jeweils eine Ablehnung mit Fehlermeldung,
   nicht ein Hinweis.
2. **Zwei Schichten.** Wo eine Kontrolle sicherheitskritisch ist, gibt es
   sie auf mehreren Ebenen (z. B. Mandantentrennung im HTTP-Guard **und** im
   Service). Die zweite Schicht fängt den Fall, dass die erste umgangen
   wird.
3. **Der Nachweis ist maschinell.** Jede Kontrolle verweist auf einen
   wiederverwendbaren Test. Eine Kontrolle ohne Test ist eine Behauptung.

## 2. Kontrollmatrix

### 2.1 Erfassung der Bestandteile

| # | Risiko | Kontrolle | Nachweis im System | Verantwortlich |
|---|---|---|---|---|
| K-1 | Ein Beleg wird einem fremden Mandanten zugeordnet | **Mandantentrennung, zweifach**: `MandantGuard` (HTTP) und `assertMandantAccess` (Service) | `e2e/mandant-tiefenschutz.e2e.spec.ts` — der Service weist einen fremden Mandanten auch dann ab, wenn der Guard umgangen wird | STEUERBERATER / KANZLEI_ADMIN |
| K-2 | Jemand sieht Daten, für die er keine Rolle hat | Rollenprüfung **je Mandant**: alle Rollen des Mandanten zählen; eine Rolle aus einem anderen Mandanten berechtigt nicht | `roles.guard.ts`; `e2e/rollen-eskalation.e2e.spec.ts` | KANZLEI_ADMIN |
| K-3 | Ein abgeschlossener Datensatz wird nachträglich verändert | **Monotone Statusfolge** (`DRAFT` → `VALIDATED` → `ARCHIVED`); ein Zurücksetzen ist nicht möglich. Der **Vier-Augen-Freigabemarker** `APPROVED` ist der Endzustand des Feldes: aus ihm ist kein Statuswechsel mehr möglich — er weist die Prüfung im signierten und veröffentlichten Dokument aus (Nachtrag 81) | `common/utils/status-transition.ts`; `e2e/vier-augen-marker.e2e.spec.ts` | STEUERBERATER |
| K-4 | Ein Entwurf wird als verbindlicher Beleg behandelt | Entwurfs-PDF trägt **eigenen EntityType, eigenen Prefix und kein Object-Lock**; der WORM-Wächter zählt die Entwürfe getrennt | `e2e/pdf-entwurf.e2e.spec.ts` — der Nachweis erfolgt am **Objekt im Speicher**, nicht nur im Register | STEUERBERATER |
| K-5 | Eine Änderung ohne Nachweis (kein Protokolleintrag) | Jede Mutation erzeugt einen Protokolleintrag **im selben Request** | `e2e/audit-quittierung.e2e.spec.ts` — die Zusage wird im selben Request geprüft, nicht über ein Zeitfenster | KANZLEI_ADMIN |

### 2.2 Abschluss des Jahresabschlusses

| # | Risiko | Kontrolle | Nachweis im System | Verantwortlich |
|---|---|---|---|---|
| K-6 | Ein unvollständiger Abschluss wird abgeschlossen | **Fail-closed Vollständigkeitsprüfung**: Bilanz geht auf, GuV weist Ergebnis aus, Anhang ohne Platzhalter, alle drei Sätze abgeschlossen | `e2e/jahresabschluss-finalize.e2e.spec.ts` — jede Sperre einzeln | STEUERBERATER |
| K-7 | Eine Bilanz, die nicht aufgeht, wird dennoch publiziert | **Saldo-Gate** im PDF-Pfad (400, `BILANZ_NICHT_SALDOSTIMMIG`) — unabhängig vom Abschluss-Pfad | `pdf.service.ts` — `assertBilanzVollstaendigUndSaldostimmig()` | STEUERBERATER |
| K-8 | Der Abschluss geht trotz Bilan-/GuV-Abweichung durch | **Saldoabgleich sperrt**, Ausnahme nur mit schriftlicher Begründung (≥ 20 Zeichen), die im Audit-Trail steht | `e2e/jahresabschluss-finalize.e2e.spec.ts` — der Beleg wird im Audit-Trail geprüft, nicht nur in der Antwort | STEUERBERATER, Freigabe durch KANZLEI_ADMIN |
| K-9 | Ein falscher Abschluss wird nachträglich korrigiert und geht trotzdem raus | Zurücksetzen ist nicht erlaubt; ein korrigierter Abschluss ist ein **neuer** | `abschluss.service.ts` — 409 bei erneutem Abschließen | STEUERBERATER |
| K-10 | Die Oberfläche meldet einen Abschluss als erfolgreich, den der Server abgelehnt hat | Die Anzeige folgt der **Serverantwort**, nicht dem HTTP-Status: Überschrift, Farbe und Häkchen stammen aus `bestanden` | `frontend/e2e/jahresabschluss.spec.ts` — die Prüfung der semantischen Zusage steht **vor** der Attributprüfung | STEUERBERATER |

### 2.3 Signatur (Endabnahme)

| # | Risiko | Kontrolle | Nachweis im System | Verantwortlich |
|---|---|---|---|---|
| K-11 | Ein nie abgeschlossener Abschluss wird signiert | **Status-Sperre**: signiert wird nur `FINALIZED` (Erstsignatur) oder `SIGNED` (Korrektur nach einer Änderung — Nachtrag 78) | `e2e/jahresabschluss-signatur.e2e.spec.ts` | WIRTSCHAFTSPRUEFER |
| K-12 | Ein nicht zugelassenes Zertifikat beglaubigt eine Abschluss | Aussteller muss in `SIGNATURE_TRUSTED_ISSUERS` stehen; selbstsignierte Zertifikate sind per Default **nicht** zugelassen | `signatur.service.ts` — `trustedIssuers`; Konfiguration im Pilot prüfen | WIRTSCHAFTSPRUEFER |
| K-13 | Ein gesperrtes Zertifikat wird akzeptiert | Sperrlisten-Prüfung, **fail-closed**: nicht erreichbare CRL ⇒ Zertifikat gilt als nicht vertrauenswürdig | `signatur.service.ts` — `requireRevocationCheck` | WIRTSCHAFTSPRUEFER |
| K-14 | Ein signiertes PDF ohne Signatur-Datensatz (oder umgekehrt) | Manifest und Signatur-Record in **einer** Transaktion | `signatur.service.ts` — `prisma.$transaction(...)` | WIRTSCHAFTSPRUEFER |
| K-15 | Ein Bestandteil-Signatur wird als Endabnahme gelesen | **Modellfeld `signaturEbene`** (`ABSCHLUSS` / `BESTANDTEIL`); die Status-API zählt für den Abschluss nur die Abschluss-Signaturen, die Oberfläche zeigt „⚠ 1× Bestandteil geprüft — nicht signiert" | `e2e/signatur-bezugsachse.e2e.spec.ts` — „der Jahresabschluss gilt NICHT als signiert, wenn nur die Bilanz geprüft wurde" | WIRTSCHAFTSPRUEFER |
| K-16 | Die vorgelegten Daten weichen von der signierten Fassung ab | Die Signatur **sperrt nicht** (eine Korrektur erzeugt zwingend eine neue Signatur), aber die Abweichung wird sichtbar ausgewiesen (`ABWEICHEND`) **und die Einreichung wird gesperrt** (409, Nachtrag 78) | `e2e/signatur-abweichung.e2e.spec.ts`; `frontend/e2e/signatur.spec.ts` — `SignaturStatusBadge` | WIRTSCHAFTSPRUEFER |
| K-17 | Ein Zeitstempel fehlt und wird übersehen | Mock-TSA erzeugt eine **sichtbare Warnung** an der Signatur („Pilot nicht freigabefähig") | `signatur.service.ts` — `warnings` | WIRTSCHAFTSPRUEFER |

### 2.4 Einreichung und Veröffentlichung

| # | Risiko | Kontrolle | Nachweis im System | Verantwortlich |
|---|---|---|---|---|
| K-18 | Ein Abschluss gilt als eingereicht, ohne dass etwas eingereicht wurde | Die **Bestellnummer ist Pflicht**; ohne sie kein Statuswechsel. Der Beleg hält Nutzlast und SHA-256 der eingereichten Fassung | `e2e/jahresabschluss-einreichung.e2e.spec.ts` | STEUERBERATER |
| K-19 | Zwei Abschlüsse hängen an demselben Vorgang | **Eindeutigkeit in der Datenbank** (`@unique`), nicht nur im Anwendungscode; verbleibende Konkurrenz wird als 409 beantwortet | Migration `2026_10_20_220000_banz_bestellnummer_unique` | STEUERBERATER |
| K-20 | Ein nicht signierter Abschluss wird eingereicht | **Fail-closed**: ohne Signatur 409, ohne signiertes PDF im WORM 409 | `e2e/jahresabschluss-einreichung.e2e.spec.ts` | STEUERBERATER |
| K-33 | Ein Abschluss wird bescheinigt und veroeffentlicht, ohne dass jemand ihn geprueft hat | Die qeS-**Endabnahme** verlangt einen **freigegebenen Vier-Augen-Pruefungsnachweis** der Bilanz (`WPPruefungsAbschluss` mit Status `APPROVED` und `freigegebenVonId`); ohne ihn 409. Eine *Bestandteil*-Signatur bleibt davon unberuehrt — sie bescheinigt nur ein Teilstueck | `e2e/signatur-pruefungsnachweis.e2e.spec.ts` | WIRTSCHAFTSPRUEFER |
| K-21 | Der Wirtschaftsprüfer reicht eigenmächtig ein | Einreichungsrouten nur für `STEUERBERATER` und `KANZLEI_ADMIN` — der WP **bescheinigt**, die Kanzlei **reicht ein** | `e2e/jahresabschluss-einreichung.e2e.spec.ts` (403) und `frontend/e2e/jahresabschluss-einreichung.spec.ts` (der Knopf ist für den WP gar nicht sichtbar) | KANZLEI_ADMIN |

### 2.5 Aufbewahrung und Nachvollziehbarkeit

| # | Risiko | Kontrolle | Nachweis im System | Verantwortlich |
|---|---|---|---|---|
| K-22 | Ein Beweis wird überschrieben oder gelöscht | **Object-Lock COMPLIANCE** (auch nicht durch den Root-User übersteuerbar), Legal Hold ON, 3650 Tage | `backend/scripts/audit-worm-retention.sh` — prüft jede Registerzeile | DevOps |
| K-23 | Ein Entwurf wird als Beweis missverstanden | Eigener EntityType, eigener Prefix, kein Lock; der WORM-Wächter **zählt** die Entwürfe, statt sie stillschweigend zu übergehen | `audit-worm-retention.sh` — die Ausnahme ist sichtbar | DevOps |
| K-24 | Ein Protokolleintrag wird nachträglich verändert | **SHA-256-Hash-Kette**; die Reihenfolge kommt aus der Datenbank (`sequenz`), nicht aus dem Aufrufer | `audit-integrity.service.ts`; `GET /api/audit/integrity` | KANZLEI_ADMIN |
| K-25 | Die Kette bricht beim Löschen eines Mandanten | Der Hash schützt den **Inhalt**, nicht die veränderbaren Fremdschlüssel — die Datenbank setzt sie auf `NULL` | `e2e/audit-kette-mandant-loeschung.e2e.spec.ts` | KANZLEI_ADMIN |
| K-26 | Die Kette steht, und niemand merkt es | `/health/ready` weist das Alter des ältesten ungehashten Eintrags aus und meldet `degraded` über der Schwelle | `health.controller.ts` — `auditOldestUnhashedAgeMs` | DevOps |
| K-27 | Zwei Instanzen zerlegen die Kette | Die Reihenfolge kommt aus der Datenbank, die Berechnung ist idempotent — nachgewiesen mit **zwei echten Instanzen** auf derselben Datenbank, je 60 abwechselnde Schreibvorgänge, vier Läufe: `integrity` → **OK** | Nachtrag 45, wiederholt in Nachtrag 63 | DevOps |
| K-28 | „Alles geprüft" bei leerem Trail | `NO_ENTRIES` ist ein eigener Status und **kein** „OK" | `audit-integrity.service.ts` — `verifyIntegrity()` | KANZLEI_ADMIN |

### 2.6 Zugriff und Authentifizierung

| # | Risiko | Kontrolle | Nachweis im System | Verantwortlich |
|---|---|---|---|---|
| K-29 | Ein gestohlenes Token wird zur MFA-Übernahme genutzt | MFA-**Aktivierung** verlangt das **Passwort** (erneute Authentifizierung); **Deaktivierung** verlangt Passwort **und** Code | `e2e/totp-aktivierung.e2e.spec.ts` | KANZLEI_ADMIN |
| K-30 | Ein TOTP-Geheimnis im Klartext | AES-256-GCM verschlüsselt | `auth/services/encryption.service.ts` | DevOps |
| K-31 | Eine offene Sitzung bleibt lange nutzbar | Access Token 15 Minuten, serverseitig widerrufbar | `auth.service.ts` | KANZLEI_ADMIN |
| K-32 | Ein Benutzer ohne Rolle sieht eine Aktion, die dann mit 403 endet | Die Oberfläche blendet Aktionen **mandantenbezogen nach Rolle** aus — die Regel steht an **einer** Stelle (`frontend/src/lib/session.ts`) und bildet den `RolesGuard` ab | `frontend/e2e/signatur-berechtigung.spec.ts` | KANZLEI_ADMIN |
| K-34 | Ein Webhook-HMAC-Secret im Klartext | AES-256-GCM verschlüsselt abgelegt (Präfix `enc:v1:`), entschlüsselt **nur** beim Signieren; ein unlesbares Secret lässt die Zustellung sichtbar auf `FAILED`/`DEAD_LETTER` gehen, statt sie mit leerer Signatur zu senden. Hashen ist hier unmöglich (der Server signiert selbst) — Verschlüsseln ist die einzige wirksame Form | `e2e/webhook-secret-verschluesselt.e2e.spec.ts` | DevOps |
| K-35 | Eine Kanzlei beansprucht die Custom-Domain einer anderen oder verifiziert eine fremde Domain | Die Domain wird **normalisiert** (klein, getrimmt) — DNS ist case-insensitiv, der Vergleich war es nicht; die Eindeutigkeitsprüfung läuft case-insensitiv. Die DNS-Verifikation prüft den **ausgestellten Token**: ohne laufende Verifikationsanfrage gibt es keine Verifikation (fail-closed), der Token wird nach dem Erfolg gelöscht | `e2e/customdomain-eindeutigkeit.e2e.spec.ts` und `src/modules/dns/services/domain-verification.service.spec.ts` | KANZLEI_ADMIN |
| K-36 | Die Oberfläche zeigt einen Stand, den es nicht mehr gibt | Jeder Schreibpfad auf die Branding-Felder invalidiert den Branding-Cache (TTL 1 h) — auch der Pfad **außerhalb** des Branding-Moduls (die DNS-Verifikation). Ein **Wächter** stellt das durchsetzbar: jede Datei der Service-Schicht, die ein Branding-Feld schreibt, muss invalidieren | `src/common/cache/branding-cache-invalidation.spec.ts` und `e2e/branding-cache-invalidation.e2e.spec.ts` | KANZLEI_ADMIN |
| K-37 | Ein Tarif wird ohne Zahlung aktiviert — oder ein bezahlter Tarifwechsel bleibt aus | Der Mock-Modus ist eine **Entscheidung** (`BILLING_MOCK_ENABLED`, fail-closed) und gilt für **Checkout und Aktivierung** alike; die Provider-Wahl ist explizit (`BILLING_PROVIDER`), ein unbeabsichtigter Mock startet den Dienst nicht. Die Stripe-Price-ID kommt aus der Konfiguration — Platzhalter, die wie echte IDs aussehen, sind entfernt. Invariante: der Checkout liefert niemals eine Session, die nicht einlösbar ist | `src/modules/subscription/services/billing-konfiguration.spec.ts` und `e2e/billing-checkout-invariante.e2e.spec.ts` | KANZLEI_ADMIN |
| K-38 | Der Einreichungsbeleg enthält nicht das eingereichte Dokument | Die Nutzlast des Belegs folgt dem **Kanal** des Mandanten: `PDF_DIRECT` → signiertes PDF; `XML_XBRL`/`EBILANZ_TAXONOMIE` → die XBRL, die beim Einreichen erzeugt und im **WORM** abgelegt wird (zehn Jahre, COMPLIANCE, Legal Hold, eigener EntityType). Die Datei wird **nach** der Abweichungsprüfung erzeugt — sie entspricht damit der signierten Fassung (§ 147 AO) | `e2e/einreichungsbeleg-kanal.e2e.spec.ts` und `src/modules/ebilanz/services/xbrl-archivierung.spec.ts` | WIRTSCHAFTSPRUEFER |
| K-39 | Die an die Kanzlei übergebene DATEV-Datei enthält keine Buchungen | Der Export schreibt **eine Zeile je Buchung** (Sachkonten-Buchungsstapel: Konto auf der Soll-, Gegenkonto auf der Haben-Seite). Zwei Zeilen mit identischen Konten wären zwei Buchungen — jedes Konto saldierte auf 0. Der **Round-Trip** (Export → Import derselben Anwendung) ist der Nachweis: die importierten Positionen müssen die exportierten Beträge tragen. Der Import warnt, wenn er ein Konto mit Saldo 0 überspringt | `e2e/datev-roundtrip.e2e.spec.ts` und `src/modules/datev/services/datev-export.service.spec.ts` | STEUERBERATER |
| K-40 | Ein externes System kann die Einreichung nicht zuordnen | Der Einreichungsbeleg trägt die **BAnz-Vorgangsnummer** aus dem Feld, das die Einreichung tatsächlich schreibt (`banzBestellnummer`, eindeutig) — nicht aus einem Legacy-Feld, das niemand füllt. Die Liste ist wie alle übrigen Listen der öffentlichen API **cursor-gepaged**: `hasMore` und `nextCursor` stimmen, kein Datensatz ist unerreichbar | `e2e/public-api-submissions.e2e.spec.ts` | KANZLEI_ADMIN |
| K-41 | Ein archivierter Mandant bekommt doch wieder neue Belege | Die Archivregel („Der Bestand bleibt zur Nachvollziehbarkeit erhalten (§ 147 AO), wird aber nicht fortgeschrieben") gilt an **jedem** Schreibpfad: das Anlegen einer Konsolidierungseinheit **und** ihr Anwenden. `applyKonsolidierung` legt Konzern-Bilanz und Konzern-GuV an und prüft deshalb **vor** der Rechnung, ob Mutter oder Tochter archiviert sind (409) | `e2e/konsolidierung-archiv-apply.e2e.spec.ts` und `src/modules/konsolidierung/services/konsolidierung-archiv.spec.ts` | WIRTSCHAFTSPRUEFER |
| K-42 | Die Beteiligungsquote wird falsch angewendet (1 % als 100 %) | Die Quote wird an **einer** Stelle gelesen (`beteiligungsquoteAlsFaktor`): gespeichert wird **Prozent** (DTO 0–100, `Decimal(5,2)`), der Faktor ist immer `wert / 100`. Ein Faktor, der zwei Einheiten annimmt (Prozent *oder* Bruchteil), macht 1 % mehrdeutig — und entschied sich still zu 100 %. Unplausible Werte (≤ 0 %, > 100 %) werden als 100 % angewendet und **protokolliert**. Der Eliminations-Kontext trägt den Faktor, damit sich keine zweite Lesart einschleichen kann | `e2e/konsolidierung-beteiligungsquote.e2e.spec.ts` und `src/modules/konsolidierung/services/konsolidierung.service.spec.ts` | WIRTSCHAFTSPRUEFER |
| K-43 | Ein manuell zugeordnetes DATEV-Konto landet auf der falschen Bilanzseite | Die Bilanzseite einer HGB-Position wird aus den **Tabellen** bestimmt (SKR04-Reverse-Tabelle, dann HGB-Bilanz-Katalog § 266) — nicht aus dem Nummernformat: A./B./C. stehen nach § 266 auf **beiden** Bilanzseiten, die Nummer allein entscheidet die Seite nicht (der Seed legt `A.III.1.` als AKTIVA **und** als PASSIVA an). Ist die Position mehrdeutig oder unbekannt, wird der Override **abgelehnt** (fail-closed), das Konto übersprungen und der Grund genannt — jeder übersprungene Konto-Auftritt wird begründet | `e2e/datev-override-seite.e2e.spec.ts` und `src/modules/datev-import/mappings/hgb-position-auflosung.spec.ts` | STEUERBERATER |
| K-44 | Der Anhang traegt ungepruefte Pflichtangaben | Die Platzhalterpruefung sieht den **ganzen** Anhang — die Abschnitte **und** die drei Pflichtangaben (§ 284 Abs. 2 Nr. 1/2, § 285 HGB), die genauso im PDF stehen. Sie bleibt eine Meldung; die Sperre fuer die Veroeffentlichung liegt beim Jahresabschluss (§ 314 HGB). Die Aenderbarkeit der drei Felder nach der Freigabe ist **gewollt** (Entscheidung der Fachverantwortlichen vom 2026-10-14: das Signieren sperrt nicht gegen Aenderung — die Felder sind der einzige Korrekturweg am signierten Abschluss) und ist getestet | `e2e/anhang-pflichtangaben.e2e.spec.ts` und `src/modules/anhang/services/anhang-inhalt-regeln.spec.ts` | STEUERBERATER |
| K-45 | Der Audit-Trail verschweigt eine Aenderung | Jede Mutation wird mit der **Wirkung** protokolliert, nicht mit dem Stil des Aufrufers: die IDW-Regelpruefung schreibt `BilanzPruefungsResult` und protokolliert deshalb `UPDATE` (bzw. `CREATE` beim ersten Lauf) statt `READ`. `previousState` dokumentiert den Stand **vor** der Pruefung, `newState` nennt die einzelnen Ergebnisse (Regel, Status, Wert, Schwellwert, Meldung) — nicht nur deren Anzahl | `src/modules/wp/services/idw-pruefung-audit.spec.ts` | WIRTSCHAFTSPRUEFER |
| K-46 | Der Datenbestand weicht vom eingereichten Dokument ab | Nach der **Einreichung** (Jahresabschluss `SUBMITTED`) bzw. der Veroeffentlichung (`PUBLISHED`) ist der **Inhalt** des Anhangs eingefroren (409). Die eingereichte Fassung liegt beim Bundesanzeiger; eine Aenderung koennte nicht mehr nachgezogen werden (eine erneute Signatur ist fuer einen eingereichten Abschluss gesperrt). Bis zur Einreichung bleibt der Korrekturvorgang offen (nach `SIGNED` aenderbar, mit erneuter Signatur) — Entscheidung der Fachverantwortlichen vom 2026-10-14 | `e2e/signatur-abweichung.e2e.spec.ts` und `src/modules/anhang/services/anhang-inhalt-regeln.spec.ts` | WIRTSCHAFTSPRUEFER |

## 3. Offene Punkte der IKS

Diese Punkte sind vor der Freigabe zu klären. Sie sind in
[Abschnitt 9 der Verfahrensdokumentation](./VERFAHRENSDOKUMENTATION.md#9-offene-punkte)
mit den(process-)bezogenen Fragen verknüpft.

| # | Offener Punkt |
|---|---|
| 1 | **Zuordnung „welcher Kontrolle gehört wem"?** Die Matrix nennt Rollen. Wer sie im Einzelfall ausübt, ist eine Festlegung der Kanzlei (Rollen ≠ Personen). |
| 2 | **Wie wird die Wirksamkeit beurteilt?** Dieses Dokument beschreibt die **Existenz** der Kontrollen und ihren technischen Nachweis. Die Beurteilung der Wirksamkeit ist Aufgabe des Wirtschaftsprüfers — dafür braucht es Stichproben und Zugriffsrechte auf die Testumgebungen. |
| 3 | **Empfangsbestätigung des Portals** (K-18): Die Anwendung erfasst die Bestellnummer, nicht die Empfangsbestätigung des Portals. Bis dahin ist der Einreichungsbeleg unvollständig — die Lücke ist vor dem Pilot zu schließen. |
| 4 | **Restore-Test** (K-22): Der DR-Plan beschreibt das Verfahren; ein **monatlicher Wiederherstellungstest** fehlt noch (TODO-8.6). Ohne ihn ist die Wirksamkeit der Aufbewahrung nicht belegt. |
| 5 | **Vier-Augen-Prüfung der Abweichungs-Freigabe** (K-8): Wer darf eine bilanz-/GuV-Abweichung freigeben, und wird das intern geprüft? |
| 6 | **Rechtsanwalt- und Berufshaftungsfristen**: Die Software setzt 10 Jahre. Längere Fristen sind eine Kanzlei-Entscheidung und wirken auf die Retention-Konfiguration. |

## 4. Mitgeltende Unterlagen

| Dokument | Inhalt |
|---|---|
| `docs/VERFAHRENSDOKUMENTATION.md` | das Verfahren, auf das sich diese Matrix bezieht |
| `docs/GOBD-AUDIT-REPORT.md` | vollständiger Prüfbericht: jede Messung, jeder Nachtrag, jede Negativprobe |
| `docs/DISASTER-RECOVERY.md` | Backup, RPO/RTO, Recovery |
| `docs/rollen-rbac.md` | Rollen- und Berechtigungsmodell |
| `docs/gobd-architektur.md` | technische Umsetzung der GoBD-Anforderungen |
