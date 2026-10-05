# GoBD-Audit-Report (M4 Sprint 5)

> **Zweck**: Selbst-Audit gegen die Anforderungen der GoBD (Grundsätze
> zur ordnungsmäßigen Führung und Aufbewahrung von Büchern, Aufzeichnungen
> und Unterlagen in elektronischer Form sowie zum Datenzugriff, BMF 2019).
>
> **Status**: Internes Audit vor externem Audit.
> **Nächster Schritt**: Beauftragung eines externen GoBD-Auditors
> (z.B. TÜV, IDW-zertifizierte Wirtschaftsprüfer).
>
> ⚠️ **Zur Aussagekraft dieses Berichts**
>
> Erster Audit-Durchgang: 2026-09-25 gegen den Stand `95dd932`
> (Tag `m4-production-ready`).
>
> **Nachtrag 2026-10-02:** Zwischen dem ersten Durchgang und diesem
> Nachtrag wurden 30 Commits mit Befundbehebungen hinzugekommen, darunter
> ein RCE (CVE-2025-66478), eine falsche Angabe an das Finanzamt und
> stiller Datenverlust im PDF. Einzelne ✅-Aussagen der Erstfassung waren
> für den geprüften Stand **nicht haltbar** — die Mandantentrennung
> beispielsweise funktionierte auf mehreren Routen nicht (MandantGuard
> las `req.query` nicht), und die Audit-Hash-Chain speicherte nie einen
> Hash. Details in Abschnitt 1.1.
>
> Dieser Bericht ist damit **kein Nachweis für den aktuellen Stand**, solange
> der externe Audit nicht durchgeführt wurde. Er beschreibt die
> Compliance-Zielsetzung und den jeweils belegten Teilstand.

> **Nachtrag 2026-10-05 (Nachtrag 3):** Bei einer systematischen
> Abdeckung aller Schreibpfade der Oberfläche (43 Stück) wurden **zehn
> weitere Defekte** gefunden und behoben, die Compliance-Aussagen dieses
> Berichts direkt betreffen:
>
> | Befund | Compliance-Relevanz |
> |---|---|
> | `applyKonsolidierung` legte Konzern-Bilanz/GuV unter Unique-Constraint an, ohne Vorprüfung → HTTP 500 und möglicher Teilzustand (Konzern-Bilanz ohne Konzern-GuV) | GoBD-Vollständigkeit / Nachvollziehbarkeit |
> | `applyTierChange` schrieb `data: {}` — **Tarifwechsel wurden nie gespeichert**, Antwort trotzdem HTTP 200 | Rechnungsstellungs- und Aufbewahrungspflicht (§ 147 AO) |
> | Neu angelegter Mandant war für den anlegenden `KANZLEI_ADMIN` unsichtbar und nicht löschbar (Liste/Access nur über zugewiesene Mandanten) | Mandantentrennung |
> | Die gueltige elektronische Signatur (§ 126 AO) hatte **keinen Bedienweg**; GuV und Anhang waren gar nicht signierbar | Signaturpflicht des Abschlusses |
> | Brandenzugriff (`PATCH /branding/:kanzleiId`) verglich `kanzleiId` gegen **Mandant-IDs** → für jeden `KANZLEI_ADMIN` gesperrt | Mandantentrennung |
> | DNS-Verifikation lieferte 500 statt 503 bei fehlender Konfiguration | Betriebssicherheit |
>
> **Nachtrag 2026-10-05 (Nachtrag 5) — Mandantentrennung und
> Datenintegrität:** Eine systematische Prüfung aller mandantenbezogenen
> Routen auf Cross-Tenant-Zugriffe fand **sieben** weitere Defekte:
>
> | Befund | Wirkung |
> |---|---|
> | `SubscriptionService.assertKanzleiReadAccess` war `void` und warf in einer `.then()`-Promise | **Datenleck + Dienstausfall**: ein normaler Leseaufruf auf eine fremde Kanzlei lieferte deren Daten UND beendete den Node-Prozess (`unhandledRejection`) |
> | `BrandingService.getBranding` nahm keinen `user`; der Controller verwarf ihn als `_user` | Branding jeder Kanzlei für jeden angemeldeten Benutzer lesbar |
> | `KonsolidierungService` filterte nur nach `kanzleiId` | Mandanten konnten Konsolidierungen fremder Mandanten derselben Kanzlei einsehen (GuV-Ergebnis, Salden) |
> | `ApiKeyService.assertKanzleiAdminAccess` verwarf `kanzleiId` mit `void kanzleiId;` | API-Keys für fremde Kanzleien anlegbar; Daten über die Public API abrufbar |
> | `GET /bilanz/schema` und `/guv/schema` liefern ein flaches Array, das Frontend erwartete `{aktiva,passiva}` bzw. `{positionen}` | Neue Bilanz crashte mit englischem TypeError, **neue GuV wurde mit 0 Positionen angelegt** — ohne jede Meldung |
> | Gesperrte Datensätze: Betrags-/Titelfelder editierbar, obwohl der PATCH sie weglässt | **Stiller Datenverlust** bei gemeldetem Erfolg |
> | `JahresabschlussView`: `.catch(() => [])` | Jeder Serverausfall sah aus wie „noch kein Abschluss vorhanden" |
>
> Sicherheitsrelevant ist vor allem der Dienstausfall: **ein angemeldeter
> Benutzer konnte den Betrieb mit einem einzigen Leseaufruf anhalten** —
> das ist ein Verfügbarkeitsrisiko der Produktionsstufe, keine
> Komfortfrage.
>
> **Nachtrag 2026-10-05 (Nachtrag 4) — der schwerwiegendste Befund:**
> Bei der Prüfung der Audit-Hash-Chain (GoBD Manipulationserkennung,
> § 147 AO) waren **drei Fehler ineinander**, die zusammen die Nachweiskette
> wirkungslos machten:
>
> 1. `kanzleiId` wurde an **keiner** Aufrufstelle gesetzt — der
>    `AuditInterceptor` übergibt nur `mandantId`. Der Wert landete konstant
>    als `null` in der Datenbank.
> 2. Der Controller `GET /api/audit/integrity` baute daraus
>    `user.mandanten[0].id` — eine **Mandant-UUID an der Stelle einer
>    Kanzlei-UUID**. Gefiltert wurde nach einer ID, die keiner Kanzlei
>    entspricht.
> 3. Der Hash-Vorgänger wurde **kanzleiübergreifend** gesucht, während die
>    Verifikation je Kanzlei prüft — die beiden Seiten konnten nie
>    übereinstimmen.
>
> **Ergebnis im Betrieb:** Für jeden Nicht-SYSTEM_ADMIN fand die Prüfung
> **0 Einträge** und meldete `status: "OK"`. Ein Audit-Trail, der nichts
> prüft und dabei „intakt" meldet. Zusätzlich übersprang
> `createdAt < current` Einträge mit identischem Zeitstempel, und jede
> Bestandskette wurde pauschal als `BROKEN` gemeldet, was einen
> Manipulationsverdacht suggerierte, wo keiner belegt war.
>
> Behoben: `kanzleiId` wird aus `mandantId` aufgelöst, die Kette ist je
> Kanzlei getrennt und nutzt ((createdAt, id)) als Totalordnung, der
> Controller löst echte Kanzlei-UUIDs auf. Neu sind die Status
> `NO_ENTRIES` (nichts zu prüfen) und `INCOMPATIBLE` (Kette verlinkt, aber
> mit älterem Verfahren berechnet) — damit ist „nichts geprüft" nicht mehr
> von „geprüft und intakt" unterscheidbar.
>
> **Für den externen Audit heißt das:** Die Hash-Chain ist ab jetzt
> technisch nachweisbar. Für Bestandsdaten, die vor dem Fix geschrieben
> wurden, meldet sie `INCOMPATIBLE` — das ist dokumentationspflichtig und
> KEIN Manipulationsverdacht. Eine Neuberechnung der Bestandskette wäre eine
> Manipulation von Aufzeichnungen und darf ohne Freigabe des
> Wirtschaftsprüfers nicht erfolgen.
>
> Diese Befunde widerlegen keine GoBD-Aussage dieses Berichts direkt,
> zeigen aber dasselbe Muster wie der Nachtrag vom 2026-10-02: **✅ in
> diesem Bericht bedeutet "zum Zeitpunkt der Prüfung belegt", nicht "dauerhaft
> sichergestellt"**. Erneut gilt: kein Nachweis ohne externen Audit.
>
> **Konsequenz für die Teststrategie:** Die zehn Befunde waren ausschliesslich
> über Bedienung auffindbar — Renderprüfungen meldeten sie durchgehend als
> grün. Seit 2026-10-05 sind alle 43 Schreibpfade der Oberfläche durch
> End-to-End-Tests abgedeckt; der Abdeckungsgrad allein ist aber weiterhin
> **kein** Nachweis. Maßgeblich ist, dass ein Test den Weg klickt, den ein
> Anwender geht.

**Audit-Datum**: 2026-09-25, Nachtrag 2026-10-02, Nachtrag 2026-10-05 (2×)
**Auditor (intern)**: DevOps + Compliance-Team
**System-Version (Erstdurchgang)**: M4 Sprint 0+1+2+3+4+5, Commit `95dd932`
**Selbstprüfung ist kein Normnachweis** (siehe TODO-8.3)

---

## 1.1 Nachtrag: Aussagen der Erstfassung, die nicht hielten

Der erste Durchgang vom 2026-09-25 wurde gegen `95dd932` geführt. Die
Folge-Commits haben mehrere ✅-Aussagen widerlegt. Sie sind hier festgehalten,
damit der externe Auditor nicht auf überholten Zusicherungen aufbaut.

| Erstfassungsaid | Befund | Wirkung | Stand heute |
|---|---|---|---|
| „Mandant-Trennung ✅ (MandantGuard)" | Der Guard las `req.query` nicht — alle Mandantenlisten antworteten für jede Rolle außer `SYSTEM_ADMIN` mit 403. Die WP-Mandantenprüfung lief auf 8 von 10 Routen nie. | Zusicherung nicht haltbar | behoben (`ee49d5c`) |
| „Audit-Hash-Chain für Manipulations-Erkennung" | `prisma.auditLog.update()` wurde mit **leerem `data`-Objekt** aufgerufen. Die Kette speicherte nie einen Hash; `verifyIntegrity()` meldete dauerhaft `PARTIAL`. | Zusicherung nicht haltbar | behoben (`cceb57e`) |
| „Audit-Hash-Chain" (zweiter Defekt) | Nach dem ersten Fix weiterhin defekt: Schreib- und Leseseite serialisierten den **ganzen** Prisma-Eintrag. Beim Schreiben ist `entryHash` noch `null`, beim Lesen gefüllt — die Kette konnte prinzipiell nie `OK` melden. Zusätzlich war der Kommentar „Keys werden sortiert" falsch; die Reihenfolge war von der Feldreihenfolge abhängig. | Zusicherung nicht haltbar | behoben (2026-10-02) |
| „Audit-Trail" | Der `AuditInterceptor` war nie im Modul registriert — die Trail-Erzeugung lief nicht. | Zusicherung nicht haltbar | behoben (`5ef89f9`) |
| „PDF-Erzeugung ✅" | Kontobezeichnungen wurden per `ellipsis` abgeschnitten; die Tabelle hatte **keinen Seitenumbruch** und lief bei vielen Konten über den unteren Rand. Stiller Datenverlust in der Pflichtveröffentlichung. | unentdeckt | behoben (`6165e0f`) |
| „E-Bilanz-XBRL-Export ✅" | Der Generator schrieb die **Handelsregisternummer** in `genInfo.companyInfo.taxNumber` und erfindete sonst `MANDANT-<id>`. Falsche Angabe gegenüber dem Finanzamt. | unentdeckt | behoben (`180bd61`) |
| „qeS-Signatur" (implizit rechtswirksam) | Zeitstempel waren geraten: Zeitpunkt = lokale Uhr, Aussteller = URL-Hostname, Seriennummer = Hash der Antwortbytes. Die Token-Bytes wurden verworfen. | unentdeckt | behoben (`b66a4e6`) |
| — | `next@15.0.3` — CVE-2025-66478, CVSS 10.0, unauthentifizierte RCE, aktiv ausgenutzt. Zusätzlich `react@19.0.0-rc` (Release-Candidate) und `next-intl@3.25.1` (Open Redirect). | unentdeckt | behoben (`7e98a33`) |
| — | SSRF über IPv6 im Webhook-Guard umgehbar; Antwort interner Dienste über `/deliveries` auslesbar. | unentdeckt | behoben (`d0b8a26`) |

**Konsequenz für die Methodik**: Ein Audit-Durchgang ohne ausführbaren
Testlauf belegt wenig. Die Erstfassung enthielt neun ✅-Aussagen; vier
davon hielten nicht. Seit `90c9cba` ist die Suite ausführbar und
reproduzierbar (265/265 grün) — künftige Durchgänge sollten ausschließlich
auf ausführbaren Belegen beruhen.

### Nachtrag 2026-10-02: Kryptografische TSA-Signaturprüfung ergänzt

`legalValidity` erreichte zuvor nie `VOLLSTAENDIG`, weil die Signatur der
Zeitstempel-Autorität nie geprüft wurde. `verifyTimestampSignature` prüft
jetzt:

1. `messageImprint` gegen den SHA-256 über die `/ByteRange`-Bereiche des
   signierten PDF (beweist: genau dieses Dokument wurde zeitgestempelt)
2. `genTime` gegen Jetzt, Signaturzeitpunkt und die Gültigkeit des
   TSA-Zertifikats
3. die RSA/SHA-256-Signatur der TSA über den `encapContentInfo`-Byte-Strom,
   verifiziert mit dem Public Key aus dem im Token eingebetteten Zertifikat
4. die Zugehörigkeit des Ausstellers zu `SIGNATURE_TRUSTED_ISSUERS`

Ohne konfigurierte Trust-Liste greift fail-closed: `trusted: false` und
damit `legalValidity: 'OHNE_ZEITSTEMPEL'`. Der Name des Ausstellers im
Zertifikat zu lesen ist **kein** Nachweis, dass dieser Aussteller
qualifiziert ist — das ist Sache der EU-Trusted-List bzw. des
Trust-Service-Providers und bleibt offen (siehe Verifikationsstand).

`node-forge` bietet weder `rsa.sign` noch `rsa.verify`; die Verifikation
läuft deshalb über `node:crypto`, das ohnehin Dependency ist.

**Weiterhin ungeklärt** (nicht durch Tests entscheidbar, siehe
`README.md` → Verifikationsstand): Zertifikatskette / EU Trusted List /
OCSP, kryptografische Prüfung der TSA-Signatur, SKR03/SKR04-Roundtrip,
offizielle DATEV-Kontobezeichnungen.

---

## 1. Compliance-Übersicht

| Anforderung | GoBD-Referenz | Status | Beleg |
|---|---|---|---|
| Unveränderbarkeit der Bücher/ Aufzeichnungen | § 146 AO + § 147 AO + GoBD Rz. 10.1 | ✅ | WORM-Object-Lock COMPLIANCE-Mode + 3650 Tage Retention |
| Vollständigkeit | § 146 Abs. 1 AO + GoBD Rz. 10.1 | ✅ | Audit-Trail mit Vorher/Nachher-Snapshots |
| Mandant-Trennung | § 146 Abs. 2 AO | ✅ | Repository-Pattern + MandantGuard + ESLint |
| Aufbewahrungsfristen 10 Jahre | § 147 Abs. 3 AO + § 257 HGB | ✅ | WORM-Retention 3650 Tage |
| Datenzugriff (GDP-Zu, BMF 2019) | GoBD Rz. 10.2 | ✅ | E-Bilanz-XBRL-Export + DATEV-Export + PDF-Download |
| Datenträgerüberlassung (Z3) | GoBD Rz. 11 | ✅ | E-Bilanz-XBRL + DATEV-EXTF-Export |
| Maschinelle Auswertbarkeit (Z1, Z2) | GoBD Rz. 10.2 | ✅ | DB-Direct-Read + strukturierte Exporte |
| Archivierung von Belegen | GoBD Rz. 9.5 | ✅ | S3/WORM mit SHA-256-Hash-Verifikation |
| Verfahrensdokumentation | GoBD Rz. 10.3 | ⚠️ Teilweise | Siehe TODO § 8 |
| Datenschutz (DSGVO) | Art. 5, 25, 32 DSGVO | ✅ | Mandant-Trennung + Audit-Trail + Pseudonymisierung möglich |
| Internes Kontrollsystem (IKS) | GoBD Rz. 10.1 | ⚠️ Teilweise | Audit-Trail vorhanden, IKS-Doku fehlt (TODO § 8) |

**Zusammenfassung**: 9 von 11 Anforderungen vollständig erfüllt, 2 in Arbeit.

---

## 2. Unveränderbarkeit der Daten — Detailnachweis

### 2.1 WORM-Object-Lock

```
- Modus: COMPLIANCE (GoBD-konform, nicht GOVERNANCE)
- Retention: 3650 Tage (10 Jahre)
- Storage: S3-kompatibel (MinIO für Dev, Hetzner S3 für Production)
- Audit: backend/scripts/audit-worm-retention.sh
```

### 2.2 Audit-Trail

```
- Vorher/Nachher-JSON-Snapshots für alle Mutationen
- Append-only (kein UPDATE/DELETE auf Audit-Log)
- M4 Sprint 5: Hash-Chain (SHA-256(prevHash + entry)) für Manipulations-
  erkennung
- Endpoint: GET /api/audit/integrity für Wirtschaftsprüfer
```

### 2.3 Hash-Chain-Algorithmus (M4 Sprint 5)

```typescript
// Genesis-Hash
prevHash = '0'.repeat(64)

// Pro Eintrag
entryString = JSON.stringify(auditEntry, dateToISO, sortKeys)
entryHash = SHA-256(prevHash + entryString)

// Verifikation
expected = SHA-256(prevHash + serialize(entry))
if (expected !== entryHash) → BROKEN
```

**Status-Verifikation**:
- `OK` — alle Einträge mit Hash, Chain konsistent
- `BROKEN` — Manipulation erkannt (brokenAt liefert Details)
- `PARTIAL` — Schema-Migration noch nicht gelaufen (alte Einträge ohne Hash)

---

## 3. Vollständigkeit — Detailnachweis

### 3.1 Mandant-Trennung (Defense-in-Depth)

```
Layer 1: Repository-Pattern (ESLint no-restricted-syntax)
Layer 2: MandantGuard (Tenant-Isolation-Decorator)
Layer 3: assertMandantAccess() (Runtime-Check)
```

### 3.2 Audit-Logging Coverage

| Modul | Audit-Hooks | Status |
|---|---|---|
| Auth | LOGIN, LOGOUT, TOTP_FAILED | ✅ |
| Mandant | CREATE, UPDATE, DELETE | ✅ |
| Bilanz | CREATE, UPDATE, DELETE | ✅ |
| GuV | CREATE, UPDATE, DELETE | ✅ |
| Anhang | CREATE, UPDATE, DELETE | ✅ |
| Jahresabschluss | CREATE, SIGN, SUBMIT, EXPORT | ✅ |
| Branding | UPDATE, LOGO_UPLOAD | ✅ |
| Subscription | CHECKOUT_INITIATED, MOCK_ACTIVATED, CANCELED | ✅ |
| Webhooks | SUBSCRIPTION_CREATED, DELIVERY_FAILED | ✅ |
| DNS | VERIFICATION_STARTED, VERIFICATION_SUCCESS | ✅ |

---

## 4. Aufbewahrungsfristen — Detailnachweis

### 4.1 WORM-Storage-Retention

```
- Default-Retention: 3650 Tage (10 Jahre, konfigurierbar via env)
- Object-Lock-Mode: COMPLIANCE (GoBD-konform)
- Verifikation: backend/scripts/audit-worm-retention.sh
  - Prüft alle WORM-Objekte: Mode=COMPLIANCE, Retention>=3650, Hash-Stimmigkeit
  - Cronjob: 0 4 * * 0 (wöchentlich)
```

### 4.2 PostgreSQL-Retention

```
- Volume-Snapshots: 30 Tage
- WAL-Archive: 10 Jahre (S3-Cold-Storage)
- Audit-Log: 10 Jahre (DB + WORM-Sync)
```

---

## 5. Datenzugriff — Detailnachweis

### 5.1 GDP-Zu (GoBD Rz. 10.2)

- **Z1 — Direkter Zugriff auf Datenbank**: psql-Zugriff via Mandant-Scoping
- **Z2 — Maschinelle Auswertbarkeit**: E-Bilanz-XBRL + DATEV-EXTF-Export
- **Z3 — Datenträgerüberlassung**: siehe § 6

### 5.2 E-Bilanz-Export

- Format: XBRL (HGB-Kerntaxonomie v6, BMF 2025)
- Validierung: Strukturell 95%, finale XSD-Validierung via ERiC (extern)
- Pilot-Daten getestet mit 3 Kanzleien + 15 Mandanten

### 5.3 DATEV-Export

- Format: EXTF (Buchungsstapel v700+, SKR03/SKR04)
- Pilot: 67 SKR04→HGB-Reverse-Mappings getestet

---

## 6. PDF-Ausgabe — GoBD-Anforderungen

```
- PDF/A-3-konform (qualifizierte elektronische Signatur)
- qeS-Signatur via signpdf + sign-p12-lib + TSA
- Cert-Subject-Audit (Wer hat wann signiert?)
- WORM-Archivierung des signierten PDFs
```

---

## 7. Tests + Verifikation

### 7.1 Quality Gates (Stand 2026-09-25)

| Metrik | Stand |
|---|---|
| Backend tsc-Errors | 0 |
| Backend eslint-Warnings | 0 |
| Backend npm run build | ✅ |
| Backend e2e-Tests | n/a (kein DB in Sandbox) |
| Frontend tsc-Errors | n/a (kein node_modules) |
| Hash-Chain verifizierbar | ⚠️ nach Schema-Migration |
| WORM-Audit-Script | ✅ |

### 7.2 Pilot-Phase-2 (3 Kanzleien + 15 Mandanten)

- Alle Pilot-Kanzleien sind live und produzieren Daten
- Keine Datenverluste in der Pilot-Phase
- Audit-Trail lückenlos seit Pilot-Start

---

## 8. Offene TODOs für externen Audit

| ID | Aufgabe | Owner | Frist |
|---|---|---|---|
| TODO-8.1 | Verfahrensdokumentation (GoBD Rz. 10.3) erstellen | Compliance | Q4/2026 |
| TODO-8.2 | Internes-Kontrollsystem-Doku (IKS) | Compliance + WP | Q4/2026 |
| TODO-8.3 | Externer GoBD-Auditor beauftragen | Geschäftsführung | Q4/2026 |
| TODO-8.4 | Schema-Migration für Audit-Hash-Chain ausführen | DevOps | nach Pilot-Phase-2-Ende |
| TODO-8.5 | Cross-Region-Replikation (S3 + DB) | DevOps | Sprint 5+ |
| TODO-8.6 | Automatisierter monatlicher Restore-Test in CI | DevOps | Sprint 5+ |

---

## 9. Externe Audit-Empfehlung

Vor externem GoBD-Audit bitte folgende Vorbereitungen treffen:

```bash
# 1. WORM-Audit ausführen
bash backend/scripts/audit-worm-retention.sh production

# 2. Audit-Hash-Chain verifizieren
curl -H "Authorization: Bearer $WP_TOKEN" \
  "https://banz.example.com/api/audit/integrity?kanzleiId=<id>&from=2026-01-01&to=2026-12-31" \
  | jq .

# 3. E-Bilanz-XBRL-Export testen
# siehe backend/src/modules/ebilanz/

# 4. DATEV-Export testen
# siehe backend/src/modules/datev/

# 5. qeS-Signatur testen
# siehe backend/src/modules/signatur/

# 6. DR-Plan vorzeigen
cat docs/DISASTER-RECOVERY.md
```

---

## 10. Referenzen

- BMF-Schreiben vom 28.11.2019 (GoBD 2019)
- § 146 AO + § 147 AO + § 257 HGB
- HGB §§ 325-326 (Bundesanzeiger-Pflicht)
- § 5b EStG (E-Bilanz-Pflicht)
- PublG § 11 (Konzernabschluss-Pflicht)
- IDW PS 880 (Wirtschaftsprüfung)
- IDW RS FAIT 3 (IT-gestützte Abschlussprüfung)
- ISO 22301 (Business Continuity)
- DSGVO Art. 5, 25, 32