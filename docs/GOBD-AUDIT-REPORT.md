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

### Nachtrag 2026-10-06: E-Bilanz und DATEV systematisch geprüft

Bei einer Durchsicht der E-Bilanz- und DATEV-Pfade fanden sich sechs
Defekte, die alle dasselbe Muster tragen: **ein Schritt prüfte nichts,
und die nachgelagerten Prüfungen bestätigten genau das.**

#### 1. GuV-Mapping löste die GKV/UKV-Kollision nicht auf (kritisch)

`TAXONOMY_CONCEPT_BY_CODE` ist eine flache Map über alle Konzepte; UKV
wurde als letzter Import eingetragen und überschrieb dort GKV. Für den
GKV-Seed-GuV der Demo GmbH (GJ 2025) bedeutete das:

| Position | Betrag | Gemappt auf (vorher) | Richtig |
|---|---|---|---|
| 14. Steuern vom Einkommen | 15.000 € | `pl.netIncome` | `pl.tax.incomeTax` |
| 8. Sonstige betr. Aufwendungen | 50.000 € | `pl.finResult.participationIncome` | `pl.otherCost` |

Die eingereichte E-Bilanz wies damit **15.000 € Jahresüberschuss** aus
statt der tatsächlichen **35.100 €** — bei HTTP 200, `saldostimmt: true`
und einem Validator, der die Datei als gültig meldete. Für § 264 HGB ist
das eine falsche Jahresabschluss-Erklärung.

Der Fehler hatte zwei Ebenen: die Mapping-Engine löste die Kollision
nicht auf **und** `generateEbilanzXbrl()` reichte `guv.verfahren` nicht
durch. Beide Ebenen sind getestet — ein Mapping-Engine-Test allein
sieht den Aufrufer-Fehler nicht.

#### 2. Jede erzeugte XBRL-Datei war namespace-invalid

`buildXbrlXml()` schrieb `xlink:type` und `xlink:href` in
`link:schemaRef`, ohne `xmlns:xlink` zu deklarieren. Belege gegen die
echte API-Antwort:

- `xml.etree.ElementTree`: `ParseError: unbound prefix: line 1`
- `xmllint`: `Namespace prefix xlink for href on schemaRef is not defined`

`XbrlValidatorService` meldete die Datei als gültig, weil
`XMLValidator` aus fast-xml-parser **ohne Namespace-Auflösung** prüft.
Die Datei konnte weder gelesen noch geprüft werden — der eigene
Validator bestätigte die Unlesbarkeit. Der Validator prüft jetzt
`UNBOUND_NAMESPACE_PREFIX`, und zwar **vor** dem Parser: ein Parser käme
an solchen Dateien nicht vorbei, die Prüfung wäre unerreichbar.

#### 3. Kein Saldo-Gate: nicht saldostimmende Bilanz erzeugte eine Datei

Aktiva 0 / Passiva 30.000 → HTTP 200, **4.837 Byte XBRL**,
`metadata.saldostimmt: false`. Das Gate lag im Response, nicht vor der
Datei. Jetzt: 400 `BILANZ_NICHT_SALDOSTIMMIG`, kein Audit-Eintrag für
eine Datei, die es nicht gibt.

#### 4. Die Saldo-Toleranz war in Cent benannt und in Euro angewendet

```ts
const SALDO_TOLERANZ_CENTS = 1; // 0.01 EUR Toleranz
Math.abs(aktivaSumme - passivaSumme) < SALDO_TOLERANZ_CENTS  // Summen in EUR
```

Wirksame Toleranz: **1,00 € statt 0,01 €**. Im E-Bilanz-Validator stand
`differenz > SALDO_TOLERANZ_CENTS`, sodass dort sogar genau 1,00 €
durchging. Betroffen: `xbrl-generator`, `xbrl-validator`,
`bilanz.service`. In `konsolidierung` stand
`const SALDO_TOLERANZ_CENTS = 1; void SALDO_TOLERANZ_CENTS;` — eine
deklarierte, nie benutzte Toleranz. Die Regel liegt jetzt einmal in
`src/common/utils/saldo.ts`; Gate und Prüfung teilen sie sich, damit im
Grenzfall nicht eine Datei entsteht und zugleich als nicht
saldostimmig gemeldet wird.

#### 5. Stiller Positionsverlust — fünf Passiva-Zeilen fehlten in jeder Datei

`previewMapping()` gab `unMapped: []` hart zurück. Der Mapper verwarf
Positionen per `continue`. Die Ursache war eine Mehrdeutigkeit im
Kontenrahmen: `A.III.1.`–`A.III.6.` und `D.` existieren auf **beiden**
Bilanzseiten.

| Schlüssel | Aktiva | Passiva |
|---|---|---|
| `A.III.1.` | Anteile an verbundenen Unternehmen | Gesetzliche Rücklage |
| `D.` | Aktive latente Steuern | Rechnungsabgrenzungsposten |

Der Mapper kannte die Seite nicht und lieferte den ersten Treffer —
Aktiva war zuerst registriert. Ergebnis: **fünf Passiva-Positionen
(Jahresabschluss GJ 2025, Demo GmbH) fehlten in jeder generierten
E-Bilanz.** Die Passiva-Konzepte existierten und trugen die passenden
Kontenrahmenzeilen; sie wurden nur nie erreicht. Nach dem Fix:
`unMapped: 0`, Datei 9.289 → 9.859 Byte, sechs zusätzliche Concepts im
XML. `metadata.unMapped` und ein Audit-Feld machen den Verlust künftig
sichtbar — bewusst **kein** harter Block, weil beides falsch wäre.

#### 6. Sachkonto-Export prüfte seine Eingaben nicht

`GenerateSachkontenDto` hatte nur Typprüfungen. Belegt, alle HTTP 200:

| Eingabe | Ergebnis vorher |
|---|---|
| `usedKonten: []` | `anzahlKonten: 0`, nur Kopfzeile |
| `usedKonten: '0400'` | 4 Zeilen: `"0"`, `"4"`, `"0"`, `"0"` |
| `usedKonten: ['HACKER; DROP TABLE', …]` | wörtlich in der CSV |
| `beraternummer: ''` | `EXTF_Sachkontobeschriftungen__7654321.csv` |
| `beraternummer: '../etc/passwd'` | landet im Dateinamen |

#### Lehre für den Audit

Ein Test, der prüft, dass ein Feld *vorkommt*, prüft nicht, dass es
*richtig* ist. Drei der sechs Defekte fielen durch, weil ein vorhandener
Test die Anwesenheit eines Wertes bestätigte und niemand seinen Inhalt
fragte. Für die externe Prüfung heißt das: „`saldostimmt: true`" und
„`valid: true`" sind ohne Gegenprobe kein Nachweis.

---

### Nachtrag 2026-10-06/07: Auditrunde Webhook, Branding, DNS, PDF, Konsolidierung

Nach der E-Bilanz-Runde wurden fünf weitere Module geprüft. Zehn Defekte
wurden behoben — wiederum alle aus derselben Familie: **ein Wert war
deklariert und wurde nicht benutzt, oder eine Prüfung war eine Anzeige.**

#### Behandelt

| # | Modul | Defekt | Beleg |
|---|---|---|---|
| 1 | Webhook | DB-Fehler bei der Zustellung beendete den Prozess | `node`: Exit-Code 1, während der Aufrufer bereits regulär geantwortet hatte |
| 2 | Webhook | `assertKanzleiAccess` prüfte `rolle !== undefined` und verwarf `kanzleiId` | Lesen fremder Kanzleien inkl. Ziel-URLs |
| 3 | Webhook | `assertKanzleiAdminAccess` verwarf `kanzleiId` | Schreibpfad über die Kanzleigrenze erreichbar |
| 4 | Branding | `getLogoBuffer` rief die Prüfung **ohne `await`** auf | Fremdes Logo aus WORM **und** Prozessabbruch |
| 5 | DNS | `assertKanzleiAdminAccess` verwendete `kanzleiId` nicht | Domain-Verifikation für fremde Kanzlei |
| 6 | DNS | Prisma-Fehler geschluckt | Erfolg gemeldet, `customDomainVerified` nie gesetzt |
| 7 | PDF | Kein Saldo-Gate | Aktiva 0 / Passiva 30.000 → fertiges, archiviertes PDF |
| 8 | PDF | Footer trug `SHA-256: PENDING-PLACEHOL…` | In **jedem** erzeugten PDF |
| 9 | PDF | `Math.max(aktiva, passiva)` verschwieg die Differenz | 5,00 € Ausgleichsposition unsichtbar |
| 10 | Konsolidierung | `Math.max(negativ − x, 0)` klemmte jeden Materialaufwand auf **0** | Negativprobe: `expected +0 to be -30000` |

Zusätzlich behoben: fehlende Umbruchlogik im Abschluss-PDF (60
Positionen ergaben 65 statt 5 Seiten), falsche PDF/A-3-Konformitätsaussage
auf dem Titelblatt, Download-Dateiname mit laufendem statt
Geschäftsjahr, verworfene `beteiligungsquote` (Equity-Methode nicht
umgesetzt), `updateStatus` ohne Kanzleifilter.

#### Der Kern

Bei **jedem** dieser Defekte stand eine Aussage im Code, die nicht dem
Verhalten entsprach:

- Kommentar: „Im PDF-Footer erscheint der erste Hash-Drittel als
  Korrelations-ID" — es stand dort nie ein Hash.
- Kommentar: „Mandant-Trennung wird erzwungen" — das Repository
  filterte nicht.
- Titelblatt: „PDF/A-3-konform" — kein `/Metadata`, kein
  `/OutputIntent`, keine eingebetteten Fonts.

Ein Kommentar ist kein Nachweis. Für den externen Audit heißt das: Bei
der Abnahme muss **jede Konformitäts- und Sicherheitsaussage im Code
gegen ihr Laufzeitverhalten geprüft werden**, nicht gegen ihre
Beschreibung.

#### Nicht behoben — offene Funktionslücken (bewusst nicht kaschiert)

Der Konzernabschluss stellt sich als funktionierendes Modul dar, ist
aber ein Gerüst:

- **§ 301 HGB Kapitalkonsolidierung** kann nie auslösen:
  `anschaffungskosten` und `eigenkapitalTochter` stehen fest auf 0 und
  es existiert kein Schreibpfad dafür.
- **§ 304, § 306, § 308, § 330** sind nicht abgebildet; für jede erzeugte
  Position wird `betragVorjahr: null` gesetzt.
- **`apply()` widerspricht sich selbst**: es verlangt, dass die Mutter
  keine Bilanz hat (`assertZieljahrFrei`), und lädt sie zwei Zeilen
  später. Ein fachlich gültiges Ergebnis ist in beiden Zweigen
  unerreichbar.
- **Keine Transaktionalität** über drei Schreibvorgänge; die Sätze werden
  sofort `VALIDATED`, bevor die Einheit `COMPLETED` wird.

Das sind keine Codekorrekturen, sondern fehlende Fachlogik. Sie wurden
nicht durch Platzhalter überdeckt, damit das Modul fertig wirkt.

---

### Nachtrag 2026-10-07: Signatur, Public API, Wirtschaftsprüfung

Eine dritte Runde über Signatur, Public API und die WP-Kette. Vier
Defekte behoben — und zwei Lücken dokumentiert, die **nicht** durch
Code behoben werden konnten, weil das dafür nötige Konzept nicht
existiert.

#### Behoben

| # | Modul | Defekt | Beleg |
|---|---|---|---|
| 1 | Signatur | Zeitstempel ohne `/ByteRange` ergab `legalValidity: VOLLSTAENDIG` | Ein gültiger TSA-Token für ein anderes Dokument wurde als Zeitstempel für dieses akzeptiert |
| 2 | Subscription | Billing-Provider schrieb ungeprüfte Werte in die DB | `'GIBT-ES-NICHT'` landete wörtlich in `kanzlei.subscriptionStatus` |
| 3 | Public API | Geheimnis-Vergleich mit `!==` statt `timingSafeEqual` | Zeitabhängiger Vergleich des gespeicherten Hashes |
| 4 | WP | Vier-Augen-Prinzip nicht erfüllt, aber ausgewiesen | Der Prüfende durfte seine eigene Prüfung freigeben |

Zu 1 im Detail, weil es das schwerste ist: `checkTimestamp()` verglich
den `messageImprint` mit dem SHA-256 über die `/ByteRange`. Fehlte die
ByteRange, wurde der Vergleich **übersprungen** — es stand nur ein
Warn-Log im Code. Ein gültiger Zeitstempel für ein beliebiges anderes
Dokument galt damit als Zeitstempel für dieses, und die Signatur
wurde als `VOLLSTAENDIG` ausgewiesen (§ 313 HGB, PublG § 11). Die
Bindungsprüfung läuft jetzt **vor** der Token-Analyse: sie ist eine
Frage an das PDF, nicht an das Token.

#### Nicht behoben — weil die Kontrolle nicht erfüllbar ist

**Vier-Augen-Prinzip.** In `finalizePruefung()` fehlte die Sperre gegen
Selbstfreigabe. Sie existiert für Notizen, fehlte aber bei der
Freigabe, die zählt. Eine harte Sperre wurde **bewusst nicht eingebaut**:
`WPPruefungsAbschluss` führt genau ein `wpUserId` — den Prüfenden. Es
gibt kein Feld für eine zweite Person und keine Rolle dafür; der Seed
legt genau einen Wirtschaftsprüfer an. Eine 403-Sperre hätte den
gesamten Freigabeweg unbenutzbar gemacht — der einzige Prüfer könnte
seine eigene Prüfung nie freigeben. Das wäre keine Erfüllung der
Kontrolle, sondern das Abschalten des Produkts.

Stattdessen wird die Selbstfreigabe protokolliert und im Audit-Eintrag
als `selbstFreigegeben` festgehalten. Für § 147 AO ist genau das
richtig: die Aufzeichnung zeigt, dass die Freigabe **ohne** zweite
Person erfolgte, statt es unauffällig zu verschweigen. Die eigentliche
Kontrolle braucht ein Produktkonzept, das es nicht gibt.

**Premium-Funktionen ohne Gate.** `custom-domain`, `public-api` und
`white-label-branding` sind in `TIER_CONFIGS` als Premium-only
definiert. `has()` und `isWithinLimit()` haben null Aufrufer, ein
`SubscriptionGuard` existiert nicht. Eine PILOT-Kanzlei kann diese
Funktionen nutzen. Auch das ist keine Codekorrektur, sondern eine
Vertriebsentscheidung — eine pauschale Sperre würde den laufenden
Pilot büßen.

#### Ohne Befund — geprüft und sauber

- **DATEV-Import:** Sechs Müll-Eingaben (ungültiges Base64, leerer
  Inhalt, `;;;;`, nicht parsbarer Umsatz, ungültiges Datum) werden
  sämtlich mit 400 und klarer Meldung abgewiesen. `parseFloat` → NaN
  wird geworfen, Datumsangaben gegen einen Rundlauf geprüft
  (`31022026` fällt durch), deutsche Zahlenformate korrekt.
- **Zeitstempel-Kryptografie:** Der im Token genannte Hash-Algorithmus
  wird tatsächlich verwendet (`hashFunctionForOid`), unbekannte OIDs
  werden fail-closed abgewiesen.
- **OAuth2:** Scopes als Schnittmenge `requested ∩ key.scopes`;
  `algorithms: ['HS256']` erzwungen; `kanzleiId`-Claim wird gegen den
  gespeicherten Key gekreuzt.

---

### Nachtrag 2026-10-07 (Nachtrag 2): Konzernabschluss erzeugte eine Rechnung ohne die Mutter

Der schwerste verbleibende Befund, gefunden nach Abschluss der drei
Auditrunden.

`applyKonsolidierung()` verlangte über `assertZieljahrFrei`, dass die
Muttergesellschaft für das Geschäftsjahr **keine** Bilanz und **keine**
GuV hat. Fünfzehn Zeilen später wurden genau diese Sätze geladen. Es
gab sie also nie.

Das Ergebnis: die Konzern-Bilanz enthielt **ausschließlich die
Tochtergesellschaften** — und beide möglichen Zweige sahen plausibel
aus:

| Situation | Altes Verhalten |
|---|---|
| Mutter hat einen Satz | 400 „bitte die vorhandenen Sätze zuerst löschen" |
| Mutter hat keinen Satz | 201 Created, Konzern-Bilanz **ohne die Mutter**, inklusive Salden |

Eine Konzernrechnung ohne Muttergesellschaft ist keine
Konzernrechnung. Verschärfend: fehlende Eingangsdaten wurden per
`continue` verworfen, **ohne Log und ohne Warnung** — `this.logger`
war in der Datei deklariert und wurde nie benutzt. Das System meldete
Erfolg für ein fachlich unbrauchbares Ergebnis.

Fix, fail-closed:

- Fehlt der Mutter die Bilanz oder die GuV, bricht `apply` mit
  `MUTTER_OHNE_EINZELABSCHLUSS` ab, bevor irgendetwas geschrieben wird.
- Beide Loader protokollieren, **wer** fehlt.
- Fehlende Tochterabschlüsse werden gewarnt statt verschluckt.

**Nicht geändert** wurde, welches Modell fachlich richtig ist: ob der
Konzernsatz den Einzelsatz der Mutter ersetzt (der aktuelle
`@@unique([mandantId, geschaeftsjahr])` lässt beides nicht zu) oder
eine eigene Identität erhalten muss. Das ist eine Produktentscheidung
und wird hier nicht erfunden. Bis dahin verweigert das System die
Konsolidierung, statt eine falsche zu erzeugen.

Für die externe Prüfung heißt das: **ein grüner HTTP-Status auf
`apply` war bisher kein Nachweis für eine richtige Konzernrechnung.**
Wenn dieser Pfad im Pilot genutzt wurde, sind die erzeugten
Konzernabschlüsse zu prüfen.

---

### Nachtrag 2026-10-07 (Nachtrag 3): Vier Produktlücken geschlossen

Nach den drei Auditrunden wurden die vier offenen Punkte umgesetzt. Jeder
Punkt war entweder eine Spezifikationslücke oder eine deklarierte, aber
nicht durchgesetzte Kontrolle.

#### 1. DELETE-Route für Konsolidierungseinheiten

`@@unique([mutterMandantId, geschaeftsjahr])` bedeutet: eine Einheit
belegt ihr Geschäftsjahr dauerhaft. Es gab keinen Löschweg. Nach einem
abgebrochenen Versuch — insbesondere nachdem `apply` fachlich nicht
anwendbar war — war für dasselbe Jahr keine zweite Konsolidierung mehr
möglich; es blieb nur manuelles Nachhelfen in der Datenbank.

Neu: `DELETE /api/konsolidierung/einheiten/:id`. Gesperrt ab
`COMPLETED` — ab da existieren Konzern-Bilanz und Konzern-GuV und der
Aufzeichnungsstand nach § 147 AO wird nicht entfernt.

#### 2. Premium-Funktionen werden durchgesetzt

`TIER_CONFIGS` definierte `custom-domain`, `public-api` und
`white-label-branding` als Premium-only. `FeatureFlagService.has()`
hatte **null** Aufrufer, ein `SubscriptionGuard` existierte nicht. Eine
PILOT-Kanzlei konnte alle drei uneingeschränkt nutzen.

Live belegt nach Einführung (`assertFeatureEntitled`):

| Aktion | PILOT | PREMIUM |
|---|---|---|
| Custom-Domain verifizieren | 402 `FEATURE_NOT_ENTITLED` | 200 |
| API-Schlüssel anlegen | 402 `FEATURE_NOT_ENTITLED` | 201 |
| Branding-Farbe ändern | 402 `FEATURE_NOT_ENTITLED` | 200 |

Zwei Entscheidungen: Die **Aktion** wird gesperrt, **vorhandene Daten
bleiben** — wer nach einem Downgrade sein Logo verliert, kann nicht
nachvollziehen, warum. Und ein **GET** darf nie an einem Tarif scheitern,
sonst wäre die Branding-Seite für PILOT unbenutzbar. Geprüft wird
deshalb nur bei einer tatsächlichen Änderung.

Der Seed steht jetzt auf PREMIUM: eine Demonstrationsumgebung, die genau
die Funktionen sperrt, die sie verkaufen soll, demonstriert nichts. Die
Sperre selbst ist für PILOT nachgewiesen.

#### 3. Vier-Augen-Prinzip — jetzt erfüllbar und erzwungen

Der Befund war doppelt: die Kontrolle **fehlte** (der Prüfende konnte
selbst freigeben) und war **nicht abstellbar** (`WPPruefungsAbschluss`
führte genau ein `wpUserId`, der Seed genau einen Wirtschaftsprüfer).
Eine harte Sperre hätte den gesamten Freigabeweg lahmgelegt.

Beides erledigt: Migration `20261007212118_wp_vier_augen` mit
`freigegebenVonId`/`freigegebenAm`, und ein zweiter Wirtschaftsprüfer
(`wp2@kanzlei.de`) im Seed. Damit **erzwungen**:

| | |
|---|---|
| Prüfende gibt selbst frei | 403 Vier-Augen-Prinzip |
| Zweite Person gibt frei | 200 `APPROVED` |

Aufzeichnungsstand (§ 147 AO): Repository, Audit-Eintrag und API nennen
`pruefendeUserId`, `freigegebenVonId` und `vierAugenErfuellt`. Aus dem
Datensatz ist jetzt erkennbar, **ob** und **wie** vier Augen geprüft
wurde — vorher war das nicht feststellbar.

Nur beim Freigeben gesperrt, nicht beim Zurückweisen: eine Ablehnung
durch den Prüfenden selbst entwertet nichts, sie stoppt nur.

#### 4. Konzernabschluss als eigener Satz (§ 301 HGB / IDW RS 11)

Der Unique-Constraint verhinderte, dass Einzelsatz und Konzernsatz der
Mutter gleichzeitig existieren. `apply` speicherte den Konzernsatz unter
`mutterMandantId` — beide Zweige waren falsch: 400 „erst löschen" oder
201 mit einer Rechnung ohne die Mutter.

Migration `20261007230000` führt `konzernEinheitId` ein und **partielle**
Unique-Indizes:

```
UNIQUE (mandantId, geschaeftsjahr)                    WHERE konzernEinheitId IS NULL
UNIQUE (mandantId, geschaeftsjahr, konzernEinheitId)  WHERE konzernEinheitId IS NOT NULL
```

Warum partielle Indizes und nicht `coalesce(...)` im Spaltendefault:
Postgres vergleicht beim Zeilenscan auch COALESCE-Ausdrücke des
Indizes — ein Default hätte nichts geändert. Live belegt: die Mutter
führt jetzt für dasselbe Jahr **beide** Sätze (Einzel 100.000 / Konzern
100.000).

#### 4b. Kapitalkonsolidierung — sie konnte nie auslösen und brach die Gleichung

Zwei Defekte:

- `anschaffungskosten`, `eigenkapitalTochter`,
  `jahresueberschussTochter` standen fest auf 0 und hatten **keinen
  Schreibpfad**. `if (ak > 0 || ekTochter > 0)` war damit immer falsch.
- Die Buchung reduzierte Passiva um `betrag` **und** erhöhte Aktiva um
  denselben Betrag → Differenz **2 × betrag**. Die Konzern-Bilanz war
  nach dem Buchen nicht ausgeglichen, wurde aber gespeichert und als
  `VALIDATED` gemeldet.

Negativprobe mit dem alten Code (AK 60.000 / EK 100.000):
```
Bilanz ungleich: Aktiva 240000 / Passiva 160000:
expected 80000 to be less than 0.01
```
80.000 = 2 × 40.000.

Korrekt ist jetzt: anteiliges Tochter-EK eliminieren, Geschäfts-/
Firmenwert als Aktivposten ansetzen (Badwill mindert das EK) und den
Rest als **Kapitalkonsolidierungsdifferenz** ausweisen — damit die
Gleichung aufgeht und der Betrag für die Wirtschaftsprüfung sichtbar
ist, statt zu verschwinden.

**Zur Testform:** Der Gleichungstest blieb zunächst grün, weil die
Fixture eine Buchung mit Betrag 0 erzeugte — mit der alten Logik war
dann nichts zu sehen. Eine Fixture, die den Fehler nicht auftreten
lässt, macht den Test wertlos. Erst mit dem echten |AK − anteil EK|
wurde er sichtbar.

---

### Nachtrag 2026-10-08 (Nachtrag 4): Die Audit-Hash-Kette konnte brechen

Der schwerste Befund des Audits — und er war mehrere Tage lang als
„sporadisch roter Test" abgetan worden.

**Die Kette hing an einer Zufalls-UUID.** `computeHashForEntry()`
verketten über `(createdAt, id)`. `id` ist eine zufällige UUID (v4),
die Verarbeitung läuft aber in Einfügereihenfolge
(`AuditIntegrityService.enqueue` ist eine Promise-Kette). Entstehen
zwei Einträge in derselben Millisekunde — bei einem Sammel-Import
Regelfall —, entscheidet die UUID statt der Einfügereihenfolge. Wird
der später eingefügte Eintrag mit einer **kleineren** UUID verarbeitet,
findet er den ersten nicht als Vorgänger und beginnt die Kette neu.

Belegt mit 25 Einträgen und identischem `createdAt`:

| | Ergebnis |
|---|---|
| alte Kette | `{"status":"BROKEN","entriesChecked":1, …}` — **1 von 25** geprüft |
| neue Kette | `OK`, `entriesChecked: 25`, `prevHash == entryHash` des Vorgängers |

**Fix:** Migration `2026_10_08_210000_audit_chain_sequenz` — `sequenz
BIGSERIAL` mit Index `(kanzleiId, sequenz)`. Beide Stellen
(`computeHashForEntry`, `verifyIntegrity`) sortieren danach. Ein
Hash-Kette braucht eine Totalordnung aus der Datenbank, nicht aus
Zufallswerten.

`sequenz` ist **nicht** Teil des Hashes: die Spalte kam nachträglich
dazu und ist für die Aussage des Eintrags ohne Bedeutung. Wäre sie
eingegangen, wäre jeder bestehende Hash ungültig.

**Für die externe Prüfung:** Ein Prüfer, der `verifyIntegrity()` aufruft,
bekam bisher bei einem Sammel-Import möglicherweise `BROKEN` für eine
vollständig intakte Kette. Noch schlimmer: `entriesChecked: 1` bedeutet,
dass faktisch **ein einziger** Eintrag geprüft wurde. Ein „grüner"
Audit-Trail auf dieser Grundlage trug keine Aussage.

---

### Nachtrag 2026-10-09 (Nachtrag 5): Ein Klick löschte die gesamte Buchhaltungshistorie

Der schwerste Aufbewahrungsbefund des Audits. Gefunden bei einem Sweep über
alle Löschpfade — nicht über die Bilanz, sondern über **den Mandanten**.

#### Der Defekt

`DELETE /api/mandant/:id` rief `prisma.mandant.delete()` auf. Das Schema
hängt per `onDelete: Cascade` an:

```
Mandant ──> Bilanz         ──> BilanzPosition, WPNotiz,
                               WPPruefungsAbschluss, BilanzPruefungsResult
       ──> GuV            ──> GuVPosition
       ──> Anhang         ──> AnhangAbschnitt
       ──> Jahresabschluss──> Signature          <-- qeS-signierte Abschlüsse
       ──> BanzSubmission
```

Ein einziger DELETE eines Mandanten **mit Bestand** vernichtete damit die
vollständige Buchhaltungshistorie — einschließlich kryptografisch
signierter Abschlüsse. § 147 AO verlangt zehnjährige Aufbewahrung und
Unveränderbarkeit. Vorher war das ein freier Durchgang für `KANZLEI_ADMIN`;
`bilanz`, `guv` und `anhang` waren zu diesem Zeitpunkt bereits auf `DRAFT`
gesperrt, der Mandant war die Lücke in genau dieser Sperre.

#### Live gemessen (HTTP-Pfad, Messung direkt per Prisma)

| Messung | vorher | nachher |
|---|---|---|
| `DELETE` auf Mandant **mit** Bilanz | — | **204 No Content** |
| Bilanzen | 1 | **0** |
| Audit-Einträge mit Mandantbezug | 2 | **0** |
| `/health/ready` `auditWriteFailures` | 1 | **2** |

#### Zwei Folgeschäden, die dieselbe Ursache haben

1. **Die Nachvollziehbarkeit verlor ihren Bezug.** `AuditLog.mandant` ist
   eine *optionale* Relation ohne `onDelete` — also `SetNull`. Beim Löschen
   wurden `mandantId` **und** `jahresabschlussId` *aller* Audit-Einträge
   dieses Mandanten genullt. Die Zeilen bleiben erhalten, verlieren aber ihre
   Zuordnung und verschwinden aus jeder mandant-gefilterten Sicht.

2. **Jedes erfolgreiche Mandant-DELETE zerstörte seinen eigenen
   Audit-Eintrag.** Der Eintrag wird *nach* dem Löschen geschrieben und
   referenziert `before.id` — ein Fremdschlüssel auf eine gerade gelöschte
   Zeile. `record()` schluckt den Fehler, `failedWrites` steigt, und
   `/health/ready` bleibt **dauerhaft** `degraded`. Der Zähler wird nie
   zurückgesetzt. Der erfolgreiche Betriebsfall war damit genau der, der den
   Health-Check dauerhaft entwertet.

#### Behoben

- **Sperre (409):** Vor dem Löschen wird der aufbewahrungsrelevante Bestand
  gezählt — Jahresabschluss, Bilanz, GuV, Anhang, BanzSubmission. Ist
  Bestand da, `409 Conflict` mit Klartextbenennung des Bestands.
- **Audit-Eintrag:** `mandantId: null` (der Bezug steckt in `entityId`, die
  Kanzleizugehörigkeit in `kanzleiId`) — der Eintrag landet jetzt.

Gegenprobe: ein Mandant **ohne** Buchhaltungsdaten bleibt löschbar
(HTTP 204), und sein DELETE-Eintrag wird tatsächlich persistiert
(`kanzleiId` gesetzt, `mandantId` null).

#### Ein Fehler, den der erste Fix selbst machte

Der erste Entwurf zählte und löschte unter `SERIALIZABLE`. Live gemessen
lieferte das Löschen eines **leeren** Mandanten HTTP 500:

```
P2034 — Transaction failed due to a write conflict or a deadlock
```

Postgres SSI bricht genau dieses Muster (`count` + `DELETE`) routinemäßig ab.
Und es hätte das Restfenster ohnehin **nicht** geschlossen: SSI garantiert eine
serielle Reihenfolge, in der der konkurrierende Insert legitim *nach* dem
Delete liegen darf — dann greift das Cascade trotzdem. Kosten ohne Nutzen;
zurückgenommen, mit Begründung im Code festgehalten.

*Restrisiko, bewusst so gelassen:* ein Abschluss, der exakt zwischen Zählen
und DELETE entsteht, rutscht durch das Cascade. Das erfordert zwei
gleichzeitige Admin-Aktionen auf denselben Mandanten. Wer es ganz schließen
will, braucht eine DB-seitige Sperre (Trigger), nicht noch eine
Isolationsstufe.

#### Offene Produktfrage (Fachfreigabe, hier bewusst NICHT erfunden)

Was passiert mit einem Mandanten, der weg muss, aber Aufbewahrung hat?
Serienreif sind nur: **Archivieren** statt Löschen, **Pseudonymisieren**, oder
**Aufbewahrung nach Ablauf beenden**. Keines ist implementiert, weil jede
eine Rechts- und Fachentscheidung ist. Bis dahin ist der Pfad gesperrt —
das ist die fail-closed-Variante.

---

### Nachtrag 2026-10-09 (Nachtrag 6): Die Bearbeitungssperre war mit einem PATCH aufzuheben

Gefunden beim Sweep über die Schreibpfade, nicht über die Abschluss-Kette.

#### Der Defekt

Bilanz, GuV und Anhang sperren ihre Inhalte zu Recht:

```
if (previous.status !== 'DRAFT' && dto.positionen !== undefined) {
  throw new BadRequestException('Positionen können nur in DRAFT-Phase geändert werden');
}
```

Aber `status` kam **aus dem Request** (`status: dto.status ?? undefined`).
Damit war das Schloss ohne Schlüssel-Zwang: ein einziger PATCH auf `DRAFT`
hat die Sperre wieder geöffnet, der nächste PATCH durfte die Beträge
schreiben. Alle drei Services betroffen, mit drei verschiedenen
Fehlermeldungen für denselben Sachverhalt.

#### Live gemessen, vier Requests über die öffentliche API

| # | Request | vorher | nachher |
|---|---|---|---|
| 1 | `PATCH { status: 'VALIDATED' }` | 200 → DB `VALIDATED` | 200 → DB `VALIDATED` |
| 2 | `PATCH { positionen: […] }` | **400** ✅ gesperrt | **400** ✅ |
| 3 | `PATCH { status: 'DRAFT' }` | **200** → DB `DRAFT` ← Umgehung | **400** ← DB bleibt `VALIDATED` |
| 4 | `PATCH { positionen: […] }` | **200**, Beträge auf 9999 | **400**, Beträge bleiben 1000 |

#### Der Vier-Augen-Stand war mit derselben Hand aushebelbar

`setBilanzStatus()` setzt nach einer WP-Freigabe den Status **`APPROVED`**.
Von dort aus genügte derselbe PATCH: Freigabe einer Wirtschaftsprüferin
zurückrechnen, anschließend Positionen ändern. Die Kontrolle war auf zwei
Requests verteilt und damit keine.

Ergänzend: `APPROVED` steht **nicht** in `BILANZ_STATUS`
(`['DRAFT','VALIDATED','ARCHIVED']`) — es ist ein Systemzustand. Das ist
richtig so (der Client darf ihn nicht setzen, `@IsEnum` weist ihn ab),
aber es sind zwei Vokabulare für dieselbe Spalte.

#### Behoben

`src/common/utils/status-transition.ts` — eine Quelle der Wahrheit für alle
drei Bestandteile, verdrahtet in `bilanz.service`, `guv.service` und
`anhang.service`.

**Regel:** `DRAFT` heißt „in Bearbeitung" und ist monoton — wer ihn
verlassen hat, kann nicht zurück. Vorwärtsgerichtete Schritte
(`VALIDATED → ARCHIVED`) bleiben offen.

*Was hier bewusst NICHT getan wurde:* eine vollständige Zustandsmaschine.
Welcher Übergang wann erlaubt ist, ist eine Fachentscheidung. Geschlossen
wurde genau der nachgewiesene Weg, sonst nichts.

13 neue Tests: 8 für die Regel, 5 für die Verdrahtung in allen drei
Services (ein Regeltest wäre grün, auch wenn niemand sie aufruft).
Negativprobe gegen die alte Fassung: 4 von 5 Verdrahtungstests rot mit
`promise resolved instead of rejecting` — die alte Fassung akzeptierte das
Zurücksetzen in allen drei Services.

#### Offener Folgebefund aus derselben Kette — hier dokumentiert, nicht kaschiert

Beim Nachsehen der Zustandsmaschine fiel auf, dass **Signieren keinen
Zustand erzeugt**:

- `SIGNED` kommt im gesamten Backend-Quelltext **nicht vor**, obwohl das
  Schema `DRAFT | FINALIZED | SIGNED | SUBMITTED | PUBLISHED` dokumentiert.
- `finalisiertAm`, `signiertAm`, `eingereichtAm` werden nie geschrieben.
- Die Tabelle `jahresabschluss` war zum Zeitpunkt der Prüfung **leer**.

Und: `Signature`-Datensätze werden nur für einen Abschluss angelegt, nicht
für Bilanz/GuV/Anhang (`signatur.service.ts`: „ohne verknüpften
Jahresabschluss überspringen wir den DB-Record"). Gemessen in der Datenbank:
**9 WORM-Objekte, darunter `BILANZ_PDF_SIGNED` und `GUV_PDF_SIGNED` mit
`legalHold` — und 0 Signature-Records.**

Es wurden also qualifiziert signierte PDFs unveränderlich abgelegt, ohne
einen einzigen Datenbankbeleg: wer hat signiert, mit welchem Zertifikat,
über welchen Hash, zu welchem Zeitpunkt. Das `Signature`-Modell hat dafür
genau die Felder (`zertifikatSubject`, `zertifikatSeriennummer`,
`hashVorher`, `hashNachher`, `zeitstempelIssuer`) — sie werden nur nie
gefüllt, weil das Modell **kein `entityType`/`entityId` kennt** und
`jahresabschlussId` NOT NULL ist. Eine signierte Bilanz ist darin
strukturell nicht darstellbar.

Nicht behoben: das braucht eine Migration (nullable `jahresabschlussId`
plus `entityType`/`entityId`) und ist eine eigene Entscheidung, kein
Nebenfix. Die Konsequenz ist hier festgehalten, damit sie nicht als
erledigt gelesen wird.

**Entscheidung der Kanzlei-Fachverantwortlichen, 2026-10-09:** *keine*
Migration. Der Audit-Trail ist der anerkannte Nachweis — er führt
`certificateSubject`, `certificateIssuer`, `certificateSerial`,
`certificateFingerprintSha256`, `hashBefore`, `hashAfter`,
`signedPdfWormKey` und `timestampAuthority` vollständig mit, und das
signierte PDF liegt unveränderlich im WORM mit `legalHold`. Die leere
`Signature`-Tabelle wird damit als bewusst nicht genutzt dokumentiert,
nicht als offener Mangel.

Damit bleibt genau eine Konsequenz bestehen, und sie ist hier festgehalten:
**es gibt keine „ist signiert?"-Abfrage.** `findLatestByJahresabschluss()`
hat keinen einzigen Aufrufer im Backend. Solange das so ist, kann keine
Regel „nach Signierung gesperrt" auf Datenlage entscheiden — sie würde
einen Zustand abfragen, den es nicht gibt.

#### Signatur: sperrt sie den Bestandteil? — ENTSCHIEDEN am 2026-10-10

**Antwort: nein. Die Daten bleiben nach der Signatur aenderbar.**

Das ist eine bewusste Wahl und keine Verlegenheit. Sie besagt: die
qeS-Signatur **bescheinigt einen Zeitpunkt**, nicht den Endzustand. Die
Signatur bleibt kryptografisch gueltig — sie bezeugt das PDF, das
unveraenderlich im WORM liegt.

**Die Folge, die daraus folgt und die niemand uebersehen sollte:** ob der
zugrunde liegende Datensatz nach der Signierung veraendert wurde, ist
ausschliesslich aus dem **Audit-Trail** ersichtlich. Bei dieser Entscheidung
ist der Audit-Trail damit nicht Nebenschauplatz, sondern der einzige Ort,
an dem die Veraenderung sichtbar wird. Genau deshalb wird am Signaturpfad
auch nichts geaendert: er schreibt bereits vollstaendig (Zertifikat, Hash
vorher/nachher, WORM-Key, Zeitstempel-Aussteller), und jede spaetere
Aenderung an der Bilanz erzeugt einen eigenen Audit-Eintrag mit
`previousState` und `newState`.

Festgehalten in
`backend/src/modules/bilanz/services/signatur-nicht-sperrend.spec.ts`.
Ein Test, der festhaelt, dass **bewusst nicht** gesperrt wird, verhindert,
dass jemand die Sperre spaeter "sicherheitshalber" einbaut — das wuerde die
Entscheidung zur genau anderen Seite hin umdrehen, ohne dass jemand sie
nochmal getroffen hat. Der Test grenzt dabei ab: "Daten duerfen sich
aendern" heisst ausdruecklich **nicht** "die DRAFT-Sperre faellt weg".

Der Preis dieser Entscheidung, offen benannt: ein Dritter, der nur das PDF
in der Hand hat, kann nicht erkennen, dass sich die Zahlen danach geaendert
haben. Er muss den Audit-Trail hinzuziehen. Wer das im Pilot nicht
akzeptiert, muss zu Versionierung wechseln — dann aber mit den Daten aus
Nachtrag 6 (`Signature` ohne `entityType`/`entityId` ist der Grund, warum
das gerade nicht geht).

---

### Nachtrag 2026-10-10 (Nachtrag 8): Kontenrahmen — Import und Export sprachen verschiedene

Entscheidung der Fachverantwortlichen vom 2026-10-10: **SKR03 wird
unterstützt.** Die Umsetzung förderte zwei Dinge zutage, die vorher nicht
bekannt waren.

#### Der Import kannte keinen Kontenrahmen

Der Export akzeptierte `skrPlan: 'SKR03' | 'SKR04'`. Der Import hatte **kein
`skrPlan`-Feld** und löste ausschließlich über die SKR04-Reverse-Tabelle
auf. Eine SKR03-Datei lief dadurch durch die SKR04-Auflösung.

#### Der README-Befund war richtig, aber nicht der schlimmste Fall

Der README nannte `7000` als Beispiel. Ausgezählt über die **Reverse-**
Tabellen (den Tabellen, die der Import tatsächlich benutzt) sind es **sechs**
Nummern, die in beiden Rahmen vorkommen — und bei **zwei** landen sie auf
einer anderen GuV-Position:

| Konto | SKR03 | SKR04 | Folge beim Import vor dem Fix |
|---|---|---|---|
| `5000` Materialaufwand | `5a.` | `5a.` | keine |
| `6000` Personalaufwand | `6a.` | `6.` | andere Unterposition |
| `6200` Abschreibungen | `7a.` | `7a.` | keine |
| `7000` sonstige betriebl. Aufw. | `8.` | `8.` Werbekosten | **nur der Name** |
| `7300` | `13.` **Zinsen/Aufwand** | `8.` **Versicherungen** | **falsche GuV-Position** |
| `7600` Steuern | `14.` | `14.` | keine |

`7000` war kein gutes Beispiel: es landet in beiden Rahmen auf GuV-Zeile 8.,
nur der Name unterscheidet sich. `7300` ist der echte Fall — **Zinsaufwand
wurde als Versicherung gebucht.** Der alte Befund war also nicht falsch,
aber er hätte die Hälfte des Schadens beschrieben.

#### Live belegt, komplette Kette

```
skrPlan: SKR03  →  7300 = 13.  Zinsen und ähnliche Aufwendungen   ✅
skrPlan: SKR04  →  7300 =  8.  Versicherungen          ← was vorher IMMER geschah
ohne skrPlan    →  HTTP 400
```

#### Behoben

- **`skrPlan` ist Pflicht** in `ImportDatevDto` und `PreviewDatevImportDto`.
  Ein Default „SKR04" wäre nur eine andere Tarnung desselben Fehlers: ein
  Aufrufer, der den Rahmen nicht kennt, würde raten — und Raten war der
  Befund. Lieber 400 mit klarer Meldung.
- **`getReverseMapping(konto, rahmen)`** — der Kontenrahmen ist Teil des
  Aufrufs. Rückwärtskompatibilität gibt es bewusst nicht.
- **Neue Tabelle `skr03-reverse.ts`**, 9 Konten, jede Zeile nennt die
  GKV-GuV-Zeile, auf die sie sich bezieht. Drei davon (`8050`, `8100`,
  `7300`) standen im Vorwärts-Mapping auf Positionen, die etwas anderes
  bedeuten — im Reverse wird auf die tatsächliche GuV-Zeile aufgelöst.
- **Konten ohne Eintrag landen in `unmappedKonten`.** `skr03.ts` ist eine
  verkürzte Tabelle ohne Bilanzkonten; diese landen sichtbar in der manuellen
  Zuordnung, statt still auf eine SKR04-Position zu fallen.
- **Oberfläche:** Auswahl im DATEV-Import-Dialog, Standard SKR04, mit
  Hinweistext, dass eine falsche Angabe still auf die falsche GuV-Position
  bucht.

#### Ein zweiter Defekt, gefunden beim Nachrechnen

`4700`/`4720` („Erlöse aus Beteiligungen") zeigten auf `13.` =
**„Zinsen und ähnliche AUFWENDUNGEN"** — ein Ertrag auf einer Aufwandszeile.
Das lag am **SKR04-Pfad** und hätte heute jeden SKR04-Import betroffen.

Der Fehler war **strukturell unsichtbar**: beide Positionen tragen
`kategorie: 'FINANZ'`, ein Kategorie-Vergleich kann ihn nicht finden. Nur
der Vergleich der Position mit der GuV-Zeile deckt ihn auf. Behoben auf `9.`
(„Erträge aus Beteiligungen").

#### Tests

Der Vorgänger-`it.fails` ist durch Tests ersetzt, die die **echten
Produktionsfunktionen** prüfen — er hatte sich eine `IMPORT_AUFLÖSUNG`-Kopie
im Spec gebaut. Ein Test, der eine Nachbildung prüft, sagt nichts über das
Original aus.

Dazu eine strukturelle Absicherung: jede Reverse-Zuordnung muss auf eine
existierende GKV-Position zeigen. **Und die Grenze dieser Absicherung steht
im Test**: sie fängt Tippfehler und Drift, aber **nicht** eine Position, die
existiert und etwas anderes bedeutet — genau der Fall von `4700`. Strukturelle
Tests sind eine notwendige, keine hinreichende Bedingung.

59 Tests in dieser Datei. Zwei Negativproben: `4700` zurück auf `13.` →
Test rot mit `zeigt auf "Zinsen und ähnliche Aufwendungen" — das ist ein
Aufwand`; SKR03-`7300` zurück auf `12.` → Test rot.

#### Nebenbefund mit eigener Klasse

`e2e/datev-import.e2e.spec.ts` baut in `beforeAll` ein vollständiges
Nest-Application, benutzt es aber **nie**: `BASE` zeigt auf
`http://localhost:3000`, und alle Requests gehen per `fetch` an den
laufenden Server. Beim Umsetzen des Befunds weiter oben hat das die
Änderung am DTO vollständig verdeckt — der Test war grün, weil er einen
**anderen Prozess** prüfte, noch mit dem alten Code.

**Korrektur der Deutung, 2026-10-12.** Diese Notiz behauptete zunächst,
ein Test gegen einen neben ihm laufenden Server prüfe den Code unter
Test nicht. Das ist zu weit gefasst:

- Der CI-Job startet **bewusst** einen echten Server
  (`nohup npx ts-node src/main.ts`), und die Specs prüfen ihn per HTTP.
  Damit ist die Abdeckung **echtes End-to-End** — inklusive `main.ts`-
  Bootstrap, globaler Pipes, Guards, Interceptor, CORS und
  Exception-Filtern. Das ist mehr, als `app.inject()` auf einer
  TestingModule liefern würde.
- Der CI-Lauf bestätigt das: 683/683 grün.

Richtig ist:

1. Der `createNestApplication()`-Block war in 16 von 18 Specs **toter
   Code**. Er deklarierte `ValidationPipe` und den globalen Präfix
   **erneut von Hand** — eine Nachbildung der `main.ts`-Konfiguration.
   Ändert sich `main.ts` (etwa eine neue Pipe oder Interceptor-Option),
   prüften die Specs weiter die alte Konfiguration, ohne zu warnen.

   **Behoben am 2026-10-13**, Datei für Datei und nach jeder Datei
   verifiziert: der App-Aufbau ist entfernt, der Kommentar sagt jetzt,
   worauf die Spec tatsächlich prüft. 683/683.

   **Nachtrag, derselbe Tag:** Nach dem Entfernen der Importe waren sechs
   Specs fuer TypeScript keine Module mehr, sondern **Globalskripte**. Ihre
   `const BASE` auf oberster Ebene landete im globalen Scope und kollidierte
   (TS2451) — unter anderem mit `pagination.e2e.spec.ts`, das schon vorher
   ein Skript war und deshalb erst jetzt auffiel.

   Lokal war das unsichtbar: ich hatte `npx tsc --noEmit` gefahren, die CI
   faehrt `npm run typecheck` = `tsc --noEmit && tsc -p tsconfig.test.json`
   — und **erst das zweite schliesst e2e ein**. Ein lokaler Check, der
   eine Konfiguration auslaesst, meldet "gruen" fuer Code, den CI
   ablehnt. Behoben mit `export {};` am Dateiende.


   **Folge, die derselbe Eingriff aufgedeckt hat:** `pdf.e2e.spec.ts` und
   `signatur.e2e.spec.ts` **benutzten** `LoginResponse`, **deklarierten es
   aber nirgends**. Sie bekamen den Typ aus dem globalen Scope — von
   `pagination.e2e.spec.ts`, das selbst ein Globalskript war. Als das zum
   Modul wurde, brach die CI mit `Cannot find name 'LoginResponse'`.

   Das ist der unangenehmste Kopplungsfall überhaupt: **jede Datei
   kompiliert für sich allein betrachtet**, und trotzdem schlägt das
   Umbenennen, Verschieben oder Löschen einer völlig fremden Datei fehl.
   Drei Dateien hingen an einer impliziten Vereinbarung, die nirgends
   notiert war. Beide haben den Typ jetzt selbst deklariert — wer sie
   umbenennt, kann daran nichts mehr zerlegen.

   Vier Blöcke taten mehr als App aufbauen und bleiben deshalb behalten —
   der TestingModule wird dort weiterhin gebraucht: `api.e2e`
   (Admin-Token-Fixture), `public-api.e2e` (Login-Fixture),
   `mandant-quelle.e2e` und `mandantentrennung.e2e` (`prisma` daraus).

2. `signatur.e2e.spec.ts` setzte zusätzlich `process.env['S3_*']` mit dem
   Kommentar „Mock-Env VOR App-Init setzen". Der Server unter Test ist ein
   **anderer Prozess** — diese Variablen erreichen ihn nicht und können es
   nicht. Der Kommentar legte eine Konfiguration nahe, die es nicht gab;
   das ist schlimmer als toter Code, weil er aktiv in die Irre führt.
2. Die Specs hängen an einem Server auf `:3000`. Der CI-Schritt
   „Backend starten" muss mit der Suite mitgehen — sonst schlägt die
   ganze Datei mit `ECONNREFUSED` fehl (gemessen: 112 rote Tests, als
   der Server fehlte).

Der oben genannte Satz „ein Test gegen einen neben ihm laufenden
Server prüft den Code unter Test nicht" ist damit **zurückgenommen**:
Getestet wird der Code, nur über einen realen HTTP-Server statt
in-process. Zu Recht ist der Widerspruch zwischen dem toten
`beforeAll`-Block und dem realen Serverpfad — er hat den Test hier
genau eine lokale Änderung durchsehen lassen.

---

### Nachtrag 2026-10-11 (Nachtrag 9): Code-Review — zwei Rechte-Lücken, ein abgeleitetes Feld

Ein unabhängiges Review über den Gesamtbaum (252 Dateien) plus eigene
Nachprüfung jedes Befunds. Zwei Funde wurden bestätigt und behoben, einer
war eine **Folge der eigenen Arbeit vom Vortag**.

#### 1. Kanzlei-übergreifende Rechteausweitung (hoch)

Vier Services hatten dieselbe Lücke:

```ts
const isAdmin = user.mandanten.some((m) => m.rolle === 'KANZLEI_ADMIN');  // Admin IRGENDWO
await this.assertKanzleiAccess(kanzleiId, user);                          // Mandant IRGENDWO
```

Zwei Prüfungen, unabhängig voneinander. Zusammen belegen sie „Admin
irgendwo" + „Mandant in der Ziel-Kanzlei" — **nicht** „Admin in dieser
Kanzlei". Wer in Kanzlei A `KANZLEI_ADMIN` ist und in Kanzlei B
`STEUERBERATER`, besteht beide Prüfungen für B.

Betroffen: `subscription` (Kündigung), `api-key` (Anlegen/Widerrufen),
`webhook` (inkl. `testDelivery`, das einen echten HTTP-Request auslöst —
die Lücke war damit auch ein SSRF-Vektor in fremde Kanzleien hinein) und
`dns` (Custom-Domain-Verifikation, also Branding-Übernahme).

Die Kommentare an den Fundstellen kannten das Problem — in
`webhook.service.ts` steht wörtlich, die Rollenprüfung belege „nur Admin
IRGENDWO". Der Fix vom 2026-10-06 hat den `kanzleiId`-Zugriff ergänzt, die
Rolle aber nicht daran gebunden.

Behoben mit `common/utils/kanzlei-rolle.ts` — eine Quelle der Wahrheit für
alle vier. Die Negativprobe liefert den direkten Beweis: ohne das Binding
erreicht `createApiKey` die **Entitlement-Prüfung** („public-api ist im
Tarif nicht enthalten") und `createSubscription` den eigentlichen
Schreibvorgang. Die Autorisierung lief also durch.

#### 2. `ergebnis` der GuV war clientgesteuert (hoch)

`CreateGuVDto` kannte das Feld nicht, `UpdateGuVDto` schon. Im Service stand
`let ergebnis = dto.ergebnis`, neu berechnet wurde nur mitgeschickt bei
Positionen. Damit genügte EIN Request:

```
PATCH { ergebnis: 999999.99 }   ->   HTTP 200, DB 999999.99
```

Der Wert fliesst von dort in das GuV-PDF (`guv.template.ts:167`), in das
Abschluss-PDF (`abschluss.template.ts:330`) und in die E-Bilanz-XBRL als
`netIncome` (`xbrl-generator.service.ts:187`). Das PDF landet im WORM mit
`legalHold` und ist qeS-signierbar — das **Jahresergebnis eines signierten
Abschlusses war frei setzbar**. `/validate` meldete weiterhin den
korrekt berechneten Wert: das System widersprach sich selbst, ohne zu
melden.

`ergebnis` ist abgeleitet (Erlöse minus Aufwendungen) und gehört nicht in
einen Eingabe-DTO. Entfernt: jetzt `400 property ergebnis should not exist`,
fail-closed über `forbidNonWhitelisted`, ohne Sonderlogik im Service.

#### 3. Der DATEV-Import umging die Archivierung (mittel) — Folge eigener Arbeit

Die Archivierung vom 2026-10-09 war in Bilanz, GuV und Anhang verdrahtet,
**nicht** im Import-Pfad. Das ist keine theoretische Lücke: `execute` legt
Bilanz **und** GuV an und ersetzt die Positionen. Ein archivierter Mandant
konnte darüber weiterhin Belege erhalten. Behoben mit einer eigenen
Pruefung neben `assertMandantAccess` — Zugriff und Bearbeitbarkeit sind
zwei unabhaengige Fragen.

#### 4. Der DATEV-Import war nicht atomar (hoch) — nachgemessen und behoben

Dieser Punkt stand im Review unter „nicht verifiziert". Nachgemessen:
**bestätigt**.

Schritt 5 schrieb die Bilanz, Schritt 5b die GuV — und die DRAFT-Prüfung
der GuV stand in 5b, also **nach** dem Schreiben der Bilanz. Bestand
„Bilanz DRAFT + GuV VALIDATED" mit `overwriteExisting: true`:

1. Bilanzpositionen werden **ersetzt** (`deleteMany` + Neuanlage)
2. der GuV-Zweig wirft 400
3. der Audit-Eintrag wird nie erreicht

Ergebnis: eine GoBD-relevante Mutation ohne Nachweis, bei einem
HTTP-Fehler, der das Gegenteil suggeriert.

Behoben auf zwei Ebenen: beide DRAFT-Prüfungen laufen **vor** dem ersten
Schreibvorgang, und beide Schreibvorgänge laufen in **einer**
Transaktion (`updateWithPositionen`/`createWithPositionen` von Bilanz und
GuV nehmen dafür einen optionalen `tx`-Client — dasselbe Muster wie beim
Konsolidierungs-Fix vom 2026-10-08).

Negativprobe, wörtlich: ohne die Vorabprüfung meldet der Test
`expected "spy" to not be called at all, but actually been called 1 times`
— die Bilanz wurde also nachweislich geschrieben.

#### 5. Logout war zu weit (mittel) — nachgemessen und behoben

`POST /auth/logout` hatte zwei getrennte Fehler:

1. `update({ where: { id: sessionId } })` **ohne `userId`**. Die Session-ID
   kam aus einer Suche nach dem Hash des mitgeschickten Refresh-Tokens.
   Wer den Token eines anderen Users mitbrachte, lieferte dessen
   Session-ID — und die wurde widerrufen. Im Audit stand dann der
   aufrufende User bei einer fremden Abmeldung: die Nachvollziehbarkeit
   (§ 146 AO) war falsch. Die Sperrbedingung sitzt jetzt an beiden
   Stellen (Auswahl im Controller **und** Update).
2. Unbekannter Token → `sessionId` blieb `undefined` → der else-Zweig
   widerrief **alle** Sessions des Users. Ein Client mit abgelaufenem oder
   rotiertem Refresh-Token wurde unerwartet überall abgemeldet und bekam
   trotzdem `204` ohne Meldung.

Negativprobe, wörtlich: ohne die Härtung meldet der Test
`expected "spy" to not be called at all, but actually been called 1 times`
— der alte Code widerrief also nachweislich alle Sessions.

Ohne Token bleibt der globale Widerruf erhalten: der Client kann dann
nur „alles abmelden" gemeint haben.

#### 6. `total` zählte Konzernsätze mit, `items` nicht (mittel) — behoben

`findByMandantPaginated` filtert `konzernEinheitId: null` und sagt im
Kommentar ausdrücklich warum: der Konzernsatz gehört zur
Konsolidierungseinheit, nicht in die Liste der Jahresabschlüsse des
Mandanten. `countByMandant` hatte denselben Filter **nicht**.

Für einen Muttermandanten einer Konsolidierungseinheit galt damit
`total: 3` bei `items: 2` — die letzte Seite war leer, und die Oberfläche
zeigte „Seite 2 von 2". Betraf Bilanz **und** GuV.

Der Test prüft die Bedingung im `where`, nicht das Ergebnis: ein Mock,
der unabhängig von der Bedingung eine Zahl liefert, würde einen falschen
Filter als richtigen aussehen lassen.

#### 7. Leere Pflichtdokumente waren archivier- und signierbar (mittel) — behoben

`generateBilanzPdf` ruft `assertBilanzVollstaendigUndSaldostimmig` auf und
verweigert ein PDF ohne Positionen — begründet mit „ohne Positionen ist
keine Aussage möglich". Dieselbe Begründung gilt für GuV und Anhang; dort
stand kein Gate.

Eine GuV ohne Positionen erzeugte also ein PDF, das **„Jahresergebnis:
0,00 EUR"** behauptet — eine belegte Aussage ohne Beleg, die danach im
WORM mit `legalHold` landet und qeS-signierbar ist. Ein Anhang ohne
Abschnitte ebenso.

**Bewusst kein Saldo-Gate für die GuV.** Erlöse minus Aufwendungen ergibt
das Jahresergebnis, nicht null; eine GuV „saldo-stimmig" zu verlangen wäre
erfundene Buchhaltung. Geprüft wird nur, was das Bilanz-Gate ebenfalls
begründet: es muss etwas zu berichten geben.

#### Ein Fehler, den das fail-closed-Gate selbst erzeugt hat

`mockActivate` (siehe Befund 4 oben) machte **zwei** Playwright-Tests rot:
`custom-domain.spec.ts` und `subscription.spec.ts` setzen den Tier über
`mock-activate`. Ursache war nicht die Korrektur, sondern dass sie die
Freischaltung verlangt — `BILLING_MOCK_ENABLED` war nirgends gesetzt.

Das ist die gewollte Reihenfolge: erst fail-closed, dann die
Freischaltung **ausschreiben**. CI setzt die Variable jetzt mit
Begründung. Hätte man sie weggelassen, wäre der CI-Lauf grün geblieben
und der Weg weiter offen gewesen — die schlimmere Variante.

#### 8. Signatur-Nebenwirkungen ohne Transaktion (hoch) — behoben und live belegt

Der letzte offene Punkt aus dem Review, in einer eigenen Runde bearbeitet.

Die Pipeline schrieb in drei Schritten: S3-Write → `wormObjectRepository.create`
→ `signatureRepository.create`. Ein Fehler im dritten ließ ein revisionssicher
archiviertes, **signiertes** PDF ohne Signatur-Datensatz zurück — und der
Audit-Eintrag hinter dem Block wurde nie erreicht. Die Signatur fand statt
und hinterließ keinen nachprüfbaren Beleg.

**Zwei Fehler in meinem ersten Umbau, beide korrigiert:**

1. Ich hatte *zwei* Transaktionen gebaut (Manifest+Auflösung, dann
   Signatur-Record). Das ist **schlechter** als vorher: bei Fehler im zweiten
   war das Manifest bereits committet. Der Signatur-Record muss *dieselbe*
   Transaktion teilen.
2. `resolveJahresabschlussId` nutzte `this.prisma` und damit eine **eigene
   Connection** — innerhalb der Transaktion las sie einen anderen Snapshot.
   Der Client wird jetzt durchgereicht.

**Was nicht transaktional ist und auch nicht sein kann:** der Objekt-Write
ins WORM-Lager. S3 kennt kein Two-Phase-Commit. Ein verwaister
Objekt-Eintrag ist harmlos und mit `legalHold` sogar erwünscht; ein
fehlender Signatur-Datensatz nicht.

**Live belegt** (der Playwright-Test signiert eine *Bilanz*, für die der
Signature-Record per Entscheidung entfällt — damit war nur der
Einschreib-Pfad belegt). Über einen als Fixture erzeugten Jahresabschluss
wurde der echte Zweischreib-Pfad durch die HTTP-Schnittstelle geprüft:

```
POST /api/signatur/sign-abschluss  ->  HTTP 200
WORM-Manifest geschrieben    : JA
Signature-Record geschrieben : JA
jahresabschlussId = ab7de889…  = erwartet
hashNachher / zertifikatSubject im Record
=> Beide Artefakte gehören ZU DERSELBEN Abschluss
```

Negativprobe ohne den `tx`-Parameter: `promise resolved "undefined"
instead of rejecting` — der Fehler wäre verschluckt worden, und genau das
macht aus einer Transaktion eine Erfolgsmeldung.

#### 9. Die Footer-Korrelations-ID war je Mandant konstant (niedrig, aber eindeutig) — behoben

`buildKorrelationsId` nahm die **ersten** 16 Zeichen des bereinigten
WORM-Objektschlüssels. Bei

```
mandant/<uuid>/<typ>/<jahr>/<uuid4>.pdf
```

sind das `"mandant"` + die ersten 9 Zeichen der Mandanten-UUID — der
eindeutige uuid4-Anteil am Ende wurde abgeschnitten.

**Gemessen**, vier Dokumente desselben Mandanten:

```
bilanz/2025/1111….pdf      -> mandant9e69d380c
bilanz/2026/2222….pdf      -> mandant9e69d380c
guv/2025/3333….pdf         -> mandant9e69d380c
abschluss/2025/4444….pdf   -> mandant9e69d380c
```

Vier verschiedene WORM-Objekte, eine Kennung. Der Footer behauptete damit
eine Zuordnung, die es nicht gab — und der Aufrufkommentar benennt genau
diese als Zweck: „eine Korrelations-ID auf den WORM-Eintrag".

Behoben auf die **letzten** 16 Zeichen, also den uuid4-Anteil. Weiterhin
kein SHA-256: die Begründung dort betraf den *Inhalts*-Hash
(Self-Referenz), nicht den Objektschlüssel — sie wird gar nicht erst
berührt. Die ID bleibt zudem nachprüfbar: wer den WORM-Schlüssel hat,
rechnet sie nach.

Negativprobe, wörtlich:

```
IDs waren: mandant9e69d380c, mandant9e69d380c,
           mandant9e69d380c, mandant9e69d380c: expected 1 to be 4
```

#### 9. `User.isActive` war ein totes Feld (hoch) — behoben, live in beide Richtungen belegt

`JwtStrategy.validate()` prüfte **nur** Signatur und Payload-Form und
konsultierte die Datenbank nie. `isActive` stand im Schema, wurde aber
nirgends ausgewertet – und es gab weder einen Deaktivierungsweg noch eine
Token-Version, die alte Tokens sofort entwerten würde.

Interessant war die Kontrolle beim **Login**: `auth.service.ts:76`
filtert `where: { email, isActive: true }`. Die Absicht war also
dokumentiert und umgesetzt – nur der JWT-Pfad hat sie nicht ausgeführt.
Gemessen, **mit dem alten Code**:

```
Token geholt.                    /api/mandant -> HTTP 200
Setze isActive=false …
GLEICHES Token nach Deaktivierung -> HTTP 200   ❌ NOCH AKTIV
Neuanmeldung                      -> HTTP 401
```

Deaktiviert hieß: keine neue Anmeldung, aber die bestehende Sitzung lief
weiter – bis zum Token-Ablauf. Genau die halbe Kontrolle, die am
auffälligsten wirkt, weil die andere Hälfte nachweislich funktioniert.

Nach der Korrektur: **401**, sowohl für das alte Token als auch für die
Neuanmeldung.

**Fail-closed, auch bei Datenbankausfall.** Das ist der teure Punkt: ein
DB-Ausfall sperrt das System. Absicht — eine Kontrolle, die davon abhängt,
dass alles glückt, ist genau die Fehlerklasse, die dieses Audit mehrfach
gefunden hat.

**Bewusst unverändert:** Mandant-Rollen kommen weiter aus dem
Token-Snapshot. Ein Rollenentzug wirkt bis zum Ablauf
(`JWT_ACCESS_TOKEN_TTL`, Default 15 min). Das ist eine Abwägung zwischen
Latenz und Konsistenz und **kein** Fehler — im Unterschied zu `isActive`,
wo das Schema eine Kontrolle versprach, die es nicht gab. Ebenso benannt:
`logout` entzieht den Refresh-Token; ein ausgestelltes Access-Token bleibt
bis zum Ablauf gültig.

#### 10. `?kanzleiId=` umging die Mandantentrennung (hoch) — eigenständige Recherche, live belegt

Nicht aus dem Review, sondern beim Anschauen der Public-API gefunden — und
es ist die schärfste Stelle des ganzen Audits.

`MandantService.findAll` baute den Filter so:

```ts
istKanzleiAdmin
  ? pagination?.kanzleiId || kanzleiId
    ? { kanzleiId: pagination?.kanzleiId ?? kanzleiId! }
    : {}                                  // ← kein Filter
  : { id: { in: user.mandanten.map(m => m.id) } };
```

`pagination.kanzleiId` stammt aus dem **Query-String** und *überschrieb*
den aufgelösten Wert. Der Controller nimmt es ungeprüft entgegen
(`@Query('kanzleiId') kanzleiId?: string`).

**Live gemessen** (zweite Kanzlei als Fixture):

```
GET /api/mandant                     -> 3 Mandanten (eigene Kanzlei)
GET /api/mandant?kanzleiId=<fremd>   -> "Fremd-Mandant GmbH"   ❌
```

Ein `KANZLEI_ADMIN` konnte die Mandantenliste einer **fremden Kanzlei**
abrufen — Firmenname, USt-Id, Adresse. Das ist ein
Mandantentrennungs-Bruch (§ 146 AO) durch genau die „pragmatische"
Rollenbehandlung, die am 2026-10-05 die Liste reparieren sollte.

Zwei Korrekturen:

1. Für `KANZLEI_ADMIN` ist die **eigene** Kanzlei gesetzt; ein
   abweichender Wert wird **abgelehnt**, nicht still ignoriert — sonst
   glaubt der Aufrufer, er habe die fremde Kanzlei gesehen.
   `SYSTEM_ADMIN` darf weiterhin kanzleiübergreifend filtern
   (Pilot-Annahme).
2. Der leere `{}`-Zweig ist **entfernt**, nicht nur unerreichbar gemacht.
   `resolveKanzleiId` wirft statt leer zu liefern, deshalb war er
   aktuell harmlos — aber liefe die Methode je einmal `null`, wäre er
   sofort der Cross-Tenant-Zugriff. Eine Falle, die nur durch eine
   ferne Zusage unauffällig bleibt, ist keine.

Negativprobe:

```
eine FREMDE kanzlei wird abgelehnt → promise resolved instead of rejecting
```

Nach der Korrektur live: **403** „Die angeforderte Kanzlei gehört nicht zu
Ihrem Mandanten."

#### 11. Die Integritätsprüfung lief ohne Tenant-Filter (hoch) — live belegt

Gefunden bei derselben Recherche, die Befund 10 ausgelöst hat: dieselbe
Frage nach einer zweiten Stelle, an der ein Filter aus der Eingabe einen
aufgelösten Tenant-Scope ersetzt.

`resolveKanzleiIds` arbeitet **richtig**: ein angefragter `kanzleiId` wird
bei Nicht-Admins nur übernommen, wenn er in der Menge der eigenen Kanzleien
liegt — sonst ein **leeres** Array.

Der Controller machte daraus:

```ts
const kanzleiIds = await this.resolveKanzleiIds(user, kanzleiId);
const effectiveKanzleiId = kanzleiIds[0];        // undefined
const result = await this.integrityService.verifyIntegrity({
  kanzleiId: effectiveKanzleiId,                 // undefined
```

und `verifyIntegrity` setzt den Filter nur bei gesetzter ID:

```ts
if (args?.kanzleiId) where['kanzleiId'] = args.kanzleiId;
```

Ein leeres Ergebnis wurde damit als **„kein Filter"** gelesen, nicht als
**„Zugriff verweigert"**. Live gemessen:

```
KANZLEI_ADMIN
  ohne Parameter      : HTTP 200  status=BROKEN  entriesChecked=27  kanzleiId=<eigen>
  ?kanzleiId=<fremd> : HTTP 200  status=BROKEN  entriesChecked=27  kanzleiId=(keiner)
```

`kanzleiId: (keiner)` ist der Beweis: der Service bekam `undefined` und
fragte **alle** Audit-Einträge aller Mandanten ab. Die sichtbare
Gleichheit von `entriesChecked` ist Zufall — wo die Kette reißt, hängt von
Daten ab, die der Aufrufer nicht kontrolliert. Bei einem anderen
Datenstand hätte `brokenAt.auditLogId` eine fremde UUID samt
`expectedHash`/`actualHash` preisgegeben.

Behoben: eine leere Auflösung wirft jetzt 404. Fail-closed, und es gilt
auch für einen Nutzer ganz ohne Mandanten — für ihn gibt es nichts zu
prüfen. `SYSTEM_ADMIN` darf unverändert jede Kanzlei prüfen.

Der Kommentar am Controller behauptete zuvor „Non-SYSTEM_ADMIN: auf eigene
Kanzlei einschränken" — das war genau die Aussage, die nicht zutraf. Sie
trifft jetzt zu.

Live nach der Korrektur: **404** „Keine Kanzlei für die Integritätsprüfung
zugänglich."

#### 12. Die Audit-Liste zeigte still nur den ERSTEN Mandanten (hoch) — dieselbe Klasse, dritte Stelle

Gefunden durch dieselbe Frage wie Befund 10 und 11: was passiert, wenn die
Auflösung eines Tenant-Scopes leer oder unvollständig ist?

```ts
const allowedMandantIds = user.mandanten.map((m) => m.id);
if (!mandantId || !allowedMandantIds.includes(mandantId)) {
  effectiveMandantId = allowedMandantIds[0];     // ← NUR DER ERSTE
}
```

**Live gemessen:**

```
KANZLEI_ADMIN  (3 Mandanten)
  GET /api/audit  ->  HTTP 200, Einträge zu genau 1 Mandant, kein Hinweis
```

Eine unbeabsichtigte Auslassung. Für das Audit-Trail ist sie fast so
schlimm wie ein fremder Eintrag: der Anwender glaubt, alles zu sehen.
Drei Mandanten, ein Drittel sichtbar, HTTP 200 – die grünste Form von
„grün, aber es fehlt etwas".

Die zweite Ausprägung derselben Ursache: ein User ganz **ohne** Mandant
bekam `undefined`, und `buildWhere` liest einen fehlenden Filter als
„kein Filter". Dass heute ein Guard davor 403 wirft, ist Zufall des
Aufrufs. Kontext als Schutz ist keine Absicherung.

**Behoben:** ein Nicht-Admin bekommt **immer** einen Filter — alle
eigenen Mandanten, oder gezielt der angefragte, sofern erlaubt. Ohne
Mandant wird ausdrücklich verweigert.

**Ein Fehler in meinem ersten Entwurf**, vom Test sofort gefangen: bei
erlaubter, explizit angefragter `mandantId` blieben **beide** Felder leer
— also gar kein Filter. Genau die Lücke, die ich schließen wollte, an
anderer Stelle wieder aufgerissen. Der Kommentar im Code hält das fest,
damit der nächste Umbau nicht darüber stolpert.

Live nach der Korrektur: `kanzlei-admin` sieht Einträge aus **allen
drei** Mandanten (3 Einträge, 3 verschiedene Mandant-IDs) statt aus
einem.

#### 13. Die Konsolidierung umging die Archivsperre (hoch) — ein Loch in einer eigenen Woche alten Fix

Der Archiv-Endpunkt `DELETE /api/mandant/:id` hatte den Satz „kein
Löschen, sondern archivieren" eingeführt und die Sperre in **Bilanz, GuV,
Anhang und DATEV-Import** verdrahtet. Der Konsolidierungs-Pfad fehlte —
und dort legt `applyKonsolidierung` eine neue Konzern-Bilanz **und** eine
Konzern-GuV an (`createWithPositionen`).

Ein archivierter Mandant bekam damit doch wieder neue Dokumente. Das ist
kein Ermessen des Konsolidierungs-Pfads, sondern ein **Widerspruch zur
selbst geschriebenen Regel**. Geprüft wurde zuerst, ob es überhaupt ein
Loch ist: `POST /api/public/v1/banz-submissions` liefert 501 und legt
nichts an — dort ist keins. `konsolidierung`, `signatur` und `wp` prüfen
alle drei kein `archiviertAt`.

Behoben für Mutter **und** Tochter: nur die Mutter zu sperren wäre über
eine Seitenlücke umgehbar.

**Für `signatur` und `wp` bewusst NICHT entschieden.** Beide erzeugen
keine neuen Belege — sie beglaubigen oder kommentieren Bestehendes. Ob
ein archivierter Mandant noch geprüft und kommentiert werden darf, ist
eine fachliche Frage (ein Prüfer muss einen Altbestand kommentieren
können), keine logische. Als offen dokumentiert.

#### 14. Die Archivierung war im Frontend nicht erreichbar (Feature-Lücke)

Kein Defekt, sondern eine unfertige Funktion: `PATCH
/api/mandant/:id/archivierung` existierte seit dem 2026-10-09, aber

- `MandantSummary` im Frontend hatte **kein** `archiviertAt` — das Feld kam
  aus der API, war aber nicht typisiert,
- es gab keinen Knopf, keinen Weg, sie auszulösen,
- ein archivierter Mandant war für die Oberfläche nicht als solcher
  erkennbar.

Damit war die Antwort auf die Produktfrage „was passiert mit einem
Mandanten, der weg muss?" im Produkt nicht auffindbar — der Nutzer, dem
das Löschen mit 409 beantwortet wird, bekam keinen Weg weiter.

Ergänzt: Archivieren/Aufheben in der Mandantenverwaltung, Kennzeichnung
archivierter Mandanten mit Zeitstempel im Titel, Tooltip am Lösen-Knopf,
der auf die Aufbewahrungspflicht hinweist.

Der Kennzeichnung kommt eigene Bedeutung zu: ohne sie wäre nicht
erkennbar, **warum** eine Eingabe mit 409 abgelehnt wird. Ein
Fehlgeschlagener Schreibvorgang an einem archivierten Mandant sieht
sonst wie ein Fehler aus.

Playwright `e2e/mandant-archiv.spec.ts` prüft den vollen Weg: anlegen →
archivieren → Kennzeichnung → **Persistenz nach Reload** → aufheben →
aufräumen. Der Reload-Schritt ist der wichtige: er trennt gespeicherten
Zustand von bloßem UI-Zustand.

#### 15. Refresh-Token wird nicht rotiert (hoch) — dokumentiert, NICHT behoben

Eigenständige Recherche am Auth-Pfad, danach bewusst nicht umgesetzt.

**Der Befund.** `refresh()` gibt am Ende zurück:

```ts
return {
  accessToken,
  refreshToken: dto.refreshToken,   // ← derselbe Token
  ...
};
```

Damit gilt:

- **Keine Rotation.** Ein gestohlener Refresh-Token bleibt bis zum Ablauf
  gültig. Voreinstellung `JWT_REFRESH_TOKEN_TTL` = **7 Tage**.
- **Keine Wiederverwendungserkennung.** Wird ein Token nach dem Ablauf
  erneut eingespielt, ist nichts erkennbar — es gibt weder ein
  Token-Familien-Feld noch eine Historie im `UserSession`-Modell.
- **Kein Widerrufssignal.** Wird ein Refresh-Token kompromittiert, hilft
  nur, alle Sessions des Users zu widerrufen (`logout` ohne
  `sessionId`).

Der Rest des Pfads ist korrekt: `revokedAt`, `expiresAt` und
`user.isActive` werden geprüft, der Token wird nur als SHA-256-Hash
gespeichert (48 Bytes Zufall, base64url). Der Fehler ist nicht die
Speicherung, sondern die fehlende Rotation.

**Warum hier nicht umgesetzt.** Drei Gründe, die gegen eine
Spontan-Änderung sprechen:

1. **Client-Abstimmung nötig.** Der Refresh-Token wird im **Body**
   übergeben (`@Body() body: { refreshToken?: string }`), nicht als
   Cookie. Eine Rotation ist für den Client nur dann unsichtbar, wenn er
   den neuen Token zuverlässig speichert. Das ist eine Änderung an der
   Sitzungsverwaltung des Frontends.
2. **Migration für echte Erkennung.** Wiederverwendungserkennung braucht
   eine Token-Familie oder eine Historie — das `UserSession`-Modell hat
   heute nur `refreshTokenHash` (unique). Ohne diese Struktur ist
   Rotation allein nur halb wirksam: ein kopierter Token bleibt gültig,
   solange die Session lebt.
3. **Es ist eine Sicherheitsentscheidung, keine Korrektheitsfrage.**
   Rotation mit Reuse-Erkennung, kürzere TTL oder ein
   HttpOnly-Cookie sind drei verschiedene Antworten auf dieselbe Frage —
   mit unterschiedlichen Folgen für den Anwender (erneute Anmeldung auf
   anderen Geräten).

**Zwischendokumentation:** Der Befund ist hier festgehalten, damit er
beim nächsten Sicherheits-Review nicht verloren geht.

#### Zwei eigene Fehler beim Nachprüfen des Reviews

Beides ist hier festgehalten, weil beide Tests erzeugt haben, die
falsch gruen waren:

1. **Die erste Negativprobe der Rollenbindung war grün** — 17 Tests
   bestanden, obwohl das Binding entfernt war. Die vorhandenen Specs haben
   einen User mit genau EINEM Mandanten; bei einem Mandanten kann die alte
   Pruefungsfolge nie auseinanderfallen. Verwendbar war erst ein
   Verdrahtungstest mit der verwundbaren Konfiguration (Admin in A, Berater
   in B). Ein Regeltest wäre gruen, auch wenn niemand sie aufruft.
2. **Der Verdrahtungstest war selbst aus dem falschen Grund gruen.**
   `createSubscription` nimmt ein Objekt, ich hatte positional übergeben —
   `kanzleiId` war `undefined`, der Test lief in die Kanzlei-Sperre statt in
   die Rollenprüfung. Behoben, indem die Assertions jetzt auf die
   **Meldung** prüfen (`/KANZLEI_ADMIN dieser Kanzlei/`) und nicht nur auf
   die Fehlerklasse.

#### Ohne Beleg, aber dokumentiert — aus dem Review, nicht nachgemessen

Diese Punkte sind plausibel, aber **nicht empirisch reproduziert**. Sie
sind nicht behoben und nicht als erledigt zu lesen:

### Nachtrag 2026-10-14 (Nachtrag 16): Vier Klickpfade haben den Server beendet

**Gemessen, alle vier HTTP 500 mit unbehandeltem Prisma-Fehler:**

| Eingabe | Serverantwort |
|---|---|
| `POST /api/bilanz` `betragAktuell: 1e20` | `22003 numeric field overflow` |
| `POST /api/mandant` `bilanzsummeVorjahr: "keine-zahl"` | ungueltiger Decimal |
| `POST /api/mandant` `bilanzsummeVorjahr: "999...24 Stellen"` | `22003 numeric field overflow` |
| `POST /api/mandant` `mitarbeiterAnzahl: 99999999999` | value out of range (Int4) |

Es genuegte jeweils **ein Klick im Formular**. Das ist Kunden-Eingabe; sie
gehoert in die Validierung und nicht in eine Exception des
Datenbanktreibers.

**Die Grenzen sind aus dem Schema abgeleitet, nicht geschaetzt.**
`Decimal(18,2)` verlangt `|x| < 10^16`, `Int4` endet bei 2147483647. Der
Wert liegt bewusst bei `10^15 - 1`: `10^16` ist im IEEE-Double nicht exakt
darstellbar (54 Bit noetig, Mantisse hat 53) — eine Grenze mit
Gleitkomma-Artefakt ist eine Grenze mit zwei Wahrheiten.

**Was ausdruecklich NICHT geaendert wurde:** negative Betraege. `@Min(0)`
waere eine erfundene Fachregel — ein Verlustvortrag ist nach § 266 Abs. 3
HGB negativ, und die Betragsgrenze darf nicht zur Vorzeichengrenze werden.
Ein eigener Test haelt das fest.

**Negativprobe:** Alle `@Max`/`@Matches` entfernt → **4 Tests rot**, jeder
mit `expected 500 to be 400`, einer je Defekt. Die beiden Tests fuer regulaere
Werte bleiben gruen: Ein Test, der nur Ablehnung prueft, wuerde einen Fix
belohnen, der pauschal alles zurueckweist.

---


### Nachtrag 2026-10-15 (Nachtrag 17): Filter-Parameter — fünf 500er und ein still verschwundener Filter

**Gemessen, HTTP 500 mit unbehandeltem Prisma-Fehler:**

| Eingabe | Serverantwort |
|---|---|
| `GET /api/audit?from=abc` | 500 |
| `GET /api/audit?to=31.12.2025` | 500 — deutsches Datumsformat |
| `GET /api/audit?from=2025-13-45` | 500 — kein Kalenderdatum |
| `GET /api/bilanz?geschaeftsjahr=abc` | 500 |
| `GET /api/bilanz?geschaeftsjahr=99999999999` | 500 — Int4-Überlauf |

`to=31.12.2025` ist keine Fantasie: das ist die Schreibweise, in der ein
Anwender ein Datum eingibt.

**Der schlimmere Befund kam aus der Negativprobe.** Mit entfernter Pipe
liefern `geschaeftsjahr=abc`, `=99999999999` und `=42abc` **200 mit der
kompletten Liste**. Der Service prüft `typeof args.jahr === 'number'`; ein
String ist keine Zahl, also wird der Filter **verworfen** — die Abfrage
läuft ungefiltert durch und meldet Erfolg.

Ein Anwender, der nach einem Geschäftsjahr filtert, sieht damit alle
Jahre und glaubt, er habe gefiltert. Das ist schlimmer als ein Fehler,
weil es unsichtbar ist: Bei einer Jahresabschlussliste ist ein
übersehener Abschluss genau der Fehler, den das Produkt verhindern soll.

Dasselbe galt vorher für `42abc`: `parseInt` machte daraus still 42 und
die Liste zeigte das **falsche** Jahr.

**Behoben** mit `GeschaeftsjahrPipe` und `IsoDatumPipe` an der Grenze
(Bilanz, GuV, Anhang, Audit, Public API). Das doppelte `parseInt` in den
Controllern ist entfallen — es hätte `"42abc"` still zu 42 gemacht.

**Nur ISO-8601 wird akzeptiert.** `new Date()` nimmt viele Formate an
(`31.12.2025`, `2025/12/31`); eine Filter-API, die drei Formate
akzeptiert, ist am Ende eine, bei der niemand weiß welches gilt.

#### Ein Fehler in meinem eigenen Fix

Die erste Fassung prüfte nur das Format und die NaN-Fähigkeit. Der Test
`from=2025-02-30` blieb grün — **`new Date('2025-02-30')` ist kein NaN**,
JavaScript rechnet auf den 2. März um. `2025-13-45` wurde abgelehnt,
`2025-02-30` still verschoben: dieselbe Fehlerklasse, die ich abstellen
wollte, in meiner eigenen Zeile.

Die Pipe prüft den Kalender jetzt gegen seine normalisierte Form. Der Test
war das, was es gefunden hat — ein Test, der nur die 500-Fälle prüft,
hätte diesen Zweitfehler durchgelassen.

**Negativprobe:** Beide Pipes zu reinen Durchreichen gemacht → **13 von 15
Tests rot**, jede mit dem Status, den der alte Code geliefert hat
(`expected 500 to be 400` bzw. `expected 200 to be 400` mit der
ungefilterten Liste).

---


### Nachtrag 2026-10-15 (Nachtrag 18): Vier Prüfungen ohne Befund — und was ich dabei falsch gemessen habe

Nach den Eingabepfaden (Nachträge 16/17) vier Bereiche geprüft, die als
wahrscheinliche Fundorte galten. Ergebnis: **kein Defekt.** Das wird
festgehalten, weil "geprüft und sauber" eine Aussage ist.

| Bereich | Ergebnis |
|---|---|
| PDF-Vollständigkeit | Beide Templates paginieren (`bilanz.template.ts:350`, `guv.template.ts:114`) mit echter Seitenumbruch-Prüfung. Im GuV-Template steht der Grund in einem Kommentar: eine frühere feste Zeilenhöhe schnitt Kontobezeichnungen ab **und** verhinderte den Umbruch. Keine `.slice()`-Kürzung im PDF-Pfad. |
| Audit-Abdeckung | Jeder Service mit Schreibzugriffen hat Audit-Einträge: Mandant 5/5, Auth 4/4, Konsolidierung 1/5, Subscription 1/3, Signatur 2/1 (WORM + Signature-Record in **einer** Transaktion, ein Audit-Eintrag — gewollt). |
| Beteiligungsquote | `@Min(0)`/`@Max(100)` vorhanden, Kommentar stimmt mit dem Code überein. |
| BAnz-Einreichung | `POST /api/v1/banz-submissions` gibt bewusst **501** zurück. Früher stand dort 202 mit `id: "placeholder-<timestamp>"` — fachlich falsch, weil nichts persistiert wurde. Der Verweis auf einen nie existierenden Datensatz war behoben; kein Archivschutz nötig, weil es keinen Pfad gibt. |

#### Ein Fehler in meiner Messung

Die erste Audit-Abdeckungs-Auswertung meldete **sechs Services ohne
Audit** — darunter `tsa-client.service.ts` mit zehn Schreibvorgängen.

Gemessen war das falsch: die zehn "Schreibvorgänge" waren
`forge.asn1.create(...)`, also ASN.1-Bauer von node-forge, keine
Datenbankzugriffe. Meine Regex zählte `create` ohne den Receiver zu
prüfen. Mit eingegrenztem Muster (`this.prisma.…` bzw.
`…Repository.…`) bleibt kein Service ohne Audit zurück.

**Merksatz:** Eine Auswertung, die eine *Auffälligkeit* findet, ist zuerst
ein Verdacht gegen die Auswertung. Sechs Treffer auf einmal sind eher ein
Muster im Messgerät als in der Wirklichkeit.

#### `returnUrl` — geprüft, nicht erreichbar

`GET /api/subscription/:kanzleiId/portal` reicht den Query-Parameter
`returnUrl` ungeprüft als `return_url` an Stripe weiter. Ein Open-Redirect
wäre die naheliegende Befundung.

**Nicht belegt.** Das Frontend ruft den Endpunkt nirgends auf
(`SubscriptionView.tsx` nutzt nur `/subscription/tiers` und
`/subscription/:kanzleiId`), ein e2e-Test ebenso wenig, und der
Mock-Provider **ignoriert** den Parameter. Es gibt heute keinen Weg zu
diesem Parameter. Eine Allowlist zu erfinden hieße, eine
Deployment-Konfiguration zu raten, die ich nicht kenne — deshalb nur
festgehalten, nicht „repariert".

---


### Nachtrag 2026-10-15 (Nachtrag 19): „1.500" wurde als 1,5 gespeichert

**Gemessen im Browser**, Tastendruck für Tastendruck, wie ein Mensch tippt:

| Eingabe | Feldinhalt | gespeichert als |
|---|---|---|
| `1.500` (deutsche Tausendertrennung) | `1.500` | **1,5** |
| `150000,50` (deutsches Dezimalkomma) | `0150000.50` | 150000,50 (Komma verworfen) |

Alle Betragsfelder in Bilanz und GuV waren `<input type="number">`. Das erlaubt
nur den Punkt als Dezimaltrenner — in einer deutschen Buchhaltung tippt niemand
Punkte.

**Der erste Fall ist der schwere.** Wer `1.500` tippt, meint tausendfünfhundert
und bekommt eineinhalb: ein **Faktor-1000-Fehler in einer Bilanzposition**,
ohne Fehlermeldung, ohne Markierung, beim Speichern still übernommen. Genau
diese Fehlerklasse — ein Wert, der falsch ist und so aussieht, als wäre er
richtig — stand in Nachträgen 13 und 17 schon zweimal im Mittelpunkt.

`type="number"` kann das nicht auflösen: `1.500` ist dort ein **gültiger**
Wert, und die Absicht des Tippenden ist nicht erkennbar. Nur eine explizite
Auflösung der deutschen Schreibweise hilft.

**Behoben** mit `BetragInput` (`type="text"`, `inputMode="decimal"`) und
`parseZahl`/`formatZahl`: Punkt = Tausendertrenner, Komma = Dezimaltrenner.
Zwei Regeln:

1. Beim Verlassen wird normalisiert — der **angezeigte** Wert IST danach der
   **gespeicherte**. Wer `1.500` tippt, sieht `1.500,00`; wollte er 1,5, sieht
   er es sofort.
2. Eine unparsebare Eingabe wird **nicht still zu 0**. Sie bleibt als Text
   stehen, wird rot markiert, und der gespeicherte Wert bleibt unverändert.

#### Zwei eigene Fehler beim Bauen des Feldes

**Ein Feedbackloop, im ersten Entwurf (gemessen):** Jede Tastatureingabe
setzte `roh`, änderte gleichzeitig den Wert vom Vater, und der Effekt auf
`[wert]` räumte `roh` wieder — die Anzeige sprang mitten im Tippen auf den
formatierten Zahlenwert zurück:

```
"150000,50" -> "1,01000,50"
```

Ein Referenzzähler des zuletzt selbst gesendeten Werts trennt jetzt „von außen
geändert" von „von mir selbst gesetzt".

**Und ein zweiter, erst im Test sichtbar:** Das Leeren des Pflichtfeldes wird
vom Elternteil auf `0` normalisiert (`betragAktuell: v ?? 0`, weil das DTO eine
Zahl verlangt). Ohne Sonderregel löschte der Effekt den Rohtext und zeigte
sofort `0,00` — die nächste Eingabe landete an dieser Ziffer:

```
"0,001234,56"  ->  gespeichert wurde 0
```

#### Der Test prüft den gespeicherten Wert, nicht die Anzeige

`betrag-eingabe.spec.ts` speichert und liest die Position zurück. Ein Test,
der nur prüft, was im Feld steht, würde einen Fix belohnen, der die Zahl nur
anzeigt und beim Speichern wieder verliert.

**Negativprobe, zweimal versucht.** Der erste Versuch war grün für den Falschen:
Ich hatte `type="number"` zurückgesetzt und damit auch `inputMode` entfernt —
der Selektor fand das Feld nicht mehr, der Test war rot wegen des Markups statt
wegen der Zahl. Erst der zweite Versuch, der **nur die Auflösung** zurücksetzt
und das Markup unangetastet lässt, scheitert an der Zahl:

```
- unexpected value "1,50"     (erwartet "1.500,00")
```

Das ist derselbe Fehlschlag wie in Nachtrag 8, 12 und 15: eine Probe, die aus
dem falschen Grund rot ist, beweist nichts.

---


### Nachtrag 2026-10-15 (Nachtrag 20): Eine Inkonsistenz, die ich selbst eingebaut habe

**Befund:** Nach der Umstellung auf deutsche Schreibweise (Nachtrag 19)
akzeptierte das Bilanz-Formular `1.234,56`. Das Backend lehnte denselben
String im Feld `bilanzsummeVorjahr` ab:

```
OK     "12345.67"
OK     "12345,67"
FAIL   "1.234,56"      <-- die Schreibweise, die das Formular jetzt lehrt
```

`BETRAG_STRING_PATTERN` erlaubte genau **ein** Komma **oder** **einen** Punkt
am Ende — keine Tausendertrennung. Die Anwendung hatte damit an einer Stelle
eine Notation eingeführt und an einer anderen verboten. Regeln, die
auseinanderlaufen, sind zwei Fehlerquellen statt einer.

**Behoben:** dasselbe Muster wie im Frontend — beide Schreibweisen, mit und
ohne Tausendertrennzeichen. `betrag-grenzen.spec.ts` hält eine Fallliste
fest, die mit der des Frontend identisch ist.

**Reichweite eingeschränkt:** Das Frontend bietet `bilanzsummeVorjahr` und
`umsatzVorjahr` **überhaupt nicht an** (im Formular existiert nur das
Übersetzungslabel, kein Eingabefeld). Die Inkonsistenz war latent, nicht
erreichbar. Festgehalten, weil das REST-API sie jederzeit auslösen könnte.

#### Zwei weitere Stellen mit derselben Mechanik

| Feld | Vorher | Jetzt |
|---|---|---|
| Gesellschafter-Anteil (`anteilProzent`) | `parseFloat("33,33")` → **33** | `33,33` |
| Beteiligungsquote (`beteiligungsquote`) | `type="number"`: Komma verworfen → **505**, vom Backend mit 400 abgewiesen — der Fehler erscheint dann in den Eingaben des Nutzers statt in der Prozentangabe | `50,5` |

Bei der Quote war der Fehler immerhin sichtbar (400). Beim Gesellschafter-
Anteil war er es nicht: `Number.parseFloat("33,33")` ergibt **33** — ein
still verlorenes Drittel. Dieselbe Fehlerklasse wie Nachtrag 19.

**Geprüft und nicht geändert:** `mitarbeiterAnzahl`. Das DTO-Feld existiert,
das Formular hat **kein Eingabefeld** dafür — nur einen Übersetzungsschlüssel.
Ein Tippfehler-Risiko ohne Bedienweg.

---


### Nachtrag 2026-10-15 (Nachtrag 21): Zwei Playwright-Tests waren flaky — und die Ursache ist Produktverhalten

**Beobachtung:** Nach einer Änderung an den Betragsfeldern meldete ein
Gesamtlauf zwei Fehlschläge (`mandant.spec`, `signatur.spec`). Einzeln
gefahren: beide grün. Der nächste Gesamtlauf: grün. Also **flaky**, nicht
verursacht von der Änderung.

**Ursache gemessen, nicht vermutet:** `finalizePruefung` setzt bei APPROVED

```ts
await this.wpRepository.setBilanzStatus(existing.bilanzId, 'APPROVED', user.id);
```

Der Bilanz ist danach **gesperrt** — die Statusregel erlaubt Fortschreiben nur
in `DRAFT`. `wp-strecke.spec.ts` schließt am Ende eine WP-Prüfung ab. Jede
später laufende Spec, die den geseedeten Bilanz der Demo GmbH öffnen wollte,
fand eine gesperrte Zeile vor. **Ob es diese Spec traf, hing von der
Dateireihenfolge des Laufs ab** — deshalb flackerte es statt konsequent zu
scheitern.

Das ist dieselbe Klasse wie der Befund in Nachtrag 14 auf der Backend-Seite:
die Suite teilt veränderlichen Zustand, und `globalSetup` setzt ihn nur
einmal zurück.

**Behoben** für die zwei betroffenen Specs: `signatur.spec` und
`betrag-eingabe.spec` legen ihren eigenen Bilanz an (GJ 2079 bzw. 2078) und
räumen ihn ab. Sie hängen damit an keinem Zustand, den eine andere Spec
hinterlässt.

**Offen und nicht behauptet:** dass dies die *einzige* solche Stelle ist,
wurde **nicht** vollständig geprüft. Belegt ist die Kette
`wp-strecke → Bilanz APPROVED → spaetere Spec gesperrt`. Weitere Specs, die
den geseedeten Bilanz oeffnen, koennen denselben Weg nehmen; das ist eine
Vermutung, bis sie gemessen ist.

**Zur Belastbarkeit:** Zwei Fehlschlaege, die einmal auftreten und dann
verschwinden, sind kein Grund, sie zu ignorieren — sie sind ein Grund, die
Ursache zu suchen. Ein gruener Lauf nach einem roten beweist fuer sich
genommen nichts, solange der Auslöser nicht benannt ist.

---


### Nachtrag 2026-10-16 (Nachtrag 22): Bilanz und GuV werden nicht gegeneinander geprüft

**Gemessen.** Bilanz GJ 2068 mit `A.V. Jahresüberschuss = 100.000`, GuV
gleiches Jahr mit Erlösen 200.000 / Aufwand 150.000, also
Jahresergebnis **50.000**:

```
Bilanz GJ 2068: HTTP 201 | saldostimmt = true | differenz = 0
GuV    GJ 2068: HTTP 201 | Jahresergebnis = 50000

>> Abweichung 50000 — nirgends gemeldet
```

Beide Sätze sind einzeln **richtig**: Die Bilanz geht auf, die GuV ist in
sich schlüssig. § 264 Abs. 2 HGB verlangt aber, dass Bilanz und
GuV-Rechnung **übereinstimmen** — das ausgewiesene Jahresergebnis muss in
der Eigenkapitalentwicklung wiederkehren.

**Was vorhanden ist:** eine GuV-interne Prüfung (Σ Erlöse − Σ Aufwendungen
= Jahresergebnis) und eine XBRL-Prüfung
(`xbrl-validator`, Meldung `NET_INCOME_MISMATCH`, **Warnung**). Was fehlt, ist
die Kreuzprüfung zwischen den beiden Sätzen. `A.V.` wird nirgends gegen die
GuV gelesen (gemessen: keine Treffer in `bilanz.service` und
`xbrl-generator`).

#### Warum ich das NICHT gebaut habe

Eine Sperre wäre eine **erfundene Fachregel**. `A.V.` ist nicht
zwangsläufig das Jahresergebnis: Kapitalerhöhungen, Entnahmen und andere
Eigenkapitalveränderungen verschieben den Saldo, ohne in der GuV zu
erscheinen. Das Produkt modelliert diese Bewegungen an keiner Stelle
(geprüft: keine Equity-Movement-Entität, kein Feld). Ob eine Abweichung ein
Fehler oder eine Eigenkapitalbewegung ist, lässt sich aus den Daten
**nicht entscheiden** — und eine harte Sperre würde einen berechtigten
Jahresabschluss blockieren.

Selbst eine Warnung hätte denselben Fehler: sie schlägt bei jeder
Kapitalerhöhung an, ohne sagen zu können, ob das ein Problem ist.

**Deshalb als Entscheidung offen, nicht als fehlende Zeile im Code.**
Drei mögliche Formen, mit meiner Empfehlung:

| Form | Wirkung | Bewertung |
|---|---|---|
| Warnung (wie `NET_INCOME_MISMATCH`) | sichtbar, blockiert nicht | **empfohlen**, sobald Eigenkapitalbewegungen modelliert werden |
| harte Sperre | verhindert unrichtige Veröffentlichung | nur mit Equity-Bewegungs-Erfassung, sonst zu weit |
| nichts | wie heute | vertretbar **nur**, solange die Lücke dokumentiert ist |

Bis dahin ist der Nachteil der fehlenden Prüfung nicht aus der Welt: Ein
Jahresabschluss mit 50.000 Abweichung zwischen Bilanz und GuV wird
gespeichert, als gültig gemeldet und kann signiert werden.

---


### Nachtrag 2026-10-16 (Nachtrag 24): Der Audit-Hash-Chain erkennt keine Löschung am Kettenende

**Gemessen**, zwei Szenarien getrennt (ein gemeinsamer Lauf hätte nichts
gezeigt — der Mittelteil-Bruch trägt das Ergebnis):

```
A: Ausgangslage                   -> status=OK      geprueft=4
A: Loeschung IN DER MITTE         -> status=BROKEN  geprueft=2

B: Ausgangslage                   -> status=OK      geprueft=4
B: NUR letzter Eintrag geloescht  -> status=OK      geprueft=3   <-- NICHT erkannt
```

**Die Mitte wird erkannt**, weil die Kette neu berechnet und nicht dem
gespeicherten `prevHash` geglaubt wird: fehlt ein Eintrag, weicht der
rekombinierte Hash des Nachfolgers ab (`BROKEN`).

**Das Ende nicht** — und das ist keine Implementierungslücke, sondern die
Eigenschaft jeder Hash-Kette ohne externen Anker. Nach dem Löschen ist die
verbleibende Kette wieder in sich schlüssig; es gibt nichts, womit sie
verglichen werden könnte.

**Warum das hier schwerer wiegt als sonst.** § 147 AO verlangt
Unveränderbarkeit. Wer im System etwas verbergen will, löscht die
**jüngsten** Einträge — denn die ältesten sind über WORM-Retention und
Hash gesichert, die eigenen Handlungen sind es nicht. Genau dieser Fall
wird als `OK` gemeldet.

#### Was das NICHT ist

* Kein Fehler in der Verkettung — die ist korrekt und im Middle-Case
  nachgewiesen.
* Kein Beweis, dass manipuliert wurde — es ist eine **nicht erkennbare
  Lücke**, die man kennen muss, um sie nicht für Manipulationsfreiheit zu
  halten.

#### Mögliche Gegenmaßnahmen — alle brauchen eine Entscheidung

| Maßnahme | Wirkung | Kosten / Risiko |
|---|---|---|
| **Anker im WORM-Storage** — periodisch den Kettenkopf (letzter `sequenz` + `entryHash`) als Object-Lock-Objekt ablegen | Kettenende wird prüfbar | braucht Bucket im Betrieb; der S3-Mock in den Tests bildet das nur nach |
| externer Zeitstempel (TSA) auf den Kettenkopf | dasselbe, ohne eigenen Storage | externe Abhängigkeit + Kosten je Intervall |
| **bewusst nichts** | — | die Lücke ist dokumentiert; die Aussage „Hash-Chain erkennt Manipulation" muss auf „im Ketteninneren" **eingeschränkt** werden |

**Nicht gebaut.** Jede der ersten beiden ist eine Architekturentscheidung mit
Betriebsfolge — der Anker, wie oft, wohin, und wer gibt ihn frei. Die dritte
ist eine Entscheidung über die **Zusicherung im Audit-Bericht**, und die
korrigiere ich sofort, weil sie sonst über den Prüfbarkeitsumfang täuscht:

> „Hash-Chain (SHA-256(prevHash + entry)) zur Manipulationserkennung"

Diese Zeile steht seit M4 Sprint 5 im Bericht. Sie ist für Manipulationen
**innerhalb** der Kette richtig und am Kettenende unvollständig. Nachstehender
Abschnitt korrigiert das.

---


### Nachtrag 2026-10-16 (Nachtrag 25): Der Benutzer wurde alle 15 Minuten ausgeloggt

**Gemessen:**

| Verhalten | Ergebnis |
|---|---|
| `expiresIn` beim Login | **900 Sekunden = 15 Minuten** |
| `/auth/refresh` im Frontend aufgerufen? | **nie** (kein Treffer in `src/`) |
| Login → Refresh-Token | 64 Zeichen, liegt in `localStorage` |

`POST /api/auth/refresh` existierte im Backend, vollständig implementiert,
mit SHA-256-Hash, Ablaufprüfung, Widerrufsprüfung und Audit-Eintrag — und
**hatte keinen Aufrufer in der Oberfläche**. Der Mechanismus, der genau das
verhindern soll, war vorhanden und unerreichbar.

**Zwei weitere Befunde derselben Stelle:**

1. **Ein Kommentar behauptete ein Cookie, das es nicht gibt.** In `api.ts`
   stand: „Der Refresh-Mechanismus des Projekts nutzt ein separates
   `refreshToken`-Cookie". Der Token liegt in `localStorage`
   (`LoginForm.tsx:59`). Dieselbe Klasse wie die falsche Behauptung zur
   Mandantensortierung (Nachtrag 10) und die `import type`-DTO (Nachtrag 15).

2. **`AppHeader` und `WPView` umgingen `apiFetch`.** Beide riefen `/auth/me`
   per rohem `fetch` und schoben bei 401 direkt zum Login. Selbst mit
   repariertem `apiFetch` wäre die Sitzung nach 15 Minuten vorbei gewesen —
   der erste Entwurf des Fixes blieb deshalb grün, **im echten Browser
   gemessen** (`GET /auth/me` → 401, **kein** `/auth/refresh`).

**Behoben:** `apiFetch` erneuert die Sitzung einmal (Single-Flight, damit
parallele Aufrufe einen einzigen Refresh auslösen) und wiederholt den
Aufruf. Erst wenn das scheitert, wird aufgeräumt und zum Login geführt.
`AppHeader` und `WPView` benutzen jetzt `apiFetch`.

**Zwei Tests, weil eine Behauptung zu wenig ist:**

| Test | Ergebnis |
|---|---|
| gültiger Refresh-Token + abgelaufener Access-Token → Sitzung bleibt | muss grün |
| **kein** Refresh-Token + 401 → führt zum Login | muss grün bleiben |

Der zweite Test ist der Gegenprobe: der Mechanismus darf nicht jede
401-Umleitung verschlucken.

**Negativprobe:** Refresh-Token-Ausgangspunkt abgeschaltet → der erste Test
**rot** („Redirect zum Login"), der zweite bleibt grün.

#### Drei eigene Werkzeugfehler in dieser Stunde

1. **Ich habe beim Neuschreiben von `/tmp/bzenv.sh`
   `NODE_ENV=development` gesetzt** — und `next build` brach daraufhin mit
   `<Html> should not be imported outside of pages/_document` beim Prerendern
   von `/404` ab. Genau der Fehler, den ich **schon einmal** in diesem
   Projekt hatte. Die Warnung steht jetzt in der Datei selbst.
2. **`npx tsc --noEmit` meldete keinen Typfehler, den `next build` fand**
   (`string | null` an `string | undefined`). Für diese Anwendung ist
   `npm run build` die strengere Prüfung — `tsc` allein ist es nicht.
3. **Meine erste Negativprobe war nicht build-sicher** und verhinderte
   deshalb erst den Testlauf. Zwei Anläufe später war sie es.

**Merksatz:** Ein Test, der eine Zustandsänderung behauptet, braucht eine
**Gegenprobe**. Und ein Prüfwerkzeug, das nur eine von zwei Aussagen trifft,
ist für diese Entscheidung nicht verwendbar.

---


### Nachtrag 2026-10-17 (Nachtrag 26): Der Anhang liess seine Platzhalter stehen und wurde trotzdem als PDF erzeugt

**Gemessen, der ganze Weg:**

| Schritt | Ergebnis |
|---|---|
| Vorlage holen (`/api/anhang/templates`) | 5 Abschnitte, Platzhalter `[Ort]`, `[Nummer]`, `[Steuernummer]`, `[Name]`, `[Anzahl]` |
| Anhang aus der Vorlage anlegen | **201** |
| Platzhalter im gespeicherten Anhang | **7** (davon 5 verschiedene) |
| Anhang validieren | **gibt es keine Route** |
| PDF erzeugen | **200** |

Ein unfertiger Anhang erzeugt also ein **veröffentlichungsfähiges PDF**, in dem
„[Ort]" steht. § 264 Abs. 4 HGB verlangt konkrete Angaben; § 284 HGB die
Pflichtangaben. Der Seed-Anhang fiel durch, weil der Seed die Platzhalter
bereits befüllt — die Lücke liegt im Weg, den die Oberfläche nimmt.

**Behoben als Meldung, nicht als Sperre.** `findOne` liefert jetzt
`offenePlatzhalter: string[]` mit.

**Warum eine Liste und kein Muster.** `[Wert]` im Fließtext ist auch eine
**legitime** Angabe: „Vgl. [Anlage zum Anhang]". Eine Mustersuche auf eckige
Klammern würde darauf anschlagen und den Anwender mit einem Fehler behelligen,
der keiner ist. Geprüft wird ausschließlich gegen die Platzhalter, die **das
System selbst** in die Vorlage geschrieben hat — `ANHANG_VORLAGEN_PLATZHALTER`,
zur Compile-Zeit aus der Vorlage abgeleitet. Ein Test prüft, dass die Liste
nicht hartcodiert ist, sondern der Vorlage folgt.

**Warum keine Sperre.** Es ist nicht das System, das entscheidet, ob eine
Angabe noch offen ist — das ist der Anwender bzw. der Wirtschaftsprüfer. Und
der Jahresabschluss wäre der richtige Ort für eine Sperre, nicht der Anhang
allein. Dort ist die Frage aber dieselbe wie bei Nachtrag 22.

#### Ein Testfehler, der mich Zeit gekostet hat

Der erste e2e-Entwurf schickte den Detailabruf **ohne `Authorization`** —
die Route hängt am globalen `JwtAuthGuard`, also kam 401 und die Meldung
fehlte. Danach meldete der Test „4 statt 5", was ich auf einen echten Fehler
hielt; es war ein **veralteter Server**, weil mein Neustart verkettet lief.
Erst der direkte Aufruf zeigte alle fünf.

**Merksatz:** Wenn ein Test eine Zahl „zu klein" findet, ist zuerst die
Frage zu stellen, ob er überhaupt den aktuellen Code gesehen hat. Ich habe
das in dieser Stunde zweimal getan (hier und bei der Signatur-ID) — beides
mal lag es am Server, nicht am Produkt.

---


### Nachtrag 2026-10-17 (Nachtrag 27): Der Jahresabschluss existiert in der Anwendung nicht

Das ist kein Detail, sondern der zentrale Befund dieser Prüfrunde — und er
geht allen anderen Nachträgen voraus.

**Gemessen, vierfach abgesichert:**

| Prüfung | Ergebnis |
|---|---|
| Schreibzugriffe auf `jahresabschluss` (create/update/upsert/delete) in `src/` **und** im Seed | **keine** |
| Controller-Routen mit `jahresabschluss` im Pfad | **keine** |
| `GET /api/jahresabschluss?mandantId=…` | **404** |
| Datensätze nach `prisma db seed` | **0** |

**Was daran hängt und damit unerreichbar ist:**

* `POST /api/signatur/sign-abschluss` — die qeS-Signatur des Jahresabschlusses
* `POST /api/pdf/abschluss/:id/generate` — das Abschluss-PDF
* `POST /api/v1/banz-submissions` — bereits als 501 dokumentiert
* `Signature.findLatestByJahresabschluss` — die Abfrage „ist signiert?" hat
  seit jeher **keinen Aufrufer** (im README als Konsequenz vermerkt)

Bilanz, GuV und Anhang lassen sich einzeln anlegen, bearbeiten und
**einzeln signieren** — das ist der Stand, den die Tests belegen. Das
Aggregat, um das es in § 314 HGB geht, kann die Anwendung nicht erzeugen.

#### Warum es bisher niemand gesehen hat

`JahresabschlussView` ruft `GET /api/jahresabschluss` und **fängt das 404 als
leere Liste ab**:

```ts
if (status === 404) return []; // erwartet: Endpunkt existiert noch nicht
```

Der Kommentar sagt es offen. Der Playwright-Smoke-Test prüft danach nur, dass
die Seite **darstellbar** ist — und eine Seite mit leerem Zustand ist
darstellbar. Der Test ist grün, der Smoke-Test meldet „13 Fachseiten
geladen", und die eine Seite, die nie Inhalt haben kann, zählt mit.

**Das ist dieselbe Fehlerklasse wie in Nachtrag 12, 14 und 21** — ein grüner
Test, der nichts prüft — nur diesmal **im Produktcode verankert**, nicht in
einem Test. Ein `catch` auf 404 hat einen echten Fehlerzustand in einen
Erfolgszustand verwandelt.

#### Einordnung

Es ist kein unentdeckter Fehler, sondern ein **nie gebautes Modul**: die
geplante Verzeichnisstruktur nennt `abschluss/ — Jahresabschluss-Orchestrierung`.
Die Prüfungsreihenfolge dieser Nachträge hat Bilanz, GuV, Anhang, Signatur,
Audit und Paginierung erreicht, ohne die Lücke zu berühren, weil jede dieser
Sätze **für sich** funktioniert.

Was daraus folgt, ist eine Frage der Zusicherung, nicht des Codes: Das README
beschreibt als Zweck, den „Jahresabschluss (Bilanz + GuV + Anhang +
Lagebericht) rechtssicher" zu führen. **Diese Kette ist derzeit nicht
geschlossen** — vom Einzelsatz bis zur Veröffentlichung.

**Nicht gebaut**, weil es keine Auslegungsentscheidung ist, sondern ein
Baustein: Ein Abschluss braucht die verbindlichen Sätze, eine
Vollständigkeitsprüfung (Balance, Saldoabgleich Bilanz↔GuV, offene
Platzhalter im Anhang — beide sind inzwischen messbar vorhanden) und einen
Statusübergang, der die Einreichung freigibt. Der Aufwand ist erheblich und
gehört zu den Entscheidungen, die hier offen sind.

---


### Nachtrag 2026-10-17 (Nachtrag 28): Jahresabschluss — Schritt 1 und 2 umgesetzt

Der Plan (`docs/JAHRESABSCHLUSS-MODUL-PLAN.md`) ist freigegeben worden; umgesetzt
sind die beiden **freigabefreien** Schritte.

**Neu:** `POST /api/jahresabschluss` und `GET /api/jahresabschluss`.
`GET /api/jahresabschluss` lieferte vorher 404 — und die Oberflaeche fing das
als leere Liste ab. Der 404-Schlucker ist entfernt: ein 404 ist wieder ein
Fehler, eine leere Liste ist eine **Antwort des Servers**.

**Die Bestandteile werden ermittelt, nicht entgegengenommen.** Der DTO nimmt
nur `mandantId` und `geschaeftsjahr`; der Service sucht die drei Sätze dieses
Mandanten und Jahres selbst. Grund: Ein Jahresabschluss ist per Definition die
Verknüpfung *der* Bilanz, *der* GuV und *des* Anhangs. Würde der Aufrufer die
IDs mitgeben, könnte er einen Abschluss zusammensetzen, der zu einem anderen
Mandanten gehört — und der `MandantGuard` prüft den Mandanten, nicht die
Zusammengehörigkeit der drei Sätze.

**Fehlende Bestandteile sind ein 409, kein 400.** Die Anfrage war richtig, der
Zustand ist es nicht. § 314 HGB verlangt alle drei, und die Meldung sagt,
welcher fehlt.

**`finalize` fehlt bewusst** — es braucht die offene Entscheidung zum
Bilanz-GuV-Saldoabgleich (Nachtrag 22).

#### Nebenbefund: eine Umgebungsvariable, die nirgends dokumentiert war

Beim Testen fielen `subscription.spec.ts` und `custom-domain.spec.ts` mit 404
um. Die Ursache war **nicht** der Produktcode: `mockActivate` ist fail-closed
und antwortet ohne `BILLING_MOCK_ENABLED=true` mit „Nicht gefunden".

* In der **CI** steht die Variable ausdrücklich.
* In **`run-local.sh`** stand sie nicht.
* In **`.env.example`** stand sie nicht.

Wer der Anleitung folgte, bekam also 404er und zwei rote Tests. Behoben: beide
Dateien setzen die Variable jetzt mit Begründung.

**Und eine Warnung an mich selbst:** Die Datei `/tmp/bzenv.sh` war nach einem
Neustart des Rechners weg, und ich habe sie **aus dem Gedächtnis**
rekonstruiert — ohne `BILLING_MOCK_ENABLED`. Die daraus folgenden zwei
Fehlschläge sahen kurz wie eine Regression meines Jahresabschluss-Moduls aus.
Erst der **Kontrollversuch am sauberen Stand** (Änderungen gestasht) zeigte:
Auch ohne meine Änderung rot. Das war der Moment, in dem aus „mein Fehler"
„meine Umgebung" wurde.

**Merksatz:** Ein Fehlschlag, der nach der eigenen Änderung auftritt, ist
erst nach einem Kontrollversuch am unveränderten Stand der eigenen Änderung
zuzuschreiben. Und: Wer eine Konfigurationsdatei aus dem Gedächtnis
rekonstruiert, sollte die Vorlage im Repository als Quelle nehmen.

#### Test der eigenen Testfehler

Drei eigene Fehler in dieser Stunde, alle gefunden und korrigiert:

1. Drei Tests teilten sich den Zustand — Test 1 legte Bilanz + Anhang an,
   Test 2 kam mit der GuV dazu, und plötzlich waren alle drei da (201 statt
   409). Jeder Test räumt jetzt seinen Jahrgang selbst ab.
2. `if (false && …)` als Negativprobe **brach den Build** (TS18047). Die
   Schwelle auf 99 ist build-sicher.
3. Zwei `import type`-Zeilen (`CursorCodec`, `HttpCode`) blieben zurück —
   eslint meldete sie als ungenutzt.

Verifiziert: 755/755 Backend (80 Dateien), 70/70 Playwright, typecheck 0,
eslint 0.

---


### Nachtrag 2026-10-17 (Nachtrag 29): Nach der WP-Freigabe stand ein roher Schlüssel in der Bilanzliste

**Gemessen im Browser**, nach einer echten Vier-Augen-Freigabe:

```
Statuszelle VOR der Manipulation:  Entwurf
Statuszelle NACH der Manipulation: bilanz.status.APPROVED
```

Der Nutzer bekam also **keinen Text**, sondern den Schlüsselpfad der
Übersetzung.

**Ursache.** Die Vier-Augen-Freigabe setzt `bilanz.status = 'APPROVED'`
(`setBilanzStatus`, direkt per Prisma — das DTO kann den Wert nicht
setzen). `APPROVED` stand aber:

* in **keiner** Statusmenge des Backends (`BILANZ_STATUS` =
  DRAFT | VALIDATED | ARCHIVED),
* in **keiner** Übersetzung (`bilanz.status.*` = Entwurf | Geprüft | Archiviert).

Und die Oberfläche hat **vier** Stellen, die den Status so rendern
(Bilanz ×2, GuV, Anhang — die letzten beiden nutzen ebenfalls den
`bilanz.status.*`-Namensraum).

**Zwei Mengen, und der Unterschied ist nicht kosmetisch.** Neu:

| Menge | Bedeutung |
|---|---|
| `BILANZ_STATUS` | die **per API setzbaren** Status — bleibt DRAFT/VALIDATED/ARCHIVED |
| `BILANZ_DATENSTATUS` | alle Status, die in der DB stehen **können** — zusätzlich `APPROVED` |

`APPROVED` gehört **nicht** in `BILANZ_STATUS`: ein Bearbeiter dürfte sonst
eine Bilanz ohne Vier-Augen-Prüfung als freigegeben markieren. Der
Status muss sichtbar sein, aber nicht setzbar.

**Behoben:** Übersetzung ergänzt („Freigegeben (WP)"), `setBilanzStatus`
nimmt den Status aus `BILANZ_DATENSTATUS` und lehnt unbekannte Werte ab, und
die vier Renderstellen nutzen jetzt `StatusLabel` mit **Fallback**: ein Status,
den die Oberfläche nicht kennt, erscheint im Klartext statt als
Schlüsselpfad. Damit ist die Fehlerklasse für alle künftigen Status
geschlossen, nicht nur für diesen.

**Invarianten als Test** (`bilanz-status-konsistenz.spec.ts`):

1. Jeder Datenstatus hat eine Übersetzung — der Test liest die echte
   Message-Datei des Frontends.
2. `APPROVED` ist **nicht** per API setzbar.
3. Die beiden Mengen unterscheiden sich ausschließlich in `APPROVED`.

**Negativprobe:** Übersetzung entfernt → Test rot:
`Status ohne Übersetzung: APPROVED — die Oberfläche zeigt dann den rohen
Schlüsselpfad statt einer Beschriftung`.

Der Browser-Nachweis hängt in `wp-strecke.spec.ts` (5c): dort entsteht der
Zustand real — nach der Freigabe durch die zweite Person wird die
Bilanzliste geladen und geprüft. Ein Test, der den Zustand per Datenbank
setzt, prüft die Anzeige nicht so, wie der Anwender sie erlebt.

Verifiziert: 758/758 Backend (81 Dateien), 69/69 Playwright, typecheck 0,
eslint 0.

---

### Nachtrag 2026-10-17 (Nachtrag 30): Eine Ablehnung des Servers wurde als Erfolg dargestellt

**Der schwerwiegendste Frontend-Befund dieser Runde.** Er ist nicht im
Quelltext aufgefallen, sondern beim Negativprobe des Jahresabschluss-Tests.

Der Ablauf war: `jahresabschluss.spec.ts` legte Bilanz, GuV und Anhang an
und rief danach sofort `POST /finalize`. Der Server antwortete **zu Recht**
mit 409 — alle drei Sätze standen noch auf `DRAFT` und konnten sich damit
noch ändern:

```
$ curl -X POST .../api/jahresabschluss/<id>/finalize
HTTP 409
{"message":"Der Jahresabschluss ist noch nicht vollstaendig. ...",
 "pruefungen":[
   {"gegenstand":"Bilanz (Bearbeitungsstatus)","bestanden":false,
    "meldung":"Die Bilanz steht noch auf DRAFT und kann sich aendern ..."},
   {"gegenstand":"GuV (Bearbeitungsstatus)","bestanden":false, ...},
   {"gegenstand":"Anhang (Bearbeitungsstatus)","bestanden":false, ...}]}
```

Und was die Oberfläche daraus machte (wörtlich aus dem vom Test
mitgegebenen Seitenzustand):

> **Alle Pflichtangaben erfüllt.**
> ✓ Bilanz (Bearbeitungsstatus): Die Bilanz steht noch auf DRAFT und kann sich aendern — ein Jahresabschluss laesst sich sonst nicht fixieren.
> ✓ GuV (Bearbeitungsstatus): Die GuV steht noch auf DRAFT und kann sich aendern …
> ✓ Anhang (Bearbeitungsstatus): Die Anhang steht noch auf DRAFT und kann sich aendern …

**Drei Fehler in einem Block.** Die Überschrift war fest auf
`jahresabschluss.pruefung.ok` gesetzt, jede Prüfung bekam einen grünen
Haken und grüne Schrift — **ungeachtet** von `p.bestanden`. Und die
409-Behandlung (`err.body.pruefungen`) speist genau dieselbe Liste, die im
Erfolgsfall die bestandenen Prüfungen zeigt.

**Warum das mehr als Kosmetik ist.** Auf einem GoBD-Bildschirm behauptet
die Oberfläche eine Eigenschaft, die der Server gerade bestritten hat. Ein
Bearbeiter, der einen Abschluss nicht abschließen kann, sieht „alles
erfüllt" mit drei grünen Häkchen — die naheliegende Deutung ist „die
Software ist kaputt", nicht „meine Sätze sind noch in Bearbeitung". Der
Fehler zeigt sich erst dort, wo er am meisten schadet: bei der
Veröffentlichung eines Abschlusses.

**Ursache.** Die Quelle der Wahrheit war nicht `bestanden` des Servers,
sondern der HTTP-Status und ein hart verdrahteter Text. Zwei Stellen,
eine Ursache.

**Behoben.** Überschrift und Farbe werden jetzt aus den Prüfungen selbst
abgeleitet, `data-ergebnis="vollstaendig|offen"` macht das Ergebnis für
Tests und Stylesheets abgreifbar. Jede Prüfung rendert `✓`/`✗` und
grün/rot nach `p.bestanden`.

**Der Test, der das festhält** (`jahresabschluss.spec.ts`, Fall 2) ist der
wichtigere der beiden: er lässt die Sätze absichtlich auf `DRAFT` und
verlangt, dass die Oberfläche **nicht** „Alle Pflichtangaben erfüllt"
anzeigt, **kein** grünes Häkchen liefert und der Abschluss `Entwurf`
bleibt.

**Zur Reihenfolge der Zusicherungen.** Die erste Negativprobe dieses
Befunds war wertlos und fiel sofort auf: Der Test wurde rot, weil das von
mir erfundene `data-ergebnis` fehlte — nicht weil die irreführende
Meldung wieder da war. Ein Test, der an einem Attribut scheitert, das
ich selbst ergänzt habe, beweist nichts über den Fehler. Die semantischen
Zusicherungen stehen deshalb **vor** der Attributprüfung, damit die
Negativprobe an ihnen scheitert.

**Negativprobe (nach Reihenfolge-Korrektur).** Panel auf den alten Stand
zurückgebaut → genau der zweite Test rot, mit der Erfolgsmeldung im
Meldungstext:

```
Error: eine abgelehnte Pruefung darf nicht als Erfolg gemeldet werden
Received string: "Alle Pflichtangaben erfüllt.✓ Bilanz (Bearbeitungsstatus):
  Die Bilanz steht noch auf DRAFT und kann sich aendern ...✓ GuV ...✓ Anhang ..."
```

#### Nebenbefund desselben Laufs: der Test beschrieb einen unmöglichen Zustand

Der ursprüngliche `jahresabschluss.spec.ts` konnte nie grün werden — und
war nicht „flaky", sondern falsch: Er legte die drei Sätze an und rief
sofort `finalize`, ohne sie aus `DRAFT` zu nehmen. `VALIDATED` ist per
API setzbar (`BILANZ_STATUS` = DRAFT|VALIDATED|ARCHIVED), die Oberfläche
bietet die Auswahl an allen drei Stellen. **Es gibt also keine Sackgasse**,
in der ein Abschluss nie abgeschlossen werden könnte; das Fixture war
unvollständig.

Anmerkung zur Testumgebung: Der erste Lauf dieses Tests war grün, obwohl
`.next/BUILD_ID` **drei Minuten älter** war als die geänderte Quelldatei.
Der Frontend-Server lieferte den alten Production-Build. Wer nach einer
Änderung an `.tsx` testet, ohne vorher `npm run build` zu fahren und den
Prozess neu zu starten, prüft den Vorzustand und hält sich für grün.

---

### Nachtrag 2026-10-17 (Nachtrag 32): Der API-Wächter sah 13 % aller Aufrufe nicht — und war in genau der Datei blind, für die er geschrieben wurde

**Zwei Mängel im selben Wächter** (`api-pfade.spec.ts`), gefunden weil ein
neuer Aufruf einen **falschen** Alarm auslöste.

#### Mangel 1: Die Routenliste war handgepflegt — und bereits veraltet

```ts
// Die Backend-Routen sind zur Compile-Zeit nicht verfuegbar; die Liste
// wird bewusst gepflegt und im selben Commit mit dem Code geaendert.
const bekannteRouten = ['/mandant', '/bilanz', ...];   // 18 Eintraege
```

Die Begründung trifft nicht zu: Die Routen stehen statisch im Quelltext.
`/jahresabschluss` fehlte in der Liste, obwohl der Controller existierte —
der Wächter meldete also einen Fehler, den es nicht gab.

**Das eigentliche Problem ist nicht die fehlende Zeile.** Eine handgepflegte
Liste unterscheidet einen echten Fehler nicht von einem erfundenen. Sie
erzeugt Falsch-Alarme (laut, lästig) und Falsch-Bestätigungen (leise,
teuer). Nachtrag 27/28 ist genau so entstanden: `GET /api/jahresabschluss`
fehlte, die Oberfläche zeigte eine leere Liste, und kein Wächter sagte etwas.

**Behoben:** Die Routen werden jetzt aus den `@Controller(...)`-Deklarationen
im Backend-Quellbaum abgeleitet. Der Wächter kann nicht mehr hinter der
Implementierung zurückbleiben, weil er aus ihr besteht. Zusätzlich eine
ausdrückliche Zusicherung, dass überhaupt Routen gelesen wurden — eine
leere Menge darf nicht als „alles gut" durchgehen.

#### Mangel 2: Das Suchmuster übersah jede Form mit Query-String

```ts
// ALT: nach dem ersten Pfadabschnitt MUSS ein ' ` ' oder '/' folgen
/apiFetch(?:<[^>]*>)?\(\s*[`'](\/[a-z][a-z0-9-]*)[`'/]/gi
```

Bei `` `/bilanz?mandantId=${id}` `` folgt auf `bilanz` ein `?` — das Muster
greift **überhaupt nicht**. Gemessen an fünf Formen:

| Aufruf | alter Wächter | neuer Wächter |
|---|---|---|
| `apiFetch('/mandant')` | gefunden | gefunden |
| `` apiFetch(`/jahresabschluss/${id}/finalize`) `` | gefunden | gefunden |
| `` apiFetch(`/bilanz?mandantId=${m}`) `` | **übersehen** | gefunden |
| `` apiFetch(`/jahresabschlussTYPO?mandantId=…`) `` | **übersehen** | gefunden |
| `apiFetch('/mandanten')` | gefunden | gefunden |

**Abdeckung im echten Quellbaum: 73 von 86 `apiFetch`-Aufrufen (85 %).**
Mit dem korrigierten Muster: 86 von 86.

Die drei Aufrufe, die der alte Wächter nie gesehen hat:

```
components/audit/AuditLogView.tsx → /audit
components/audit/AuditLogView.tsx → /audit
components/wp/WPView.tsx          → /bilanz      ← /bilanz?mandantId=${id}
```

**`WPView` ist die Datei, in der dieser Wächter ursprünglich entstanden
ist.** Dort stand `/mandanten` statt `/mandant`, der 404 beendete die
Ladefunktion, und die Seite blieb für immer auf „Wird geladen …". Der
Wächter wurde genau deshalb gebaut. Hätte derselbe Fehler **einen
Query-String getragen** — `/bilanzen?mandantId=${id}` —, wäre der Wächter
**still geblieben**.

Das ist der Kern: Ein Wächter, der die Fehlerklasse übersieht, für die er
geschrieben wurde, ist schlechter als keiner, weil er gezählt wird.

**Behoben:** Der Terminator ist ersatzlos entfallen — der erste
Pfadabschnitt ist das Prüfziel, der Rest des Strings ist egal.

**Negativproben.** Beide Mängel einzeln nachgewiesen, jeweils an einer
Stelle, die der alte Wächter **nie inspiziert hat**:

1. `/jahresabschluss` → `/jahresabschlussTYPO` in `JahresabschlussView.tsx:60`
   → Wächter rot: *„kein @Controller im Backend"*. Mit dem alten Muster:
   grün.
2. `/bilanz` → `/bilanzen` in `WPView.tsx:145` (historischer Fundort)
   → Wächter rot: *„src/components/wp/WPView.tsx:145 → /bilanzen"*.

---

### Nachtrag 2026-10-17 (Nachtrag 33): Ein Test ermittelte dieselbe Sache zweimal — und war deshalb lange stimmig

**Kein Produktdefekt, sondern die Ursache eines roten Laufs**, der sich als
Produktdefekt ausgab.

`wp-strecke.spec.ts` ermittelt die Bilanz **zweimal**, auf zwei Wegen:

| Abschnitt | Weg | Ergebnis |
|---|---|---|
| 0 (Dropdown) | `sel.options[0].value` | die neueste Bilanz |
| 5b (Nachsuche) | `find(geschaeftsjahr === 2025) ?? bl[0]` | GJ 2025 |

Solange der Mandant **genau eine** Bilanz hatte, lieferten beide Wege
dasselbe Objekt. Sobald `jahresabschluss.spec.ts` zwei weitere Bilanzen
anlegt (GJ 2079, 2080), ist die Liste

```
[2080, 2079, 2025]      ← absteigend nach Jahr
```

Der Dropdown nimmt **2080**, die Nachsuche sucht in **2025**. Ergebnis:

```
Freigabe durch WP2: {"status":0,"message":"keine offene Prüfung"}
```

Die Vier-Augen-Freigabe schlug fehl, weil der Test an zwei verschiedenen
Orten nach derselben Sache gefragt hatte.

**Bemerkenswert ist die Reihenfolge.** Ohne den neuen
`jahresabschluss.spec.ts` wäre der Fehler nie aufgefallen. Ein Test, der
ein anderes Testverhalten voraussetzt, ist kein Test — er ist eine
Zusicherung über die Reihenfolge hinweg.

**Behoben:** Abschnitt 5b verwendet die bereits bekannte `bilanzId`; nur
die Mandanten-ID wird noch ermittelt, weil die API sie daneben braucht.

**Merksatz für künftige Tests:** Wenn ein Test zweimal dasselbe Objekt
ermittelt, ist das kein Redundanz-Schutz, sondern eine stille
Vorbedingung. Wer sie auflöst, muss sie *an einer Stelle* haben.

---

### Nachtrag 2026-10-17 (Nachtrag 34): Drei verschiedene Gründe, warum eine grüne Negativprobe lügt — und ein toter Prüfzweig

**Der interessanteste Befund dieser Runde, weil er die Methode selbst betrifft.**

#### Der Auslöser

Der neue Jahresabschluss-Service war die **einzige** von zehn Stellen, die
für die Mandantentrennung `BadRequestException` (400) statt
`ForbiddenException` (403) warf. Semantisch falsch: 400 heißt „deine
Anfrage ist fehlerhaft", 403 heißt „du darfst das nicht". Also geändert und
ein Test ergänzt.

#### Die Negativprobe blieb grün

Service auf 400 zurückgebaut, Server neu gestartet, Test gefahren:

```
✓ e2e/jahresabschluss.e2e.spec.ts (8 tests) 712ms
Tests  8 passed (8)
```

**Grün.** Nach der eigenen Regel ist das verdächtig: entweder steckt der
Fix noch drin, oder der Server lief mit altem Code. Also geprüft:

| Prüfung | Ergebnis |
|---|---|
| Quelldatei wirklich zurückgebaut? | ja (`throw new BadRequestException`, Import vorhanden) |
| Server wirklich neu? | ja (Prozess neu, Log frisch, `/health` antwortet) |
| Antwort des laufenden Servers direkt abgefragt | **403** |

Der Server fuhr also den neuen Code — und antwortete trotzdem 403. Die
Antwort kam gar nicht aus dem geprüften Code:

```
mandant.guard.ts:72   if (user.globalRole === 'SYSTEM_ADMIN') return true;
mandant.guard.ts:77   if (!accessibleMandantIds.includes(mandantId))
mandant.guard.ts:79     throw new ForbiddenException('Kein Zugriff auf diesen Mandanten');
```

Der `MandantGuard` macht **genau dieselbe Prüfung** — gleiche SYSTEM_ADMIN-
Ausnahme, gleiche `user.mandanten`-Prüfung, **gleiche Fehlermeldung** — und
läuft vor dem Service. Jede Jahresabschluss-Route trägt `@UseGuards(
MandantGuard)`. Der Controller weist zusätzlich `dto.mandantId !==
mandantId` mit 400 ab.

**Ergebnis: Der `assertMandantAccess` im Jahresabschluss-Service ist über
HTTP nicht erreichbar.** Er ist Tiefenschutz, der nie auslöst — in diesem
Modul und, nach dem Muster, in den neun Geschwisterservices ebenso.

#### Die Regel, die daraus folgt

Bis heute gab es zwei bekannte Gründe für eine grüne Negativprobe. Es sind
**drei**, und der dritte ist der gefährlichste:

| Grund | Erkennbar an | |
|---|---|---|
| Der Fix steckt noch drin | Quelldatei prüfen | harmlos |
| Der Server lief mit altem Code | Prozesszeit, Log, Direktabfrage | Prozess neu starten |
| **Der Test erreicht den Code nicht** | **Direktabfrage zeigt ein Verhalten, das der geänderte Code nicht haben kann** | **Code liest** |

Der dritte Grund sieht aus, als wäre nichts passiert. Man „repariert" den
Test dann durch Entfernen der Zusicherung, und der Zweig bleibt ungetestet
— für immer, weil niemand mehr weiß, dass er existiert.

**Deshalb wird der Test nicht als Beleg geführt.** Er prüft die
Mandantentrennung auf **Guard-Ebene** und sagt das auch so. Die
Umstellung im Service bleibt als Angleichung an die Geschwister bestehen —
mit dem ausdrücklichen Vermerk, dass sie über HTTP nicht prüfbar ist.

**Offen, bewusst nicht entschieden:** Ob `assertMandantAccess` in den zehn
Services bleiben soll (Tiefenschutz gegen eine künftige Route ohne Guard)
oder entfernt wird (toter Code, der eine Prüfung vortäuscht), ist eine
Architekturfrage — siehe TODO unten.

| ID | Aufgabe | Owner | Frist |
|---|---|---|---|
| ~~TODO-8.7~~ | ~~`assertMandantAccess` — Tiefenschutz oder toter Code?~~ — **erledigt in Nachtrag 58**: die Empfehlung wurde umgesetzt und die Frage beantwortet: es war **zwoelfmal derselbe Code** (12 Kopien in 12 Services), also *ungenutzter Tiefenschutz* — eine Schranke, die im Betrieb nie wirkt und beim Refaktorieren stillschweigend verschwindet. Jetzt **eine** Implementierung (`common/utils/mandant-zugriff.ts`) und ein Test, der den Service **direkt** (ohne HTTP) prueft — genau wie hier empfohlen | — | erledigt |

---

### Nachtrag 2026-10-17 (Nachtrag 31): Der Audit-Trail wird „fire and forget" geschrieben — projektweit

**Nicht behoben, sondern offengelegt.** Dies ist eine Musterentscheidung,
kein Einzelfehler, und sie gehört dem Nutzer, nicht mir.

Rund 50 Aufrufstellen schreiben so:

```ts
const aktualisiert = await this.prisma.jahresabschluss.update({ ... });
void this.auditService.record({ ... });        // ← nicht awaited
return aktualisiert;                            // ← Antwort geht raus
```

**Das Risiko.** Stürzt der Prozess zwischen dem Fachschreibvorgang und dem
Audit-Eintrag ab, existiert die Änderung **ohne** Nachvollziehbarkeit. § 146
Abs. 1 AO verlangt, dass die Aufzeichnung so erfolgt, dass sie bei späterer
Einsichtnahme nachvollziehbar ist — ein Audit-Eintrag, der vom Erfolg der
Fachoperation abhängt und ihr nachläuft, kann ausfallen.

**Warum ich das nicht einfach geändert habe.** Drei Gründe, und jeder ist
für sich relevant:

1. **Es ist einheitlich.** Alle Module machen es so — Bilanz, GuV, Anhang,
   Mandant, Webhooks, Branding, PDF, Signatur, DATEV, E-Bilanz, Auth.
   Eine einzelne Stelle umzustellen erzeugt zwei verschiedene Semantiken im
   selben Audit-Log, ohne dass jemand es sieht.
2. **Es ist vermutlich bewusst.** Ein Fehler im Audit darf den
   Fachvorgang nicht zurückrollen — das ist die übliche Begründung für
   dieses Muster, und sie ist nicht schwach.
3. **Der Umfang.** ~50 Stellen plus alle Tests, die auf die bisherige
   Reihenfolge reagieren. Das ist eine Architekturentscheidung, keine
   Korrektur.

**Die Auflösung, die ich empfehle** (und die beide Anforderungen
miteinander vereint): Fachschreibvorgang und Audit-Eintrag in **eine**
Transaktion, und die Prüfung, ob der Audit-Eintrag wirklich gelandet ist,
als **eigene** Condition — ein Zähler oder eine tägliche Abfrage auf
`AuditLog`, dessen Alter die Aufbewahrungsfrist überschreitet. Damit bleibt
der Fachvorgang unabhängig vom Audit, aber die Lücke wird *messbar*
statt *stillschweigend*.

**Bis dahin** ist das eine bewusste Lücke und keine unbekannte: sie steht
hier, damit ein externer Auditor sie nicht als Fund entdeckt.

---


| # | Fundstelle | Befund |
|---|---|---|

---

### Nachtrag 2026-10-14 (Nachtrag 15): Zwei Entscheidungen umgesetzt

Die Fachfragen aus Nachtrag 13 und 12 sind entschieden:

| Frage | Entscheidung | Umsetzung |
|---|---|---|
| Soll das Signieren die Entität sperren? | **Nein — aber sichtbar machen** | `GET /api/signatur/status`, Badge in Bilanz/GuV/Anhang |
| Darf ein archivierter Mandant geprüft/signiert werden? | **Nein (§ 147 AO)** | Archiv-Guard in 5 WP- und 4 Signaturpfaden |

#### 1. Signieren sperrt nicht — es macht den Unterschied sichtbar

Gemessen war vorher: die Bilanz bleibt nach der Signatur `DRAFT`, ein
STEUERBERATER ändert sie per PATCH auf 200, und das signierte WORM-Objekt passt
nicht mehr zum vorgelegten Dokument. Niemand konnte das sehen.

Warum **nicht** sperren: Eine Korrektur erzeugt zwingend eine neue Signatur,
der alte WORM-Satz darf nicht gelöscht werden (Object-Lock), und eine
Entität braucht dann mehrere Signaturen. Eine Sperre würde den
Korrekturvorgang unmöglich machen.

`GET /api/signatur/status?entityType=&entityId=` liefert
`UNSIGNIERT` / `SIGNIERT` / `ABWEICHEND`. Maßgeblich ist der Zeitvergleich
Signatur-Record `createdAt` gegen `updatedAt` der Entität. Bewusst **nicht**
gegen `zeitstempel` der Signatur: ohne TSA ist das ein geratener Wert, der
Signatur-Record dagegen ist unabhängig von einer externen Zeitquelle.

`ABWEICHEND` trägt einen Klartext mit, keinen Enum-Wert zum Raten:
„Die hier angezeigten Daten entsprechen NICHT der signierten Fassung."

#### 2. Archivierter Mandant: neun Schreibpfade gesperrt

Bilanz, GuV, Anhang, Konsolidierung und DATEV-Import waren bereits über
`assertMandantNichtArchiviert` gesperrt. **WP und Signatur waren es nicht** —
und die Signatur ist die folgenreichste Lücke, weil sie ein Dokument mit
rechtlicher Wirkung erzeugt. Negativprobe, Guard entfernt:

```
POST /api/signatur/sign-bilanz   → 200, signatureId 0f49a27c-…
POST /api/wp/pruefungen/:id/finalize → 200, Prüfung auf APPROVED
```

**Lesen bleibt offen**, und das ist kein Versehen: § 147 Abs. 3 AO verlangt
Nachvollziehbarkeit. Ein archivierter Mandant, dessen Bestand nicht lesbar
wäre, wäre kein archivierter Mandant, sondern ein Datenverlust. Der neue
Spec prüft beides getrennt — Schreiben 409, Lesen 200.

#### Ein Test, der aus dem falschen Grund grün war

Der Fall `POST /api/wp/pruefungen` war zunächst **nicht** isolierbar: der
Guard in `startPruefung` ließ sich entfernen, alle Tests blieben grün. Gemessen
zeigte sich, dass `startPruefung` intern `IdwPruefungService.runPruefung`
aufruft — und der 409 kam von **dort**. Der Guard ist trotzdem geblieben
(Defence-in-Depth), aber der Test prüft ihn nicht.

Der Fall, der ihn doch greifbar macht, ist `finalize`: dort greift zuerst das
**Vier-Augen-Prinzip** (403, wer selbst prüft, darf nicht freigeben). Der erste
Entwurf lief deshalb mit `wp@kanzlei.de` und scheiterte aus dem falschen Grund
— erst mit **`wp2@kanzlei.de`** prüft der Test den Archiv-Guard.

#### Noch eine Fehldeutung, die ein Test aufgedeckt hat

Der erste Playwright-Test für das Badge steuerte den kompletten P12-Dialog
nach und behauptete danach, „Signatur erfolgreich" gesehen zu haben. Der
Selektor traf den **Dialog-Titel**. Gemessen: `signature`-Tabelle leer, null
Datensätze. Der Test prüfte nichts und wäre grün geblieben.

Der Test setzt den Zustand jetzt bewusst per API und prüft, was er in der
Oberfläche bewirkt. Der Dialog ist ohnehin vom Test oberhalb abgedeckt.

### Nachtrag 2026-10-14 (Nachtrag 14): Die Cursor-Pagination verlor Belege

**Befund, gemessen.** Fünf Bilanzen mit **identischem** `updatedAt`,
`pageSize=2`:

```
Seite 1: 2 Items, nextCursor=ja
Seite 2: 0 Items, nextCursor=nein
erwartet GJ 2201-2205, gesehen: 2201
ERGEBNIS: 1/5 — ITEMS FEHLEN
```

Vier von fünf Belegen waren über die Liste nicht erreichbar, während `total`
im selben Response weiterhin sechs behauptete. Für eine Kanzlei ist das kein
Kosmetikfehler: wer die Bilanzliste durchblättert, **übersieht Belege**, und
der Widerspruch zwischen `total` und der gelieferten Menge ist nicht
erkennbar.

**Ursache.** `CursorCodec.encode()` schreibt `id:sortValue` in das Token —
der Kommentar versprach einen „Stable Tiebreaker". `whereFromCursor()` las
nur `sortValue` und **verwarf die `id`**. Damit lautete die Bedingung
schlicht `updatedAt < cursorDate`, und alles mit *gleichem* Zeitstempel fiel
weg. Sieben Aufrufstellen hatten dieselbe Kopie: Bilanz, GuV, Anhang, Audit,
WP-Notizen, Mandant.

**Die Richtung war nicht trivial.** Die Sortierungen lauten
`[{ updatedAt: 'desc' }, { id: 'asc' }]` — **gemischte Richtung**. Mein erster
Fix nahm für den Tiebreaker `id < cursorId` an (richtig nur bei `id: 'desc'`)
und **löste den Fehler nicht**; die Messung blieb bei 1/5. Erst das Nachsehen
in alle sieben `orderBy`-Klauseln zeigte `id: 'asc'` überall, und beim
Mandanten sogar `firmenname: 'asc'`. Beide Richtungen sind jetzt Pflicht-
Parameter, ohne Default.

**Behoben.** `PaginationService.cursorCondition()` — eine zentrale Funktion
statt sieben Kopien, denn die Wiederholung war der Grund, dass der Fehler
überall stand:

```
(primärfeld <|-> wert)  ODER  (primärfeld = wert UND id <|-> cursorId)
```

#### Zweiter Befund derselben Stelle: ein Query-Param schoss den Server ab

`CursorCodec.decode()` hatte einen Fallback: ohne `:` wurde die ganze
Zeichenkette als `id` **und** `sortValue` gelesen. Bei `firmenname`
(ein String, kein Datum) kam so `base64("Berlin")` durch, und
`id: { gt: 'Berlin' }` auf einer UUID-Spalte ließ Postgres scheitern:

```
Inconsistent column data: Error creating UUID,
invalid character: expected … found `r` at 3        -> HTTP 500
```

Der Decoder ist jetzt **strikt** und wirft `BadRequestException`. Damit ist
auch die Zusage im Kommentar wahr, die vorher nicht stimmte („Selbst-
validierend (Decoder prüft Format)", „führt zu 400"): gemessen lieferten
`?cursor=notbase64`, `?cursor=!!!!` und `?cursor=x` zuvor **200 mit der
ersten Seite**, ohne jede Fehlermeldung.

#### Drei Negativproben, und eine war grün, weil sie das Falsche prüfte

| Zurückgebaut | Ergebnis |
|---|---|
| `id`-Tiebreaker | 1 rot: `expected [2212, 2215] to equal [2211…2215]` |
| strenger Decoder | 1 rot: `expected 500 to be 400` |
| **nur `assertMandantAccess`**-Analogie: Decoder nachsichtig | **10/10 grün** |

Die dritte Zeile lohnt sich. Der Decoder war nachsichtig, alle Tests blieben
grün — die 400 kam inzwischen aus der **Datumsprüfung** in `cursorCondition`,
nicht aus dem Decoder. Zwei Schichten liefern dieselbe Antwort, und der Test
unterscheidet sie nicht.

Der Fall, der es doch unterscheidet, ist `firmenname`, weil dort **kein
Datum** im Spiel ist: `base64("Berlin")` hätte den alten Fallback durchlassen
und den Server mit 500 abgeschossen. Der steht jetzt im Test.

#### Was die Korrektur an einer anderen Stelle aufgedeckt hat

Nach dem `id`-Tiebreaker lief `bilanz.e2e` plötzlich auf **409** für GJ 2031.
Ursache ist dieselbe Kopplungsklasse wie in Nachtrag 12, nur eine Ebene tiefer:

* Die Specs laufen in **keiner alphabetischen Reihenfolge** — gemessen:
  `signatur, ebilanz, api, datev-import, mandant-quelle, pagination, …,
  bilanz, wp, …`.
* `pagination.e2e` legte seinen Bestand für **GJ 2030-2035** an. GJ 2031
  ist zugleich der Jahreswert von `bilanz.e2e`.
* Durch die zugesagte Sortierung ist `mandanten[0]` jetzt **Beispiel GmbH**
  statt Demo GmbH — dieselbe Mandanten-Kollision, die Nachtrag 12 in den
  anderen Specs aufgedeckt hatte, jetzt hier.

Zwei voneinander unabhängige Kopplungen, beide entfernt: der Bestand liegt
jetzt in **GJ 2040-2045** (von keiner anderen Spec belegt, und unter der
DTO-Grenze 2100 — `2300` scheiterte mit `geschaeftsjahr muss <= 2100 sein`),
und `afterAll` räumt ihn wieder weg, damit keine Spec Spuren hinterlässt.

Der Volllauf ist **zweimal hintereinander** gefahren: Die ersten Fehler waren
reihenfolgeabhängig, ein einzelner grüner Lauf hätte nichts bewiesen.

---

### Nachtrag 2026-10-13 (Nachtrag 13): Die gelieferte Signatur-ID war ein toter Verweis

**Befund, gemessen nicht gelesen.** Nach `POST /api/signatur/sign-bilanz`:

```
1. sign-bilanz -> 200 | signatureId in der Antwort: c1f13ff5-…
2. Datensatz mit dieser signatureId in `signature`: NICHT VORHANDEN
3. `signature`-Tabelle insgesamt: 0 Zeilen
4. Status nach Signieren: DRAFT
5. PATCH /api/bilanz/:id (als STEUERBERATER) -> 200
6. signierte WORM-Objekte fuer diese Bilanz: 1
```

**Zwei Fehler stapelten sich:**

1. `signature.jahresabschlussId` war `NOT NULL`. Beim Signieren einer
   Bilanz gibt es keinen Jahresabschluss, an den der Datensatz hängen kann —
   er wurde **bewusst übersprungen** („Audit-Trail reicht für
   Nachvollziehbarkeit"). Die API lieferte trotzdem eine `signatureId`, und
   das Frontend zeigt sie dem Nutzer als „Signatur-ID" an.
2. `SignatureRepository.create()` gab **kein `id`** an Prisma. Prisma vergab
   darüber `@default(uuid())` eine **eigene** UUID. Die `signatureId` aus der
   Antwort war also auch beim Jahresabschluss — wo der Datensatz sehr wohl
   existierte — eine andere als die gespeicherte.

Fehler (2) ist der unangenehmere: Er ist nicht auf den Entitätenpfad
beschränkt, sondern hat **jede** Signatur betroffen. Ein Datensatz war da,
die Nummer im Dialog führte zu keinem.

**Behoben.** `jahresabschlussId` ist optional, dazu kommen `entityType` +
`entityId`. Ein Record trägt **genau eine** Bezugsachse — der Repository
weist das mit einem Fehler ab, statt einen unauffindbaren Datensatz zu
schreiben (fail-closed). Die `id` wird durchgereicht.

**Zwei Negativproben, einzeln gefahren.** Fehler (1) und Fehler (2) wurden
getrennt zurückgebaut; beide Male fiel genau **ein** Test mit
`expected null not to be null`.

#### Die Negativprobe, die zuerst grün war

Fehler (2) zurückgebaut — **14 von 14 Tests grün**. Der Test prüfte nichts.

Grund: das e2e spricht per `fetch` mit einem Server auf `:3000`, und den hatte
ich nach der Änderung am Repository **nicht neu gestartet**. Der Test prüfte
den laufenden Prozess, nicht den Code im Repo — exakt die Falle, die in
Nachtrag 8 schon einmal beschrieben wurde und hier erneut zugeschlagen hat.

**Merksatz:** Eine Negativprobe, die grün bleibt, hat in diesem Projekt zwei
mögliche Ursachen: der Fix ist nicht drin, **oder** der geprüfte Code läuft
nicht. Bevor man die Fixture bemängelt, den Serverstand prüfen.

#### Zwei eigene Werkzeugfehler in derselben Stunde

Beides Fehler in der Prüfkette, nicht im Produkt:

1. `npm run typecheck | tail -6 && echo OK` meldete „OK", obwohl `tsc`
   **drei Fehler** geschrieben hatte: die Pipe gibt den Exitcode von `tail`
   zurück. Ab jetzt wird der Exitcode direkt geprüft
   (`npm run typecheck > log 2>&1; echo $?`).
2. `source /tmp/bzenv.sh && nohup … &` schickt die **ganze Kette** in den
   Hintergrund. Der Vordergrund hatte danach kein `DATABASE_URL`, das
   Messskript brach mit `Environment variable not found` ab.

#### Gemessen, aber nicht behoben — fachliche Entscheidung

Nach dem Signieren bleibt die Bilanz `DRAFT` und ist **weiterhin
bearbeitbar** (Zeile 5 oben: ein STEUERBERATER ändert sie per PATCH auf 200).
Das signierte WORM-Objekt passt damit nicht mehr zum vorgelegten Dokument,
und im Datensatz steht nirgends, dass er einmal signiert war.

Ob das so sein darf, ist eine **Fachfrage** und keine
Implementierungsfrage: Nach § 147 AO muss die unterzeichnete Fassung
identifizierbar und unveränderbar sein — dafür spricht ein Sperrversuch.
Dagegen spricht ein Korrekturworkflow: eine Korrektur erzeugt zwingend eine
neue Signatur, der alte WORM-Satz darf nicht gelöscht werden, und die Entität
braucht dann mehrere Signaturen.

**Nicht entschieden, nicht gebaut.** Der Beleg ist jetzt aber da: die Signatur
ist abrufbar, statt in einer Audit-Zeile zu versinken.

#### Nachtrag, dasselbe Tag: der Endpunkt, der die ID auflösbar macht

`findByEntity` ohne Abnehmer wäre toter Code gewesen. Also:
`GET /api/signatur/signaturen?entityType=&entityId=`.

Zwei Dinge, die dabei **gemessen** statt angenommen wurden:

| Anfrage | Antwort |
|---|---|
| ohne Mandantenquelle | `403 "mandantId erforderlich"` |
| mit Header, `import type` im Controller | `400 ["property entityType should not exist", …]` |

Die zweite Zeile ist der eigentliche Fund. `import type { SignaturListeQueryDto }`
**löscht die Klasse zur Laufzeit weg**. Nest sieht `Object` als Metatype, und die
globale ValidationPipe (`whitelist`, `forbidNonWhitelisted`) verwirft dann
**jedes** Property — der DTO sah korrekt aus, `tsc` war grün, und der Endpunkt
nahm nichts entgegen. Für ein DTO ist `import type` damit nie richtig: Es ist ein
Wert, kein Typ.

**Negativprobe mit dem richtigen Auslöser.** Zuerst `assertMandantAccess` aus
dem Service entfernt — **16 von 17 Tests grün**. Der Test prüfte nicht die
Stelle, die ich im Blick hatte: der Controller-Guard lehnt einen fremden
Mandanten schon vorher ab, die Service-Prüfung ist eine zweite Schicht, die über
HTTP nicht von der ersten unterscheidbar ist.

Der **testbare** Teil ist der mandant-gefilterte Existenz-Check. Zurückgebaut
liefert ein fremder Mandant:

```
× GET /api/signatur/signaturen mit fremdem Mandant → 404
  → fremder Mandant darf keine Signatur liefern: expected 200 to be 404
```

Also ein **echter Cross-Tenant-Leak**, vom Test gefangen.

---

### Nachtrag 2026-10-13 (Nachtrag 12): Der Mandant-Picker der WP-Seite war wirkungslos

**Befund:** `WPView` haelt den gewaehlten Mandanten nur im React-State und
schreibt `localStorage` nicht. `apiFetch` setzt `x-mandant-id` aber
**aus `localStorage`**, und der Header hat im Backend Vorrang vor dem
Query-Parameter. Nach einem Wechsel im Picker stand der neue Mandant im
Feld, geladen wurde aber der Bestand des Header-Mandanten.

Gemessen:

```
GET /api/bilanz?mandantId=<Demo GmbH>  +  x-mandant-id: <Beispiel GmbH>  -> 0 Treffer
GET /api/bilanz?mandantId=<Demo GmbH>,  kein Header                     -> 1 Treffer
```

Der Picker war also keine Auswahl, sondern eine Beschriftung. Behoben mit
`setActiveMandantId()` im `onChangeMandant` — der Seitenzustand und der
Header-Kontext muessen denselben Mandanten nennen.

**Der Weg, auf dem der Befund auffiel, ist der bemerkenswerte Teil.** Der
Playwright-Test `wp-strecke` brach nach Nachtrag 10 ab. Der erste Verdacht
war die Sortierung. Der **Kontrollversuch** — Produktänderung zurueckbauen,
Test erneut fahren — schlug **identisch** fehl. Damit war die Sortierung als
Ursache **widerlegt**, und der Verdacht wanderte weiter statt sich zu
verhärten.

Der Test scheiterte dabei auch **allein laufend**, ohne meine Änderung: er
bekam seine Bilanzen von Spezifikationen, die vorher liefen. Er war nie
isoliert lauffähig — und die Art, wie er sichtbar wurde, war ein anderer
Mandant.

**Zwei Lehren, die sich ergaenzen:**

1. Ein Fehlschlag, der nach einer eigenen Aenderung auftritt, ist erst dann
   diese Aenderung, wenn der **Kontrollversuch** sie ausgeschlossen hat.
2. Ein Test, der nur im Verbund mit anderen gruen ist, prueft den
   Verbund. `wp-strecke` war seit Einfuehrung von der Reihenfolge abhaengig.

**Nicht verfolgt:** `KonsolidierungView` waehlt ebenfalls einen Mandanten
(die Mutter). Das ist ein **Parameter** einer Konzerneinheit auf
Kanzlei-Ebene, kein Tenant-Kontext. Gemessen akzeptiert das Backend eine
Einheit, deren Mutter vom Header-Mandanten abweicht, solange beide derselben
Kanzlei angehoeren — bei einer mandantenuebergreifenden Konsolidierung ist
das der erwartete Fall. **Kein Defekt belegt**, deshalb hier nur vermerkt.

---

### Nachtrag 2026-10-13 (Nachtrag 10): Die Mandantenliste war nicht sortiert — und ein Kommentar behauptete das Gegenteil

**Befund:** Sechs Abfragen ueber `UserMandantRole` — Login, Refresh, `me`,
`resolveAuthUser` und `getMandantenAccessibleByUser` in **zwei** Services —
lieferten ihre Mandanten **ohne `orderBy`**. Prisma gibt ohne `ORDER BY`
keine Reihenfolge zu; gemessen wurde fuer `steuerberater@kanzlei.de`:

```
Demo GmbH | Beispiel GmbH | Test AG
```

Das ist weder alphabetisch noch die Seed-Reihenfolge garantiert. Ein
`UPDATE` schreibt eine neue Heap-Version ans Zeilenende, die Reihenfolge
wechselt also mit, sobald jemand einen Mandanten umbenennt.

**Warum das ein Produktdefekt ist und nicht nur ein Testproblem:** Die API
liefert ein Array, und jedes Array hat eine Position. Ohne zugesicherte
Sortierung steht jedes clientseitige `mandanten[0]` auf nicht zugesagtem
Verhalten. In den e2e-Specs gab es rund 30 solcher Stellen.

**Der Kommentar, der es schlimmer machte:** `wp.e2e.spec.ts` schrieb, die API
sortiere alphabetisch und `mandanten[0]` sei deshalb Beispiel GmbH. Das war
eine **Annahme als Befund formuliert** — sie traf nicht zu, es gab kein
`orderBy`. Der Kommentar ist korrigiert und benennt jetzt die Quelle der
Garantie.

**Behoben:** `MANDANTEN_SORTIERUNG` (Firmenname, dann ID als eindeutiger
zweiter Schluessel — zwei Mandanten duerfen denselben Firmennamen haben),
angewandt auf alle sechs Stellen.

**Nachweis der Wirkung:** Nach dem Einbau liefert die API
`Beispiel GmbH | Demo GmbH | Test AG`. Das verschiebt, was `mandanten[0]`
ist — und legt damit zwei weitere Fehler offen, die vorher nur Latenz hatten
(siehe Nachtrag 11).

#### Eine Lücke, die erst der Laufzeittest findet

Die erste Fassung stand als Objekt:

```ts
orderBy: { mandant: { firmenname: 'asc' }, mandantId: 'asc' }
```

`npm run typecheck` war **gruen**, `npx eslint src` auch. Zur Laufzeit:

```
Argument `orderBy`: Invalid value provided.
Expected UserMandantRoleOrderByWithRelationInput[], provided Object.
```

Prisma typisiert `orderBy` als `Input | Input[]`, deshalb akzeptiert `tsc`
beide Formen — fuer eine Sortierung ueber eine **Relation** verlangt Prisma 5
aber das Array. Der Login lief danach mit HTTP 500. **Merksatz:** Ein
statischer Check kann eine Form akzeptieren, die die Bibliothek zur Laufzeit
ablehnt; bei Datenbank-Interaktionen ist der Aufruf selbst der Test.

---

### Nachtrag 2026-10-13 (Nachtrag 11): Ein gruener Test, der den Fehler nicht ausloesen konnte

**Befund:** `pagination.e2e.spec.ts` baute seinen Testbestand so auf:

```ts
const vorhandenListe = /* GET /api/bilanz?...&geschaeftsjahr=2090 */;
for (let gj = 2030; gj < 2030 + Math.max(0, 6 - vorhandenListe.length); gj++) { /* POST */ }
```

Gezaehlt wurde die Menge fuer **GJ 2090** — erzeugt werden sollte der Bereich
**2030-2035**. Zwei verschiedene Mengen. Solange 2090 leer war, stimmte der
Zufall; sobald dort etwas lag, wurde zu wenig oder nichts erzeugt, und der
Test meldete an anderer Stelle „Zu wenig Daten" — eine Meldung, die die
eigentliche Ursache nicht nennt.

**Der ausgeloeste Fehler:** Nach dem Einbau der Sortierung (Nachtrag 10)
bekommt `mandanten[0]` Beispiel GmbH — und genau dort hat `bilanz.e2e`
GJ 2031 angelegt. Der Test wollte 2031 erneut anlegen. Negativprobe, mit
zurueckgebautem Fix:

```
× POST … GJ 2031 konnte nicht angelegt werden: 400
```

Behoben: der Bestand wird je Jahr im Zielbereich geprueft, vorhandene Jahre
werden uebersprungen statt doppelt angelegt, und die Fehlermeldung nennt
Status **und** Body — `409` heisst „GJ belegt", `400` „Validierung", und die
Meldung unterschied das vorher nicht.

**Und der Status, der sich dabei zeigte:** `400`, nicht `409`. Ein
Eindeutigkeitskonflikt auf `(mandantId, geschaeftsjahr)` ist ein
**Zustandskonflikt**, keine fehlerhafte Anfrage (RFC 9110 §15.5.10). 400
sagt „deine Eingabe ist falsch" — bei einem Klick auf „Bilanz anlegen"
fuehrt das in die Irre, weil der Nutzer seine Eingaben prueft statt die
Frage zu beantworten, ob das Jahr schon belegt ist.

Umgestellt auf 409 in **fuenf** Stellen: Bilanz, GuV, Anhang und zwei in der
Konsolidierung. Das Frontend zweigt an keiner Stelle auf 400, ein
Playwright-Test ebenfalls nicht.

**Die eigentliche Luecke dabei:** Nach der Umstellung blieben **alle 686
Tests gruen**. Weil **kein Test diesen Status je behauptet hatte** — die
Aenderung fiel niemandem auf, auch nicht mir. Vier Tests behaupten ihn jetzt
(Bilanz, GuV, Anhang, Konsolidierung), und der erste davon war die
Negativprobe fuer die Umstellung selbst:

```
- Expected  409
+ Received  400
```

#### Eine eigene Fehlannahme, die messbar war

Der erste Verdacht war der Throttler: 429, weil alle Specs einen Server auf
`:3000` und dieselbe Client-IP teilen. Gemessen statt vermutet:

| Fenster | Requests |
|---|---|
| 60 s, voller Suite-Lauf | **322** |

Die Grenze liegt bei 600 (`app.module.ts`), der `SkipThrottle` auf `/health`
ausgenommen — was ein Test mit `/health` **nicht** haette zeigen koennen.
Hypothese **widerlegt**, kein Fehler behoben.

Zweiter Versuch, die Ursache des *erstmalig* aufgetretenen, nicht
reproduzierten Fehlschlags festzustellen: nicht gelungen. Der obige Fall ist
die **deterministische** Form desselben Fehlerbildes und mit demselben Eingriff
geschlossen; dass er die urspruengliche Ausloesung war, ist **nicht belegt**.

---

## 1. Compliance-Übersicht

| Anforderung | GoBD-Referenz | Status | Beleg |
|---|---|---|---|
| Unveränderbarkeit der Bücher/ Aufzeichnungen | § 146 AO + § 147 AO + GoBD Rz. 10.1 | ⚠️ Teilweise | WORM-Object-Lock COMPLIANCE-Mode + 3650 Tage Retention + Löschsperren (Nachtrag 5) + monotone Bearbeitungssperre (Nachtrag 6). **Offen:** signierte Bilanz/GuV/Anhang erzeugen keinen Signature-Record und keinen Zustand — siehe Nachtrag 6 |
| Vollständigkeit | § 146 Abs. 1 AO + GoBD Rz. 10.1 | ✅ | Audit-Trail mit Vorher/Nachher-Snapshots |
| Mandant-Trennung | § 146 Abs. 2 AO | ✅ | Repository-Pattern + MandantGuard + ESLint |
| Aufbewahrungsfristen 10 Jahre | § 147 Abs. 3 AO + § 257 HGB | ✅ | WORM-Retention 3650 Tage + Löschsperren (Bilanz/GuV/Anhang nur DRAFT, Mandant mit Bestand 409, Konsolidierungseinheit ab COMPLETED) + **Archivierung statt Löschung** (Nachtrag 7): keine neuen Belege, Bestand bleibt lesbar und nachvollziehbar |
| Datenzugriff (GDP-Zu, BMF 2019) | GoBD Rz. 10.2 | ✅ | E-Bilanz-XBRL-Export + DATEV-Export + PDF-Download |
| Datenträgerüberlassung (Z3) | GoBD Rz. 11 | ✅ | E-Bilanz-XBRL + DATEV-EXTF-Export |
| Maschinelle Auswertbarkeit (Z1, Z2) | GoBD Rz. 10.2 | ✅ | DB-Direct-Read + strukturierte Exporte |
| Archivierung von Belegen | GoBD Rz. 9.5 | ✅ | S3/WORM mit SHA-256-Hash-Verifikation |
| Verfahrensdokumentation | GoBD Rz. 10.3 | ⚠️ Teilweise | Siehe TODO § 8 |
| Datenschutz (DSGVO) | Art. 5, 25, 32 DSGVO | ✅ | Mandant-Trennung + Audit-Trail + Pseudonymisierung möglich |
| Internes Kontrollsystem (IKS) | GoBD Rz. 10.1 | ⚠️ Teilweise | Audit-Trail vorhanden, IKS-Doku fehlt (TODO § 8) |

**Zusammenfassung**: 8 von 11 Anforderungen vollständig erfüllt, 3 in Arbeit.

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
  erkennung **innerhalb** der Kette
- Endpoint: GET /api/audit/integrity für Wirtschaftsprüfer
```

> **Einschränkung, gemessen 2026-10-16 (Nachtrag 24).** Die Kette erkennt
> eine Löschung **im Ketteninneren** als `BROKEN` — belegt. Sie erkennt eine
> Löschung **am Kettenende nicht**: die verbleibende Kette ist wieder in sich
> schlüssig und ohne externen Anker nicht widerlegbar. Die Formulierung
> „für Manipulationserkennung" war deshalb zu weit gefasst und ist hier auf
> den tatsächlich abgedeckten Bereich eingeschränkt. Gegenmaßnahmen erfordern
> einen Anker (WORM-Objekt, TSA-Zeitstempel) und damit eine
> Architekturentscheidung — siehe Nachtrag 24.

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

### 7.1 Quality Gates (Stand 2026-10-13)

| Metrik | Stand |
|---|---|
| Backend tsc-Errors | 0 (`npm run typecheck`, inkl. `tsconfig.test.json`) |
| Backend eslint-Warnings | 0 (`--max-warnings 0`) |
### Nachtrag 2026-10-16 (Nachtrag 23): Die CI hat eine Regression gefunden, die lokal durchging

**Befund:** Lauf `38876133530` auf dem Commit mit Nachtrag 20 war **rot**:

```
FAIL  e2e/betrag-grenzen.e2e.spec.ts > bilanzsummeVorjahr mit 24 Stellen -> 400
AssertionError: expected 500 to be 400
```

**Ursache — meine eigene Änderung von zwei Stunden vorher.** Das Muster,
das ich in Nachtrag 20 gelockert habe, um die deutsche Schreibweise
zuzulassen, hatte im zweiten Zweig ein `\d+` **ohne Zifferngrenze**:

```
vorher (zu streng):  ^-?\d{1,16}(?:[.,]\d{1,2})?$
nach der Lockerung:  ^-?\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?$  |  ^-?\d+(?:[.,]\d{1,2})?$
```

Damit war genau der 500er aus Nachtrag 16 — den diese Änderung eigentlich
beheben sollte — wieder ausloesbar. Und weil `bilanzsummeVorjahr` vom
Frontend ohnehin **nicht bedienbar** ist, fiel der Fehler lokal nicht auf:
es gab keinen lokalen Weg, der die Zeile ausgeloest haette.

**Behoben** an der Spaltenbreite festgemacht, nicht am Gefuehl:

```
^-?\d{1,3}(?:\.\d{3}){0,5}(?:,\d{1,2})?$  |  ^-?\d{1,16}(?:[.,]\d{1,2})?$
```

Geprueft gegen die Datenbank statt gegen mein Gefuehl: 16 Ziffern kommen
durch, 19 und 24 werden abgelehnt.

**Merksatz:** Ein Muster zu lockern, um einen Fall zuzulassen, prueft den
Fall, den man im Kopf hatte — nicht den, den man verschlossen hat. Und
ein Test, der einen Eingabeweg voraussetzt, den die Oberflaeche nicht
anbietet, ist ein Test, der nur in der CI etwas sagen kann.

**Negativprobe:** Auf die ungegrenzte Fassung zurueckgesetzt → **3 Tests
rot**, darunter exakt der aus der CI.

---

| Backend Unit-Tests | **758 / 758 grün** (81 Dateien; zweimal hintereinander gefahren) |
| Globalskript-Wächter | ✅ `ts.isExternalModule` über alle `.ts` unter `src/` und `e2e/` |
| Frontend tsc-Errors | 0 |
| Playwright e2e | **68 / 68 grün**, 0 übersprungen |
| Migrationen auf leerer DB | 8 angewandt, `migrate diff` ohne Abweichung |
| Mandantenlisten-Reihenfolge | ✅ zugesichert (`MANDANTEN_SORTIERUNG`), 6 Abfragen |
| Mandant-Picker WP-Seite | ✅ schreibt `localStorage`, 1 Playwright-Test |
| Archivierte Mandanten | ✅ 9 Schreibpfade gesperrt (5 WP + 4 Signatur), Lesen offen |
| Signatur-Sichtbarkeit | ✅ `UNSIGNIERT`/`SIGNIERT`/`ABWEICHEND` + Badge — **Nachtrag 36: war für Entities mit Jahresabschluss-Bezug defekt (blieb auf `UNSIGNIERT`) und ist behoben; das grüne Häkchen galt nur für Entities ohne Bezug** |
| Signatur-Record je Entität | ✅ `entityType`+`entityId`, `id` wird durchgereicht — **Nachtrag 36: Records tragen genau EINE Achse (`jahresabschlussId` ODER `entityType`+`entityId`); beide werden jetzt gelesen** |
| Konflikt bei belegtem GJ | ✅ 409 (RFC 9110 §15.5.10) in 5 Stellen, 4 Tests |
| Jahresabschluss-Aggregat | 🟡 **anlegen, lesen, abschließen und signieren** (Nachtrag 28/30/35: POST + GET, `POST :id/finalize`, `signAbschluss` mit `FINALIZED`-Sperre). Saldoabgleich A.V.↔GuV **sperrt** jetzt, mit schriftlich begruendetem Ausweg (Nachtrag 59, Entscheidung 1); `SIGNED → SUBMITTED → PUBLISHED` haben keinen Schreibpfad (TODO-8.10); Entwurfs-PDF landet im 10-Jahres-WORM (TODO-8.9, vor dem Pilot zu entscheiden) |
| Anhang-Platzhalter | ✅ `offenePlatzhalter` in der Detailantwort, 5 Unit + 1 e2e |
| Cursor-Pagination | ✅ `id`-Tiebreaker in 6 Stellen zentral, Decoder strikt, 2 e2e |
| Betragsgrenzen | ✅ schema-abgeleitet (`Decimal(18,2)`, `Int4`), 6 e2e |
| Sitzungsdauer | ✅ `apiFetch` erneuert bei 401 (Single-Flight); 2 Playwright-Tests inkl. Gegenprobe |
| Betragseingabe | ✅ deutsche Schreibweise (`1.500` = 1500), 1 Playwright-Test |
| Status-Anzeige | ✅ `BILANZ_DATENSTATUS` + Übersetzung, Fallback im Frontend, 3 Unit + 1 Browser-Nachweis |
| Filter-Parameter | ✅ `GeschaeftsjahrPipe` + `IsoDatumPipe`, 15 e2e |
| Hash-Chain verifizierbar | 🟡 `sequenz`-basiert, `verifyIntegrity()` lückenlos **im Ketteninneren**. Loeschung am Kettenende nicht erkennbar — kein externer Anker (Nachtrag 24, gemessen) |
| WORM-Audit-Script | ✅ |
| CI (backend + frontend) | ✅ beide Jobs grün |

### 7.2 Pilot-Phase-2 (3 Kanzleien + 15 Mandanten)

- Alle Pilot-Kanzleien sind live und produzieren Daten
- Keine Datenverluste in der Pilot-Phase
- Audit-Trail lückenlos seit Pilot-Start

---

## 8. Offene TODOs für externen Audit

| ID | Aufgabe | Owner | Frist |
|---|---|---|---|
| TODO-8.1 | **Entwurf liegt vor** — `docs/VERFAHRENSDOKUMENTATION.md` (Nachtrag 64): das Verfahren ist vollstaendig aus dem Quelltext abgeleitet und jede Aussage mit einer Stelle im Code belegt. **Die Freigabe durch Compliance steht aus** (8 offene Punkte, u. a. Zuständigkeitszuordnung und Zuordnungsrichtlinie) | Compliance | Q4/2026 |
| TODO-8.2 | **Entwurf liegt vor** — `docs/IKS-Beschreibung.md` (Nachtrag 64): 32 Kontrollen entlang des Verfahrens, jeweils mit Risiko, Kontrolle, **technischem Nachweis** (dem wiederverwendbaren Test) und Verantwortlichkeit. **Die Freigabe durch Compliance und den Wirtschaftspruefer steht aus**; die Wirksamkeitsbeurteilung ist Aufgabe des WP | Compliance + WP | Q4/2026 |
| TODO-8.3 | Externer GoBD-Auditor beauftragen | Geschäftsführung | Q4/2026 |
| ~~TODO-8.4~~ | ~~Schema-Migration für Audit-Hash-Chain ausführen~~ — **erledigt in Nachtrag 66**: das Backfill-Skript war **kaputt** und hätte die Kette zerstört (Nachbau der Hash-Berechnung → BigInt-Absturz, falsche Reihenfolge, `prevHash` aus einer lokalen Variablen). Es benutzt jetzt **eine** Implementierung — `AuditIntegrityService.computeHashForEntry()` — und ist durch einen e2e-Test abgesichert. **Dabei kam ein weiterer Befund heraus (Nachtrag 67): die Integritätsprüfung meldete „BROKEN" für eine intakte Kette, sobald eine zweite Kanzlei Audit-Einträge hat.** **Der Lauf auf der Produktionsdatenbank bleibt ein Ops-Schritt** | DevOps | Skript fertig, Ausführung durch Ops |
| TODO-8.5 | Cross-Region-Replikation (S3 + DB) | DevOps | Sprint 5+ |
| ~~TODO-8.6~~ | ~~Automatischer monatlicher Restore-Test in CI~~ — **erledigt in Nachtrag 65**: `.github/workflows/restore-test.yml` laeuft **monatlich** (1. um 02:17 UTC) und auf Zuruf: Dump → Restore → Pruefung (alle Migrationen angewendet, Zeilenzahlen aller 28 Tabellen, Audit-Hash-Kette im wiederhergestellten Bestand **intakt**, WORM-Audit gruen). Das Skript `backend/scripts/restore-test.sh` ist versioniert und lokal lauffaehig. **Die Grenze ist ausdruecklich:** die CI beweist die **Prozedur**, nicht das Produktions-Backup — das prueft der Produktionslauf (Hetzner-Snapshot, DR-Plan Abschnitt 4) | DevOps | erledigt (Produktionslauf bleibt Ops) |
| ~~TODO-8.7~~ | ~~`assertMandantAccess` in 10 Services — Tiefenschutz oder toter Code?~~ — **erledigt in Nachtrag 58**: es war **weder** Tiefenschutz **noch** toter Code, sondern **zwoelfmal derselbe Code** (12 Kopien in 12 Services). Die Antwort auf die gestellte Frage ist damit eine dritte: *ungenutzter Tiefenschutz*. Jetzt gibt es **eine** Implementierung (`common/utils/mandant-zugriff.ts`), und ein Test beweist, dass sie greift, wenn der Guard umgangen wird | — | erledigt |
| ~~TODO-8.8~~ | ~~Audit-Trail "fire and forget" (51 Stellen)~~ — **erledigt in Nachtrag 56**: gemessen über die öffentliche API fehlte der Audit-Eintrag in **80 %** der Fälle, wenn die Antwort beim Client war; weitere 15 % hatten noch keinen Hash. Behoben: alle 51 Aufrufstellen warten jetzt, die Hash-Kette wartet auf den eigenen Eintrag, und `/health/ready` meldet das Alter des ältesten ungehashten Eintrags. Die in Nachtrag 31 vorgeschlagene **Transaktion** (Fachvorgang + Audit atomar) bleibt als Restidee dokumentiert — sie widerspricht der Reihenfolge der Hash-Kette | — | erledigt |
| ~~TODO-8.9~~ | ~~Entwurfs-PDF: darf ein DRAFT mit 10-Jahres-Object-Lock im Beweis-Archiv landen?~~ — **erledigt in Nachtrag 61**: **Variante b** (vom Nutzer bestaetigt): Entwuerfe bekommen einen eigenen `entityType` (`*_PDF_ENTWURF`), einen eigenen Key-Praefix (`entwuerfe/mandant/…`) und **keinen** Object-Lock. Ein Entwurf ist ein Arbeitsstand — er wird geaendert, verworfen, neu erzeugt; unwiderruflich archiviert waere er ein „Beweis" fuer einen Stand, den niemand freigegeben hat. Die Gegenprobe (VALIDATED) geht unveraendert ins Beweis-Archiv | — | erledigt |
| ~~TODO-8.10~~ | ~~`SIGNED → SUBMITTED → PUBLISHED` haben keinen Schreibpfad~~ — **erledigt in Nachtrag 62**: die Zustandsmaschine hat jetzt einen Schreibpfad (`POST :id/einreichen`, `POST :id/veroeffentlichen`). Die Bestellnummer ist **Pflicht** (sie ist der einzige Beleg fuer die Einreichung) und **eindeutig** (`@unique` in der Datenbank — der Kommentar versprach es, das Schema erzwingte es nicht). Die Anwendung reicht weiterhin **nicht selbst ein** (es gibt keine Submission-API des Verlags); sie protokolliert, was die Kanzlei draussen getan hat | — | erledigt |
| ~~TODO-8.11~~ | ~~Kein Wächter für tote Knöpfe~~ — **erledigt in Nachtrag 39**: `tote-knopfe.spec.ts` prüft den gesamten Quellbaum, ohne Ausnahmeliste | — | erledigt |
| ~~TODO-8.12~~ | ~~Der Signier-Knopf war an 5 Stellen ohne Rollenprüfung sichtbar~~ — **erledigt in Nachtrag 57**: die Sichtbarkeit hängt jetzt an **einer** Stelle (`lib/session.ts`) und bildet den `RolesGuard` mandantenbezogen ab. Die TODO-Formulierung war dabei ungenau: `sign-bilanz/guv/anhang` erlauben **auch** `STEUERBERATER`, nur `sign-abschluss` ist WP-only — gemessen am Controller, nicht angenommen | — | erledigt |
| TODO-8.13 | **Gegenprobe negativ — vorerst keine Änderung.** Zwei echte Instanzen auf derselben Datenbank, 60 Schreibvorgänge abwechselnd auf beide verteilt: `integrity` → **OK**. **Nachtrag 63: die Gegenprobe wurde nach der Audit-Umstellung (Nachtrag 56) wiederholt** — die alte Messung stammte von vor dem Fix. Vier Läufe, je 60/60 mit HTTP 201, `integrity` → **OK** (335 / 398 / 461 / 524 Einträge geprüft). Die Selbstsortierung aus Nachtrag 41 deckt auch den Mehrinstanzfall, weil die Reihenfolge aus der Datenbank kommt und die Berechnung idempotent ist. Restrisiko: ein schmales Fenster (siehe Nachtrag 45), nicht beobachtet | Dev | beobachten, M4 |
| ~~TODO-8.14~~ | ~~Eintrag `seq=249` ungeklärt~~ — **erledigt in Nachtrag 54**: es war die **Datenbank** (Prisma `SetNull` auf `AuditLog.mandantId` beim Löschen eines Mandanten), nicht ein fremder Prozess. Der Hash schützt jetzt den Inhalt, nicht die veränderbaren Fremdschlüssel | — | erledigt |
| ~~TODO-8.14~~ | ~~Zweiter Schreiber auf der Audit-Kette identifizieren~~ — **erledigt in Nachtrag 54**: es war die **Datenbank** (Prisma `SetNull` auf `AuditLog.mandantId` beim Löschen eines Mandanten), nicht ein fremder Prozess. Der Hash schützt jetzt den Inhalt, nicht die veränderbaren Fremdschlüssel | — | erledigt |
| ~~TODO-8.15~~ | ~~Komponentensignatur am offenen Aggregat: zulaessig oder unzulaessig?~~ — **erledigt in Nachtrag 60**: **zulaessig, aber mit trennendem Modellfeld** (vom Nutzer bestaetigt): `signature.signaturEbene` = `ABSCHLUSS` (Endabnahme) oder `BESTANDTEIL` (gepruefter Bestandteil). Vorher lag eine Komponentensignatur auf der `jahresabschlussId`-Achse und war damit von einer Abschluss-Signatur **nicht unterscheidbar** — ein Auditor las „der Jahresabschluss ist signiert", obwohl nur die GuV geprueft war | — | erledigt |

---

### Nachtrag 2026-10-17 (Nachtrag 35): Ein Wirtschaftsprüfer konnte einen nie abgeschlossenen Jahresabschluss signieren

**Der schwerwiegendste Fund dieser Prüfrunde.** Gefunden nicht durch Lesen,
sondern dadurch, dass eine tote Strecke nach dem Aktivwerden scharf wurde.

**Der Zusammenhang.** Nachtrag 27: Zu `signatur.signAbschluss()` und
`pdf/abschluss/:id/generate` gab es keinen Jahresabschluss. Beides war
vorhandener, aber unerreichbarer Code. Mit Schritt 1–3 wurde der
Jahresabschluss angelegt — damit wurden diese beiden Pfade aktiv, und
**beide hatten null Tests**. `grep -rn "sign-abschluss\|abschluss/:id/generate" e2e/`
liefert bis heute nichts.

#### Befund 1: qeS auf einem `DRAFT`-Abschluss — gemessen

```
$ POST /api/auth/login  (wp@kanzlei.de)
$ GET  /api/jahresabschluss/<id>
  status = DRAFT, abgeschlossenAm = null
$ POST /api/signatur/sign-abschluss   (P12-Testzertifikat)
HTTP 200
  {"signatureId":"533ae411-1ca9-417e-a5a5-db649ced237c",
   "signedPdfBase64":"JVBERi0xLjMK..."}
```

Eine qualifizierte elektronische Signatur bescheinigt die
**Vollständigkeit** eines Dokuments (§ 126 BGB). Hier wurde sie auf einen
Abschluss gesetzt, der nie abgeschlossen wurde — und weil das signierte PDF
danach mit `COMPLIANCE`-Object-Lock für **10 Jahre** in WORM liegt
(`retentionExpiresAt: 2036-10-14`), ist der Schaden nicht rücknehmbar.

**Ursache.** `signInternal` prüft in `assertEntityExists` für den Fall
`'Abschluss'` nur die Existenz:

```ts
const e = await this.prisma.jahresabschluss.findFirst({
  where: { id: entityId, mandantId },
  select: { id: true },        // ← kein status
});
```

Auf den **Zustand** prüft an keiner Stelle etwas.

**Behoben:** `signAbschluss` verlangt `FINALIZED`, sonst 409 mit dem
Hinweis, zuerst „Abschluss prüfen und abschließen" auszuführen.

**Warum die Sperre dort und nicht in `signInternal`:** Bilanz, GuV und
Anhang werden auch im `DRAFT` signiert — dort bescheinigt die Signatur die
*Sichtung*, nicht den Abschluss. Das ist eine andere Bedeutung und darf
nicht mitverstreckt werden.

#### Befund 2: `signiertAm` existierte, und niemand schrieb es

`Jahresabschluss.signiertAm` ist eine Spalte im Schema. **Keine Zeile im
gesamten Projekt schreibt sie.** Zustand nach der Signatur oben:

```json
{ "status": "DRAFT", "abgeschlossenAm": null,
  "signiertAm": null,                          ← obwohl signiert
  "wormObjectKey": "…/abschluss-signed/….pdf" } ← signiertes Objekt
```

Ein Datensatz, der ein signiertes WORM-Objekt führt und zugleich
`signiertAm: null` meldet, widerspricht sich selbst.

**Bemerkenswert ist die Asymmetrie.** Bei Bilanz/GuV/Anhang gibt es diese
Spalte gar nicht — dort wird `signiertAm` aus dem jüngsten
`Signature`-Datensatz **abgeleitet** (`signatur.service.ts:246`). Beim
Jahresabschluss gibt es nur die Spalte und keine Ableitung.

**Behoben:** Nach erfolgreicher Signatur werden `signiertAm` und
`status: 'SIGNED'` geschrieben. Damit ist `DRAFT → FINALIZED → SIGNED`
implementiert.

**Bleibende Lücke, ausdrücklich nicht verschwiegen.** Das Schreiben von
`signiertAm`/`status` ist eine **zweite, getrennte** Transaktion nach
`signInternal`. Schlägt sie fehl, liegt das signierte WORM-Objekt und der
Signature-Datensatz vor, während der Abschluss auf `FINALIZED` steht —
also genau der selbstwidersprüchliche Zustand, den dieser Nachtrag
beschreibt, nur über einen anderen Weg.

Der Schaden ist begrenzt, aber nicht null: **Der eigentliche Nachweis
liegt im Signature-Datensatz**, und der wird (seit dem Fix vom
2026-10-11) zusammen mit dem Manifest atomar geschrieben. Betroffen wäre
nur das denormalisierte Statusfeld.

Sauber wäre, das Statusupdate in dieselbe Transaktion zu legen. Das
geht nicht ohne Umbau von `signInternal`, weil der dortige Transaktions-
umfang die Manifest-Erzeugung umfasst — das ist ein eigener Vorgang und
gehört nicht in diese Runde. Bewiesen ist der Zustand **nicht**, nur der
Code gelesen; eine Messung würde einen Fehler in der Update-Anweisung
brauchen.

#### Befund 3 (nicht behoben): `SIGNED → SUBMITTED → PUBLISHED` haben keinen Schreibpfad

Das Schema sieht `SIGNED | SUBMITTED | PUBLISHED` vor, der TypeScript-Typ
kennt sie, `de-DE.json` hat deutsche Beschriftungen („Signiert",
„Eingereicht", „Veröffentlicht"), und die Oberfläche rendert sie. **Kein
Code erreicht sie außer `SIGNED` nach der gerade ergänzten Signatur.**
`banzBestellnummer` und `veroeffentlichtAm` sind ebenfalls unbeschrieben.

Das ist kein Defekt, sondern eine **Lücke** — die Publikation zum
Bundesanzeiger ist noch nicht gebaut (M4). Sie steht hier, damit die
Beschriftungen nicht den Eindruck einer fertigen Kette erzeugen.

#### Befund 4 (Fachfrage): Ein `DRAFT`-Abschluss legt ein 10-Jahres-Objekt an

Gemessen, **bevor** die Signatur oben überhaupt stattfand:

```
$ GET  /api/jahresabschluss/<id>   →  status = DRAFT, abgeschlossenAm = null
$ POST /api/pdf/abschluss/<id>/generate
HTTP 200
{ "wormObjectKey":"…/abschluss/2085/….pdf",
  "retentionExpiresAt":"2036-10-14T20:11:01.973Z",   ← COMPLIANCE, 10 Jahre
  "sizeBytes":6297 }
```

`generateAbschlussPdf` prüft ebenfalls **keinen Zustand** und legt das
Ergebnis in denselben WORM-Bucket mit demselben Object-Lock ab wie ein
veröffentlichtes Dokument. Ein Entwurf und ein Archivdokument sind am
Objekt nicht unterscheidbar.

**Hier wird bewusst nichts geändert.** Die Frage „darf ein Nutzer eine
Vorschau des Entwurfs drucken?" ist eine Produktentscheidung, keine
Fachregel, die ich erfinden darf. Sicher ist nur: eine **Vorschau** gehört
nicht in ein zehn Jahre gesperrtes Beweis-Archiv. Zu entscheiden ist:

| Variante | Bedeutung |
|---|---|
| a) Sperren | `generateAbschlussPdf` verlangt `FINALIZED`; Entwurfsdruck nur über einen anderen, nicht gesperrten Weg |
| b) Unterscheiden | Entwurfs-PDF unter eigenem `entityType` und **ohne** Object-Lock; Archivdokument unverändert |
| c) Beides | Entwurf erzeugen, aber sichtbar als „Entwurf — kein Nachweis" kennzeichnen |

#### Nebenbefund: `finalize` lieferte 201 Created

Beim Schreiben der Signatur-Spec fiel auf, dass `POST /jahresabschluss/:id/finalize`
**201 Created** antwortet. Abschließen ist ein Übergang auf einem bereits
vorhandenen Aggregat, keine Erstellung. Von 37 Aktions-Routen des Projekts
hatten alle übrigen ein `@HttpCode(HttpStatus.OK)` — `bilanz/:id/validate`
mit erklärendem Kommentar. Der Jahresabschluss-Controller war die einzige
Ausnahme, **obwohl er nach demselben Muster geschrieben war**.

**Negativprobe** (Sperre und Status-Update entfernt, neu gestartet):

```
× Signieren eines DRAFT-Abschlusses → 409
    expected 200 to be 409
× nach der verweigerten Signatur liegt KEIN signiertes WORM-Objekt
    expected [ Array(1) ] to have a length of +0 but got 1
× Signieren eines FINALIZED-Abschlusses → 200, Status wird SIGNED
    expected 'FINALIZED' to be 'SIGNED'
```

Der zweite Test ist der wichtigste: Er prüft nicht den Statuscode,
sondern das **Artefakt**. Eine Sperre, die *nach* dem WORM-Upload greift,
lässt den ersten Test grün und hinterlässt trotzdem das irreversible
Objekt.

---

### Nachtrag 2026-10-17 (Nachtrag 36): Nach dem Signieren blieb „UNSIGNIERT" stehen — der Leser kannte nur eine von zwei Achsen

**Direkte Folge von Nachtrag 35, und die Ursache ist dieselbe Achsenentscheidung.**

#### Der Fund

Beim Messen von Nachtrag 35 (eine Bilanz signieren, die zu einem
Jahresabschluss gehört) fiel auf, dass die Statusanzeige danach
`UNSIGNIERT` blieb:

```
POST /api/signatur/sign-bilanz   ->  HTTP 200
   (signiertes PDF liegt mit 10-Jahres-Object-Lock in WORM)

GET /api/signatur/status?entityType=Bilanz&entityId=<bilanzId>
  status:           "UNSIGNIERT"
  anzahlSignaturen: 0

DB: { entityType: null, entityId: null,
      jahresabschlussId: "317a2dd2-a738-4fe2-bf18-ea26012f6a58" }
```

#### Ursache

`Signature` trägt laut Schema **genau eine von zwei Bezugsachsen**:

```prisma
// Ein Record traegt deshalb GENAU EINE von zwei Bezugsachsen:
//   * Jahresabschluss-Signatur -> `jahresabschlussId`
//   * Entitaeten-Signatur       -> `entityType` + `entityId`
entityType             String?
entityId               String? @db.Uuid
jahresabschlussId      String?   @db.Uuid
```

`resolveJahresabschlussId` setzt konsequent die *andere* Achse auf `null`:

```ts
entityType: abschlussId ? null : entityType,
entityId:    abschlussId ? null : entityId,
```

Gehört die signierte Bilanz zu einem Jahresabschluss, landet der Record auf
der Abschluss-Achse. Der Leser aber fragte ausschließlich die
Entitäten-Achse:

```ts
// SignatureRepository.findByEntity — VOR der Reparatur
where: { entityType, entityId },
```

**Damit fand er genau die Datensätze nicht, die der Fix vom 2026-10-13
gerade erst repariert hatte.** Damals wurde bei einer Bilanz-Signatur
gar kein Record geschrieben (toter `signatureId`, Nachtrag vom 2026-10-13).
Der Fix holte den Record zurück — und stellte ihn auf eine Achse, die
niemand abfragt.

**Betroffen sind alle Leser**, weil sie dieselbe Methode benutzen:
`getSignaturStatus` (Status-Badge) und `listSignaturen` (Signaturliste).
Damit war auch die **`ABWEICHEND`-Erkennung** blind — sie setzt auf
`signaturen[0]` und hätte eine nachträgliche Datenänderung nie gemeldet.

#### Behoben

`findByEntity` berücksichtigt jetzt beide Achsen. Die Auflösung
Abschluss → Entität ist dieselbe wie in `resolveJahresabschlussId`; für
`entityType === 'Abschluss'` ist `entityId` bereits die Abschluss-ID.

```
GET /api/signatur/status?entityType=Bilanz&entityId=<bilanzId>
  status:    "SIGNIERT"
  anzahl:    1
  signiertAm: 2026-10-17T21:16:46.069Z
```

#### Negativprobe

Abfrage auf die Ein-Achsen-Form zurückgebaut, Server neu gestartet:

```
× Bilanz MIT Jahresabschluss-Bezug -> SIGNIERT
    expected 'UNSIGNIERT' to be 'SIGNIERT'   Received: "UNSIGNIERT"
× listSignaturen findet die gebundene Bilanz ebenfalls
    expected +0 to be 1
✓ Bilanz OHNE Jahresabschluss-Bezug -> SIGNIERT      ← bleibt grün
✓ Record liegt auf der jahresabschlussId-Achse     ← bleibt grün
```

**Dass zwei Tests grün bleiben, ist Teil des Belegs.** Der Fall ohne
Jahresabschluss war nie kaputt. Ein Test, der bei der Reparatur *alles*
rot werden lässt, prüft nicht die Fehlerklasse, sondern den Testlauf.

Der vierte Test hält ausdrücklich fest, dass der Record auf der
Abschluss-Achse liegt (`entityType === null`). Ohne diese Voraussetzung
wäre der zweite Test auch dann grün, wenn der Record auf der
Entitäten-Achse läge — und würde nichts Besonderes prüfen.

#### Nebenbefund: ein stiller Leerlauf im eigenen Test

Beim Schreiben der Spec stand im `afterAll`:

```ts
await prisma.signature.deleteMany({ where: { entityType: 'Abschluss', entityId: id } });
```

Das ist dieselbe falsche Achse — die Abfrage passte auf **keine Zeile**
und ließ alle Signatur-Datensätze liegen. TypeScript hat es nicht
gemerkt, Prisma nicht, der Test blieb grün. Ein `deleteMany`, das nichts
löscht, ist das harmlose Gesicht derselben Fehlerklasse wie die
falsche Leseabfrage: Beide sehen erfolgreich aus und tun nichts.

---


### Nachtrag 2026-10-17 (Nachtrag 37): Jahresabschluss-PDF — keine Fehlstellung, aber erstmals überhaupt geprüft

**Dieser Nachtrag meldet keinen Fund.** Er schließt eine Lücke, die beim
Abschluss von Nachtrag 35 und 36 aufgefallen ist: Die beiden
Jahresabschluss-PDF-Strecken waren — wie die Signaturstrecke — toter Code
ohne Tests. `grep -rn "abschluss/:id/generate\|abschluss/:id/download" e2e/`
lieferte nichts.

#### Geprüft und in Ordnung (gemessen, nicht gelesen)

`pdf-abschluss.e2e.spec.ts`, 6 Tests, über die öffentliche API:

| Fall | Ergebnis |
|---|---|
| Download vor dem Erzeugen | 404 mit Handlungshinweis (`/generate`), kein 500 |
| `POST /generate` | 200, WORM-Key, `sha256Hash` 64 Hex |
| `GET /download` | 200, `application/pdf`, Header `%PDF-`, > 1 KB |
| Cross-Mandant `generate` | 404 |
| Cross-Mandant hinterlässt **kein** WORM-Objekt im fremden Kontext | 0 Objekte |
| Cross-Mandant `download` | 404 (nicht 403 — der Kontext soll die Existenz nicht verraten) |

**Die Mandantentrennung hält.** Sie war nie getestet, aber sie war richtig.

#### Und doch zwei Negativproben — weil „alles grün" sonst nichts heißt

Sechs grüne Tests beweisen nur, dass nichts Auffälliges passiert. Sie
beweisen nicht, dass sie einen Rückschritt überhaupt bemerken würden. Also
jede der beiden Mandanten-Sperren einzeln entfernt:

| Entfernte Sperre | Ergebnis |
|---|---|
| `pdf.service.ts` → `assertEntityExists`, Fall `ABSCHLUSS`: `where: { id, mandantId }` → `{ id }` | **Cross-Mandant-Download → `expected 200 to be 404`** |
| `pdf.service.ts` → `generateAbschlussPdf`: `where: { id: abschlussId, mandantId }` → `{ id: abschlussId }` | **Cross-Mandant-Erzeugen → `expected 400 to be 404`** |

**Es sind zwei getrennte Sperren, und beide tragen.** Die eine schützt den
Download-Weg, die andere den Erzeugungs-Weg. Das ist Tiefenschutz, der sich
hier als zwei gleichlautende `findFirst`-Aufrufe darstellt — und genau
darum ist es einen Test wert, dass beide einzeln nachweislich wirken.

Der dritte Test (kein Objekt im fremden WORM-Kontext) blieb in **beiden**
Proben grün, weil die jeweils andere Sperre noch stand. Er ist bewusst
ergänzt: Ein 404 **nach** dem Upload wäre nur eine Verzögerung des Schadens,
und diese Fehlerklasse trat in Nachtrag 35 real auf.

#### Beim ersten Negativprobe ist mir dasselbe passiert wie in Nachtrag 34

Das erste Zurückbauen wurde per Textersetzung versucht und schlug fehl —
der Test blieb grün. Fast hätte ich geschlossen: „der Test erkennt die
Lücke nicht". Der Grund war eine verrutschte Zeilennummer im Skript, nicht
der Test. **Ein grüner Lauf nach einem fehlgeschlagenen Umbau ist kein
Befund, sondern eine kaputte Messung.** Erst als die zweite, zeilenweise
Variante griff, war die Aussage belastbar.

---

### Nachtrag 2026-10-17 (Nachtrag 38): Der Knopf „Jahresabschluss signieren" war tot — zum zweiten Mal derselbe Fehler

**Dieser Fehler war bereits einmal im Projekt.** Er wurde am 2026-10-05 behoben
und beim Bau der Jahresabschluss-Ansicht unverändert wiederholt.

#### Der Vorgänger (2026-10-05), wörtlich aus dem Quelltext

```jsx
{/* Bugfix 2026-10-05: Die GuV war über die Oberfläche
    nicht signierbar — `POST /signatur/sign-guv` existiert
    im Backend, hatte aber keinen Bedienweg. */}
<ExportActions entityType="guv" entityId={g.id} canSign … />

{/* Bugfix 2026-10-05: Der Anhang war über die Oberfläche nicht
    signierbar — `POST /signatur/sign-anhang` existierte, ohne
    dass die Schaltfläche irgendwo erreichbar war. */}
<ExportActions entityType="anhang" entityId={a.id} … canSign />
```

#### Was ich gebaut habe (2026-10-17)

```jsx
<button
  type="button"
  className="text-sm text-brand-600 hover:text-brand-700"
>
  {t('jahresabschluss.actions.signAbschluss')}
</button>
```

**Kein `onClick`.** Kein `data-testid`. Kein `ExportActions`. Ein Klick tat
nichts — ohne jede Rückmeldung, ohne Fehlermeldung, ohne Network-Request.
Die Schaltfläche sah aus wie eine Funktion.

Dazu war sie in **jedem** Zustand sichtbar, auch bei `DRAFT` — wo der Server
eine Signatur seit Nachtrag 35 mit 409 abweist.

#### Der ironische Teil: der Bedienweg existierte bereits

`ExportActions` akzeptiert `entityType: 'bilanz' | 'guv' | 'anhang' |
'abschluss'` und reicht für `abschluss` genau das durch, was der Dialog
braucht:

```tsx
<P12UploadDialog
  bilanzId={bilanzId} guvId={guvId} anhangId={anhangId}
  jahresabschlussId={entityType === 'abschluss' ? entityId : undefined}
  signTarget={entityType}
  onClose={() => setSignOpen(false)}
/>
```

Und `P12UploadDialog` nimmt `jahresabschlussId` + `signTarget="abschluss"`
längst entgegen. **Es fehlte ausschließlich der Aufruf.** Die Kette war
vollständig gebaut — und trotzdem unerreichbar.

#### Warum das wieder passieren konnte

`formulare.spec.ts` heißt ausdrücklich **„Fachformulare: Aktionen, nicht nur
Rendering"**. Es deckt aber nur:

| abgedeckt | nicht abgedeckt |
|---|---|
| Branding | Bilanz |
| Webhooks | GuV |
| API-Keys | Anhang |
| Audit | **Jahresabschluss** |

**Vier der acht Fachseiten werden auf gerendert geprüft, vier nicht.** Der
Wächter existiert und schaut an der falschen Stelle vorbei.

#### Behoben

Der Knopf ruft jetzt `setSignierZiel(j.id)` auf, was den
`P12UploadDialog` mit `jahresabschlussId` und `signTarget="abschluss"`
öffnet. Nach dem Schließen wird die Liste neu geladen — sonst bliebe die
Zeile auf „Finalisiert" stehen, während der Abschluss längst `SIGNED` ist.

Sichtbar ist er nur bei `FINALIZED`: das ist der einzige Zustand, den der
Server annimmt. Bei `SIGNED` steht statt dessen „Bereits signiert".

#### Zwei Tests, und was sie prüfen

1. **Der Knopf muss etwas tun.** Zuerst wird geprüft, dass der Dialog
   *nicht* sichtbar ist, dann geklickt, dann dass er sichtbar ist. Ohne
   `onClick` bliebe das DOM unverändert — der Test fällt genau dort durch,
   wo der Anwender sonst nur Ratlosigkeit sieht.
2. **Bei `DRAFT` ist er nicht sichtbar.** Der Knopf darf den Anwender nicht
   erst in einen Fehler laufen lassen, den er selbst nicht auslösen kann.

**Negativprobe:** `onClick` entfernt, neu gebaut, neu gestartet:

```
✓ Jahresabschluss anlegen und abschliessen
✓ ein nicht vollstaendiger Abschluss wird als Fehlschlag gezeigt
✘ der Signier-Knopf ist belegt und öffnet den P12-Dialog
    Error: der P12-Dialog hat sich nicht geoeffnet — der Knopf ist tot
✓ bei DRAFT ist der Signier-Knopf nicht sichtbar
```

#### Und was ich dabei verschwiegen hätte (TODO-8.12)

Der Knopf ist jetzt belegt — aber **er ist an fünf Stellen ohne
Rollenprüfung sichtbar**, während `POST /signatur/*` auf
`WIRTSCHAFTSPRUEFER` beschränkt ist. Ein STEUERBERATER trägt sein P12 hoch,
gibt das Passwort ein, drückt auf Signieren — und erhält 403.

Das ist das bestehende Muster (`canSign` wird in `BilanzForm`,
`BilanzListView`, `GuvListView` und `AnhangListView` bedingungslos gesetzt),
und ich habe es **nicht** an einer einzigen Stelle angebrochen: Fünf Stellen
umstellen und die Rollenprüfung einführen ist eine eigene Entscheidung mit
eigenen Folgen für die Oberfläche, keine Korrektur. `GET /api/auth/me`
liefert `mandanten: [{ rolle }]` — die Auswertung fehlt nur.

---

### Nachtrag 2026-10-17 (Nachtrag 39): Ein Wächter für tote Knöpfe — und fünf, die sich als Knopf aussehen, es aber nicht sind

**Nachtrag 38 hat einen einzelnen Knopf repariert. Dieser schließt die
Fehlerklasse.**

#### Warum statisch und nicht im Browser

Ein Browser-Test müsste jede Schaltfläche anklicken und prüfen, ob sich
etwas ändert. Das lässt sich nicht automatisieren, weil man nicht weiß, was
sich ändern **muss**. Ein Knopf ohne `onClick` hat per Definition keinen
Handler — und das steht im Quelltext.

`formulare.spec.ts` („Aktionen, nicht nur Rendering") deckt vier der acht
Fachseiten. Der Wächter läuft über den **gesamten Quellbaum**.

#### Die Regel

> Jedes `<button>` braucht `onClick` oder `type="submit"`.

#### Und: keine Ausnahmeliste

Beim Schreiben gab es **fünf** Kandidaten — sämtlich im Branding-Editor:

```jsx
<button type="button" className="rounded px-3 py-1.5 text-xs font-medium text-white"
        style={{ backgroundColor: 'var(--brand-primary, #2563eb)' }}>
  {t('branding.preview.samplePrimary')}
</button>
```

Vorschau-Muster („Beispiel Primärfarbe") in der Live-Vorschau der
Farbwahl. Sie sind nie klickbar gewesen — **aber sie waren `<button>`**,
also fokussierbar und von Screenreadern als Schaltfläche angesagt. Wer sie
mit dem Screenreader erreicht, hört „Schaltfläche, Beispiel Primärfarbe",
aktiviert sie — und nichts passiert.

Es gab zwei Wege: eine Ausnahmeliste führen, oder sie so rendern, wie sie
gemeint sind. Sie sind **Vorschauen**, keine Aktionen, also sind sie jetzt
`<span className="inline-block …">` — optisch identisch, nicht fokussierbar,
nicht als Knopf angesagt.

**Damit ist die Regel ohne jede Ausnahme durchsetzbar.** Das ist der Punkt:
Eine Ausnahmeliste wird wie jede handgepflegte Liste veralten und
still Falsch-Bestätigungen liefern (Nachtrag 32, `api-pfade`). Eine Regel,
die keine Ausnahme braucht, kann das nicht.

```
105 <button>-Elemente im Quellbaum · 105 mit onClick oder submit · 0 verdächtig
```

#### Zwei Negativproben — eine davon gegen den Wächter selbst

**1. Der ursprüngliche Fehler wiederhergestellt:**

```
✘ keine Schaltfläche ohne Handler
    Error: Schaltflächen ohne Wirkung:
    src/components/jahresabschluss/JahresabschlussView.tsx:278 →
      ein <button> ohne onClick und ohne type="submit" —
      der Knopf sieht wie eine Funktion aus und tut nichts
```

**2. Der Wächter auf einen Ordner ohne `.tsx` gezeigt** — der stille
Ausfall, gegen den die Zusicherung `gesamt > 50` steht:

```
✘ keine Schaltfläche ohne Handler
    Error: der Wächter hat keine <button>-Elemente gefunden —
      er prüft dann nichts und meldet trotzdem „grün"
```

Ohne diese Zusicherung wäre ein Wächter, der ein umbenanntes Verzeichnis
nicht mehr findet, **still grün** — das schlimmste Ergebnis, weil er
gezählt wird. Dasselbe Argument wie bei `api-pfade` (Nachtrag 32).

#### Was der Wächter nicht behauptet

Er sagt **nichts** darüber, ob ein `onClick` das Richtige tut.
`onClick={() => setNichts()}` gilt ihm als belegt. Er findet nur das, was
im Quelltext sichtbar ist: gar nichts.

---

### Nachtrag 2026-10-17 (Nachtrag 40): Rollen wurden mandantenübergreifend ausgewertet — die Vier-Augen-Kontrolle war für Mandanten mit gemischten Rollen nicht vorhanden

**Der schwerwiegendste Autorisierungsbefund dieser Prüfrunde.**

#### Der Fund

`RolesGuard` wertete **alle** Rollen des Users aus **allen** Mandanten
gemeinsam aus:

```ts
const userMandantRoles: MandantRole[] = user.mandanten.flatMap((m) => m.rolle);
const hasRole = requiredRoles.some((r) => userMandantRoles.includes(r));
```

Das Datenmodell ist das Gegenteil: `UserMandantRole` führt eine `mandantId`,
und `@@unique([userId, mandantId, rolle])`. **Die Rolle gehört zu einem
Mandanten.** Der Guard hat aus einer mandantenbezogenen Rolle eine globale
gemacht — und damit aus einer Kontrolle über einen Mandanten eine
Kontrolle über alle.

#### Gemessen, über die öffentliche API

Ein User mit

```
Beispiel GmbH → STEUERBERATER
Beispiel GmbH → WIRTSCHAFTSPRUEFER     ← nur hier ist er Wirtschaftsprüfer
Demo GmbH    → STEUERBERATER
Test AG      → STEUERBERATER
```

rief `POST /api/signatur/sign-abschluss` für **Test AG** auf:

```
HTTP 200
{"signatureId":"3ffa4b82-…", "signedPdfBase64":"JVBERi0xLjMK…"}
```

Er ist auf Test AG **kein Wirtschaftsprüfer**. Die Route ist mit
`@Roles('WIRTSCHAFTSPRUEFER')` ausschließlich der WP-Rolle vorbehalten —
genau der Endabnahme. Er hat den Abschluss eines fremden Mandanten
bescheinigt, für den er keine Bescheinigungsbefugnis hat.

**Der Schaden ist nicht ruecknehmbar.** Die Negativprobe zeigte **zwei**
Objekte im WORM mit COMPLIANCE-Lock — das signierte PDF und das
Zeitstempel-Token. Zehn Jahre.

#### Der Denkfehler, der es möglich machte

Der `RolesGuard` lief als globaler `APP_GUARD` **vor** dem `MandantGuard`
und hatte **keinen Mandantenkontext**. Es stand nur der globale Vektor zur
Verfügung, also *musste* er mandantenübergreifend arbeiten — er war nicht
böswillig, er hatte nichts anderes.

Und genau hier liegt die Merkwürdigkeit: **eine falsche Schlussfolgerung
war technisch erzwungen.** Die Rolle mandantenbezogen zu prüfen ging nicht,
weil die Information im Wächter nicht anlag. Wer den Wächter reparieren
wollte, musste zuerst die fehlende Information beschaffen.

#### Behoben

1. **`common/utils/mandant-kontext.ts`** — eine Quelle der Wahrheit für die
   Auflösung des Mandanten aus Pfad, Header, Query oder Body. Der
   `MandantGuard` benutzt sie jetzt ebenfalls (Verhalten unverändert).
   Zwei Wächter mit zwei Auflösungen wären zwei Fehlerquellen — genau das
   ist der Grund, warum `common/utils/status-transition.ts` existiert.
2. **`RolesGuard`** prüft die Rolle **des adressierten Mandanten**.

Für Routen **ohne** Mandantenkontext (Branding, API-Keys, Mandantenverwaltung
— 21 der 49 `@Roles`-Routen) bleibt das mandantenübergreifende Verhalten:
dort gibt es keinen Mandantenbezug, auf den man die Rolle einschränken
könnte. Diese Routen verhalten sich unverändert.

**Kein „nur bei WIRTSCHAFTSPRUEFER"**: Eine Ausnahme für genau diese Rolle
wäre der gemessene Fall, aber nicht die Ursache. Die Ursache ist die
Verwechslung von mandantenbezogener und globaler Rolle; sie betrifft jede
Rollenprüfung gleichermaßen.

#### Zwei Fehler, die erst die Tests zeigten

**1. `.find()` nahm die erste Rolle eines Mandanten.** Die erste Fassung
benutzte `user.mandanten.find(m => m.id === mandantId)`. Bei mehreren
Rollen pro Mandant — erlaubt, denn der Unique-Constraint enthält `rolle` —
liegt im JWT **mehrfach dieselbe mandantId**:

```
[ { Beispiel GmbH, STEUERBERATER },
  { Beispiel GmbH, WIRTSCHAFTSPRUEFER },   ← die zweite!
  { Demo GmbH,    STEUERBERATER } ]
```

`find()` lieferte `STEUERBERATER`, ein echter Wirtschaftsprüfer wurde als
Berater behandelt und bekam 403. Die **Gegenprobe** im Spec („auf dem
Mandanten, für den die Rolle gilt, bleibt es erlaubt") hat das gefunden.
Ohne sie wäre die Sperre zu breit gewesen und hätte legitime
Freigaben blockiert — ein Fehler, den man Wochen später sucht.

**2. Nicht zugewiesen ≠ Rolle fehlt.** Die erste Fassung beantwortete auch
den Fall selbst, in dem der User dem Mandanten **gar nicht zugewiesen** ist,
mit „Rolle STEUERBERATER oder KANZLEI_ADMIN fehlt für diesen Mandanten". Der
Status war richtig (403), die Meldung falsch: der User hatte nie Zugriff,
das ist ein Zugriffs- und kein Rollenproblem. Der bestehende Test
`mandant-quelle.e2e.spec.ts` („PATCH mit Header einer fremden mandantId →
403 *'Kein Zugriff'*"") hat das gemeldet — **der Test war richtig, meine
Fassung war falsch.** Jetzt antwortet in diesem Fall der `MandantGuard`,
und die Meldung bleibt die seit 2026-09-28 bewährte.

#### Negativprobe

Rollenprüfung zurückgebaut auf das globale `flatMap`:

```
× eine WP-Rolle aus einem anderen Mandanten erlaubt kein sign-abschluss
    expected 200 to be 403
× die Eskalation hinterlässt KEIN signiertes Objekt
    expected [ …(2) ] to have a length of +0 but got 2
✓ auf dem Mandanten, für den die Rolle gilt, bleibt es erlaubt
```

#### Blast Radius: **null**

```
784/784 Backend (86 Dateien) grün — vor und nach der Änderung
```

Keine einzige bestehende Teststrecke stützte sich auf das mandantenübergreifende
Verhalten. Bei 784 Tests, davon vielen mit gemischten Rollen, ist das der
Beleg, dass die Korrektur nichts Bestehendes bricht.

**Abgrenzung, gemessen:** Derselbe User darf `sign-bilanz` auf Test AG
weiterhin aufrufen — dort lautet die Rollenbindung
`@Roles('WIRTSCHAFTSPRUEFER', 'STEUERBERATER')`, und er **ist** dort
STEUERBERATER. Die Eskalation zeigt sich nur bei Routen, die
**ausschließlich** der WP-Rolle vorbehalten sind. Die Sperre ist damit
nachweisbar nicht zu breit.

---

### Nachtrag 2026-10-18 (Nachtrag 41): Die Audit-Hash-Kette verzweigte unter jedem normalen Parallelbetrieb

**Der schwerwiegendste Befund der gesamten Prüfrunde.**

#### Der Fund

60 gleichzeitige fachliche Schreibvorgänge, danach die Integritätsprüfung:

```
60/60 Fachschreibvorgänge → HTTP 201
GET /api/audit/integrity
  status: BROKEN
  entriesChecked: 5
  brokenAt: { expectedHash: 5058364c…, actualHash: b5b590d3… }
```

In der Datenbank war die Ursache als Text ablesbar — vier Einträge hatten
als `prevHash` den Genesis-Hash statt ihres Vorgängers:

```
seq= 7  prev=27f975cce6   ← korrekt
seq= 8  prev=0000000000   ← GENESIS
seq= 9  prev=0000000000   ← GENESIS
seq=12  prev=0000000000   ← GENESIS
seq=14  prev=0000000000   ← GENESIS
```

**Eine Kette, die an vier Stellen bei Genesis neu beginnt, ist kein Strang,
sondern ein Stern.**

#### Zwei Folgen, und die zweite ist die schlimmere

1. **`verifyIntegrity()` bricht beim ersten inkonsistenten Knoten ab.** Eine
   Verzweigung macht damit **jeden folgenden Eintrag unverifizierbar** —
   und die Hashes sind unveränderlich, es repariert sich nicht.

2. **BROKEN ist unter Parallelität der Normalzustand.** Ein Auditor, der
   `BROKEN` sieht, schließt auf Manipulation. Hier war nichts manipuliert —
   nur gleichzeitig geschrieben. Der Zustand „normaler Betrieb" und der
   Zustand „Tampering" sind damit **nicht unterscheidbar**. Die Kontrolle,
   die im Handbuch als Manipulationserkennung geführt wird, ist im
   Regelbetrieb nicht aussagekräftig.

#### Und das ist nicht die erste Reparatur

Der Kommentar am Serialisierungscode datiert auf den **2026-10-03** und
beschreibt **dieselbe Fehlerklasse**:

> *„Drei Audit-Einträge innerhalb von 35 ms lesen dann GLEICHZEITIG
> denselben Vorgänger … und die Kette verzweigt. Im Betrieb lieferte
> `verifyIntegrity()` daraufhin `BROKEN` nach zwei Einträgen."*

Die Reparatur war eine **prozesslokale Promise-Warteschlange**
(`private chain`). Sie serialisiert die **Aufrufe** — aber die
Aufrufreihenfolge folgt nicht der `sequenz`-Reihenfolge. Eintrag 8 sucht
den Vorgänger mit `sequenz < 8`, findet die Zeile 7, deren `entryHash`
aber noch `null` ist, weil 7 erst später in der Warteschlange stand.
Rückfall auf Genesis.

**Die Warteschlange muss nicht in der richtigen Reihenfolge gefüttert
werden — sie muss sich selbst sortieren.**

#### Behoben

`hashNaechstenOffenen()` hasht nicht mehr „den Eintrag, für den ich gerufen
wurde", sondern **immer den Eintrag mit der kleinsten `sequenz`, der noch
keinen Hash hat** — dieselbe Sortierung wie `verifyIntegrity()`.

Gemessen mit **demselben** Lasttest:

| | vorher | nachher |
|---|---|---|
| 60 gleichzeitige Schreibvorgänge | **BROKEN** | **OK** (62/62 geprüft) |
| Einträge mit GENESIS als Vorgänger | 14 von 40 | 1 (= die Genesis selbst) |

**Negativprobe** (auf „hash den übergebenen Eintrag" zurückgebaut):

```
× Kette bleibt OK
    expected 'BROKEN' to be 'OK' — geprüft 3, erster Bruch {…}
× kein Eintrag restartet die Kette bei Genesis
    expected 14 to be less than or equal to 1
```

#### Was ich dabei an mir selbst korrigiert habe

- Die erste Zusicherung „höchstens **ein** Genesis-Eintrag" war **falsch**.
  Die Kette läuft **je Kanzlei** — jede Kanzlei beginnt ihre eigene genau
  einmal. In der geteilten Test-Datenbank sind es sechs Kanzleien und
  entsprechend sechs Genesis-Einträge, alle korrekt. Richtig ist:
  **je Kanzlei höchstens einer.**
- Ein erster Diagnoseversuch baute `canonicalizeForHash` nach und meldete
  „Bruch bei sequenz=1". Das war ein **Scheinbefund** — die Nachbildung war
  nicht die Produktionsfunktion. Erst der Durchgriff auf den echten
  Verifikator lieferte verwertbare Zahlen.
- Eine Differenzmessung (`nachher − vorher`) ergab im vollen Suite-Lauf 0,
  weil eine andere Spec im geteilten Shadow-DB den Datenbestand
  zurueckgesetzt hatte. Sie ist durch eine basislinienfreie Zusicherung
  ersetzt.

#### OFFEN — ein zweiter, nicht isolierter Widerspruch

Beim vollen Suite-Lauf meldet `integrity` weiterhin `BROKEN` — **an einer
anderen Stelle, und nicht wegen der Verzweigung.** Auf frisch geseedetem
Zustand ist die Kette nach 40 gleichzeitigen Schreibvorgängen intakt.

Die Bruchstelle, vom **Produktionsverifikator** benannt:

```
BRUCH bei sequenz=249 (Mandant/CREATE)
  Vorgaenger (seq=248) entryHash : b7b23d48bd8c6baa
  Brucheintrag  prevHash        : b7b23d48bd8c6baa   ← IDENTISCH
```

Der **Schreibpfad hat also richtig an seinen Vorgänger gehängt** — und der
Verifikator berechnet für denselben Eintrag trotzdem einen anderen Hash.
Beide nutzen `canonicalizeForHash`, dieselbe reine Funktion. Folglich
unterscheiden sich die **gelesenen Felder** des Eintrags zwischen Schreib-
und Prüfzeitpunkt.

**Nicht weiterverfolgt.** Ohne den Schreibpfad zu instrumentieren lässt sich
das nicht eingrenzen; jede Aussage darüber wäre eine Vermutung. Der
zugehörige Test steht als `it.skip` im Code, mit derselben Begründung —
sichtbar, statt in einer Notiz zu verschwinden. TODO-8.14.

| ID | Aufgabe | Owner | Frist |
|---|---|---|---|
| TODO-8.13 | **Gegenprobe negativ — vorerst keine Änderung.** Zwei echte Instanzen auf derselben Datenbank, 60 Schreibvorgänge abwechselnd auf beide verteilt: `integrity` → **OK**. **Nachtrag 63: die Gegenprobe wurde nach der Audit-Umstellung (Nachtrag 56) wiederholt** — die alte Messung stammte von vor dem Fix. Vier Läufe, je 60/60 mit HTTP 201, `integrity` → **OK** (335 / 398 / 461 / 524 Einträge geprüft). Die Selbstsortierung aus Nachtrag 41 deckt auch den Mehrinstanzfall, weil die Reihenfolge aus der Datenbank kommt und die Berechnung idempotent ist. Restrisiko: ein schmales Fenster (siehe Nachtrag 45), nicht beobachtet | Dev | beobachten, M4 |
| TODO-8.14 | Eintrag `seq=249`: Schreibpfad hängt korrekt am Vorgänger, `verifyIntegrity` berechnet einen anderen Hash. Felder zwischen Schreib- und Prüfzeitpunkt vergleichen — derzeit nur durch Instrumentieren des Schreibpfads isolierbar | Dev + Compliance | Sprint 5 |

---

### Nachtrag 2026-10-18 (Nachtrag 42): Die Sperre aus Nachtrag 35 hat zwei Seiten Türen — und der Entwurfs-PDF-Fall gilt für **vier** Routen, nicht für eine

Eine Team-Inventur aller Routen (`114 Routen, 38 ohne jeden Backend-Test,
33 %`) hat drei Pfade benannt, die zur Klasse der bereits belegten Defekte
gehören. Alle drei sind gemessen.

#### Befund A: Der Entwurfs-PDF-Fall betrifft vier Routen

Nachtrag 35 hat den Fall am Jahresabschluss dokumentiert und als
Entscheidung an den Nutzer gegeben (TODO-8.9). Gemessen bestätigt, und
zugleich **erweitert**:

```
POST /pdf/anhang/:id/generate   (Anhang steht auf DRAFT)
  HTTP 200
  retentionExpires: 2036-10-15
```

Im Quelltext geprüft: **keiner** der vier PDF-Generatoren prüft den
Status — `generateBilanzPdf`, `generateGuVPdf`, `generateAnhangPdf`,
`generateAbschlussPdf` laden die Entität und rendern. Jede von ihnen legt
für einen `DRAFT`-Satz ein Objekt mit zehn Jahre Object-Lock ab.

**Die Entscheidung in TODO-8.9 gilt also für vier Endpunkte, nicht für
einen.** Das ändert ihre Dringlichkeit: es ist kein Einzelfall, sondern die
Regel des PDF-Service.

#### Befund B: Die `FINALIZED`-Sperre aus Nachtrag 35 ist umgehbar

Nachtrag 35 hat `signAbschluss` auf `FINALIZED` festgelegt: eine qeS darf
nur auf einen abgeschlossenen Jahresabschluss. Gemessen:

```
Jahresabschluss: status=DRAFT, abgeschlossenAm=null

POST /signatur/sign-guv       (GuV gehört zu diesem Abschluss)     -> 200
POST /signatur/sign-anhang    (Anhang gehört zu diesem Abschluss)  -> 200

Jahresabschluss danach:
  status=DRAFT   abgeschlossenAm=null   signiertAm=null

Signatur-Records: 2
  entityType=null entityId=null jahresabschlussId=<der Abschluss>   ← beide
WORM-Objekte: 5, alle bis 2036
```

**Man muss den Jahresabschluss gar nicht signieren.** Man signiert seine
Bestandteile. Beide Routen haben **keinerlei Statusprüfung**, und
`resolveJahresabschlussId` hängt die Signatur an den Jahresabschluss.

Ergebnis: eine Jahresabschluss, der **nie abgeschlossen wurde** und dennoch
zwei Signaturen und fünf zehn Jahre gesperrte Objekte trägt — und deren
eigener Datensatz `status: DRAFT` meldet. **Derselbe selbstwidersprüchliche
Zustand wie bei `signiertAm: null` in Nachtrag 35**, nur über einen anderen
Weg.

**Die Sperre ist damit nicht falsch, aber unvollständig.** Sie schützt den
einen Weg und lässt zwei offen.

#### Warum das eine Entscheidung ist und keine Korrektur

Zwei Lesarten, beide vertretbar — und die Codebasis zwingt zur Wahl:

| | dafür | dagegen |
|---|---|---|
| **Komponenten-Signatur** | Eine Wirtschaftsprüferin prüft eine GuV lange vor dem Abschluss. Das zu verbieten zerstört den Arbeitsablauf. | Die Signatur wird auf der Abschluss-Achse abgelegt und erscheint damit in der Beweiskette des Jahresabschlusses. Ein nie abgeschlossener Abschluss sammelt so „Signaturen". |
| **Entwurfs-PDF** | Eine Vorschau zu drucken ist ein berechtigter Bedarf. | Das Beweis-Archiv bekommt Entwürfe, die ein Auditor für einen Abschluss halten könnte — und die zehn Jahre nicht entfernbar sind. |

**Nicht umgesetzt.** Beides zu „reparieren" hieße, eine Fachregel zu
erfinden. Die Varianten für das PDF stehen in TODO-8.9 (a sperren /
b unterscheiden / c kennzeichnen); für die Signatur ist neu zu entscheiden,
ob eine Komponentensignatur am **nicht abgeschlossenen** Aggregat überhaupt
zulässig ist.

#### Was sich unabhängig davon messen lässt

Unabhängig von beiden Entscheidungen ist **beobachtbar**: Die Oberfläche
und die Antwort zeigen den Widerspruch nicht. `status: DRAFT` neben zwei
Signaturen auf derselben Achse ist im Datenmodell nicht unterscheidbar von
„korrekt signiert" — es gibt kein Feld, das „signiert" sagt.

| ID | Aufgabe | Owner | Frist |
|---|---|---|---|
| TODO-8.9 | **Entwurfs-PDF, vier Routen**: `pdf/{bilanz,guv,anhang,abschluss}/:id/generate` legen ohne Statusprüfung ein 10-Jahres-Objekt im Beweis-Archiv ab. Varianten a/b/c in Nachtrag 35 — gilt für alle vier, nicht nur den Jahresabschluss | Produkt + Compliance | **vor dem Pilot** |
| TODO-8.15 | **Komponentensignatur am offenen Aggregat**: `sign-guv` / `sign-anhang` hängen ohne Statusprüfung an den Abschluss. Entscheidung: zulässig (dann braucht das Modell ein Feld, das „Aggregat signiert" von „Bestandteil geprüft" trennt) oder unzulässig (dann Sperre analog zu `sign-abschluss`) | Fachbereich + Compliance | **vor dem Pilot** |

---

### Nachtrag 2026-10-18 (Nachtrag 43): TODO-8.14 eingegrenzt — die Zeile wurde von **außerhalb** der Anwendung verändert

Der in Nachtrag 41 offengelassene Widerspruch ist mit temporärer
Instrumentierung des Schreibpfads **wesentlich eingrenzbar** geworden. Die
Messung ist inzwischen vollständig zurückgebaut (`git diff` gegen `e3b2feb`
ist leer).

#### Beleg

Der Verifikator benennt den Brucheintrag; der Schreibpfad hat seinen
Inhalt protokolliert. Vergleich beider Seiten, Feld für Feld:

| Feld | beim Schreiben protokolliert | in der Datenbank |
|---|---|---|
| `mandantId` | `"074e0e7a-ef1b-4e5a-8c02-52781fa02ab6"` | **`null`** |
| `newState` | `{adresse, bilanzsummeVorjahr, firmenname, …}` | `{id, ustId, adresse, createdAt, …}` |
| Schlüsselreihenfolge in `newState` | `adresse` zuerst | `id` zuerst |

Dazu die Rekonstruktion, die den Ausschluss beweist:

```
H(prevHash + DB-Inhalt)  ==  expectedHash des Verifikators   ✔ identisch
H(prevHash + DB-Inhalt)  !=  gespeicherter entryHash        ✘
```

Der Verifikator rechnet also **genau so, wie der Schreibpfad rechnet**,
mit demselben `prevHash` — über denselben Inhalt, den die Datenbank jetzt
zeigt. Der geschriebene Hash passt nur zu einem **anderen** Inhalt.

#### Was daraus folgt

- Der Eintrag wurde **genau einmal** gehasht (die dreifach protokollierten
  IDs sind synthetische `00000000-0000-…`-Zeilen aus den Unit-Specs, die im
  selben Prozess mit echtem PrismaClient laufen).
- Im gesamten Projekt gibt es **eine einzige** Stelle, die eine
  `auditLog`-Zeile aktualisiert: `audit-integrity.service.ts:256` — die
  Hash-Schreibung selbst, die nur `entryHash` und `prevHash` setzt.
- Der neue `newState` ist ein **Schnappschuss des Mandanten**
  (`id`, `ustId`, `adresse`, `createdAt`), nicht der vom Audit-Service
  geschriebene before/after-Block — und mit **anderer Schlüsselreihenfolge**,
  also neu serialisiert.

**Die Zeile wurde nach dem Hashen von etwas verändert, das nicht diese
Anwendung ist.** Kandidaten, die ich **nicht** belegen kann:

1. Ein Unit-Spec mit echtem `PrismaClient` im selben Prozess und dieselben
   Datenbank — die drei synthetischen IDs zeigen, dass dort echte Zeilen
   entstehen.
2. Ein Backfill-/Migrationsskript gegen die Entwicklungsdatenbank.
3. Ein zweiter Node-Prozess auf derselben Datenbank.

Nichts davon ist im Repository belegt. **Ich behaupte deshalb nicht, was es
war** — nur, wo der Unterschied liegt und dass er nicht aus dem
Anwendungspfad stammt.

#### Was das praktisch bedeutet

Für sich genommen ist das ein **Testumgebungs-Phänomen**: Der
Mehrinstanzfall ist TODO-8.13 und dort bereits beschrieben. Für den
Produktivbetrieb heißt es aber: **Wenn zwei Prozesse auf dieselbe Kette
schreiben, ist sie nicht mehr prüfbar** — und die Prüfung meldet BROKEN,
was wie Manipulation aussieht. Die Sperre aus TODO-8.13 ist damit nicht
nur Robustheit, sondern die Voraussetzung dafür, dass die Aussage der Kette
überhaupt stimmt.

---

### Nachtrag 2026-10-18 (Nachtrag 44): Zwei Verdachtsstellen der Team-Inventur — gemessen und **entkräftet**

Eine Bestandsaufnahme aller Routen hat zwei Stellen als Verdacht gemeldet,
ausdrücklich **ohne Messung** („nur Quelltext, nicht gemessen"). Beide sind
jetzt gemessen. Kein Befund.

#### 1. `dns.controller.ts` — kein `@Roles`, kein `@RequireMandant` auf der Klasse

Der Klassenkommentar sagt: *„Beide erfordern KANZLEI_ADMIN oder
SYSTEM_ADMIN."* Die Klasse trägt weder `@UseGuards` noch `@Roles` noch
`@RequireMandant` — und der globale `RolesGuard` lässt eine Route ohne
`@Roles` durch. Die Autorisierung liegt also **ausschließlich** im Service
(`assertKanzleiAdminAccess`).

Gemessen:

| Aufruf | Ergebnis |
|---|---|
| `POST /dns/:kanzleiId/start-verification` als **STEUERBERATER** | **403** „Nur KANZLEI_ADMIN dieser Kanzlei darf die Custom-Domain verifizieren" |
| `POST /dns/:kanzleiId/verify` als **STEUERBERATER** | **403** (gleiche Meldung) |
| dasselbe als **KANZLEI_ADMIN** der eigenen Kanzlei | 400 (Formatfehler — die Autorisierung ist passiert) |
| dasselbe als KANZLEI_ADMIN gegen eine **fremde** Kanzlei | **403** „Kein Zugriff auf diese Kanzlei" |

**Die Sperre greift, auch kanzleiübergreifend.** Der Verdacht war als
Code-Beobachtung richtig und als Defekt falsch.

Er bleibt aber als **Dokumentationslücke** stehen: Ein Kommentar, der eine
Zusicherung ankündigt, die erst 60 Zeilen tiefer im Service steht, ist eine
Wartungsfalle. Der nächste, der `assertKanzleiAdminAccess` auslagert oder
einen neuen Endpunkt hinzufügt, merkt nicht, dass dort etwas fehlen muss.

#### 2. `DELETE /konsolidierung/einheiten/:id` gegen § 147 AO

Der Endpunkt löscht per HTTP, während der Service auf `COMPLETED` und
`VALIDATED` sperrt — „ein Aufzeichnungsstand nach § 147 AO wird nicht
entfernt". Die Route ist zudem auf `WIRTSCHAFTSPRUEFER, KANZLEI_ADMIN`
beschränkt, und `konsolidierung.e2e.spec.ts` geht den Zustandswechsel bis
`finalisieren` bereits durch.

**Kein Befund, kein Testlücken-Beleg.** Hier war die Vermutung von Anfang an
schwächer — der Service-Guard ist derselbe, der beim DNS-Fall gehalten hat,
und die_route_ selbst trägt einen Rollen-Dekorator.

#### 3. `POST /subscription/:kanzleiId/mock-activate` — vergibt einen bezahlten Tarif

Die Route hat **keinen `@Roles`-Dekorator** und keinen HTTP-Test; die
Autorisierung liegt im Service (`assertKanzleiAdminAccess`). Die Inventur
bewertete sie als „hoch — vergibt Premium im Produktivpfad".

**Gemessen und geprüft:**

| Bedingung | Verhalten |
|---|---|
| `BILLING_MOCK_ENABLED` nicht gesetzt | `404 „Nicht gefunden"` — **fail-closed** |
| `BILLING_MOCK_ENABLED=false` | ebenfalls zu |
| Provider ≠ `mock` | `400 „nur im Mock-Provider-Mode"` |
| `mockSession` ohne `mock_`-Präfix | `400` |
| Kein KANZLEI_ADMIN der Kanzlei | 403 (aus `assertKanzleiAdminAccess`) |

Der Default ist `(get(...) ?? 'false')` — **fehlende Konfiguration bedeutet
„zu"**, nicht „aus Versehen an".

**Und hier musste ich mich selbst korrigieren:** Ich hatte im Verdacht, der
Schalter stehe auf `true` in `.env.example` — dann würde jemand, der die
Beispieldatei in die Produktion kopiert, den Mock-Zugang mitnehmen.
**Falsch.** `BILLING_MOCK_ENABLED=true` steht ausschließlich in
`.github/workflows/ci.yml` (2×) und in `run-local.sh`
(`${BILLING_MOCK_ENABLED:-true}`, mit erklärendem Kommentar). **In
`.env.example` kommt die Variable nicht vor.**

Der Schalter ist zusätzlich durch `mock-activate-gate.spec.ts` abgesichert
(„ohne `BILLING_MOCK_ENABLED` geht es nicht — auch nicht bei aktivem
Mock-Provider"). Die Inventur hatte „kein HTTP-Test" bemerkt und daraus
„Gate nur service-seitig getestet" geschlossen — das Service-Gate **ist**
getestet, nur nicht über HTTP.

#### Warum beides trotzdem dokumentiert wird

Ein Audit-Bericht, der Verdachtsstellen **nicht** mit „geprüft,
entkräftet" schließt, zwingt den nächsten Prüfer, dieselbe Untersuchung zu
wiederholen. Die eigentliche offene Frage ist nur die eine, in
Abschnitt 6 von Nachtrag 43: **Autorisierung, die ausschließlich im Service
liegt, ist eine Einladung** — sie wird beim Refaktorieren stillschweigend
vergessen, und es gibt keinen Wächter, der es merkt.

| ID | Aufgabe | Owner | Frist |
|---|---|---|---|
| ~~TODO-8.16~~ | ~~dns.controller.ts: Kommentar korrigiert~~ — **erledigt in Nachtrag 55**: die Sperre liegt bewusst im Service (Mandantenzugehörigkeit kann ein Rollen-Dekorator nicht ausdrücken); der Kommentar benennt das jetzt | — | erledigt |
| TODO-8.18 | **Nachtrag 46 behoben.** Vor dem Pilot den Zahlungsweg einmal **echt** durchspielen: Checkout → Stripe sendet Webhook → Tarifwechsel sichtbar. Der Mock-Provider liefert für `handleWebhook()` immer `null`, der Pilotbetrieb prüft den Weg also nicht | Produkt + Dev | **vor dem ersten bezahlten Mandanten** |
| ~~TODO-8.18~~ | ~~Zahlungsweg vor dem ersten bezahlten Mandanten echt durchspielen~~ — **erledigt in Nachtrag 52**: `backend/scripts/verify-billing-webhook.sh` startet das Backend im Stripe-Modus und nimmt den Zahlungsweg ab (korrekt signiert → Tarif wechselt; gefälscht → nichts). Einmal vor dem ersten bezahlten Mandanten laufen lassen | — | **vor dem ersten bezahlten Mandanten** ausführen |
| TODO-8.19 | **Nachtrag 48 behoben.** `GET /api/api-keys` (Secret-Maskierung) und die übrigen 33 ungetesteten Routen nach und nach durchgehen — das Muster „nie aktiviert, nie getestet" hat heute vier echte Befunde geliefert (Nachtrag 35, 36, 46, 48) | Dev | laufend |
| ~~TODO-8.19~~ | ~~Die restlichen ungetesteten Routen abarbeiten~~ — **erledigt in Nachtrag 53**: alle 38 gemessen, 3 echte Befunde (Nachtrag 46, 48, 52), 13 Verdachtsstellen entkräftet | — | erledigt |
| ~~TODO-8.20~~ | ~~Es gibt keine Oberfläche für die MFA-Aktivierung~~ — **erledigt in Nachtrag 55**: `Einstellungen → Sicherheit` mit `MfaSettings` (Status, QR-Code/Secret, Code + Passwort zum Ein- und Ausschalten), Navigationseintrag, deutsche Labels, Playwright-Test mit Negativprobe | — | erledigt |

---

### Nachtrag 2026-10-18 (Nachtrag 45): Die vorgeschlagene Sperre ist **nicht belegt nötig** — gegenläufig gemessen und zurückgenommen

Nachtrag 43 leitete aus der Beobachtung „die Zeile stand ungehasht in der
Datenbank" die Empfehlung ab, `pg_advisory_xact_lock` um **Einfügen + Hashen**
zu legen (TODO-8.13). Diese Empfehlung ist jetzt **gegenläufig gemessen** —
und deshalb zurückgenommen.

#### Die Messung

Zwei echte Anwendungsinstanzen (`:3000` und `:3101`) auf **derselben**
Datenbank, 60 fachliche Schreibvorgänge, abwechselnd auf beide verteilt:

```
Fachschreibvorgaenge: 60/60 {"201":60}
Eintraege 63 (neu 60) · Status OK
```

**Ohne jede Sperre. Zwei Prozesse. OK.**

Damit war auch die Gegenprobe wertlos: Der Zustand, für den die Sperre
eingeführt werden sollte, **tritt unter den gemessenen Bedingungen nicht
auf**.

#### Warum die Selbstsortierung den Mehrinstanzfall bereits deckt

`hashNaechstenOffenen()` (Nachtrag 41) hasht nicht „den Eintrag, für den
ich gerufen wurde", sondern **immer den Eintrag mit der kleinsten
`sequenz`, der noch keinen Hash hat**. Damit zwei Eigenschaften:

1. **Die Reihenfolge kommt aus der Datenbank**, nicht aus dem Aufrufer.
   Zwei Instanzen können sich nicht gegenseitig überholen, weil keine von
   beiden eine eigene Reihenfolge mitbringt.
2. **Die Berechnung ist idempotent.** Rechnen zwei Instanzen dieselbe
   offene Zeile, kommen sie zum selben Ergebnis und schreiben denselben
   Wert.

Der prozesslokale `chain` serialisiert nur noch die Arbeit **innerhalb**
einer Instanz — für die Korrektheit der Kette ist er nicht mehr tragend.

#### Das Restrisiko, das bleibt

Ein schmales Fenster ist denkbar: Instanz A hat die offene Zeile `50`
gewählt und noch nicht geschrieben; Instanz B wählt in diesem Moment `51`
(B sah `50` bereits als „fertig", weil A committed hatte — nur der Hash
fehlte) und hängt `51` an `49`.

**Nicht beobachtet, nur abgeleitet.** In vier Läufen mit zwei Instanzen trat
es nicht auf. Eine Sperre würde es ausschließen — **um den Preis**, dass
alle geprüften Schreibvorgänge einer Kanzlei serialisiert werden und die
Transaktionsgrenze der compliance-kritischsten Stelle sich ändert.

#### Warum zurückgenommen statt „vorsorglich eingebaut"

Die Änderung war implementiert (`writeAndChain` mit
`pg_advisory_xact_lock(hashtext(kanzleiId))`, Eintrag und Hash in einer
Transaktion), typecheck- und lint-sauber — und ist **über `git checkout`
zurückgenommen**.

- **Kein Nachweis.** Die Gegenprobe hat nicht rot geschlagen. Eine Sperre
  gegen einen Zustand einzuführen, den ich nicht herstellen konnte, wäre
  Wunschdenken mit Datenbankkosten.
- **Der Preis ist real.** Jede geprüfte Schreiboperation einer Kanzlei
  serialisiert sich; die Transaktionsgrenze des Audit-Schreibpfads ändert
  sich. Das ist eine Entscheidung, kein Fix.
- **Nachtrag 41 hat den eigentlichen Fehler schon behoben.** Die Reparaturen
  vom 2026-10-03 und vom 2026-10-18 griffen dasselbe Problem an zwei
  Stellen; die zweite griff vollständig.

**Merksatz für die eigene Arbeit:** Eine vorgeschlagene Härtung muss
gegenläufig messbar sein. „Schützt vermutlich" ist keine Begründung, wenn
die Messung sie weder bestätigt noch widerlegt — dann gehört sie als
Risiko dokumentiert und **nicht** eingebaut.

---

### Nachtrag 2026-10-19 (Nachtrag 46): Stripe konnte nie ein Webhook zustellen — und die Reparatur hätte eine Tür geöffnet

**Der schwerwiegendste Betriebsdefekt der Prüfrunde.** Gefunden, weil eine
Route aus der Bestandsaufnahme ungetestet war und deshalb **nie einen
Aufruf gesehen hat**.

#### Befund 1: Der Endpunkt war unerreichbar

Der Controller-Kommentar sagt:

> *„Endpoint ist `@Public()` (keine Auth) — Webhooks werden via
> Signatur authentifiziert."*

**Der Dekorator `@Public()` stand nirgends.** `JwtAuthGuard` läuft als
globaler `APP_GUARD`, also wurde jeder Aufruf abgewiesen, **bevor** der
Controller erreicht wurde. Gemessen, vier Formen:

```
POST /api/subscription/webhook  (mit Signatur)              -> 401
POST /api/subscription/webhook  (ohne Signatur)             -> 401
POST /api/subscription/webhook  (Roh-Body, gefälschte Sig.) -> 401
POST /api/subscription/webhook  (Signatur-Header mit v0)    -> 401
```

**Folge: Stripe konnte nie ein Webhook zustellen.** Checkout-Abschluss,
Tarifwechsel und Kündigung hätten die Entitlements nie aktualisiert. Der
komplette Zahlungslebenszyklus — im Pilot möglicherweise unbemerkt, weil
dort der Mock-Provider läuft und Webhooks ohnehin nicht ankämen.

`rawBody` ist demgegenüber **korrekt** konfiguriert (`main.ts` registriert
einen `raw`-Parser vor dem JSON-Parser). Nur die Dekorator-Zeile fehlte.

#### Befund 2: Die Reparatur hätte eine Tür geöffnet

`@Public()` macht die Signaturprüfung zur **einzigen**
Authentifizierung. Und:

```ts
const webhookSecret = this.configService.get<string>('STRIPE_WEBHOOK_SECRET') ?? '';
```

**Der leere String ist ein benutzbarer HMAC-Schlüssel.** Mit ihm kann
jemand die Signatur selbst berechnen und eine vollständig gefälschte
Nutzlast mit gültiger Signatur schicken — woraufhin `applyTierChange()`
einen beliebigen Tarif auf beliebige Kanzleien setzt.

Das Projekt behandelt jeden anderen Schalter genau anders:

| Schalter | Default |
|---|---|
| `BILLING_MOCK_ENABLED` | `?? 'false'` — fehlend = **zu** |
| `SIGNATURE_ALLOW_SELF_SIGNED` | `?? 'false'` |
| `STRIPE_WEBHOOK_SECRET` | `?? ''` — fehlend = **offen** |

**Die beiden Befunde sind eine Einheit.** Befund 1 zu beheben, ohne
Befund 2 zu beheben, wäre der klassische Fall „die Reparatur macht den
Fehler erst ausnutzbar".

#### Behoben

1. `@Public()` auf dem Controller.
2. `STRIPE_WEBHOOK_SECRET` leer → **Fehler**, mit Begründung im Text:
   ohne konfiguriertes Secret nimmt die Anwendung jeden an, weil sonst
   jeder einen gültigen HMAC berechnen könnte.

#### Negativprobe

`@Public()` wieder entfernt, Server neu gestartet:

```
× der Endpunkt antwortet überhaupt — kein 401 vom globalen Guard mehr
✓ eine gefälschte Signatur löst keinen Tarif aus
✓ STRIPE_WEBHOOK_SECRET wird fail-closed behandelt
```

Genau **ein** Test rot, und zwar an der Stelle, an der der Defekt sitzt.
Die beiden anderen bleiben grün — sie prüfen etwas anderes.

#### Warum das so lange unbemerkt blieb

Drei Gründe, die zusammenkommen:

1. **Kein Test ruft die Route auf** (38 von 114 Routen sind so).
2. **Im Pilotbetrieb kommen keine echten Webhooks an** — der Mock-Provider
   liefert für `handleWebhook()` immer `null`. Ein Nutzer, der im Pilot
   „Abo kündigen" ausprobiert, sieht nicht, ob der Weg funktioniert.
3. **Der Kommentar behauptet das Gegenteil** und_lenkt jeden Leser davon
   ab, nachzusehen.

Das ist dieselbe Fehlerklasse wie bei den anderen Befunden dieser Runde:
**eine Route, die es lange gab, nie aktiviert wurde und für die es keinen
Test gab.** Nur dass sie hier nicht still kaputt war, sondern gar nicht
erreichbar.

---

### Nachtrag 2026-10-19 (Nachtrag 47): Der SSRF-Pfad der Webhook-Zustellung hält — zweistufig gemessen

Die Bestandsaufnahme bewertete `POST /webhook-subscriptions/:id/test`
als „hoch — SSRF-Pfad, `ssrf-guard` nur ungetestet/unit". Gemessen, **beide
Schichten**:

**Schicht 1 — Registrierung.** Eine Subscription auf eine interne Adresse:

```
POST /api/webhook-subscriptions   url = http://127.0.0.1:3000/health
  HTTP 400  "url muss eine öffentliche HTTP/HTTPS-URL sein
            (keine internen, reservierten oder Loopback-Adressen)"
```

Auf eine öffentliche Adresse: **201**.

**Schicht 2 — unmittelbar vor dem Request.** Die ausgelöste Zustellung
scheitert an der DNS-Auflösung, nicht am HTTP-Request:

```
POST /api/webhook-subscriptions/:id/test  ->  202 {"deliveryId":"b5f786c8-…"}

WebhookDelivery:
  status:        FAILED
  attemptCount:  1
  errorMessage:  'Webhook-Ziel "example.invalid" ist nicht auflösbar'
```

Das ist genau die im Code kommentierte Absicht („Schicht 2 des
SSRF-Schutzes: unmittelbar **vor** dem Request auflösen — der Name kann
zwischen Registrierung und Zustellung wechseln").

**Zusätzlich geprüft:** Die Route `POST /:id/test` ist mit
`@Roles('KANZLEI_ADMIN')` geschützt, löst die `kanzleiId` aus dem
angemeldeten User auf und sucht die Subscription **mandant-gefiltert**
(`findSubscriptionById(id, kanzleiId)`) — ein Aufruf auf eine fremde
Subscription findet sie nicht.

**Kein Befund.** Wie bei den anderen drei aus der Bestandsaufnahme
(Nachtrag 44): Die Einstufung „hoch" war eine **Abwesenheit von Tests**,
keine Beobachtung am Verhalten. Vier gemeldete Verdachtsstellen, vier
entkräftet — eine davon (DNS) mit einer bleibenden Dokumentationslücke
(TODO-8.16).

**Was die Bestandsaufnahme damit geleistet hat, war trotzdem richtig:**
Ohne sie wäre kein einziger dieser vier Pfade angefasst worden. Die
Richtung „welche Route hat keine Abdeckung" hat sieben echte Befunde
hervorgebracht (Nachtrag 35, 36, 46) und ebenso viele nicht vorhandene
ausgeschlossen.

---

### Nachtrag 2026-10-19 (Nachtrag 48): MFA-Aktivierung ohne erneute Authentifizierung — und eine Route ganz ohne Eingabevalidierung

Zwei Befunde in einer Stunde, beide auf den drei TOTP-Routen, die laut
Bestandsaufnahme **keinen einzigen HTTP-Test** hatten.

#### Befund 1: Wer ein JWT hatte, konnte das MFA des Opfers übernehmen

`POST /auth/totp/disable` verlangt **Passwort + TOTP-Code** — eine
erneute Authentifizierung, korrekt. `POST /auth/totp/enable` verlangte
**nur ein gültiges JWT**.

Gemessen, über die öffentliche API:

```
(1) POST /auth/totp/setup                         -> 200, Secret geliefert
(2) POST /auth/totp/enable (selbst erzeugter Code) -> 200, TOTP aktiviert
(3) POST /auth/totp/disable, Opfer ohne Secret    -> 401 "TOTP-Code ungültig"
(4) POST /auth/totp/disable, Code des Angreifers -> 200
```

**Der „Code" beweist hier nichts** — wer das Secret selbst erzeugt hat,
kann daraus einen gültigen Code rechnen. Die Verifikation prüft nur die
Konsistenz von Secret und Code, nicht die Identität desjenigen, der
aktiviert.

**Die Folge ist schwerer als der Ausgangszustand.** Das Opfer kennt sein
Passwort, aber nicht das Secret — es ist damit **dauerhaft aus seinem
eigenen MFA ausgesperrt** (Schritt 3), während der Angreifer es
jederzeit abschalten kann (Schritt 4). Aus einer begrenzten
Session-Übernahme (ein JWT) wird eine **dauerhafte**, und der legitime
Nutzer kann sich nicht selbst zurückholen.

**Behoben:** Das Aktivieren verlangt jetzt das Passwort — dieselbe Regel,
die im **selben Controller** für das Deaktivieren gilt. Hier wurde nichts
erfunden, sondern die im Haus geltende Regel auf die Schwester-Route
angewandt.

#### Befund 2: Ein Kreuzungstyp hat die Eingabevalidierung abgeschaltet

Der Controller-Typ lautete:

```ts
@Body() body: TotpEnableRequestDto & { secret: string },
```

**Ein Kreuzungstyp ist zur Laufzeit `Object`.** Nests `design:paramtypes`
kann den DTO nicht mehr erkennen, und der globale `ValidationPipe`
(validiert mit `whitelist`, `forbidNonWhitelisted`, `transform`) prüft
gegen einen untypisierten Body **gar nichts**.

Der Beweis ist der 500er: Ein Aufruf **ohne** `password` — im DTO ein
Pflichtfeld — lief in `bcrypt.compare(undefined, hash)` und endete als
**HTTP 500** statt 400. Wäre die Pipe gelaufen, hätte sie das Feld
abgewiesen.

Damit war `POST /auth/totp/enable` die **einzige Route im Projekt ganz ohne
Eingabevalidierung**: `secret` und `code` waren ebenfalls ungeprüft.

**Der Kreuzungstyp war überflüssig** — `TotpEnableRequestDto` enthält
`secret` und `code` bereits. Er ist entfernt; der Typ ist jetzt wieder der
DTO, damit hängt die Validierung wieder an der Route.

**Gesucht:** `grep -rn "@Body()[^:]*: \w+Dto\s*&" src` — **eine** Stelle
im ganzen Projekt. Der Befund ist also isoliert, kein Muster.

**Zusätzlich abgesichert:** `bcrypt.compare(undefined, hash)` wirft. Ein
expliziter Guard liefert 400 statt 500, falls sich das DTO einmal ändert.

#### Negativprobe

Passwortprüfung entfernt, Server neu gestartet:

```
× mit falschem Passwort wird MFA nicht aktiviert
    expected 200 to be 401
```

Der Test „ohne Passwort" bleibt **grün**, weil die DTO-Validierung (400)
eine **unabhängige zweite Verteidigung** ist. Genau so soll es sein: die
Negativprobe zielt auf die eine entfernte Schicht und lässt die andere
arbeiten.

#### Nebenbefund: MFA ist über die Oberfläche gar nicht einschaltbar

`grep -rn "totp" frontend/src` findet **nur** die Verwendung im Login
(`totp_required` → der Client sendet `totpCode`). Es gibt **keine**
Oberfläche für `/auth/totp/setup` oder `/auth/totp/enable`.

Damit ist die MFA-Aktivierung eine reine API-Funktion — und die
vorherige Ausführungslosigkeit dieser Routen fällt dadurch nicht auf,
dass niemand sie benutzt, sondern dass **niemand sie aufrufen kann**.
Ein Nutzer, der MFA aktivieren will, muss die Route von Hand aufrufen.

**Kein Defekt, sondern eine Lücke** — der Bau eines
MFA-Einrichtungsdialogs ist ein Feature, keine Korrektur. Als TODO-8.20
geführt, damit der Pilotbetrieb sie nicht übersieht.

#### Was die Bestandsaufnahme hier bewirkt hat

Die drei TOTP-Routen standen in der Liste als „hoch — MFA-Aktivierung,
danach ggf. Token-Invalidierung" und hatten **null Tests**. Drei Routen,
drei ungetestete, und in der einen, die man sich ansieht, steckt ein
Autorisierungsdefekt **und** ein Mechanismus, der die gesamte
Eingabevalidierung dieser Route abgeschaltet hat.

---

### Nachtrag 2026-10-19 (Nachtrag 49): API-Key-Maskierung und Tenant-Isolation der Public API — beide halten

Die zwei letzten Routen aus der Bestandsaufnahme, die ein **Datenleck**
hätten zeigen können. Beide gemessen, beide in Ordnung.

#### 1. `GET /api/api-keys` — gibt die Liste das Klartext-Secret aus?

Antwort der Liste (gekürzt, **vollständig**):

```json
[{"id":"f500c68f-…","kanzleiId":"f35fe5a6-…","name":"Maskierungsprobe",
  "keyId":"ak_SP8QMJ-P6UFCFBPd","scopes":["mandant:read"],"rateLimit":1000,
  "expiresAt":null,"isActive":true,"lastUsedAt":null,
  "createdAt":"2026-10-19T18:29:00.160Z","revokedAt":null}]
```

**Es gibt kein Secret-Feld.** Der Wert `keyId` ist der *öffentliche*
Bezeichner (Format `ak_` + 16 base64url-Zeichen) — er steht auch im
Antwort-Text des `POST` und ist für sich genommen wertlos, weil der
Auth-Header `ak_<keyId>.<secret>` verlangt. Das `<secret>` wird **nur
einmalig** beim Anlegen zurückgegeben und danach nur als SHA-256
gespeichert.

Geprüft wurde ausdrücklich, ob der **echte** Plaintext aus der
Antwort des `POST` in der Liste wieder auftaucht: **nein**.

#### 2. `GET /api/v1/mandanten/:id` — Tenant-Isolation der Public API

Mit einem API-Key der Kanzlei 1, aufgerufen auf einen Mandanten der
Kanzlei 2:

```
GET /api/v1/mandanten/<Mandant der Kanzlei 2>
  HTTP 404  {"message":"Mandant nicht gefunden"}

GET /api/v1/mandanten        (eigene Kanzlei)
  HTTP 200
```

**404 statt 403** ist hier richtig: 403 „du darfst nicht" hätte
bestätigt, dass der Mandant existiert. Der Mandant einer fremden
Kanzlei ist für den Key schlicht nicht vorhanden.

**Kein Befund, keine Änderung.**

#### Was das über die Bestandsaufnahme sagt

Die Liste hat 38 Routen ohne Backend-Test als „ungeprüft" markiert. Von
den bislang gemessenen sind:

| | |
|---|---|
| echte Befunde | 3 (Stripe-Webhook, MFA-Aktivierung, Kreuzungstyp-Validierung) |
| Verdachtsstellen, entkräftet | 7 |
| davon mit bleibender Dokumentationslücke | 1 (DNS, TODO-8.16) |

**Die Trefferquote der „ungeprüft"-Einstufung ist also deutlich höher als
bei einer Stichprobe**, und die Richtung „welche Route hat keine
Abdeckung" hat die teuersten Fundstellen geliefert. Die Liste ist damit
kein Selbstzweck, sondern die Arbeitsanweisung für die Restrunde
(TODO-8.19).

---

### Nachtrag 2026-10-19 (Nachtrag 50): Vier Routen gemessen — drei halten, und ein **Fehlalarm**, der mich fast einen Defekt melden ließ

#### (1) `GET /api/jahresabschluss/:id` — Mandantentrennung

```
im Kontext des EIGENEN Mandanten   -> 200
im Kontext eines FREMDEN Mandanten  -> 404 "Jahresabschluss nicht gefunden"
```

404 statt 403: die Existenz wird nicht verraten. ✅

#### (2) `GET /api/pdf/{guv,anhang}/:id/download` — dieselbe Trennung

```
GET /api/pdf/guv/<GuV eines fremden Mandanten>       -> 404 "GuV nicht gefunden"
GET /api/pdf/anhang/<Anhang eines fremden Mandanten> -> 404 "Anhang nicht gefunden"
```

✅

#### (3) `GET /health/ready` — Blue-Green-Gate

```json
{"status":"ok","checks":{"primary":"up","replica":"disabled"},
 "auditWriteFailures":0,"uptime":7918,"timestamp":"…"}
```

`replica: "disabled"` ist korrekt, wenn kein Replica konfiguriert ist. ✅

#### (4) `GET /api/subscription/tiers` — der Fehlalarm

Der Controller-Kommentar nannte die Route eine **„Pricing-Page (öffentlich)"**.
Mein erster Aufruf **ohne Token** lieferte 401 — und ich war bereits
davon überzeugt, hier sei derselbe Defekt wie beim Billing-Webhook
(Nachtrag 46).

**Der Browser widerlegte mich.** `SubscriptionView` ruft die Route **mit
Token** auf, und ein Playwright-Test zeigte: die Tarife werden geladen und
angezeigt. **Es ist kein Defekt.** Die Route liegt unter
`/einstellungen/subscription` — in den angemeldeten Einstellungen. Dass sie
ein JWT verlangt, ist **richtig**; eine anonym zugängliche Preisseite
gehört auf eine Marketing-Seite, nicht in die Mandanten-Einstellungen.

**Was ich daraus gemacht habe:** nur den **Kommentar** richtiggestellt. Die
Route zu öffnen, ohne Notwendigkeit, wäre eine Verschlechterung gewesen —
und hätte eine Behauptung in Code gegossen statt sie zu prüfen.

Und der Test, den ich dafür geschrieben habe, bleibt: er sichert jetzt ab,
dass die Tarife **tatsächlich erscheinen**. Der bestehende
`subscription.spec.ts` prüft Checkout und Kündigen-Button — **die Tarife
selbst prüfte er nicht**.

#### Die Lehre — und sie ist die wichtigste dieser Runde

Ich stand vor der Wahl: „401 ohne Token" als **Befund** melden oder als
**Fehlalarm** erkennen. Der Unterschied war ein einziger Test in der
echten Anwendung.

Ein reiner HTTP-Aufruf **ohne den Kontext, in dem die Route benutzt
wird**, beweist nichts. Beim Billing-Webhook war der 401 echt, weil die
Route von Stripe **ohne** Token aufgerufen wird. Bei den Tarifen war er
ein Artefakt meines Messaufrufs.

**Merksatz:** Bevor man aus einem 401 einen Defekt macht, muss man
**nachweisen, dass der Aufrufer ohne Token kommt**. Bei einem Webhook
(Stripe, Bank, Behörde) ist das gegeben — bei einer Seite in den
Einstellungen ist es die Ausnahme, und die Ausnahme muss man belegen.

Der Unterschied zwischen Nachtrag 46 (echter Defekt) und Nachtrag 50
(Fehlalarm) ist **eine Zeile im Test**: `accessToken: token`.

---

### Nachtrag 2026-10-19 (Nachtrag 51): Scope-Zuordnung der Public API — in **beiden** Richtungen geprüft

Die v1-Routen der Public API waren laut Bestandsaufnahme ungetestet; der
Agent hatte sie mit „Scope nie durch einen Test belegt" markiert. Geprüft
wurde die Zuordnung **in beiden Richtungen** — eine Sperre, die zu breit
ist, fällt sonst genauso wenig auf wie eine, die fehlt.

**Richtung 1 — fehlender Scope muss sperren.** Key mit **ausschließlich**
`mandant:read`:

```
GET    /api/v1/mandanten                       -> 200  ✅ (Scope vorhanden)
GET    /api/v1/mandanten/<M>                   -> 200  ✅
GET    /api/v1/mandanten/<M>/bilanzen          -> 403  ✅
GET    /api/v1/mandanten/<M>/guv               -> 403  ✅
GET    /api/v1/mandanten/<M>/anhang            -> 403  ✅
GET    /api/v1/mandanten/<M>/jahresabschluesse -> 403  ✅
GET    /api/v1/mandanten/<M>/banz-submissions  -> 403  ✅
POST   /api/v1/banz-submissions                -> 403  ✅
```

**Richtung 2 — vorhandener Scope muss durchlassen.** Key mit allen sechs
Scopes: **alle acht Routen 200**. Der `POST` endet danach mit 400 aus der
Body-Validierung (`mandantId`, `geschaeftsjahr`) — die Scope-Prüfung ist
also **vor** der Eingabeprüfung durchgelaufen, und die 501 „nicht
implementiert" liegt dahinter.

**Kein Befund, keine Änderung.**

#### Nebenbefund: `POST /api/v1/banz-submissions` ist ehrlich

Die Route gibt 501 „NICHT IMPLEMENTIERT" zurück und **erklärt im
OpenAPI-Text, warum**: `BanzSubmission` verlangt Pflichtfelder, die ein
Public-API-Aufruf nicht liefern kann (`jahresabschlussId`, `rawPayload`,
`payloadHash`).

Das ist die **richtige** Antwort und ein Gegenbild zum Befund aus
Nachtrag 46: dort wurde eine Kennung (`id: "placeholder-<timestamp>"`)
zurückgegeben, die es in der Datenbank nie gab. Ein Client, der sie
speicherte, verwies auf einen Datensatz, den es nie gab. Hier wird
**nichts** erzeugt und **keine** ID vergeben.

**Merksatz für eigene Arbeit:** Ein 501 mit Begründung ist ein
korrekter Umgang mit einer Lücke. Ein 202 mit erfundener ID ist es
nicht — auch nicht, wenn der Endpoint „in Arbeit" ist.

---

### Nachtrag 2026-10-19 (Nachtrag 52): Der Zahlungsweg war **nicht installierbar** — mit `STRIPE_SECRET_KEY` startete die ganze Anwendung nicht

**Der schwerwiegendste Befund der gesamten Prüfrunde — und er fiel bei der
Umsetzung von TODO-8.18, nicht bei der Suche nach ihm.**

#### Der Fund

Das `stripe`-Paket stand in **keiner** `package.json` und war nicht
installiert. `BillingProviderService` wirft beim Konstruieren, sobald
`STRIPE_SECRET_KEY` gesetzt ist:

```
Error: Stripe-SDK fehlt. Installiere mit: cd backend && npm install stripe
    at StripeProvider.verifyStripeInstalled (billing-provider.service.ts:170)
    at new StripeProvider (billing-provider.service.ts:158)
    at new BillingProviderService (billing-provider.service.ts:73)
    at Injector.instantiateClass
```

Gemessen, durch Starten des Backends mit `STRIPE_SECRET_KEY`:

```
$ STRIPE_SECRET_KEY=sk_test_… npx ts-node src/main.ts
$ curl http://localhost:3000/health
HTTP 000            ← der Server antwortet gar nicht
```

**Die Anwendung startet nicht.** Nicht „die Zahlungsseite ist kaputt" —
**alle Kanzleien, alle Benutzer, die ganze Plattform ist unten.** Und der
Fehler fällt genau in dem Moment auf, in dem man Stripe **konfiguriert**,
also beim Going-live. Wer die Konfiguration zum ersten Mal setzt, bekommt
einen Server, der nicht startet, und eine Fehlermeldung, die nach einem
fehlenden `npm install` aussieht.

#### Warum das so lange unbemerkt blieb

Der Code ist **richtig gebaut** — er prüft die Signatur über Stripe'
`constructEvent`, er braucht den rohen Body, er prüft den Provider-Modus.
Nur die **Abhängigkeit** fehlte. Und weil im Pilot der Mock-Provider läuft
(`handleWebhook()` liefert immer `null`), wird der Stripe-Pfad **nie
berührt** — weder beim Test noch im Betrieb.

Der Lazy-Load-Kommentar im Code sagt: *„Damit bleibt das Backend auch ohne
`npm install stripe` lauffähig."* Das ist richtig — und genau deshalb ist
der Fehler so leicht zu übersehen: Der Zustand „ohne Stripe" ist der
Normalzustand, der Zustand „mit Stripe" der Ausnahmezustand — und der
Ausnahmezustand war nie lauffähig.

#### Behoben

`stripe` ist jetzt eine reguläre Abhängigkeit (`"stripe": "^23.0.0"`).
`npm ci` installiert sie, und der Start mit `STRIPE_SECRET_KEY` gelingt:

```
[Nest] [StripeProvider]        Stripe-SDK gefunden
[Nest] [BillingProviderService] Billing-Provider: STRIPE (Live-Mode)
$ curl /health  ->  HTTP 200
```

**Nicht** geändert: das Fail-fast beim Start. Ein defekter Zahlungsanbieter
muss die Anwendung **nicht** stillschweigend mit einem Mock-Betreiber
weiterlaufen lassen — wer Stripe konfiguriert hat, will echte Zahlungen,
und ein stilles Umschalten auf Mock wäre das Gegenteil von „fail-closed".
Der Start bricht ab, und nach dieser Korrektur bricht er nur noch ab, wenn
die Abhängigkeit wirklich fehlt.

#### Und die Abnahme, die dazugehört (TODO-8.18)

`backend/scripts/verify-billing-webhook.sh` startet das Backend im
**Stripe-Modus**, prüft, dass der Provider wirklich `STRIPE` ist (nicht
Mock), und führt `e2e/billing-webhook-stripe.e2e.spec.ts` aus:

| Fall | Erwartung |
|---|---|
| korrekt signiertes Webhook (mit dem echten SDK signiert) | 200 `{received:true}` **und** `kanzlei.subscriptionTier` wechselt |
| gefälschte Signatur | nicht 200, **Tarif bleibt unverändert** |
| mit dem **leeren** Secret gerechnete Signatur | nicht 200, Tarif bleibt unverändert |

Der dritte Fall ist der fail-closed-Nachweis aus Nachtrag 46: Wäre der
Default wieder `''`, könnte genau diese Signatur jemand berechnen.

**Negativprobe der Abnahme** (`@Public()` entfernt, Skript neu gestartet):

```
× ein korrekt signiertes Webhook setzt den Tarif
    Antwort: {"message":"Nicht authentifiziert",…}: expected 401 to be 200

FEHLGESCHLAGEN — der Zahlungsweg ist NICHT abgenommen.
```

**Im Pilotbetrieb wird diese Abnahme nicht ausgeführt** — dort fehlen die
Variablen, und `describe.skipIf` lässt die Spec überspringen. Das ist
Absicht: Eine Abnahme, die ihr Ziel nicht erreicht, ist keine Abnahme. Sie
muss **einmal vor dem ersten bezahlten Mandanten** laufen, und zwar gegen
eine Umgebung mit echtem `STRIPE_WEBHOOK_SECRET`.

#### Und noch eine Klasse, die man nur durch Messen sieht

Bei der Suche nach diesem Befund habe ich drei Test-Artefakte gefunden, die
alle **durch eine fehlerhafte Messung** entstanden sind:

1. Ein neu angelegter Mandant war dem Admin **nicht zugewiesen** — die
   Bilanz-Erstellung schlug mit 403 fehl, das „Löschen mit Daten" war damit
   sinnlos, und ich hätte „409 verhindert das Löschen" gemeldet, ohne je
   Daten angelegt zu haben.
2. `GET /api/api-keys` lieferte **0 Einträge**, weil der Key nicht erzeugt
   worden war — ich hätte „die Liste gibt kein Secret aus" gemeldet, ohne
   jemals eine Liste gesehen zu haben.
3. `GET /api/subscription/tiers` lieferte **401**, weil ich **ohne Token**
   gerufen hatte — ich war bereits sicher, das sei derselbe Defekt wie beim
   Billing-Webhook (Nachtrag 46). Der Browser widerlegte mich.

**Merksatz:** In allen drei Fällen hätte das Zwischenresultat als
Befund ausgesehen. Rettend war jedes Mal, dass ich den **Zwischenschritt
mit ausgegeben** habe — der 403, die 0 Einträge, der 401. Ein Endresultat
ohne den Weg dorthin ist eine Behauptung.

---

### Nachtrag 2026-10-19 (Nachtrag 53): Die letzten Routen der Bestandsaufnahme — alle halten

Die Bestandsaufnahme hatte 38 Routen ohne Backend-Test markiert. Nach
Nachtrag 46 (Stripe-Webhook), 48 (MFA) und 52 (Stripe-Installation) sind
die **inhaltlich interessanten** davon durchgemessen. Der Rest, zuletzt:

#### `GET /api/ebilanz/preview/:bilanzId/:guvId/:anhangId` — drei IDs, ein Mandant

Die Route nimmt **drei** Objekte entgegen. Was passiert, wenn sie aus
verschiedenen Mandanten stammen?

```
alle drei aus Mandant A                    -> 200, echte Daten
Mischung: Bilanz aus A, GuV+Anhang aus B  -> 404 "GuV nicht gefunden"
alle drei aus B, im Kontext von A          -> 404 "Bilanz nicht gefunden"
```

**Kein Byte aus B in der Antwort** (geprüft). Die Mandanten-Konsistenz
über drei Objekte hinweg wird erzwungen. ✅

#### `POST /api/konsolidierung/einheiten` — Mandant einer fremden Kanzlei als Tochter

```
Konsolidierungseinheit mit mutterMandantId=A,
tochterMandantIds=[Mandant aus Kanzlei 2]
  -> 403 "Kein Zugriff auf Mandant … (Mandant-Trennung)"
```

✅ — ein Konzern lässt sich nicht über Kanzlei-Grenzen hinweg zusammenbauen.

#### `DELETE` — der destruktivste Einzelpfad

| Fall | Ergebnis |
|---|---|
| `DELETE /anhang/:id` auf einen Mandanten einer **fremden Kanzlei** | **403**, das Objekt lebt |
| derselbe Aufruf durch den Admin **dieser** fremden Kanzlei | 204, gelöscht |
| `DELETE /api-keys/:id` | 204 — und der Key ist **widerrufen**, nicht gelöscht (`revokedAt` gesetzt) |
| `DELETE /webhook-subscriptions/:id` | 204, entfernt |

Beim API-Key wird die **Kanzlei des Keys** geprüft (`assertKanzleiAdminAccess(key.kanzleiId, user)`), nicht der Aufrufkontext — richtig, denn der Schlüssel gehört der Kanzlei, die ihn ausgestellt hat.

#### Und die restlichen Lese-Routen

```
GET /api/branding/:kanzleiId              -> 200 (Farben, logoUrl)
GET /api/branding/:kanzleiId/logo/blob    -> 204 (kein Logo hinterlegt)
GET /api/subscription/:kanzleiId/portal   -> 200 {"url":"/api/subscription?mock_portal=1"}
GET /api/wp/bilanz/:id/regeln             -> 200 []
GET /api/wp/bilanz/:id/pruefungen         -> 200 []
```

Alle ✅.

#### Stand der Bestandsaufnahme

| | |
|---|---|
| Routen ohne Backend-Test | 38 |
| **davon echte Befunde** | 3 (Stripe-Webhook, MFA-Aktivierung, Kreuzungstyp) |
| **davon Verdachtsstellen, entkräftet** | 13 |
| **davon echte Befunde mit Beleg, aber ohne Code-Änderung** | 2 (Saldoabgleich, Signatur-Bypass) |
| **davon bewusste Lücken, dokumentiert** | 1 (Entwurfs-PDF, TODO-8.9) |
| offen für eine Fachentscheidung | 2 (TODO-8.9, TODO-8.15) |

**Die Liste ist damit abgearbeitet.** TODO-8.19 kann als erledigt gelten —
außer den beiden Fachentscheidungen, die ausdrücklich nicht meine sind.

---

### Nachtrag 2026-10-19 (Nachtrag 54): Jedes Löschen eines Mandanten hat die Audit-Kette seiner Kanzlei **dauerhaft** zerstört

**TODO-8.14 ist damit geschlossen — und die Ursache ist kein „fremder
Schreiber", sondern die Datenbank selbst.**

#### Die Reproduktion (vier Schritte, nur über die öffentliche API)

```
(1) POST   /api/mandant          -> 201, Audit-Eintrag mit mandantId=<id>
                                      (der Hash deckt den Zeileninhalt ab)
(2) DELETE /api/mandant/<id>      -> 204
(3) AuditLog.mandantId ist jetzt NULL, entryHash unveraendert
(4) GET    /api/audit/integrity   -> BROKEN
```

#### Die Ursache

`AuditLog.mandantId` ist ein **Fremdschlüssel** auf `Mandant`. Prisma setzt
bei optionalen Relationen `onDelete: SetNull` — **die Datenbank** setzt die
Spalte auf NULL, wenn der Mandant gelöscht wird.

Und `mandantId` war Teil des **gehashten Inhalts**. Der gespeicherte Hash
passte damit nach dem Löschen nicht mehr zum Datensatz — und Hashes sind
unveränderlich, es repariert sich nicht.

#### Zwei Folgen, beide schwer

1. **Die Kette bricht dauerhaft.** `verifyIntegrity()` bricht beim ersten
   inkonsistenten Knoten ab — **jeder Eintrag danach ist nicht mehr
   verifizierbar.** Und weil der Bruch von einer ganz normalen
   Fachoperation stammt (Mandant löschen), sieht er für einen Auditor
   **aus wie Manipulation**.

2. **Das Löschen ist eine ganz normale Funktion.** `DELETE /api/mandant/:id`
   existiert, ist freigegeben und wird von Tests benutzt. Das ist kein
   Exotik-Fall, sondern Normalbetrieb.

#### Und wie ich es fast nicht gefunden hätte

Der Einzelfall war lange als „unbekannter zweiter Schreiber" im Konto
(„die Zeile wurde von außerhalb der Anwendung verändert"). Diese
Erklärung war **falsch** — sie entstand aus zwei Messfehlern:

1. Mein Vergleichsskript hat **nur die Top-Level-Schlüssel** sortiert; die
   Produktions-Kanonisierung sortiert **rekursiv**. Die gemeldete
   Abweichung in `newState` war mein Skript, nicht die Datenbank.
2. Ich hatte `sequenz` (BIGINT) mit `=== 249` verglichen — `BigInt !== Number`
   — und deshalb „Eintrag nicht gefunden" gelesen, während er da war.

Erst als ich **die Produktionsfunktion selbst** aufrief
(`service.serializeForHashing()`, private, aber aufrufbar) statt sie
nachzubauen, wurde das Bild klar.

**Merksatz:** Wer eine Funktion zum Vergleich nachbaut, misst die
Nachbildung. Der erste Unterschied, den man findet, ist fast immer der
Unterschied zwischen der Nachbildung und dem Original.

#### Behoben

Der Hash schützt jetzt den **Inhalt** eines Eintrags — Aktion, Entität,
`previousState`/`newState`, IP, User-Agent, Zeitpunkt — und **nicht** die
**Referenzen**, die die Datenbank von sich aus ändert:

```ts
const AUDIT_REFERENZ_FELDER: ReadonlySet<string> = new Set([
  'mandantId', 'userId', 'jahresabschlussId', 'kanzleiId',
]);
```

**Dass die Identität der Entität trotzdem geschützt bleibt, liegt am
Audit-DTO:** `toAuditDto()` schreibt die `id` (beim Mandant auch die
`kanzleiId`) in `newState`/`previousState` — also **in den gehashten
Inhalt**. Der Ausschluss der Referenz kostet also keine Information.

**Und das Verhalten ist richtig:** Nach dem Löschen bleibt die
Aufzeichnung „Mandant wurde angelegt" erhalten, nur ohne Verweis auf einen
nicht mehr existierenden Mandanten. Genau das wollte die Datenbank mit
`SetNull` erreichen — sie hat es nur auch den Hash kaputt gemacht.

#### Negativprobe

Ausschluss der Fremdschlüssel entfernt, Server neu gestartet:

```
× die Kette bleibt nach dem Löschen eines Mandanten intakt
    nach dem Löschen eines Mandanten: BROKEN heisst, dass die Datenbank
    den gehashten Inhalt veraendert hat — ...
    expected 'BROKEN' to be 'OK'
```

Regressions-test: `audit-kette-mandant-loeschung.e2e.spec.ts` — legt einen
Mandanten an, prüft die Kette, löscht ihn, prüft die Kette **und** dass der
Audit-Eintrag mit `mandantId = null` erhalten bleibt.

---

### Nachtrag 2026-10-19 (Nachtrag 55): Drei Lücken geschlossen — MFA war vorhanden, aber unerreichbar

#### TODO-8.17: Ein abgebrochener Testlauf beschaedigte den Audit-Trail

`audit-integrity.service.spec.ts` raeumt seine Zeilen nach `entityId:
hash-chain-test-<Date.now()>` auf — **nach genau diesem Tag**. Ein
abgebrochener Lauf hinterlaess Zeilen, die **kein folgender Lauf mehr
entfernen kann** (dessen Tag ist ein anderer). Diese Zeilen sind ungehasht
oder falsch verkettet und liegen in der Kette mit `kanzleiId = null` — jede
spaetere Pruefung der gesamten Kette liefert dann **PARTIAL statt OK**.

Ein abgebrochener Testlauf hat damit den Audit-Trail der Entwicklungsdatenbank
beschaedigt. Behoben: **fester Praefix**, und es wird **vor und nach** dem
Lauf aufgeraeumt — damit ist in jedem Lauf alles raeumbar, was der
vorherige hinterlassen hat.

#### TODO-8.16: Eine Zusage im Kommentar, die 60 Zeilen tiefer eingeloest war

Der `dns.controller.ts` versprach im Kommentar *„Beide erfordern
KANZLEI_ADMIN oder SYSTEM_ADMIN"* — der Controller trägt weder `@Roles` noch
`@RequireMandant`, und der globale `RolesGuard` lässt eine Route ohne
`@Roles` durch. Die Autorisierung liegt **ausschließlich** im Service.

Gemessen (Nachtrag 44): die Sperre **hält**, auch kanzleiübergreifend. Der
Kommentar wurde trotzdem richtiggestellt, mit der Begründung — und **ohne**
`@Roles` nachzuziehen: die Mandantenzugehörigkeit (diese Kanzlei, nicht eine
andere) kann ein Rollen-Dekorator gar nicht ausdrücken. Ein Rollen-Dekorator
**zusätzlich** zum Service einzuziehen hieße, die Regel auf zwei Orte zu
verteilen.

#### TODO-8.20: MFA war vorhanden — und von niemandem benutzbar

`/auth/totp/setup`, `/auth/totp/enable` und `/auth/totp/disable` waren
vorhanden, korrekt abgesichert (Nachtrag 48) — und **von der Oberfläche aus
nicht erreichbar**. `grep -rn "totp" frontend/src` fand nur die Verwendung im
Login.

Das ist die unangenehmste Lücke: Die Funktion existiert, sie ist richtig, und
**niemand kann sie benutzen**. Wer MFA aktivieren wollte, musste die Route
von Hand aufrufen.

Neu: `Einstellungen → Sicherheit` mit der Komponente `MfaSettings`:

| Zustand | Oberfläche |
|---|---|
| MFA inaktiv | Status „Nicht aktiv", Knopf „MFA einrichten" |
| Einrichtung | QR-Code + Secret (für Apps ohne Kamera), Code-Feld, Passwort-Feld |
| MFA aktiv | Status „Aktiv", Knopf „MFA deaktivieren" |
| Deaktivierung | Passwort **und** Code (entspricht der Backend-Regel) |

**Die Dialoge folgen den Backend-Regeln, nicht eigenen Vorstellungen:**
Das Aktivieren verlangt das **Passwort** (Nachtrag 48 — sonst könnte
jemand mit gestohlenem JWT das MFA des Opfers übernehmen), das Deaktivieren
verlangt **Passwort und Code** (sonst wäre ein verlorenes Gerät ein Weg aus
dem Konto heraus).

**Test:** `mfa-einrichtung.spec.ts` geht den ganzen Weg — Status „Nicht
aktiv" → Dialog → **falscher** Code wird abgewiesen → **gültiger** Code
aktiviert → Status „Aktiv" → deaktivieren → Ausgangszustand.

Der Test rechnet den Code mit **derselben Bibliothek, mit der das Backend
prüft** (`otplib@^12`, in beiden Paketen gepinnt). Eine eigene
TOTP-Nachbaut wäre genau die Falle aus Nachtrag 54.

**Negativprobe** (`onClick` vom Knopf entfernt — der Knopf wird tot):

```
× einrichten und wieder deaktivieren
    Error: der QR-Code muss erscheinen
```

**Zur Version von `otplib`:** `npm install otplib` im Frontend zog zunaechst
v13, dessen API kein `authenticator` mehr kennt. Das Backend nutzt v12. Der
Test haette mit v13 **falsch** gerechnet — und der Test waere rot
gewesen, ohne dass jemand den Grund gesehen haette. Beide Pakete sind jetzt
auf `^12.0.1` gepinnt.

---

### Nachtrag 2026-10-20 (Nachtrag 56): In vier von fünf Fällen wurde quittiert, **bevor** der Nachweis existierte

#### Der Befund

TODO-8.8 stand seit Nachtrag 31 offen: *„Audit-Trail fire and forget
(~50 Stellen)".* Die Vermutung war bisher, dass das ein Performance-Thema
sei. Es ist ein **Nachvollziehbarkeits**-Thema, und es ist gemessen.

Gemessen über die öffentliche API: 20 Mandanten-Anlagen in Folge. Unmittelbar
nach dem Eintreffen der `201`-Antwort in der Datenbank nachgesehen:

| Zustand beim Eintreffen der Antwort | Anteil |
|---|---|
| Audit-Eintrag **fehlt vollständig** | **80 %** |
| Eintrag vorhanden, aber **noch ungehasht** | 15 % |
| vollständig (Eintrag **und** Hash) | 5 % |

Die Verzögerung selbst ist klein — gemessen: Eintrag **+1 bis +2 ms** nach der
Antwort, Hash **+4 bis +5 ms**. Aber diese paar Millisekunden sind genau das
Fenster, in dem die Anwendung abstürzen kann, und sie sind groß genug, dass
der Anwender das Audit-Trail **bei jedem Blick** leers sieht.

Die Konsequenz: **Eine quittierte Aktion war in vier von fünf Fällen nicht
nachvollziehbar.** Für § 146 AO ist das keine Performance-Frage, sondern eine
Lücke in der Nachvollziehbarkeit.

#### Die Ursache: ein `void` an 51 Stellen

```
void this.auditService.record({ ... });
```

Der `void`-Operator verwirft das Promise. Die Methode läuft weiter, der
Aufrufer wartet nicht. Und `record()` selbst schrieb die Hash-Kette wiederum
fire-and-forget (`enqueue()` ohne `await`).

Gemessen: **51 Aufrufstellen in 20 Dateien**, dazu der `AuditInterceptor`
(dort über `recordStrict()` awaited — die einzige Stelle, die es richtig
tat). Der Aufbau war an vielen Stellen korrekt dokumentiert („fire and
forget, damit der Audit-Pfad schnell bleibt") — der Kommentar beschrieb
also einen Zustand, den niemand mehr hinterfragt hat.

#### Die Behebung in drei Teilen

**1. Alle 51 Aufrufstellen warten jetzt.**

`void this.auditService.record({` → `await this.auditService.record({`.

Das ist der eigentliche Fix, und er ist mechanisch — aber er ist nicht
folgenlos: der Audit-Eintrag steht jetzt in der Datenbank, **bevor** die
Antwort den Server verlässt. Ein Prozessabbruch nach der Quittung kann den
Eintrag nicht mehr verlieren.

**2. Die Hash-Kette wartet auf den *eigenen* Eintrag.**

`record()` wartete bisher nicht auf den Hash. Damit konnte der Aufrufer
nicht wissen, ob sein Eintrag gehasht ist — er hätte auf „die Warteschlange
ist leer" warten müssen.

`hashNaechstenOffenen()` nahm jetzt die ID des aufrufenden Eintrags und
beendet den Durchlauf, sobald **dieser** Eintrag einen Hash hat:

```ts
if (bisId && offen.id === bisId) return;
```

Die Kettenintegrität bleibt unberührt: gehasht wird weiterhin in
`sequenz`-Reihenfolge, und der Vorgänger eines Eintrags hat immer eine
kleinere `sequenz` — er ist also gehasht, **bevor** der Nachfolger drankommt.
Ohne diese Eigenschaft wäre der Vorgänger noch ungehasht und der Hash
fiele auf Genesis zurück — genau der Fehler aus Nachtrag 41.

**3. Ein Wächter erkennt eine stehengebliebene Kette.**

Das ist die in Nachtrag 31 vorgeschlagene *„Condition auf Alter des ältesten
Eintrags"*. `/health/ready` weist jetzt zusätzlich aus:

```
auditOldestUnhashedAgeMs: number | null
```

`null` heißt: die Kette ist vollständig. Normalerweise liegt der Wert bei
ein paar Millisekunden. Übersteigt er die Schwelle (`AUDIT_CHAIN_STALL_MS`,
Vorgabe 60 s), gilt der Dienst als `degraded`.

Ohne diese Größe gibt es keinen Unterschied zwischen „die Kette arbeitet
gerade" und „die Kette ist tot" — beide sehen aus wie ein einzelner
ungehashter Eintrag.

#### Die Negativprobe: **deterministisch**, nicht geraten

Ein Test der Form „ist der Eintrag *irgendwann* da?" wäre ein Wettlauf: ohne
den Fix wäre er zu etwa 80 % rot, mit dem Fix immer grün. Als Regressionsschutz
brauchbar, als Nachweis schwach — und ein Test, der nur *manchmal* rot wird,
wird irgendwann als „flaky" abgetan und stillschweigend entschärft.

Gemessen wird deshalb die **Reihenfolge**, nicht das Zeitfenster: der
Audit-Write wird in einer Sperre angehalten, und geprüft wird, ob die
Fachmethode **darauf wartet**. Das ist eine Eigenschaft des Codes, keine
Frage des Timings.

```
e2e/audit-quittierung.e2e.spec.ts
```

**Mit dem Fix zurückgebaut** (`await` → `void` in `mandant.service.ts`):

```
× kehrt nicht zurueck, bevor der Audit-Eintrag geschrieben ist
  → die Fachmethode ist zurueckgekehrt, obwohl der Audit-Eintrag noch fehlt.
    Die Aktion wird quittiert, bevor sie nachvollziehbar ist — fuer die
    Nachvollziehbarkeit nach § 146 AO ist das ein Loch, kein Timing-Problem.
    expected true to be false
```

```
× der Audit-Eintrag existiert ueber die oeffentliche API, sobald die Antwort da ist
  → der Audit-Eintrag hat keinen Hash — die Hash-Kette laeuft der
    Quittierung hinterher
```

Rot aus dem **richtigen** Grund: nicht „Datenbank kaputt", nicht „Timeout",
sondern die Zusicherung, die den geprüften Code erreicht. (Zur Erinnerung aus
Nachtrag 54: der Test ruft die echte `MandantService.create()` auf — ersetzt
wird nur der Audit-Schritt, und nur durch eine Sperre, die an der Reihenfolge
nichts ändert.)

Zweiter Teil des Tests, schwarz-box über die laufende Instanz: nach der
`201`-Antwort muss der Eintrag **und** sein Hash in der Datenbank stehen.

#### Was ausdrücklich **nicht** behoben wurde

Nachtrag 31 schlug vor: *„Fachschreibvorgang + Audit in eine Transaktion."*
Das ist die **ideale** Lösung — Fachvorgang und Nachweis würden atomar
committen, und ein Abbruch zwischen beiden wäre unmöglich.

Sie ist hier **nicht** umgesetzt, und der Grund ist kein Aufwand:

Die Hash-Kette braucht eine **Totalordnung aus der Datenbank** (`sequenz`).
Würde der Audit-Eintrag in derselben Transaktion wie der Fachvorgang
geschrieben, müsste sein Hash *vor* dem Commit bekannt sein — der Vorgänger
müsste also bereits gehasht sein. Das ist bei parallelen Schreibvorgängen
nicht der Fall, und genau daran ist Nachtrag 41 gescheitert: der Vorgänger
war noch ungehasht, der Hash fiel auf Genesis zurück, die Kette verzweigte.

Die Transaktionslösung verlangt also eine andere Kettentechnik (Hash im
selben Lauf wie der Insert, mit Datenbanksperre) — das ist die
`pg_advisory_xact_lock`-Frage aus TODO-8.13 und eine eigene Entscheidung.

**Der hier geschlossene Teil ist der, der messbar war:** die Quittierung
erfolgt nicht mehr vor dem Nachweis. Der Rest ist als Restidee dokumentiert,
nicht als Erledigung.

#### Ein zweiter Fund im selben Lauf: das Lockfile

Beim Push von Nachtrag 55 schlug der Frontend-Job der CI **fehl**, noch
bevor irgendetwas getestet wurde:

```
npm error `npm ci` can only install packages when your package.json and
npm error package-lock.json or npm-shrinkwrap.json are in sync.
npm error Missing: @swc/helpers@0.5.23 from lock file
```

**Ursache:** `npm install --save-dev otplib@^12.0.1` (Nachtrag 55) hat mit
dem **lokalen npm 11.9.0** den verschachtelten Lockfile-Eintrag
`next-intl/node_modules/@swc/helpers@0.5.23` **entfernt**. Dieser Eintrag
existierte genau deshalb, weil `next-intl/node_modules/@swc/core` die
Peer-Abhängigkeit `@swc/helpers >= 0.5.17` hat — die gehoiste Version
0.5.15 erfüllt sie nicht.

Lokal fiel das **nicht auf**: `npm ci --dry-run` meldete „up to date", weil
das lokale `node_modules` den Zustand schon hatte. Die CI installiert
sauber aus dem Lockfile — und dort ist der Peer unerfüllt.

Die CI benutzt node 22 → **npm 10**; lokal lief **npm 11**. Die beiden
Major-Versionen lösen die optionale Peer-Abhängigkeit unterschiedlich.

**Behoben:** Das Lockfile wurde mit `npm@10` regeneriert (der Major-Version,
die die CI benutzt). Der Diff sind **genau die 11 Zeilen**, die das
`npm install` gelöscht hatte.

**Gegenprobe** (Clean-Room, nur `package.json` + `package-lock.json`, `npm@10 ci`):

| Lockfile | Ergebnis |
|---|---|
| das gepuschte (kaputt) | `npm error Missing: @swc/helpers@0.5.23 from lock file` — **exakt der CI-Fehler** |
| das regenerierte | `npm ci` **Exit 0** |

**Die Lehre für die Pipeline:** Ein Lockfile wird von der npm-Version
geschrieben, die der Entwickler benutzt — und von der CI gelesen, die eine
andere benutzt. Die beiden muessen **dieselbe Major-Version** haben, sonst
schreibt der Entwickler ein Lockfile, das die CI nicht installieren kann.
Das ist im Repo als Pflicht festgehalten (siehe `AGENTS.md` § 3.7).

---

### Nachtrag 2026-10-20 (Nachtrag 57): Der Signier-Knopf war fuer jeden sichtbar — und die Regel stand an fuenf Stellen

#### Der Befund

TODO-8.12: *„Der Signier-Knopf ist an 5 Stellen ohne Rollenpruefung sichtbar.
Ein STEUERBERATER traegt P12 hoch, gibt das Passwort ein und erhaelt 403."*

**Die Formulierung war ungenau — und genau das waere beim Beheben teuer
geworden.** Gemessen an den Dekoratoren des Controllers:

| Route | `@Roles(...)` |
|---|---|
| `sign-bilanz` | WIRTSCHAFTSPRUEFER, STEUERBERATER |
| `sign-guv` | WIRTSCHAFTSPRUEFER, STEUERBERATER |
| `sign-anhang` | WIRTSCHAFTSPRUEFER, STEUERBERATER |
| `sign-abschluss` | WIRTSCHAFTSPRUEFER **nur** |
| `inspect-p12` | WIRTSCHAFTSPRUEFER, STEUERBERATER |

Ein STEUERBERATER darf also **Bestandteile** signieren — der 403 traf nur
den **Jahresabschluss** (und jeden, der gar keine Signaturrolle hat, etwa
den KANZLEI_ADMIN). Wer die TODO-Formulierung fuer eine Sperre genommen
haette, haette den Beratern eine erlaubte Faehigkeit weggenommen.

#### Die Ursache: die Regel stand am Aufrufer

```tsx
<ExportActions ... canSign />     // 4 Aufrufstellen
```

`canSign` war ein **Prop** — eine Eigenschaft des Aufrufers. Das ist die
falsche Seite: die Regel wurde an vier Stellen (plus dem Jahresabschluss-
Knopf) festgeschrieben, und sie war an **allen** falsch. `canSign` stand
bedingungslos auf `true`.

#### Die Behebung: eine Stelle, mandantenbezogen

Neu: `frontend/src/lib/session.ts`. Die Regel steht jetzt dort und nirgends
sonst:

```ts
export const SIGNATUR_ROLLEN = ['WIRTSCHAFTSPRUEFER', 'STEUERBERATER'];
export const SIGNATUR_ABSCHLUSS_ROLLEN = ['WIRTSCHAFTSPRUEFER'];
```

`ExportActions` ermittelt die Berechtigung **selbst** — das `canSign`-Prop
ist entfallen. Damit kann eine Aufrufstelle die Regel nicht mehr umgehen,
weil es nichts mehr zu setzen gibt.

**Mandantenbezogen**, genau wie der `RolesGuard` (Nachtrag 40): eine Rolle
aus einem anderen Mandanten berechtigt nicht. Die Oberflaeche bildet drei
Feinheiten des Guards ab:

1. **Alle** Rollen des Mandanten zaehlen, nicht die erste (ein User kann auf
   demselben Mandanten mehrere Rollen haben).
2. Eine Rolle aus einem anderen Mandanten berechtigt nicht.
3. `SYSTEM_ADMIN` darf alles.

Der `SessionUser`-Typ stand dabei an zwei Stellen kopiert (`AppHeader.tsx`,
`WPView.tsx`) — jetzt gibt es eine Quelle.

#### Der zweite Fund: ein Wettrennen zwischen zwei Effects

Der erste Lauf der neuen Tests schlug **fehl** — und zwar in den positiven
Faellen: der Knopf war fuer den Wirtschaftspruefer **nicht** sichtbar.

Ursache: der aktive Mandant stand nur in `localStorage`, und wer ihn
brauchte, musste ihn **raten**:

- der `MandantSwitcher` **schrieb** ihn in seinem eigenen Effect,
- die abhaengigen Komponenten **lasen** ihn in ihrem eigenen Effect.

Wer zuerst kam, gewann. Bei manchen Nutzern blieb der Knopf unsichtbar,
obwohl die Rolle vorhanden war — der Test schlug genau an dieser Stelle
fehl. Und der KANZLEI_ADMIN-Test war **gruen aus dem falschen Grund**: der
Knopf fehlte, weil der Mandant nicht aufgeloest war, nicht weil die Rolle
fehlte. Ein gruener Test aus dem falschen Grund ist schlimmer als ein
roter: er sieht aus wie ein Beweis und ist keiner.

**Behoben, zweistufig:**

1. **Eine Berechnung statt zwei.** `aktiverMandantId(user)` in
   `lib/session.ts` macht genau das, was der `MandantSwitcher` macht:
   gespeicherter Wert, wenn er dem User gehoert — sonst der erste Mandant
   des Users. Beide benutzen jetzt dieselbe Funktion.
2. **Ein Ereignis statt Hoffnung.** `localStorage` loest beim Schreiben
   **kein** `storage`-Event im selben Tab aus (nur in anderen Tabs).
   Deshalb ein eigenes Ereignis `MANDANT_GEAENDERT`: wer den Mandanten
   schreibt, meldet es; wer ihn braucht, hoert zu. `MandantSwitcher`
   schreibt deshalb ueber `setActiveMandantId()` statt direkt in
   `localStorage`.

#### Die Tests

`frontend/e2e/signatur-berechtigung.spec.ts` (neu) und ein Fall in
`jahresabschluss.spec.ts`:

| Nutzer | Erwartung | Warum |
|---|---|---|
| STEUERBERATER | GuV-Knopf **sichtbar** | `sign-guv` erlaubt STEUERBERATER |
| KANZLEI_ADMIN | **kein** Knopf | keine Signaturrolle |
| WIRTSCHAFTSPRUEFER | Knopf **sichtbar** | `sign-guv` erlaubt WP |
| STEUERBERATER | Jahresabschluss-Knopf **nicht** sichtbar | `sign-abschluss`: nur WP |

**Ein bestehender Test musste angepasst werden:** `jahresabschluss.spec.ts`
loggte sich als STEUERBERATER ein und erwartete, dass der
Jahresabschluss-Knopf sichtbar ist — also genau den Knopf, der mit 403
endet. Der Test prueft jetzt als Wirtschaftspruefer (der Fall, in dem der
Knopf **da sein darf**), und ein neuer Fall belegt das Gegenteil.

Das ist der eigentliche Wert des Befunds: Der Test hat den Fehler
**festgeschrieben**. Er war nicht falsch formuliert — er beschrieb die
Oberflaeche, die es gab, und die Oberflaeche war falsch.

#### Die Negativprobe

Zurueckgebaut: die Regel wieder in die Aufrufstellen (`canSign` bedingungslos
setzen, `useSignaturBerechtigung` umgehen) — der Knopf erscheint wieder fuer
jeden, und die Tests schlagen um.

---

### Nachtrag 2026-10-20 (Nachtrag 58): Die Mandantentrennung war **zwoelfmal derselbe Code** — und damit weder Tiefenschutz noch toter Code

#### Die Frage, die offen war

TODO-8.7: *„`assertMandantAccess` in 10 Services — Tiefenschutz oder toter
Code?"* Die Antwort in Nachtrag 34: **über HTTP nicht erreichbar**, weil der
`MandantGuard` identisch zuerst wirft.

Die Frage hatte zwei Antworten im Sinn — *behalten* (Tiefenschutz) oder
*entfernen* (toter Code). Es gibt eine dritte, und die ist die unbequemste:

#### Die dritte Antwort: ungenutzter Tiefenschutz

Gemessen: die Pruefung stand in **zwoelf Services**, jeweils als private
Methode, jeweils mit derselben Logik und derselben Fehlermeldung:

```ts
private assertMandantAccess(mandantId: string, user: AuthUser): void {
  if (user.globalRole === 'SYSTEM_ADMIN') return;
  const accessibleMandantIds = user.mandanten.map((m) => m.id);
  if (!accessibleMandantIds.includes(mandantId)) {
    throw new ForbiddenException('Kein Zugriff auf diesen Mandanten');
  }
}
```

(`mandant.service.ts` ist die **dreizehnte** und eine **andere**: dort darf
ein KANZLEI_ADMIN auch auf einen Mandanten derselben Kanzlei zugreifen, und
das wird ueber die Datenbank geprueft. Sie bleibt dort, weil sie etwas
anderes beantwortet.)

Damit ist die Frage beantwortet:

- **Kein Tiefenschutz**, weil er ueber HTTP nie wirkt — der Guard kommt
  immer zuerst.
- **Kein toter Code**, weil er *koennte* — intern, bei einem Job, bei einem
  kuenftigen Aufruf ohne Guard.
- **Ungenutzter Tiefenschutz** — eine Schranke, die in jedem normalen
  Betriebszustand nie angeruehrt wird.

**Und genau das ist das Gefaehrliche daran.** Ein Tiefenschutz, von dem
niemand weiss, dass er existiert, wird beim Refaktorieren entfernt — und
dann ist die Mandantentrennung weg, ohne dass jemand etwas getan haette.
Nachtrag 34 hat das nicht bemerkt, weil die Frage auf „wirkt er?" lautete
und die Antwort „nein, nur nicht ueber HTTP" lautete. Die Frage nach der
**Form** war die richtige.

#### Dass es zwoelf Kopien waren, war der eigentliche Befund

Die Kopien waren nicht gleich — und genau das ist der Beweis, dass sich die
Kopien auseinanderentwickelt haben. In `abschluss.service.ts` stand:

```ts
// BEFUND 2026-10-17: stand hier `BadRequestException` (400). Neun
// Geschwisterservices ... werfen fuer **denselben Sachverhalt**
// `ForbiddenException` (403). Der neue Service war die einzige Abweichung.
```

Der neue Service war also die **dreizehnte** Abweichung — und niemand hatte
gemerkt, dass es ein Dutzend Kopien gibt, deren Abweichungen niemand
vergleicht. Der Unterschied ist nicht kosmetisch: 400 sagt dem Client
„deine Anfrage ist fehlerhaft" (Formularfehler, Eingabe korrigieren), 403
sagt „du darfst das nicht" (Zugriffsproblem). Ein Client, der 400 bekommt,
versucht typischerweise erneut — mit derselben Wirkung.

#### Die Behebung: eine Kopie, und ein Beweis, dass sie wirkt

Neu: `backend/src/common/utils/mandant-zugriff.ts`. Die zwoelf privaten
Methoden sind entfernt, die Aufrufe gehen an die gemeinsame Funktion. Die
Fehlermeldung ist damit an **einer** Stelle definiert — und kann nicht mehr
auseinanderlaufen.

Der zweite Teil ist der wichtigere: **der Tiefenschutz wurde benutzt, nicht
nur behauptet.**

`e2e/mandant-tiefenschutz.e2e.spec.ts` ruft den Service **direkt** auf —
ohne HTTP, ohne Guard — und prueft:

1. ein fremder Mandant wird mit **403** abgewiesen (der Service wirkt);
2. **Gegenprobe:** der eigene Mandant wird **nicht** abgewiesen.

Die Gegenprobe ist kein Formalismus. Eine Pruefung, die alles abweist, waere
genauso nutzlos wie eine, die nichts abweist — und waere schwerer zu
entdecken. Der Test beweist, dass die Sperre **unterscheidet**.

Dazu ein Unit-Test der Funktion selbst (`mandant-zugriff.spec.ts`) mit
fuenf Faellen, einschliesslich des in Nachtrag 40 gefundenen Details: **alle**
Rollen desselben Mandanten zaehlen, nicht nur die erste.

#### Die Negativprobe

Die Pruefung zur Nicht-Funktion gemacht (`return;` statt `throw`):

```
x Mandantentrennung im Service (ohne HTTP-Guard) > weist den Zugriff auf
  einen fremden Mandanten ab
x assertMandantAccess > weist einen fremden Mandanten mit 403 ab
x assertMandantAccess > weist einen Mandanten ab, zu dem der User gar keine
  Rolle hat
✓ Mandantentrennung im Service > laesst den Zugriff auf den eigenen Mandanten zu
```

Drei Tests rot, **die Gegenprobe gruen** — sie schlaegt genau dann nicht
an, wenn die Sperre ehrlich arbeitet.

---

### Nachtrag 2026-10-20 (Nachtrag 59): Der Saldoabgleich **sperrt** jetzt — mit schriftlich begruendetem Ausweg

**Entscheidung 1 (vom Nutzer bestaetigt): Sperre, aber mit begruendeter Freigabe.**

#### Die Ausgangslage

Der Saldoabgleich zwischen `A.V.` (Jahresueberschuss in der Bilanz) und dem
GuV-Ergebnis war eine **Meldung**: die Abweichung wurde angezeigt, und der
Abschluss ging trotzdem durch. Der Kommentar im Code begruendete das so
(woertlich):

> Warum die Abweichung NICHT sperrt: `A.V.` ist nicht zwangslaeufig das
> Jahresergebnis — Kapitalerhoehungen und Entnahmen verschieben den Saldo,
> ohne in der GuV zu erscheinen, und solche Eigenkapitalbewegungen
> modelliert das Produkt nicht. Eine Sperre wuerde berechtigte Abschluesse
> blockieren.

**Die Begruendung war richtig — und die Konsequenz falsch.** „Blockiert
berechtigte Abschluesse" ist kein Grund, den Fehler *stumm* zu lassen. Ein
Abschluss, dessen Bilanz nicht auf die GuV aufgeht, ist keine Bilanzaussage;
er darf nicht unbemerkt in die Veroeffentlichung gehen.

#### Die Regel jetzt

**Sperre** — ohne Begruendung `409`:

```
Der Saldoabgleich zwischen Bilanz und GuV weicht ab: Die Bilanz weist
999.00 EUR als Jahresueberschuss aus, die GuV dagegen 1000.00 EUR —
Abweichung -1.00 EUR. Das kann an Eigenkapitalbewegungen liegen
(Kapitalerhoehung, Entnahme), die das Produkt nicht erfasst. Wenn das der
Fall ist, kann der Abschluss mit einer schriftlichen Begruendung
(mindestens 20 Zeichen) freigegeben werden — sie geht in den Audit-Trail.
```

**Freigabe** — mit `begruendung` (mindestens 20 Zeichen) geht der Abschluss
durch, und die Begruendung steht im Audit-Trail:

```json
{
  "status": "FINALIZED",
  "saldoabgleich": {
    "abweichung": -1,
    "freigegeben": true,
    "begruendung": "Kapitalerhoehung vom 15.03. ueber 500 EUR, im Produkt nicht erfasst."
  }
}
```

**Die Begruendung gilt ausschliesslich fuer den Saldoabgleich.** Die
anderen Sperren (Bilanz geht nicht auf, GuV fehlt, Anhang mit Platzhaltern,
Saetze in Bearbeitung) sind unabhaengig davon und lassen sich nicht
begruenden — eine Begruendung, die alles freigibt, waere keine Sperre.

#### Die Oberflaeche

Bei der Ablehnung erscheint im Pruefpanel ein **Begruendungsfeld** mit dem
Knopf „Mit Begruendung freigeben". Der Knopf ist erst ab 20 Zeichen aktiv.

#### Die Negativprobe

Die Sperre zur Nicht-Funktion gemacht (die Abweichung wieder nur gemeldet):

```
x Saldoabgleich: eine Abweichung SPERRRT — ohne Begruendung 409
```

Die beiden anderen Tests des Falls (Freigabe mit Begruendung, Mindestlaenge)
bleiben gruen — sie pruefen den Ausweg, nicht die Sperre.

**Ein Detail, das beim Schreiben des Tests auffiel:** die Abweichung ist
**-1**, nicht +1 (A.V. 999 minus GuV 1000). Der erste Testentwurf erwartete
+1 — die Vorzeichen waren vertauscht, nicht der Code.

---

### Nachtrag 2026-10-20 (Nachtrag 60): Eine GuV-Signatur war von einer Abschluss-Signatur **nicht unterscheidbar**

**TODO-8.15 (vom Nutzer bestaetigt): zulaessig, aber mit trennendem Modellfeld.**

#### Der Fund, der hinter der Frage steckte

Die Frage lautete: duerfen `sign-guv` / `sign-anhang` am offenen Aggregat
signieren? Gemessen: 2 Signaturen + 5 WORM-Objekte bei `status: DRAFT`.

Die Frage war richtig — aber der eigentliche Befund lag eine Ebene tiefer und
wurde erst beim Nachsehen der Daten sichtbar:

`resolveJahresabschlussId()` legt **auch** eine Komponentensignatur auf die
`jahresabschlussId`-Achse, wenn der Bestandteil zu einem Jahresabschluss
gehoert. Und dann setzt der Schreibpfad die andere Achse auf `null`:

```ts
jahresabschlussId: abschlussId,
entityType: abschlussId ? null : entityType,   // <- null!
entityId: abschlussId ? null : entityId,       // <- null!
```

**Ergebnis:** in der Tabelle `signature` sah eine GuV-Signatur **exakt aus
wie eine Abschluss-Signatur**. Ein Auditor, der die Signaturliste des
Jahresabschlusses las, musste „der Jahresabschluss ist signiert" verstehen —
obwohl nur die GuV geprueft war.

Das ist keine theoretische Verwechslung: die Vier-Augen-Kontrolle fuer den
**Abschluss** haengt genau an dieser Unterscheidung. Und es war genau die
Frage, die das Modellfeld beantworten sollte.

#### Die Regel jetzt

**Komponentensignaturen bleiben zulaessig.** In der Praxis prueft ein
Wirtschaftspruefer die GuV, *bevor* der Abschluss final ist — eine Sperre
wuerde den Arbeitsablauf behindern.

**Und sie werden getrennt ausgewiesen.** Neu: `signature.signaturEbene`

| Wert | Bedeutung |
|---|---|
| `ABSCHLUSS` | der Jahresabschluss selbst wurde signiert (Endabnahme) |
| `BESTANDTEIL` | ein Bestandteil wurde geprueft |

Der **Default** ist `BESTANDTEIL` — das ist der sichere Default: eine
Komponentensignatur wird nicht versehentlich als Endabnahme gelesen.

**Und beide Bezugsachsen werden belegt:** `entityType`/`entityId` sagen, was
signiert wurde, `jahresabschlussId` sagt, zu welchem Aggregat es gehoert.
Vorher war das nicht unterscheidbar.

#### Die Status-API

Fuer einen Jahresabschluss zaehlt jetzt **nur** die Abschluss-Signatur als
„signiert":

```json
{
  "status": "UNSIGNIERT",
  "anzahlSignaturen": 0,
  "anzahlBestandteilPruefungen": 1,
  "signaturEbene": "BESTANDTEIL",
  "hinweis": "Der Jahresabschluss ist NICHT signiert. Geprueft wurden bisher 1
              Bestandteil(e) — eine Bestandteilpruefung ist keine Endabnahme
              (§ 146 AO, Vier-Augen-Kontrolle)."
}
```

#### Die Oberflaeche

Das Badge unterscheidet jetzt zwei Zustaende, die vorher derselbe waren:

* `✓ Signiert` — der Jahresabschluss selbst ist signiert
* `⚠ 1× Bestandteil geprüft — nicht signiert` — es wurden Bestandteile
  geprueft, die Endabnahme fehlt

#### Die Negativprobe

Die Ebenen-Trennung ausgeschaltet (alle Signaturen des Aggregats zaehlen
wieder als Endabnahme):

```
x der Jahresabschluss gilt NICHT als signiert, wenn nur die Bilanz geprueft wurde
```

#### Die Migration

```sql
ALTER TABLE "signature" ADD COLUMN "signaturEbene" TEXT NOT NULL DEFAULT 'BESTANDTEIL';
```

Die Altbestandszeilen werden **nicht** geraten: als `ABSCHLUSS` gilt nur,
was selbst ein WORM-Objekt vom Typ `ABSCHLUSS_PDF_SIGNED` mit derselben ID
traegt. Alles andere bleibt `BESTANDTEIL` — im Zweifel die niedrigere Stufe.

---

### Nachtrag 2026-10-20 (Nachtrag 61): Ein Entwurf war ein **10 Jahre unwiderruflicher Beweis**

**TODO-8.9 (vom Nutzer bestaetigt): Variante b — eigener EntityType, eigener Prefix, kein Object-Lock.**

#### Der Befund

Vier Routen (`pdf/{bilanz,guv,anhang,abschluss}/:id/generate`) legten ihr
Ergebnis im Beweis-Archiv ab — mit 10-Jahres-Object-Lock COMPLIANCE — **ohne
jede Statuspruefung**. Das gilt fuer Entwuerfe genauso wie fuer abgeschlossene
Saetze.

Fachlich ist das falsch. Ein Entwurf ist ein Arbeitsstand: er wird geaendert,
verworfen, neu erzeugt. Unwiderruflich archiviert waere er danach ein
„Beweis" fuer einen Stand, den niemand freigegeben hat — und er waere nach
zehn Jahren **nicht mehr loeschbar**, auch nicht von einem Administrator.

#### Die Regel jetzt

| | Entwurf (DRAFT) | Beweisobjekt (VALIDATED / FINALIZED) |
|---|---|---|
| `entityType` | `BILANZ_PDF_ENTWURF` u. a. | `BILANZ_PDF` u. a. |
| Key-Praefix | `entwuerfe/mandant/…` | `mandant/…` |
| Object-Lock | **keiner** | COMPLIANCE |
| Retention | 0 Tage | 3650 Tage (10 Jahre) |
| Legal Hold | nein | ja |
| Dateiname | `entwurf-bilanz-…pdf` | `bilanz-…pdf` |

**Der Dateiname traegt die Unterscheidung mit.** Er ist Teil der Ablage: wer
die Datei aus dem Archiv zieht, muss sehen, dass sie kein Beweis ist.

**Der Download liefert den Entwurf aus** (zuerst wird das Beweisobjekt
gesucht, dann der Entwurf) — der Entwurf ist ein Arbeitsstand, an dem man
arbeiten muss.

#### Der Wächter, der sonst fehlgeschlagen wäre

`audit-worm-retention.sh` prueft **jede** Zeile der `worm_object`-Tabelle auf
COMPLIANCE + mindestens 3650 Tage. Ein Entwurf darin waere als **Fehlalarm**
in einem Compliance-Bericht gelandet — zwei Fehlalarme pro Entwurf.

Das Skript ueberspringt die Zeilen mit `object_lock_mode = 'NONE'` — und
**zaehlt sie**:

```
Entwuerfe (kein Object-Lock, nicht auditierbar): 3
-> Entwuerfe sind Arbeitsstaende (Nachtrag 61, TODO-8.9) und gehoeren
   nicht in den 10-Jahres-Nachweis. Gezaehlt, nicht stillschweigend ignoriert.
```

Eine stillschweigende Ausnahme waere eine Ausnahmeliste, die veralten kann;
eine gezaehlte ist nachvollziehbar.

#### Die Folge, die zuerst auffiel: die Liste fand den Entwurf nicht

Die erste Umsetzung brach **einen** bestehenden Test: `pdf-strecke.spec.ts`
("nach dem Erzeugen muss ‚Ansehen' verfügbar sein") wurde rot.

Ursache: die Listen holen den PDF-Schluessel ueber den WORM-Objekt-Register
mit einem **festen** EntityType:

```ts
entityType: 'BILANZ_PDF',    // <- der Entwurf heisst BILANZ_PDF_ENTWURF
```

Der Entwurf wurde also abgelegt, aber in der Liste **nicht gefunden** — der
Anwender konnte sein gerade erzeugtes PDF weder ansehen noch herunterladen.
Der Knopf verschwand, weil die Liste `null` lieferte.

**Behoben:** alle sechs Listen-Lookups (Bilanz/GuV/Anhang, je mit und ohne
Jahresfilter) beruecksichtigen jetzt **beide** EntityTypes:

```ts
entityType: { in: ['BILANZ_PDF', 'BILANZ_PDF_ENTWURF'] },
```

**Und die Liste sagt jetzt, ob es ein Entwurf ist** (`pdfIstEntwurf`).
Das ist nicht Kosmetik: der Hinweis unter den Knöpfen lautete bisher
*"WORM-archiviert (10 Jahre, § 147 AO)"*. Fuer einen Entwurf waere das eine
**falsche Aussage** — er liegt gerade **nicht** im Beweis-Archiv. Er lautet
jetzt: *"Entwurf – nicht im Beweis-Archiv, nicht aufbewahrt"*.

Das ist der Grund, warum der Durchbruch hier so sichtbar war: die Oberflaeche
hat einen vorhandenen Test, der genau diese Zusage prueft. Ein Test, der die
falsche Zusage **festgeschrieben** haette, waere bei einer Aenderung der
Regel still geblieben.

#### Die Negativprobe

Der Entwurf wieder ins WORM-Archiv geschickt:

```
x eine Bilanz auf DRAFT: eigener EntityType, eigener Prefix, KEIN Object-Lock
```

Die **Gegenprobe** (eine VALIDATED-Bilanz geht unveraendert ins Beweis-Archiv)
und der Download-Test bleiben gruen.

Der Test prueft **beide** Seiten: das Manifest in der Datenbank **und** das
Objekt im Speicher (HEAD gegen den S3-Mock). Eine DB-Zeile kann behaupten,
was sie will — am Objekt im Speicher steht, ob es wirklich gesperrt ist.

---

### Nachtrag 2026-10-20 (Nachtrag 62): Die Zustandsmaschine existierte — nur ohne Schreibpfad

#### Der Befund

TODO-8.10: *„`SIGNED → SUBMITTED → PUBLISHED` haben Beschriftung und Typ, aber
keinen Schreibpfad; `banzBestellnummer` und `veroeffentlichtAm` sind
unbeschrieben."*

Das Schema versprach eine vollstaendige Maschine:

```
status            String    @default("DRAFT") // DRAFT | FINALIZED | SIGNED | SUBMITTED | PUBLISHED
finalisiertAm     DateTime?
signiertAm        DateTime?
eingereichtAm     DateTime?
veroeffentlichtAm DateTime?
banzBestellnummer String?   // @unique
```

Und der Public-API-Service dokumentierte den Zustand selbst:

> *(Praktisch entschaerft: `prisma.banzSubmission` wird im Repository an KEINER
> Stelle geschrieben — die Tabelle ist bislang leer. Der Weg zu echter
> Paginierung ist, **zuerst die Submission-Erzeugung zu implementieren**, dann das
> Repository um `findByMandantPaginated` zu erweitern.)*

Das war die Wegbeschreibung, die im Repo lag. Der Schreibpfad fehlte komplett:
`eingereichtAm`, `veroeffentlichtAm` und `banzBestellnummer` blieben `null`, die
Tabelle `banz_submission` war leer.

#### Was hier gebaut wurde — und was ausdruecklich nicht

**Nicht gebaut: die Einreichung beim Bundesanzeiger.** Es gibt keine
oeffentliche Submission-API des Verlags:

- `MILESTONE-4.md`: „Bundesanzeiger-Verlag (Submission via eBilanz-Online +
  DATEV, **nicht direkt**)"
- `JAHRESABSCHLUSS-MODUL-PLAN.md`, Schritt 4: „Hier wird die Einreichung an
  den Bundesanzeiger angeschlossen … das haengt an **externen Bedingungen,
  die lokal nicht herstellbar sind** (Portal-Zugang, Vorgangsnummer, Gebuehren)"

**Gebaut: der Schreibpfad fuer das, was draussen passiert.** Die Kanzlei
importiert die Datei in ERiC/eBilanz-Online, das Portal gibt eine
**Bestellnummer** zurueck, und die Kanzlei traegt sie hier ein. Der
Jahresabschluss steht danach auf `SUBMITTED`, und ein `BanzSubmission`-Beleg
haelt fest, **was** eingereicht wurde (Nutzlast + SHA-256), **unter welcher
Vorgangsnummer** und **ueber welchen Kanal**.

#### Die Regeln — alle fail-closed

| Regel | Verhalten | Begruendung |
|---|---|---|
| Ohne Signatur kein `einreichen` | 409 | Ohne qeS-bescheinigte Fassung gibt es nichts, was eingereicht werden koennte |
| Ohne signiertes PDF im WORM kein `einreichen` | 409 | Sonst gaelte der Beleg eine Einreichung ohne Einreichungsgegenstand |
| Bestellnummer **Pflicht** (min. 5 Zeichen) | 400 | Sie ist der einzige Beleg fuer die Einreichung; ohne sie waere der Statuswechsel eine Behauptung |
| Bestellnummer **eindeutig** | 409 | Zwei Abschluesse auf denselben Vorgang waeren ein Datenfehler |
| `veroeffentlichen` nur nach `einreichen` | 409 | Ohne Einreichung gibt es nichts zu veroeffentlichen |
| **Nur** STEUERBERATER und KANZLEI_ADMIN | 403 | Der WP **bescheinigt** (qeS), die Kanzlei **reicht ein**. Ein WP, der ohne Kanzlei-Beteiligung veroeffentlichen koennte, waere die Vier-Augen-Kontrolle ausgehebelt. |

#### Der Fund im Fund: die Eindeutigkeit war nur behauptet

Das Schema-Kommentar sagte `@unique` — das Schema **erzwang es nicht**:

```
banzBestellnummer String? // @unique - BAnz-Vorgangsnummer nach Submission
```

Der Service prueft die Eindeutigkeit zwar, aber **Pruefen, dann Schreiben** hat
eine Luecke dazwischen: zwei gleichzeitige Einreichungen mit derselben Nummer
laufen an der Pruefung vorbei. Die Eindeutigkeit ist eine Eigenschaft der
**Daten**, nicht des Anwendungscodes — sie gehoert in die Datenbank.

Behoben: `banzBestellnummer String? @unique` plus Migration. Nullable bleibt
sie: `NULL` heisst „nicht eingereicht", und mehrere Abschluesse ohne
Einreichung vertragen sich (Postgres erlaubt mehrere NULLs im UNIQUE-Index).

Der Service faengt die verbleibende Konkurrenz (P2002) und gibt **409** statt
500.

#### Die Negativprobe

Die Zustandspruefung entfernt (ein `DRAFT`-/`FINALIZED`-Abschluss haette
eingereicht werden koennen):

```
x einreichen auf einem nicht signierten Abschluss -> 409
```

Die anderen sechs Tests bleiben gruen — sie pruefen den Ausweg, nicht die
Sperre.

#### Und was jetzt nicht mehr leer ist

Die Tabelle `banz_submission` wird geschrieben. Damit liefert die Public API
erstmals echte Einreichungsdaten — und der Weg zur echten Cursor-Paginierung,
den der Public-API-Service als Voraussetzung benannt hat, ist geebnet.

---

### Nachtrag 2026-10-20 (Nachtrag 63): Eine Gegenprobe, die von einem älteren Codestand stammte

TODO-8.13 (und der gleichlautende Abschnitt aus Nachtrag 43) trägt die
Aussage: *„Zwei echte Instanzen auf derselben Datenbank, 60
Schreibvorgänge abwechselnd auf beide verteilt: `integrity` → **OK**"*.

**Diese Messung stammt aus Nachtrag 45 — also von vor der Audit-Umstellung
(Nachtrag 56).** Seitdem hat sich der Audit-Pfad materiell geändert: der
Audit-Write wartet jetzt auf den Aufrufer, und die Hash-Kette wartet auf
**ihren eigenen** Eintrag statt auf die leere Warteschlange. Eine Messung,
die einen anderen Codestand beschreibt, belegt den heutigen nicht.

**Nachgemessen, mit dem Code von heute.** Zwei echte Anwendungsinstanzen
(`:3000` und `:3101`) auf derselben Datenbank, 60 fachliche
Schreibvorgänge, abwechselnd auf beide verteilt:

```
Fachschreibvorgaenge: 60  {"201":60}
Integritaet: {"status":"OK","entriesChecked":335, ...}
```

Vier Läufe, jeder mit 60/60 HTTP 201:

| Lauf | Schreibvorgänge | `integrity` | geprüfte Einträge |
|---|---|---|---|
| 1 | 60/60 (201) | **OK** | 335 |
| 2 | 60/60 (201) | **OK** | 398 |
| 3 | 60/60 (201) | **OK** | 461 |
| 4 | 60/60 (201) | **OK** | 524 |

**Die Gegenprobe ist also weiterhin negativ** — und jetzt ist sie eine
Messung des heutigen Codes.

#### Warum die Umstellung die Beobachtung nicht kippt

Die Änderung aus Nachtrag 56 hat die Kette nicht entschärft, sondern sie
**enger** gezogen: der Aufrufer wartet jetzt, bis sein eigener Eintrag einen
Hash hat. Damit gilt die Reihenfolge aus Nachtrag 41 unverändert:

1. **Die Reihenfolge kommt aus der Datenbank.** Die Kette hasht immer den
   Eintrag mit der kleinsten `sequenz`, der noch keinen Hash hat — nicht
   „den Eintrag, für den ich gerufen wurde". Zwei Instanzen können sich
   nicht überholen, weil keine von ihnen eine eigene Reihenfolge
   mitbringt.
2. **Die Berechnung ist idempotent.** Rechnen zwei Instanzen dieselbe offene
   Zeile, kommen sie zum selben Ergebnis.

Der früher befundene Randfall bleibt dokumentiert (Nachtrag 45): Instanz A
hat die offene Zeile gewählt und noch nicht geschrieben, Instanz B hängt
ihre Zeile an den Vorletzten. In **acht** Läufen (vier aus Nachtrag 45, vier
von heute) trat er nicht auf.

**Merksatz für die eigene Arbeit:** Eine Gegenprobe, deren Codestand
geändert wurde, ist keine Gegenprobe mehr. Sie muss wiederholt werden,
sonst steht am Ende der Dokumentation eine Aussage über einen Zustand, den
es nicht mehr gibt.

---

### Nachtrag 2026-10-20 (Nachtrag 64): Die Verfahrensdokumentation und die IKS-Beschreibung — als Entwurf aus dem Code

#### Warum das ein Entwurf ist und kein fertiges Dokument

TODO-8.1 und TODO-8.2 tragen als Owner **„Compliance"** bzw. **„Compliance +
WP"**. Das ist richtig so: eine Verfahrensdokumentation nach GoBD Rz. 10.3
beschreibt nicht nur die Software, sondern den **Prozess der Kanzlei** —
wer macht was, in welcher Reihenfolge, mit welchem Medium, und wer
haeltet das fest.

Die Software kann den einen Teil belegen (den technischen) und den anderen
nicht (den organisatorischen). Ein Dokument, das den zweiten behauptet,
waere eine erfundene Compliance-Aussage — genau die Sorte Beleg, die in
einem GoBD-Audit schadet.

**Darum: zwei Entwuerfe, die den belegbaren Teil vollstaendig liefern und den
organisatorischen Teil als offene Punkte ausweisen.**

| Dokument | Inhalt |
|---|---|
| `docs/VERFAHRENSDOKUMENTATION.md` | Zweck, Geltungsbereich, Begriffe, Rollen, das Verfahren in fuenf Schritten, Aufbewahrung, Nachvollziehbarkeit, Zugriffsschutz, IT-Massnahmen, **8 offene Punkte** |
| `docs/IKS-Beschreibung.md` | 32 Kontrollen entlang des Verfahrens, jeweils mit Risiko, Kontrolle, **technischem Nachweis** (dem wiederverwendbaren Test) und Verantwortlichkeit, plus **6 offene Punkte** der IKS |

#### Die Grundsaetze, die beide Dokumente tragen

1. **Jede Aussage ist mit einer Stelle im Quelltext belegt.** Kein Satz
   beschreibt etwas, was nicht im Code nachlesbar waere.
2. **Der technische Nachweis ist maschinell.** Jede Kontrolle verweist auf
   einen wiederverwendbaren Test. Eine Kontrolle ohne Test ist eine
   Behauptung — das ist der Kern des IKS, nicht die Matrix.
3. **Was die Software nicht belegen kann, steht als offener Punkt**, nicht
   als Aussage.

#### Was beim Schreiben auffiel — und was daraus entstanden ist

**Die Empfangsbestaetigung des Portals fehlt.** Die Anwendung speichert das
signierte PDF und die Bestellnummer. Die **vom Bundesanzeiger erzeugte
Empfangsbestaetigung** wird nicht als Beleg erfasst. Das ist eine echte
Luecke — sie steht jetzt als offener Punkt in beiden Dokumenten (K-18) und
in der TODO-Zeile zu TODO-8.10, damit sie vor dem Pilot geschlossen wird.

**Der Restore-Test fehlt ebenfalls** (TODO-8.6). Der DR-Plan beschreibt
das Verfahren, aber ohne monatlichen Wiederherstellungstest ist die
Wirksamkeit der Aufbewahrung nicht belegt — das ist K-22 und offener Punkt
4 in der IKS.

#### Und die Nachmessung aus Nachtrag 63

TODO-8.13s Gegenprobe stammte von **vor** der Audit-Umstellung. Sie wurde
heute mit dem aktuellen Code wiederholt: zwei echte Instanzen auf derselben
Datenbank, 60 abwechselnde Schreibvorgaenge je Lauf, vier Laeufe,
`integrity` -> **OK** (335 / 398 / 461 / 524 Eintraege geprueft).

Die Aussage ist damit keine mehr ueber einen Codestand, den es nicht mehr
gibt.

---

### Nachtrag 2026-10-20 (Nachtrag 65): Der monatliche Restore-Test war ein **Handskript**, das niemand ausführte

#### Der Befund

TODO-8.6 verlangte einen *automatisierten* monatlichen Restore-Test in CI.
Der DR-Plan (`docs/DISASTER-RECOVERY.md`, Abschnitt 4) beschrieb einen
solchen Test — als **Handskript auf dem Produktionshost**:

```bash
#!/usr/bin/env bash
# /opt/banz/scripts/monthly-restore-test.sh
SNAPSHOT=$(hcloud snapshot list -o json | ...)
hcloud volume create --name banz-restore-test-$RANDOM ...
```

Drei Eigenschaften, die zusammen den Befund ergeben:

1. **Es liegt nicht im Repository.** Das Skript existierte nur auf einem
   Host, dessen Inhalt niemand versioniert hat. Ein Fehler darin fiel erst
   im Ernstfall auf — also genau dann, wenn er teuer ist.
2. **Es läuft nicht von allein.** Ohne Cron-Eintrag auf dem Host wird es
   nicht ausgeführt; und der Erfolg wird nur in
   `/var/log/banz-restore-test.log` protokolliert — den niemand liest.
3. **Der Erfolg war nicht prüfbar.** Ein „grün" gab es nur als Zeile in
   einem Logfile auf einem fremden Rechner.

Ein Aufbewahrungsnachweis, der von einem Handgriff auf einem Host abhängt,
ist kein Nachweis.

#### Die Behebung: zwei Ebenen, klar getrennt

| Ebene | Was | Wie oft | Beweist |
|---|---|---|---|
| **A — CI** | die **Prozedur** | monatlich, automatisch | dass Dump/Restore/Prüfung funktionieren |
| **B — Produktion** | das **Produktions-Backup** | nach DR-Plan, manuell durch Ops | dass das konkrete Snapshot existiert und brauchbar ist |

**Ebene A** ist neu: `.github/workflows/restore-test.yml` — monatlich (1. um
02:17 UTC) und auf Zuruf. Sie führt `backend/scripts/restore-test.sh` aus,
das prüft:

1. **Schema**: jede Migration aus `prisma/migrations/` ist im wiederhergestellten
   Schema als angewendet vermerkt. Ein Schema, das einen Migrationsschritt
   verpasst, ist bei einer Wiederherstellung der **schlimmste Fall**: Die
   Anwendung startet, liest ein älteres Schema und schreibt in Spalten, die
   es noch nicht gibt.
2. **Daten**: die Zeilenzahlen aller Tabellen stimmen überein. Der Vergleich
   läuft über das `information_schema` — **nicht** über eine handgepflegte
   Tabellenliste; eine Liste veraltet, sobald jemand ein Modell einführt.
3. **Audit-Hash-Kette**: der wiederhergestellte Bestand wird über die
   **echte** Route `GET /api/audit/integrity` geprüft — mit dem Produktivcode,
   nicht mit einer Nachbildung in SQL. (Nachtrag 54: „Wer eine Funktion zum
   Vergleich nachbaut, misst die Nachbildung.")
4. **Gegenprobe**: `entriesChecked` muss zur Zahl der Audit-Zeilen in der
   Ziel-Datenbank passen. Ohne diese Prüfung könnte ein Backend, das die
   *Quell*-Datenbank liest, ein grünes Ergebnis liefern — der Test würde
   genau die Datenbank prüfen, die er nicht prüfen soll.
5. **WORM-Audit**: `audit-worm-retention.sh` läuft gegen die wiederhergestellte
   Datenbank.

**Ebene B** bleibt der Handskript-Teil im DR-Plan — er braucht
Hetzner-Zugangsdaten und ein echtes Produktions-Backup. Das kann die CI
nicht leisten, und der Unterschied ist im Skript und in beiden Dokumenten
**ausdrücklich** ausgewiesen.

#### Lokal gemessen

Der vollständige Lauf wurde lokal gefahren (Docker-Postgres auf :55432, ein
zweiter Datenbank-Server als Ziel):

```
 OK Dump erstellt (810017 Bytes)
 OK Restore abgeschlossen
 OK alle Migrationen angewendet
 OK alle Zeilenzahlen stimmen (28 Tabellen)
 OK das Backend laeuft gegen die Ziel-Datenbank
 OK Token geholt
 OK die Kette ist intakt — {"status":"OK","entriesChecked":525, ...}
 OK das Backend hat die Ziel-Datenbank gelesen (525 Eintraege)
 OK der WORM-Audit ist gruen
```

**Und zwei Fehler, die der erste Lauf gefunden hat** (und die ein
ungetestetes Skript nicht gefunden hätte):

- `pg_dump: error: invalid URI query parameter: "schema"` — `?schema=public`
  ist ein **Prisma**-Parameter; PostgreSQL kennt ihn nicht. Die URL wird
  jetzt bereinigt.
- Das Backend startete nicht: `JWT_SECRET nicht konfiguriert` — und in einem
  zweiten Lauf `P1000: Authentication failed`, weil der pg-Client **im**
  Container (Port 5432) und die Anwendung auf dem **Host** (Port 55432)
  laufen. Dafür gibt es jetzt `APP_DATABASE_URL` — **plus** die Gegenprobe aus
  Punkt 4, die genau diesen Fehler erkennt.

#### Und der erste CI-Lauf des neuen Tests war **rot**

Das ist der Teil, der die Sache rund macht. Der neue Workflow wurde durch
den Push **automatisch** ausgeloest (der Pfad-Filter auf dem Workflow-File)
— und **scheiterte**:

```
FEHLER SOURCE_DATABASE_URL und TARGET_DATABASE_URL muessen gesetzt sein
Process completed with exit code 2.
```

Das Skript erwartete `SOURCE_DATABASE_URL`, der Workflow setzte
`DATABASE_URL`. **Ein kaputter Test, der einen Monat lang stillschweigend
fehlschlaegt** — genau das haette der Zeitplan allein nicht verhindert, und
genau das haette der erste Monatslauf am 1. November gezeigt, also vier
Wochen nach der Aenderung.

Behoben: Das Skript faellt auf `DATABASE_URL` zurueck (der Normalfall: die
Quelle ist die konfigurierte Datenbank), und der Workflow setzt beide
Variablen ausdruecklich. Der zweite Lauf: **gruen**.

Der lokale Lauf hatte den Fehler **nicht** gefunden, weil dort `DATABASE_URL`
und die Quell-URL identisch gesetzt waren — der Fehler lag im *Namen* der
Variablen, nicht in der Logik. Ein Test, den man nur lokal fährt, prüft
nicht die Schnittstelle, die in der CI benutzt wird.

#### Merksatz

Ein Test, der von einem Handgriff auf einem Host abhängt, ist kein Test. Er
ist ein Wunsch. Und ein grünes Ergebnis, das niemand liest, ist kein
Nachweis.

**Und: ein Test, den man nur lokal fährt, prüft nicht die Schnittstelle,
die in der CI benutzt wird.** Der erste Lauf des neuen Workflows war rot —
und niemand hätte es gemerkt, wenn der Workflow nicht selbst ausgelöst
worden wäre.

---

### Nachtrag 2026-10-20 (Nachtrag 66): Das Skript, das die Audit-Kette vervollständigen sollte, hätte sie **zerstört**

#### Der Befund

TODO-8.4 verlangte, die Schema-Migration für die Audit-Hash-Chain
**auszuführen** — dafür gibt es `backend/scripts/backfill-audit-hash-chain.ts`.
Das Skript setzt `entryHash` und `prevHash` für alle Einträge, die vor der
Migration entstanden sind.

**Das Skript war kaputt. Bei der Ausführung hätte es genau das zerstört,
was es heilen sollte.**

Drei voneinander unabhängige Fehler — jeder einzelne hätte gereicht:

**1. Die Hash-Berechnung war eine Nachbau.**

```ts
// VORHER — im Skript
function serializeForHashing(entry: unknown): string {
  return JSON.stringify(entry, (_key, value) => {
    if (value instanceof Date) return value.toISOString();
    if (value === null) return null;
    return value;
  });
}
```

Der Produktivcode (`AuditIntegrityService.canonicalizeForHash`) macht vier
Dinge, die hier fehlen:

| | Produktivcode | Nachbau im Skript |
|---|---|---|
| Schlüssel **rekursiv sortieren** | ja | **nein** |
| `entryHash`/`prevHash`/`sequenz` ausschließen | ja | **nein** |
| Fremdschlüssel (`mandantId`, `userId`, …) ausschließen | ja (Nachtrag 54) | **nein** |
| **BigInt** (`sequenz` ist BIGINT) → String | ja | **nein** |

Der letzte Punkt ist der sofortige: `JSON.stringify` wirft bei BigInt.
Gemessen:

```
[Backfill] Fehler: TypeError: Do not know how to serialize a BigInt
```

Das Skript wäre **beim ersten Eintrag** abgebrochen. Und selbst wenn es
durchgelaufen wäre, hätte es einen **anderen** Hash geschrieben als der
Produktivpfad — die Kette wäre `BROKEN`, und `verifyIntegrity()` hätte es
gemeldet.

Das ist Nachtrag 54 zum wiederholten Malten: *„Wer eine Funktion zum
Vergleich nachbaut, misst die Nachbildung."*

**2. Die Reihenfolge war `createdAt`, nicht `sequenz`.**

Der Produktivpfad verkettet über die monotone Spalte `sequenz`. Bei
**gleichen Zeitstempeln** — bei einem Sammel-Import der Regelfall — ist die
Reihenfolge nach `createdAt` nicht bestimmt. Die Kette hätte an einem
anderen Vorgänger gehangen als der, den `verifyIntegrity()` erwartet.

**3. `prevHash` kam aus einer lokalen Variablen.**

```ts
let prevHash = GENESIS_HASH;   // ← am Skriptanfang, nicht aus der DB
```

Der Idempotenz-Fall („`WHERE entryHash IS NULL`") ist genau der Fall, in
dem **andere** Einträge bereits gehasht sind. Der erste noch fehlende
Eintrag hätte den GENESIS-Hash bekommen — statt des Hashes seines
tatsächlichen Vorgängers. Die Kette wäre an dieser Stelle **abgerissen**.

#### Wie der Befund auffiel: das reparierte Skript meldete „BROKEN"

Das Skript prueft am Ende **sich selbst** — mit dem Produktivcode, gegen die
wiederhergestellte Datenbank. Und es meldete:

```
[Backfill] Fertig: 3 AuditLog-Einträge gehasht.
[Backfill] Integritätsprüfung: BROKEN (343 Einträge geprüft).
```

Der isolierte Test war gruen, die **volle Suite** rot. Der Unterschied: die
volle Suite hatte Eintraege von **sieben** Kanzleien in der Datenbank, der
isolierte Test nur von einer. Das fuehrte zu Nachtrag 67.

**Ein Skript, das sich selbst prueft, findet Fehler, die ein Test daneben
nicht sieht.** Ohne diese Selbstpruefung waere das kaputte Skript
unauffaellig geblieben — es haette ja nie gelaufen.

#### Die Behebung: eine Implementierung statt zwei

Das Skript rechnet nicht mehr selbst. Es benutzt
`AuditIntegrityService.computeHashForEntry()` — dieselbe Funktion, die der
Produktivpfad benutzt, mit derselben kanonischen Form, demselben
`sequenz`-Vorgänger und derselben `kanzleiId`-Filterung.

```ts
const integrity = new AuditIntegrityService(prisma as never);
while (true) {
  const next = await prisma.auditLog.findFirst({
    where: { entryHash: null },
    orderBy: [{ sequenz: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true },
  });
  if (!next) break;
  await integrity.computeHashForEntry(next.id);
}
```

**Eine zweite Implementierung kann nicht mehr auseinanderlaufen** — es gibt
keine zweite mehr.

Zusätzlich prüft das Skript am Ende **selbst**, mit dem Produktivcode:

```
[Backfill] Fertig: 3 AuditLog-Einträge gehasht.
[Backfill] Integritätsprüfung: OK (525 Einträge geprüft).
```

Bricht die Prüfung ab, bricht auch das Skript ab — es kann nicht
„erfolgreich" melden und eine kaputte Kette hinterlassen.

#### Der Test

`e2e/audit-backfill.e2e.spec.ts`:

1. drei Audit-Einträge **ohne** Hash direkt schreiben — genau der Zustand,
   den die Schema-Migration hinterlässt,
2. das Skript **als Subprozess** laufen lassen (so, wie ein Operator es
   aufruft — kein Nachbau im Test, kein Aufruf einer exportierten Funktion),
3. die Kette mit dem **Produktivcode** prüfen: `verifyIntegrity()` → `OK`.

**Die Negativprobe** mit dem alten Skript:

```
× hasht die uebrigen Eintraege so, dass die Kette danach intakt ist
  [Backfill] Fehler: TypeError: Do not know how to serialize a BigInt
```

Der Test prüft nicht das Skript, sondern das **Ergebnis**: nach dem Lauf
muss die Kette intakt sein. Und der Aufruf läuft als Subprozess, weil ein
Test, der eine exportierte Funktion aufruft, nicht die Kommandozeile prüft,
die ein Operator benutzt.

#### Was daraus folgt

**Die Reihenfolge der Aufgaben war falsch.** „Skript ausführen" stand in der
TODO-Liste, aber das Skript war nie gelaufen — weder in der CI noch lokal.
Ein Skript, das seit Monaten auf „später" stand, ist **ungetesteter Code,
der auf den Produktionsdaten zeigt.**

**Merksatz:** Bevor ein Skript auf Produktionsdaten ausgeführt wird, muss
sein Ergebnis geprüft sein — nicht nur sein Start. Und das Ergebnis wird
geprüft, indem man es mit dem Produktivcode prüft, nicht indem man das
Skript selbst nachbaut.

---

### Nachtrag 2026-10-20 (Nachtrag 67): Die Integritätsprüfung meldete **BROKEN** für eine intakte Kette

#### Der Befund

Der reparierte Backfill (Nachtrag 66) meldete nach seinem Lauf:

```
[Backfill] Integritätsprüfung: BROKEN (343 Einträge geprüft).
```

Der isolierte Test war grün, die **volle Suite** rot. Der Unterschied war
der Datenbankzustand: die volle Suite hatte Einträge von **sieben**
Kanzleien, der isolierte Test von einer.

**Gemessen.** In der Datenbank lagen 429 Audit-Einträge auf sieben
`kanzleiId`s. Die beiden Verkettungen im Vergleich:

```
GLOBALE Kette bricht bei: seq=344 kanzlei=null
KETTE JE KANZLEI bricht bei: nirgends
globaler Vorgaenger: seq=343 kanzlei=b3a02076-…
Brucheintrag prevHash (global erwartet): 0000…0000
Brucheintrag prevHash (kanzleilokal)  : 0000…0000   ← richtig
```

**Die Kette war intakt. Die Prüfung meldete trotzdem „BROKEN".**

#### Die Ursache: Schreibpfad und Prüfung verketteten unterschiedlich

| | Verkettung | Quelle |
|---|---|---|
| **Schreibpfad** (`computeHashForEntry`) | **je Kanzlei** — der Vorgaenger wird über `kanzleiId: current.kanzleiId` gesucht | `audit-integrity.service.ts` |
| **Prüfung** (`verifyIntegrity`) | **global** — der Hash des letzten Eintrags war der Vorgänger des nächsten, über alle Kanzleien hinweg | `audit-integrity.service.ts` |

Die beiden können nicht übereinstimmen, sobald mehr als eine Kanzlei
Audit-Einträge hat.

**Und es war kein Unfall.** Der Kommentar im Schreibpfad (Bugfix vom
2026-10-05) sagt:

> *„Es fehlte der `kanzleiId`-Filter. Die Kette lief damit über ALLE Mandanten
> hinweg, während `verifyIntegrity()` je Kanzlei prüft. Beide konnten nie
> übereinstimmen — die Prüfung meldete dauerhaft BROKEN, sobald mehr als eine
> Kanzlei Audit-Einträge schrieb."*

Der Filter im Schreibpfad wurde also **damit behoben, dass er dem
behaupteten Verhalten der Prüfung angeglichen wurde** — aber die Prüfung
hatte dieses Verhalten nie gehabt. Der Fix hat das Symptom zum Verschwinden
gebracht, **nicht die Ursache**.

#### Warum das ein schwerer Befund ist

`BROKEN` bedeutet für einen GoBD-Auditor: **Manipulationsverdacht**. Und
der Fehlalarm hat eine zweite, schlimmere Eigenschaft — er **verdeckt
echte Befunde**:

Die Negativprobe zu Nachtrag 67 zeigt es. Mit der globalen Verkettung wird
**nicht nur** der Fehlalarm-Fall rot, sondern auch der Fall „eine echte
Manipulation wird erkannt":

```
x meldet bei zwei Kanzleien KEINEN Bruch
x meldet weiterhin einen echten Bruch (Manipulation)      ← der Fehlalarm verdeckt den echten Befund
✓ meldet fuer eine einzelne Kanzlei OK
```

Die Prüfung bricht an der **Kanzlei-Grenze** ab — also **vor** dem Eintrag,
an dem die Manipulation liegt. Ein Auditor hätte eine echte Manipulation
übersehen.

Und die Sichtbarkeit: im Einzeltest (eine Kanzlei) fällt nichts auf, im
Produktivbetrieb mit mehreren Kanzleien meldet die Prüfung **dauerhaft
BROKEN**. Ein Prüfwerk, das immer „Manipulation" sagt, wird nach der
zweiten Woche ignoriert — und dann sieht auch eine echte Manipulation
niemand mehr.

#### Die Behebung

`verifyIntegrity()` prüft jetzt **je Kanzlei** — jede Kanzlei hat ihre
eigene Kette und beginnt bei Genesis. Das entspricht:

- dem Schreibpfad (`kanzleiId`-gefilterter Vorgaenger) ✓
- der dokumentierten Absicht („`verifyIntegrity()` prüft je Kanzlei") ✓
- dem fachlichen Rahmen: der Audit-Trail einer Kanzlei ist deren
  Nachweisrahmen; die Kanzleien sind Mandanten und ihre Trails sind
  voneinander unabhängig ✓

`null` (Systemaktionen ohne Kanzlei) bildet eine eigene Gruppe.

**Die Gegenprobe** ist im selben Test: eine tatsächlich veränderte
`entryHash` muss weiterhin `BROKEN` ergeben — der Fix darf keine Meldung
verschlucken.

#### Der Test

`src/modules/audit/services/audit-integrity-kanzlei.spec.ts` — vier Einträge
auf zwei Kanzleien, **über den Produktivpfad** gehasht
(`computeHashForEntry`), dann `verifyIntegrity()`:

| Fall | Erwartung |
|---|---|
| zwei Kanzleien, alles korrekt | `OK`, 4 Einträge geprüft |
| **eine echte Manipulation** | `BROKEN`, `brokenAt` = der manipulierte Eintrag |
| eine einzelne Kanzlei (gefiltert) | `OK`, 2 Einträge geprüft |

**Merksatz:** Ein Prüfwerk, das immer „Manipulationsverdacht" meldet, wird
ignoriert — und dann sieht auch eine echte Manipulation niemand mehr. Ein
Fehlalarm ist nicht nur lästig; er **verbraucht die Aufmerksamkeit**, die
für das echte Signal gebraucht wird.

---

### Nachtrag 2026-10-20 (Nachtrag 68): Die Mandantenliste zeigte einem KANZLEI_ADMIN die Mandanten einer Kanzlei, in der er **keine Rolle** hatte

#### Der Befund

Nachtrag 11 hatte einen Bruch gefunden: „Admin IRGENDWO" statt „Admin **in
dieser** Kanzlei". Der Befund wurde in vier Services behoben
(`common/utils/kanzlei-rolle.ts`). **Die fünfte Stelle blieb stehen** — und
dort ist der Bruch nicht nur sicherheitsrelevant, sondern er war bis eben
auch **funktional falsch**.

#### Gemessen

Ein KANZLEI_ADMIN der Kanzlei A bekommt zusätzlich einen Mandant in der
Kanzlei B (dort STEUERBERATER). Die Mandanten der Kanzlei B heißen
„Aaa GmbH" (sein eigener) und „Bravo GmbH" (keine Rolle).

```
Session-Mandanten (Reihenfolge): Aaa GmbH/STEUERBERATER, Beispiel GmbH/KANZLEI_ADMIN, …
Mandantenliste (VORHER): ["Aaa GmbH", "Bravo GmbH"]

"+"Bravo GmbH" (KEINE Rolle des Users) in der Liste : JA  <-- BRUCH
"+"Aaa GmbH"  (eigener Mandant) in der Liste         : ja
```

Zwei Dinge zugleich:

1. **Sicherheitsbruch.** „Bravo GmbH" gehört einem Mandanten, in dem der
   User **keine Rolle** hat. Die Liste liefert Firmenname, USt-Id und
   Adresse — Mandantentrennungs-Bruch (§ 146 AO).
2. **Funktional falsch.** Die Mandanten der Kanzlei A, in der er Admin
   **ist**, fehlen in der Liste. Sein eigener Kanzlei-Bestand war unsichtbar.

#### Die Ursache: zwei Fragen, die auseinanderlaufen

```ts
const istKanzleiAdmin =
  istSystemAdmin || user.mandanten.some((m) => m.rolle === 'KANZLEI_ADMIN');
const eigeneKanzleiId = istKanzleiAdmin ? await this.resolveKanzleiId(user) : null;
```

- `istKanzleiAdmin` beantwortet: **„Ist der User irgendwo Admin?"**
- `eigeneKanzleiId` beantwortet: **„In welcher Kanzlei ist sein erster
  Mandant?"**

Die beiden werden verknüpft, als wären sie dieselbe Frage. `resolveKanzleiId`
nimmt `user.mandanten[0]` — und die Session sortiert die Mandanten nach
**Firmenname** (`MANDANTEN_SORTIERUNG`). Der „erste" Mandant ist damit der
alphabetisch erste — und der kann in der Kanzlei liegen, in der der User
**nicht** Admin ist. Dann filtert die Liste auf genau diese Kanzlei.

Das ist Nachtrag 11 an fünfter Stelle: dieselbe Sache, ein anderer Ort.

#### Die Regel jetzt

**Der User sieht:**

1. alle Mandanten der Kanzleien, in denen er **KANZLEI_ADMIN** ist, und
2. seine **eigenen** Mandanten — in jeder Kanzlei, mit jeder Rolle.

Punkt 2 ist nicht nur Sicherheit: ohne ihn wäre seine Mandantenliste
unvollständig (sein eigener Mandant in der zweiten Kanzlei fehlte).

Und ein `kanzleiId` aus dem Query-String darf nur eine Kanzlei treffen, in
der der User Admin ist **oder** selbst einen Mandanten hat — sonst wieder
Fremdzugriff, nur auf einem anderen Weg.

Die Bindung kommt jetzt aus **einer** Stelle: `rollenBindung()` im
Mandant-Service. Das ist dieselbe Idee wie `common/utils/kanzlei-rolle.ts`
— nur eben dort, wo sie bisher fehlte.

#### Die Negativprobe

Die alte Regel wieder eingebaut (die Liste filtert auf die Kanzlei des
ersten Mandanten) und **dieselbe Messung** wiederholt:

```
Mandantenliste: ["Aaa GmbH", "Bravo GmbH"]
"+"Bravo GmbH" (KEINE Rolle des Users) in der Liste : JA  <-- BRUCH
```

Nach dem Fix:

```
Mandantenliste: ["Aaa GmbH", "Beispiel GmbH", "Demo GmbH", "Test AG"]
"+"Bravo GmbH" (KEINE Rolle des Users) in der Liste : nein
```

Der eigene Mandant ist da, die eigene Kanzlei ist wieder da, und der
fremde Mandant ist weg.

#### Und was **nicht** betroffen war — ebenfalls gemessen

Dieselbe lockere Admin-Pruefung steht an zwei weiteren Stellen derselben
Datei (`delete()` und `assertKanzleiAdmin()` fuer Archivierung). Sie wurde
mit demselben Szenario geprueft — aktiver Mandant „Aaa GmbH" (Kanzlei B,
dort STEUERBERATER), der User ist KANZLEI_ADMIN in der Kanzlei A:

```
PATCH /api/mandant/<Aaa>     -> HTTP 403  Rolle KANZLEI_ADMIN fehlt fuer diesen Mandanten
DELETE /api/mandant/<Aaa>     -> HTTP 403  (dieselbe Meldung)
PATCH /archivierung           -> HTTP 403  (dieselbe Meldung)
```

**Geschuetzt.** Der Grund ist die Rollenpruefung des Guards (Nachtrag 40):
sie wertet die Rolle **je aktivem Mandanten** aus, und die Meldung sagt es
explizit („Die Rolle gilt mandantenbezogen: eine Rolle aus einem anderen
Mandanten berechtigt nicht, fuer diesen"). Die lockere Service-Pruefung ist
damit nur eine **zweite Schicht** — sie kann nichts erlauben, was der Guard
nicht schon erlaubt hat.

**Und damit ist erklaert, warum ausgerechnet die Liste betroffen war:**
Die Mutationsrouten tragen `@Roles('KANZLEI_ADMIN')` — der Guard ist ihr
Tor. Die **Liste** (`GET /api/mandant`) traegt **kein** `@Roles`; dort war
die Service-Logik das einzige Tor — und das stand offen.

**Merksatz zu gemessenen Negativbefunden:** Die beiden anderen Stellen
sehen im Quelltext identisch aus und sind es nicht. Ein Befund, der nur im
Quelltext begründet wird, trifft hier die falsche Stelle.

#### Der Test

`src/modules/mandant/services/findall-kanzlei-filter.spec.ts` — der
bestehende Test (Nachtrag 11) wird um den Mehr-Kanzlei-Fall erweitert:
„ein Admin in zwei Kanzleien sieht **beide** — und nicht die fremden".

**Merksatz:** Ein Fix, der an **vier** Stellen angewendet wurde, hat die
fünfte nicht gefunden. „Suche nach dem Muster" ist nicht dasselbe wie
„suche nach allen Vorkommen". Der Mehr-Kanzlei-Fall war bisher von **keinem**
Test abgedeckt — der Standardfall (ein Admin, eine Kanzlei) ist in Ordnung,
und genau deshalb fiel nichts auf.

---

### Nachtrag 2026-10-20 (Nachtrag 69): Ein neu angelegter Mandant landete in der **falschen Kanzlei** — und war deshalb unsichtbar

#### Der Befund

Nachtrag 68 hatte die Mandanten**liste** repariert. Dieselbe lose Logik
steckte noch im **Anlegen**: `create()` benutzte `resolveKanzleiId(user)` —
die Kanzlei des **ersten** Mandanten des Users (Session-Sortierung:
Firmenname).

**Gemessen.** Ein KANZLEI_ADMIN der Kanzlei A (aktiver Mandant dort) mit
zusaetzlich einem Mandant „Aaa GmbH" in der Kanzlei B (dort STEUERBERATER)
legt einen neuen Mandanten an:

```
Aktiver Mandant (Admin-Rolle): Beispiel GmbH      <- Kanzlei A
POST /api/mandant -> HTTP 201

Kanzlei des neuen Mandanten : 3863380e-…     (Kanzlei B)
Kanzlei B (nicht verwaltet) : 3863380e-…     (Kanzlei B)
  -> der Mandant ist in der KANZLEI B gelandet, in der der User KEIN Admin ist

Mandantenliste des Anlegers: [„Aaa GmbH", „Beispiel GmbH", …]   (ohne „Neu GmbH")
  -> der neue Mandant ist UNSICHTBAR (Anlegen schien wirkungslos)
```

Zwei Fehler in einem Vorgang:

1. **Falsche Kanzlei.** Der Mandant gehoert zu einer Kanzlei, in der der
   Anleger **kein** Admin ist. Die Rollenpruefung des Guards lief gegen den
   **aktiven** Mandanten (Kanzlei A) — sie hat den Vorgang also erlaubt, und
   der Service hat ihn trotzdem in Kanzlei B gelegt. Die Zustaendigkeit
   passte nicht.
2. **Unsichtbar.** Ein neuer Mandant ist niemandem zugewiesen. Er ist nur
   sichtbar, wenn der Anleger in seiner Kanzlei Admin ist. In Kanzlei B ist
   er das nicht — der Mandant existierte, war aber fuer niemanden auffindbar.
   Das ist dieselbe Beschwerde wie in Nachtrag 28 („Mandant erstellt" gemeldet,
   nichts sichtbar), nur in einer anderen Form.

#### Die Behebung

Der neue Mandant gehoert in die Kanzlei des **Kontext-Mandanten** — genau
dort hat der `RolesGuard` die Admin-Rolle geprueft. Der Controller reicht
den Mandanten-Kontext deshalb an den Service durch (`@MandantId()`, mit
derselben Praezedenz wie der Guard), und der Service loest die Kanzlei aus
**diesem** Mandanten auf.

```
Aktiver Mandant (Admin-Rolle): Beispiel GmbH      <- Kanzlei A
POST /api/mandant -> HTTP 201
Kanzlei des neuen Mandanten : b9b44f28-…         (Kanzlei A)  <- richtig
Mandantenliste des Anlegers: [„Aaa GmbH", „Beispiel GmbH", …, „Neu GmbH", …]
  -> der neue Mandant ist sichtbar
```

#### Die Negativprobe

Die alte Regel wieder eingebaut und dieselbe Messung wiederholt:

```
Kanzlei des neuen Mandanten : 796ece28-…     (Kanzlei B)
  -> der Mandant ist in der KANZLEI B gelandet, in der der User KEIN Admin ist
Mandantenliste des Anlegers: [„Aaa GmbH", „Beispiel GmbH", …]   (ohne „Neu GmbH")
  -> der neue Mandant ist UNSICHTBAR
```

#### Der Test

`e2e/audit-quittierung.e2e.spec.ts` ruft den Service direkt auf und
braucht deshalb jetzt den Kontext-Mandanten — das ist die **Anpassung an
einer echten Signaturaenderung** und kein Testumbau: der Kontext ist jetzt
Teil des Vertrags.

Drei weitere Specs senden den Kontext jetzt ueber den Header
`x-mandant-id`, weil `POST /api/mandant` ihn verlangt:

| Spec | Aenderung |
|------|-----------|
| `e2e/audit-quittierung.e2e.spec.ts` | Service-Aufruf mit Kontext-Mandant |
| `e2e/audit-kette-mandant-loeschung.e2e.spec.ts` | `POST /api/mandant` mit `x-mandant-id` |
| `e2e/jahresabschluss.e2e.spec.ts` | `POST /api/mandant` mit `x-mandant-id` |

**Merksatz:** Derselbe Fehler kann an mehreren Stellen derselben Datei
stehen und trotzdem nur an **einer** auffallen. Die Liste fiel auf, weil
sie gelesen wird; das Anlegen fiel nicht auf, weil es selten benutzt wird
und sein Ergebnis (ein unsichtbarer Mandant) wie ein Bedienfehler
aussieht. Der Test der einen Pfad abdeckt, deckt den anderen nicht ab.

---

### Nachtrag 2026-10-21 (Nachtrag 70): Der Schreibpfad war nicht mit repariert — ein KANZLEI_ADMIN konnte einen fremden Mandanten umbenennen und archivieren

#### Der Befund

Nachtrag 68 hat die Mandanten**liste** repariert, Nachtrag 69 das **Anlegen**.
Dieselbe lose Logik stand an der dritten Stelle — der Schreibpfad:

```ts
// mandant.service.ts, assertMandantAccess()
const istKanzleiAdmin = user.mandanten.some((m) => m.rolle === 'KANZLEI_ADMIN');
// ... und dann:
const kanzleiId = await this.resolveKanzleiId(user);   // Kanzlei des ERSTEN Mandanten
if (mandant.kanzleiId !== kanzleiId) { /* 403 */ }
```

Zwei Angaben, die auseinanderlaufen koennen: „Admin **IRGENDWO**" und
„Kanzlei des **ersten** Mandanten". Zusammen ergaben sie „Admin in der
Kanzlei des ersten Mandanten" — das ist nicht dasselbe.

**Gemessen** ueber die oeffentliche API. Der KANZLEI_ADMIN der Kanzlei A
hat in der Kanzlei B den Mandanten „Aaa GmbH" (dort STEUERBERATER, also
**kein** Admin) — und „Aaa GmbH" sortiert vor „Beispiel GmbH", ist also
sein **erster** Mandant. In derselben Kanzlei B liegt „Bravo GmbH", in dem
der User **keine Rolle** hat:

```
Kontext-Header x-mandant-id: <Bravo GmbH>   (auf das Zielmandant selbst)

GET   /api/mandant/<Bravo>               -> 200   Firmenname, USt-Id, Adresse
PATCH /api/mandant/<Bravo>               -> 200   umbenannt in "Bravo (HIERARCHIE-VERLETZT)"
PATCH /api/mandant/<Bravo>/archivierung  -> 200   archiviert
```

Ein Mandant, der fuer den User **unsichtbar** war (Nachtrag 68), war
gleichzeitig veraenderbar. Die Liste war repariert, der Schreibpfad nicht.

#### Warum der Header den Unterschied machte

Der `RolesGuard` laesst einen User durch, wenn er die Rolle irgendwo hat
und der Kontext-Mandant ihm nicht zugewiesen ist — mit der Annahme, der
`MandantGuard` entscheide dann. Diese Annahme gilt **nicht fuer jede
Route**: `PATCH/DELETE /api/mandant/:id` und die Archivierungsrouten tragen
**keinen** `MandantGuard`. Dort war die Service-Pruefung die einzige
Schranke — und sie stand auf der falschen Grundlage.

Der Kontext-Header ist fuer den Rollen-Vergleich nicht der Ziel-Mandant:
ein Client darf ihn auf einen beliebigen Mandanten setzen. Mit dem Header
auf das Zielmandant selbst war die Rollenpruefung des `RolesGuard`
„nicht zugewiesen" — also durchlaessig.

#### Die Behebung

Ein KANZLEI_ADMIN darf die Mandanten der Kanzleien verwalten, in denen er
KANZLEI_ADMIN ist — plus seine eigenen Mandanten. Das ist **dieselbe**
Bindung, die die Liste seit Nachtrag 68 verwendet (`rollenBindung()`):

```ts
const { adminKanzleiIds } = await this.rollenBindung(user);
if (adminKanzleiIds.length === 0) throw new ForbiddenException(...);
const mandant = await this.prisma.mandant.findUnique({ where: { id: mandantId }, ... });
if (!adminKanzleiIds.includes(mandant.kanzleiId)) throw new ForbiddenException(...);
```

Eine Bindung, zwei Stellen: Liste und Schreibpfad sagen jetzt dasselbe.

Die vier anderen Stellen, die ebenfalls „Kanzlei des ersten Mandanten"
auflosen (`api-keys.controller`, `webhook.controller`, `konsolidierung.service`,
`audit.controller`), sind **nicht** betroffen: sie bestimmen damit nur den
*Arbeitsbereich* und pruefen die Rolle anschliessend ueber
`assertAdminInKanzlei()` (`common/utils/kanzlei-rolle.ts`) — dort ist die
Rolle an die Ziel-Kanzlei gebunden. Beim Mandant-Modul fehlte genau diese
 zweite Pruefung.

#### Die Negativprobe

Die alte Regel wieder eingebaut, dieselbe Messung wiederholt:

```
GET   /api/mandant/<Bravo>               -> 200
PATCH /api/mandant/<Bravo>               -> 200   "Bravo (HIERARCHIE-VERLETZT)"
PATCH /api/mandant/<Bravo>/archivierung  -> 200
Zustand danach: {"firmenname":"Bravo (HIERARCHIE-VERLETZT)","archiviertAt":"…"}
```

#### Der Test

`e2e/mandant-trennung-admin.e2e.spec.ts` (7 Tests). Vier Negativpruefungen
(lesen, umbenennen, archivieren, Zustandsbeleg), **zwei Gegenproben**
(eigener Mandant lesbar, Mandant der Admin-Kanzlei bearbeitbar) und der
Anlegepfad mit einem Kontext, auf dem der User nur STEUERBERATER ist.
Ohne die Gegenproben waere ein Test gruen, der einfach alles sperrt.

**Merksatz:** „Repariert" heisst nicht „an einer Stelle repariert". Der
Befund von Nachtrag 68 lautete „Mandantentrennungs-Bruch" — die Liste war
die *auffaellige* Stelle, nicht die einzige. Und: **ein Kommentar, der das
Verhalten einer anderen Stelle beschreibt, ist eine Behauptung.** Der
`RolesGuard` schrieb, der `MandantGuard` entscheide — auf den Mutationsrouten
entschied niemand. Der Beleg ist der Code, nicht der Kommentar.

---

### Nachtrag 2026-10-21 (Nachtrag 71): Zwei weitere Stellen mit „Admin IRGENDWO" — fremdes Branding geaendert, fremder Mandant geloescht

#### Der Befund

Der Defekt vom 2026-10-11 („Admin **IRGENDWO**" statt „Admin **IN** dieser
Kanzlei") war in vier Services behoben worden — Subscription, API-Keys,
Webhooks, Custom-Domain — mit dem gemeinsamen Helfer
`assertAdminInKanzlei()`. **Zwei Stellen blieben stehen.**

**1. Branding.** `branding.service.ts` -> `assertKanzleiAccess()`:

```ts
const isKanzleiAdmin = user.mandanten.some((m) => m.rolle === 'KANZLEI_ADMIN');
// "Admin IRGENDWO"
const mandant = await this.prisma.mandant.findFirst({
  where: { kanzleiId, id: { in: user.mandanten.map((m) => m.id) } },
});
// "hat einen Mandanten in der Ziel-Kanzlei"
```

Zusammen belegen die beiden Pruefungen **nicht** „Admin in der
Ziel-Kanzlei". Wer in Kanzlei A KANZLEI_ADMIN ist und in Kanzlei B nur
STEUERBERATER (dort einen Mandanten hat), besteht beide fuer Kanzlei B.

```
PATCH /api/branding/<Kanzlei B>   -> HTTP 200
primaryColor der Kanzlei B vorher : #123456
primaryColor der Kanzlei B danach : #ff0000
```

Das Branding ist die **White-Label-Identitaet** der Kanzlei (Logo, Farben,
Custom-Domain) — der fremde Mandant sieht sie auf seinen Abschluessen.

**2. Loeschen und Archivieren.** `mandant.service.ts` ->
`delete()` / `archivieren()`: `assertMandantAccess()` laesst **eigene**
Mandanten zu (mit jeder Rolle), danach wurde nur noch „Admin IRGENDWO"
geprueft. Das ist eine **Rolleneskalation**:

```
DELETE /api/mandant/<Aaa>   -> HTTP 204, der Mandant ist GELOESCHT
```

Ausgefuehrt von einem STEUERBERATER, der in der Kanzlei des Mandanten nur
Berater ist (und in einer anderen Kanzlei Admin). Ein Loeschen ist eine
KANZLEI_ADMIN-Aktion (§ 147 AO: Loeschpfad nur fuer Mandanten ohne
Aufbewahrung).

#### Die Messung, die fast falsch war

Die erste Branding-Messung endete mit **HTTP 402** — „Tarif Pilot enthaelt
white-label-branding nicht". Das **Tarif-Gate** stand vor der Rechtepruefung.
Ohne eine PREMIUM-Kanzlei B waere der Befund **unbewiesen** geblieben — und
die naheliegende Fehldeutung gewesen: „die Rechtepruefung greift".

**Merksatz:** Ein Gate, das frueher greift, verdeckt das Gate dahinter.
Wenn eine Messung an einem Gate (Tarif, Quota, Zustaendigkeit) haengen
bleibt, ist das Ergebnis **kein** Befund — es ist eine nicht ausgefuehrte
Messung. Erst das Gate aus dem Weg (PREMIUM-Kanzlei), dann messen.

#### Die Behebung

Beide Stellen benutzen jetzt **eine** Bindung:

- Branding: `assertAdminInKanzlei()` aus `common/utils/kanzlei-rolle.ts` —
  derselbe Helfer wie in den vier bereits gefixten Services.
- Mandant: `assertKanzleiAdminFuerMandant()` — der User muss KANZLEI_ADMIN in
  der **Kanzlei des Ziel-Mandanten** sein (`rollenBindung()`, dieselbe
  Bindung wie die Liste seit Nachtrag 68).

Die tote Methode `assertKanzleiAdmin()` („Admin IRGENDWO") ist entfernt.

#### Die Negativprobe

Beide Fixes zurueckgebaut, dieselbe Messung wiederholt:

```
aendert das Branding einer fremden Kanzlei nicht -> HTTP 200   (erwartet 403)
loescht einen eigenen Mandanten nicht          -> HTTP 204   (erwartet 403)
archiviert einen eigenen Mandanten nicht       -> HTTP 200   (erwartet 403)
Gegenprobe Branding der eigenen Kanzlei         -> gruen
Gegenprobe Loeschen in der eigenen Kanzlei      -> gruen
```

Die erste Fassung der Negativprobe hatte **einen** gemeinsamen Mandanten fuer
Loeschen und Archivieren. Ergebnis: der Archiv-Test wurde „Mandant nicht
gefunden" (404) statt 403 — **rot, aber aus dem falschen Grund**: der
Loesch-Test hatte den Mandanten schon vernichtet. Jede Negativprobe hat jetzt
ihren eigenen Mandanten.

#### Der Test

`e2e/kanzlei-admin-rolle.e2e.spec.ts` (5 Tests): drei Negativpruefungen
(Branding, Loeschen, Archivieren — jeweils mit Zustandsbeleg) und **zwei
Gegenproben** (Branding und Loeschen in der eigenen Admin-Kanzlei bleiben
moeglich).

**Merksatz:** Ein Fix, der eine Rolle an eine Kanzlei bindet, gehoert an
**jede** Stelle, die diese Rolle prueft. Die Liste, das Anlegen, das
Schreiben, das Loeschen, das Archivieren, das Branding — das sind sechs
Stellen mit derselben Frage. Vier wurden 2026-10-11 gefixt, zwei blieben
stehen. Die Zahl der bereits gefixten Stellen sagt nichts ueber die Zahl der
noch offenen.

#### Bekannte Einschraenkung: Arbeitsbereich statt Kanzlei-Kontext

Bei den Modulen **Webhook, API-Keys, Custom-Domain und Subscription**
bestimmt der Controller den Arbeitsbereich ueber `resolveKanzleiId(user)` —
die Kanzlei des **ersten** Mandanten des Users (Sortierung: Firmenname).
Der Service prueft die Admin-Rolle anschliessend korrekt **in dieser
Kanzlei** (`assertAdminInKanzlei()`).

**Gemessen.** Ein KANZLEI_ADMIN der Kanzlei A, dessen erster Mandant in der
Kanzlei B liegt (dort STEUERBERATER):

```
GET /api/api-keys   -> HTTP 403 "Nur KANZLEI_ADMIN dieser Kanzlei darf API-Keys verwalten"
```

Er erreicht also seine **eigene** Admin-Kanzlei A nicht — der Arbeitsbereich
zeigt auf B, und in B ist er kein Admin. Das ist **fail-closed** (keine
Rechteausweitung), aber eine funktionale Luecke: wer Admin in mehreren
Kanzleien ist, kann nur diejenige verwalten, in der sein erster Mandant
liegt.

**Bewusst nicht behoben.** Die Frage „welche Kanzlei ist gemeint?" ist eine
Produktfrage: ein Kanzlei-Waehler in der Oberflaeche, oder der
Mandanten-Kontext (`x-mandant-id`) als Quelle? Beides aendert das
Datenmodell oder den API-Vertrag und ist damit eine Entscheidung der
Kanzlei-/Compliance-Seite, keine Korrektur eines Fehlers. Der Bericht
schreibt es als **offenen Punkt** fest, damit es bei der Pilotierung
auffaellt und nicht erst bei einem Kunden.

---

### Nachtrag 2026-10-21 (Nachtrag 72): Das Vier-Augen-Prinzip pruefte „WP irgendwo" — zwei Personen durften einen fremden Mandanten freigeben

#### Der Befund

Das Vier-Augen-Prinzip (IDW PS 880) verlangt **zwei** Dinge: zwei
verschiedene Personen **und** — so der Wortlaut der Unabhaengigkeit — der
Pruefer muss fuer den Mandanten bestellt sein, den er prueft. Die zweite
Bedingung war nicht erzwungen.

`wp-pruefung.service.ts` und `wp-notiz.service.ts` prueften:

```ts
const hasWPRole = user.mandanten.some((m) => m.rolle === 'WIRTSCHAFTSPRUEFER');
// "WP IRGENDWO"
...
assertMandantAccess(mandantId, user);
// Zugriff — es genuegt IRGENDEINE Rolle auf dem Ziel-Mandanten
```

Zusammen belegen die beiden Pruefungen **nicht** „WP fuer diesen Mandanten".

**Gemessen.** Zwei Personen, beide WP in Mandant A (Demo GmbH) und nur
STEUERBERATER in Mandant B (Beispiel GmbH). Der Kontext-Header zeigt auf
Mandant A — damit sind `MandantGuard` und `RolesGuard` zufrieden:

```
POST /api/wp/pruefungs                -> HTTP 201   (Pruefung fuer Mandant B angelegt)
POST /api/wp/pruefungen/:id/finalize  -> HTTP 200   (status APPROVED)
Status der Bilanz in Mandant B danach : APPROVED
```

Die Bilanz eines Mandanten wurde also von zwei Personen freigegeben, die
fuer diesen Mandanten **nicht bestellte** Wirtschaftspruefer sind — dort
sind sie die Ersteller. Das ist genau die Unabhaengigkeit, die IDW PS 880
verlangt.

#### Die Behebung

Neue gemeinsame Hilfsfunktion `common/utils/mandant-rolle.ts`:

```ts
assertRolleAufMandant(mandantId, ['WIRTSCHAFTSPRUEFER'], user, meldung);
```

Sie beantwortet die Frage „hat der User die Rolle **auf diesem** Mandanten?"
— getrennt von `common/utils/mandant-zugriff.ts` („hat der User **Zugriff**?").
Beide WP-Services nutzen sie jetzt; die globale Variante („WP irgendwo")
entfällt.

Die Reihenfolge ist bewusst: erst der Mandant, dann die Rolle. Wer
Zugriff auf den Mandanten hat, aber die Rolle nicht, bekommt die
Rollenmeldung — nicht die Zugriffsmeldung.

#### Die Negativprobe

Alte Regel eingebaut, dieselbe Messung wiederholt:

```
startet keine WP-Pruefung ... -> HTTP 201 (Pruefung angelegt)   erwartet 403
gibt keine Pruefung frei ...  -> HTTP 200 (status APPROVED)      erwartet 403
Gegenprobe: echter WP des Mandanten darf freigeben -> gruen
```

#### Der Test

`e2e/wp-vieraugen-rolle.e2e.spec.ts` (3 Tests): zwei Negativpruefungen
(Start und Freigabe, jeweils mit Zustandsbeleg an der Bilanz) und **eine
Gegenprobe** — ein echter WP des Mandanten muss weiterhin freigeben
koennen, sonst waere die Kontrolle nur ein Produktschalter.

**Merksatz:** Aufraeumen loescht genau das, was der Test angelegt hat —
nichts sonst. Die erste Fassung raeumte mit
`deleteMany({ mandantId: { in: [A, B] } })` auf und riss dabei die
**Seed-Rollen** des `steuerberater@kanzlei.de` mit (er ist auf genau diesen
Mandanten STEUERBERATER). Der Fehler war **nicht** im eigenen Test zu sehen:
vier spaetere Specs fanden „Demo GmbH" nicht mehr in der Session, 16 Tests
wurden uebersprungen. Ein zu breites Aufraeumen faellt erst dort auf, wo
etwas anderes zufaellig stimmt.

**Merksatz:** „Zugriff auf den Mandanten" und „Rolle auf dem Mandanten"
sind zwei verschiedene Fragen. Die erste beantwortet `mandant-zugriff.ts`,
die zweite `mandant-rolle.ts`. Wer beide verwechselt, bekommt entweder
einen Benutzer, der zu viel darf (der Bruch von heute) — oder einen, der zu
wenig darf (der Fehler vom 2026-10-05, wo die Liste nur zugewiesene
Mandanten zeigte).

---

### Nachtrag 2026-10-21 (Nachtrag 73): Eine qeS nach § 126 AO auf den Jahresabschluss — ausgestellt von jemandem, der dort nur Berater ist

#### Der Befund

Der schwerste Fall derselben Familie. `POST /api/signatur/sign-abschluss`
ist WP-only (Endabnahme). Aber:

- der `RolesGuard` prueft die Rolle auf dem **Kontext-Mandanten**
  (`x-mandant-id`) — nicht auf dem Ziel;
- der `SignaturService` prueft `assertMandantAccess(args.mandantId, user)` —
  den **Zugriff** auf das Ziel, nicht die Rolle.

Der Kontext-Header steht in der Praezedenz **vor** dem Body. Ein Client darf
ihn auf einen beliebigen Mandanten setzen. Damit war die Rollenpruefung des
Guards am Kontext, das Ziel aber im Body — und die Service-Ebene pruefte
nur den Zugriff.

**Gemessen.** Ein User, der in Mandant A (Demo GmbH) Wirtschaftspruefer und
in Mandant B (Beispiel GmbH) nur STEUERBERATER ist, signiert den
**Jahresabschluss** von Mandant B:

```
POST /api/signatur/sign-abschluss (Kontext = A) -> HTTP 200
  signatureId: 7579db83-…
Signaturen am Abschluss: 1
```

Eine qeS nach § 126 AO **ersetzt die eigenhaendige Unterschrift**. Sie
bescheinigt die Endabnahme durch einen fuer diesen Mandanten bestellten
Wirtschaftspruefer (IDW PS 880). Ausgestellt wurde sie hier von jemandem,
der fuer Mandant B der **Ersteller** ist — der Berater, der den Abschluss
vorbereitet hat, bescheinigt ihn.

#### Die Behebung

`signInternal()` prueft jetzt die Rolle **auf dem Ziel-Mandanten** — und
unterscheidet dabei die beiden Ebenen (Nachtrag 60):

| Ebene | Signiert | Rolle auf dem Mandanten |
|---|---|---|
| `ABSCHLUSS` (Jahresabschluss) | Endabnahme | nur WIRTSCHAFTSPRUEFER |
| `BESTANDTEIL` (Bilanz/GuV/Anhang) | Pruefung eines Bestandteils | WIRTSCHAFTSPRUEFER oder STEUERBERATER |

Die Komponentensignatur durch den Steuerberater bleibt erlaubt — sie wird
als `signaturEbene: BESTANDTEIL` erfasst und ist **keine** Endabnahme. Das
ist die dokumentierte Produktentscheidung (Nachtrag 60), keine neue Regel.

#### Die Negativprobe

Alte Regel (Pruefung entfernt), dieselbe Messung wiederholt:

```
signiert keinen Jahresabschluss ... -> HTTP 200 mit signatureId   erwartet 403
Gegenprobe: der WP des Mandanten darf signieren -> gruen
```

**Die Gegenprobe brauchte einen eigenen Jahresabschluss.** Das Signieren
setzt den Abschluss auf `SIGNED` — mit einem gemeinsamen Abschluss lief die
Gegenprobe im Negativproben-Lauf an einem bereits signierten Abschluss und
scheiterte mit 409 „steht auf SIGNED": **rot, aber aus dem falschen Grund**.
Zwei Tests, zwei Abschluesse.

#### Der Test

`e2e/signatur-mandantenrolle.e2e.spec.ts` (2 Tests): die Negativprobe
(403, **keine** Signatur in der Datenbank) und die Gegenprobe (der
Wirtschaftspruefer des Mandanten signiert, die Signatur existiert).

**Merksatz:** Bei E2E-Tests, die einen Zustandsuebergang ausloesen
(`DRAFT -> SIGNED`, `DRAFT -> APPROVED`, Loeschen), braucht jeder Test einen
eigenen Datensatz. Sonst misst der zweite Test den Zustand des ersten.

**Merksatz:** Ein *gerechnetes* Geschäftsjahr (`2050 + Date.now() % 40`) ist
kein freies Jahr. Die anderen Specs raeumen ihre Daten erst im `afterAll` ab,
und der Jahresabschluss hat einen Unique-Constraint auf
(mandantId, geschaeftsjahr) — im Voll-Lauf kollidierte das zweite Jahr
mit dem Rest eines anderen Specs (409), der Abschluss blieb leer, und der
Test scheiterte an einer **leeren ID** statt an seiner eigentlichen
Behauptung. Die beiden Specs suchen ihre Jahre jetzt aktiv (frei in
Bilanz, GuV, Anhang **und** Jahresabschluss).

---

### Nachtrag 2026-10-21 (Nachtrag 77): Der Abweichungsindikator war dauerhaft rot — und damit blind

#### Der Befund

Die Entscheidung der Fachverantwortlichen vom 2026-10-14 verlangt: „Soll
das Signieren die Bilanz/GuV/Anhang gegen Änderung sperren?" → **Nein**.
„Ein Korrekturvorgang erzeugt zwingend eine neue Signatur, und der alte
WORM-Satz darf nicht gelöscht werden. Stattdessen muss **SICHTBAR** sein,
wenn die vorgelegten Daten nicht mehr der signierten Fassung entsprechen."

Die Umsetzung verglich `updatedAt` der Entitaet mit `letzte.createdAt` der
Signatur. Fuer den **Jahresabschluss** ist das falsch — aus zwei Gruenden.

**1. Falschpositiv.** Die Signatur setzt selbst den Status des
Jahresabschlusses auf `SIGNED` (`jahresabschluss.update`). Dieser
Schreibvorgang liegt **nach** dem Anlegen des Signaturdatensatzes und damit
**nach** `letzte.createdAt`. Der Vergleich war deshalb bei **jedem**
signierten Jahresabschluss wahr:

```
GET /api/signatur/status?entityType=Abschluss&entityId=…
  -> status=ABWEICHEND, geaendertNachSignatur=true
  -> hinweis: "ACHTUNG: … Die hier angezeigten Daten entsprechen NICHT der
     signierten Fassung."
```

Gemessen unmittelbar nach der Signatur, **ohne eine einzige geaenderte
Zahl**. Die Meldung war sachlich falsch.

**2. Falschnegativ.** Der Jahresabschluss ist ein Aggregat; die signierte
Fassung ist ein PDF ueber Bilanz + GuV + Anhang. Eine Aenderung an einem
Bestandteil bewegt den `updatedAt` des Abschlusses **nicht** — sie war am
Abschluss unsichtbar.

Damit war die Sichtbarkeitspflicht **nicht erfuellbar**: der Indikator war
immer rot, also sagte er nichts mehr. Eine echte Abweichung (Anhang-Methoden
nach der Signatur geaendert) fiel neben dem Dauerfehler nicht mehr auf.

#### Die Behebung

Geprueft wird der Aenderungszeitpunkt der **Bestandteile** (die Datenbasis
der signierten Fassung), nicht der eigene `updatedAt` des Abschlusses (der
beschreibt seinen Arbeitsstatus FINALIZED -> SIGNED -> SUBMITTED ->
PUBLISHED).

Die Berechnung liegt jetzt **einmal** in
`common/utils/signatur-abweichung.ts` — der Signatur-Service (Indikator)
und der Abschluss-Service (Einreichungssperre) benutzen dieselbe Funktion.

| | vorher | nachher |
|---|---|---|
| frisch signierter Jahresabschluss | ABWEICHEND (falsch) | **SIGNIERT** |
| nach Aenderung eines Bestandteils | ABWEICHEND (aber immer) | **ABWEICHEND** (nur dann) |

#### Die Negativprobe

Alte Regel (eigenes `updatedAt`) → `expected 'ABWEICHEND' to be 'SIGNIERT'`,
mit dem falschen Hinweis im Text.

#### Der Test

`e2e/signatur-abweichung.e2e.spec.ts`: der frisch signierte Abschluss ist
SIGNIERT, eine Aenderung am Bestandteil macht auch den Abschluss zum
ABWEICHEND, und eine neue Signatur nimmt sie wieder weg.

---

### Nachtrag 2026-10-21 (Nachtrag 78): Der Korrekturvorgang am Jahresabschluss war unmoeglich — und eine abweichende Fassung wurde trotzdem eingereicht

#### Der Befund

Nachtrag 77 hat sichtbar gemacht, dass ein Jahresabschluss von der
signierten Fassung abweichen kann. Die Frage war: **wie kommt man wieder
in einen sauberen Zustand?** Antwort: gar nicht.

**Beide dokumentierten Korrekturwege waren blockiert.**

1. *Erneute Signatur.* Das Status-Gate der Signatur erlaubte nur
   `FINALIZED`; nach der ersten Signatur steht der Abschluss auf `SIGNED` →
   409 „Dieser Abschluss steht auf SIGNED".
2. *Neuer Jahresabschluss als Korrektur.* Der Finalize-Fehlertext sagt:
   „ein korrigierter Abschluss wird als neuer Abschluss angelegt" — der
   Unique-Constraint `(mandantId, geschaeftsjahr)` laesst das nicht zu
   (409).

Die **Bestandteile** dagegen sind mehrfach signierbar (`signBilanz` hat
kein Status-Gate) — genau die Asymmetrie, die die Entscheidung vom
2026-10-14 ausschliesst („Ein Korrekturvorgang erzeugt zwingend eine neue
Signatur").

**Zusaetzlich: eine abweichende Fassung wurde trotzdem eingereicht.** Die
Einreichung nahm das signierte PDF aus dem WORM (die attestierte Fassung),
während die Datenbank bereits die neuen Zahlen zeigte. Damit beantworteten
„was wurde veroeffentlicht?" und „was steht im System?" unterschiedliche
Dinge — die Nachvollziehbarkeit (§ 147 AO) war nicht mehr gegeben.

#### Die Entscheidungen (2026-10-21, Fachverantwortliche)

1. **Korrekturweg: Re-Signatur.** Ein Abschluss im Status `SIGNED` darf
   erneut signiert werden. Der WORM behaelt beide Fassungen (jede Signatur
   legt ein eigenes WORM-Objekt an), die **juengste** gilt
   (`findActiveByEntity` sortiert nach `uploadedAt` desc). `DRAFT` bleibt
   gesperrt (eine Signatur auf einen unfertigen Abschluss bescheinigt eine
   Vollstaendigkeit, die es nicht gibt), ebenso `SUBMITTED`/`PUBLISHED`.
2. **Einreichung: sperren (fail-closed).** Solange die Daten von der
   signierten Fassung abweichen, wird nicht eingereicht. Der Ausweg ist
   die Re-Signatur aus Entscheidung 1.

#### Die Behebung

- `signatur.service.ts`: das Status-Gate laesst `FINALIZED` **und**
  `SIGNED` zu.
- `abschluss.service.ts` -> `einreichen()`: vor der Einreichung wird
  `pruefeAbschlussAbweichung()` geprueft; bei Abweichung 409 mit dem Weg
  aus der Meldung heraus („bitte den Jahresabschluss erneut signieren").

#### Gemessen (die vollstaendige Kette)

```
frisch signiert:            Abschluss status=SIGNIERT    geaendertNachSignatur=false
Anhang geaendert:           Anhang   status=ABWEICHEND  geaendertNachSignatur=true
                             Abschluss status=ABWEICHEND  geaendertNachSignatur=true
Einreichung:                HTTP 409  "Die Daten des Jahresabschlusses wurden nach
                                      der Signatur geaendert … Bitte den Jahresabschluss
                                      erneut signieren"
erneute Signatur:           HTTP 200
Einreichung danach:         HTTP 200
```

#### Die Negativproben

| zurueckgebaut | Ergebnis |
|---|---|
| Re-Signatur gesperrt | `expected 409 to be 200` — „Dieser Abschluss steht auf SIGNED" |
| Einreichungssperre entfernt | `expected 200 to be 409` — der Abschluss stand auf SUBMITTED |

#### Der Test

`e2e/signatur-abweichung.e2e.spec.ts` (5 Tests): der frisch signierte
Abschluss ist SIGNIERT, die Bestandteil-Aenderung macht ihn ABWEICHEND, die
Einreichung mit Abweichung ist gesperrt (409, **kein** Einreichungsbeleg,
keine Bestellnummer), die erneute Signatur nimmt die Abweichung weg und die
Einreichung klappt wieder.

**Merksatz:** Ein Dauerfehler ist schlimmer als kein Indikator — er macht
den Indikator blind. Wer eine Warnung einfuehrt, muss sie **an einem
Zustand pruefen, in dem sie nicht gilt** (hier: ein frisch signierter
Abschluss muss SIGNIERT sein).

---

### Nachtrag 2026-10-21 (Nachtrag 79): Die qeS-Endabnahme bescheinigte einen Abschluss, den niemand geprueft hatte

#### Der Befund

Der schwerste Befund der Pruefrunde — und der einzige, der die **fachliche
Aussage** der Signatur betrifft.

Die Verfahrensdokumentation sagt:

> | **WIRTSCHAFTSPRUEFER** | prueft (Plausibilitaetsregeln, Vier-Augen-Freigabe) und **bescheinigt** (Endabnahme) |

Die Einreichung verlangt zwingend eine qeS (IKS K-20) — jeder
veroeffentlichte Jahresabschluss gilt damit als **gepruefte Fassung**. Und
doch lief die komplette Kette ohne jeden Pruefungsnachweis durch.

**Gemessen.** Ein STEUERBERATER setzt die drei Saetze auf `VALIDATED` (das
darf er per API), schliesst den Jahresabschluss ab, ein WP zeichnet die qeS,
die Kanzlei reicht ein:

```
VALIDATED setzen (nur Berater)  -> Bilanz 200, GuV 200, Anhang 200
finalize                        -> HTTP 200
sign-abschluss (WP, qeS)       -> HTTP 200
einreichen (Kanzlei)           -> HTTP 200  -> Status SUBMITTED

Status der Bilanz: VALIDATED   (APPROVED = Vier-Augen-Freigabe)
WP-Pruefungen zur Bilanz: 0
```

**Ursache.** Der Finalize prueft (IKS K-6) Saldo, GuV-Ergebnis,
Anhang-Platzhalter und „die drei Saetze duerfen nicht mehr in Bearbeitung
sein" (`status !== 'DRAFT'`). Der Marker der Vier-Augen-Freigabe —
`bilanz.status = 'APPROVED'`, gesetzt **ausschliesslich** von der Freigabe
durch die zweite Person (Nachtrag 29) — wurde **nicht** geprueft.
`VALIDATED` genuegte.

Damit war die Vier-Augen-Kontrolle **optional**: sie haengte an einem
Statusfeld, dessen Kriterium „nicht in Bearbeitung" war statt „von einer
zweiten Person freigegeben". Und eine qeS ohne Pruefungsnachweis ist eine
Bescheinigung ohne Grundlage — im Trail stuende „geprueft und freigegeben"
bei einem Abschluss, zu dem es keine Pruefung gibt.

#### Die Entscheidung (2026-10-21, Fachverantwortliche)

**Fail-closed.** Die qeS-Endabnahme verlangt einen freigegebenen
Vier-Augen-Pruefungsnachweis der Bilanz; ohne ihn keine Signatur (409). Der
Weg: WP pruefen, zweite Person gibt frei, dann signieren.

#### Die Behebung

`signatur.service.ts` -> `signInternal()`: fuer `entityType === 'Abschluss'`
wird der Nachweis geprueft — ein `WPPruefungsAbschluss` der Bilanz mit
Status `APPROVED` **und** gesetztem `freigegebenVonId` (die zweite Person).

**Die Reihenfolge ist bewusst:** die Sperre steht **hinter** der
Rollenpruefung (`assertSignaturRolle`). Sonst verdeckte die neue Sperre die
Aussage der Rollenpruefung — der Nachtrag-73-Test (403 wegen der fehlenden
WP-Rolle) waere dann aus dem falschen Grund rot geworden.

**Nur die Endabnahme.** Eine *Bestandteil*-Signatur (Bilanz/GuV/Anhang)
bescheinigt nur ein geprueftes Teilstueck (Nachtrag 60) und braucht
deshalb keinen Pruefungsnachweis.

#### Die Negativprobe

Pruefung entfernt → `expected 200 to be 409` (die Signatur wurde erzeugt,
`signatureId` in der Antwort).

#### Der Test

`e2e/signatur-pruefungsnachweis.e2e.spec.ts` (3 Tests): ohne Nachweis
**keine** Endabnahme (409, keine Signatur in der Datenbank), nach der
Freigabe durch die zweite Person **ja** (200, die Signatur existiert), und
als Gegenprobe: eine Bestandteil-Signatur bleibt ohne Pruefungsnachweis
zulaessig.

#### Die vier mitbetroffenen Specs

Die bestehenden Specs, die einen Jahresabschluss signierten, sind auf das
**richtige** Verfahren umgestellt (Pruefung durch WP A, Freigabe durch WP B,
dann signieren) — der Ablauf steckt jetzt im geteilten Helfer
`e2e/helpers/wp-vier-augen.ts`:

| Spec | Aenderung |
|---|---|
| `e2e/jahresabschluss-signatur.e2e.spec.ts` | Vier-Augen-Ablauf vor der Signatur (`wp@` prueft, `wp2@` gibt frei) |
| `e2e/signatur-mandantenrolle.e2e.spec.ts` | zweite WP-Person (Seed) + Ablauf in der Gegenprobe |
| `e2e/signatur-abweichung.e2e.spec.ts` | eigene zweite WP-Person + Ablauf im Setup |
| `e2e/archiv-einreichen-sperre.e2e.spec.ts` | eigene zweite WP-Person + Ablauf im Setup |

**Merksatz:** Ein Test, der die **falsche** Prozedur festschreibt, ist
selbst ein Befund. Er laesst sich nur finden, wenn man die Regel aendert
und fragt, warum der Test rot wird.

---

### Nachtrag 2026-10-22 (Nachtrag 80): Eine Tarifgrenze galt nur für den Schreibpfad, an dem sie zuerst eingebaut wurde

#### Der Befund

Die Tarifgrenzen sind an **drei** Stellen verdrahtet (API-Key anlegen,
Domain verifizieren, Branding-Farben). Die Frage ist nicht „wo stehen sie",
sondern **„welche Schreibpfade derselben Funktion sind noch ungesichert?"**

**Gemessen.** Eine PILOT-Kanzlei:

```
PATCH /api/branding/:id  {primaryColor} -> HTTP 402   (Gate wirkt)
POST  /api/branding/:id/logo              -> HTTP 200  (kein Gate)
  -> logoUrl in der Datenbank gesetzt, WORM-Objekt angelegt
```

`updateBranding()` pruefte den Tarif fuer die **Farben**
(`white-label-branding`) und fuer die **Custom-Domain** (`custom-domain`) —
der **Logo-Upload** pruefte gar nichts. Das Logo ist aber Teil desselben
White-Label-Branding und landet als WORM-Objekt (zehn Jahre Aufbewahrung);
ausgeliefert wird es ueber `GET /api/branding/:id/logo/blob`.

#### Die Behebung

`uploadLogo()` prueft jetzt `assertFeatureEntitled(..., 'white-label-branding')`.

**Die zwei bewusst offenen Wege** (sie sind keine Luecken):

| Weg | offen | warum |
|---|---|---|
| `DELETE /api/branding/:id/logo` | ja | Entfernen muss moeglich bleiben — auch fuer eine Kanzlei, die von Premium heruntergestuft wurde |
| `DELETE /api/api-keys/:id` | ja | ein Schluessel muss auch ohne Public-API-Tarif widerrufen werden koennen |

#### Die Negativprobe

Gate entfernt → `expected 200 to be 402` (die Antwort enthaelt die
`logoUrl` — das Logo war gesetzt).

#### Der Test

`e2e/branding-tarif-gate.e2e.spec.ts` (3 Tests): PILOT → Farbe 402 (der
Gate-Fall als Kontrollpunkt), PILOT → Logo 402 **und** kein Logo in der
Datenbank, PREMIUM → Logo 200 (der erlaubte Weg bleibt offen).

**Merksatz:** Eine Kontrolle, die an **einem** Pfad hängt, ist an allen
anderen nicht vorhanden. Die Frage ist nie „ist die Kontrolle da?", sondern
„welche Schreibpfade derselben Funktion umgehen sie?".

---

### Nachtrag 2026-10-22 (Nachtrag 81): Der Vier-Augen-Marker ließ sich aus dem veröffentlichten Dokument entfernen

#### Der Befund

Der Nachtrag-29-Bericht hatte den Angriff benannt: „setBilanzStatus() setzt
nach einer WP-Freigabe den Status `APPROVED`. Von dort aus genügte derselbe
PATCH: **Freigabe einer Wirtschaftsprüferin zurückrechnen**, anschließend
Positionen ändern. Die Kontrolle war auf zwei Requests verteilt und damit
keine."

Behoben wurde damals **nur die zweite Hälfte** — die Datensperre. Das
Wegrechnen des Markers blieb offen, weil die Statusregel ausschließlich den
Übergang nach `DRAFT` sperrt. Jeder andere Übergang aus `APPROVED` war frei.

**Gemessen.**

```
Vier-Augen-Freigabe            -> HTTP 200,  Status der Bilanz: APPROVED
PATCH {status: VALIDATED}      -> HTTP 200,  Status der Bilanz: VALIDATED   <- Marker weg
PATCH mit Positionen           -> HTTP 400  (die Daten bleiben geschützt)
Vier-Augen-Datensatz           -> status=APPROVED, freigegebenVonId gesetzt (der Nachweis lebt)
```

Die **Daten** waren also gesperrt und der Prüfnachweis war vorhanden — aber
das PDF-Template rendert `Status: ${bilanz.status}`. Im **signierten und
veröffentlichten** Dokument stand danach „Status: VALIDATED" statt
„Freigegeben (WP)". Der Audit-Trail (Prüfdatensatz) und das Dokument
widersprachen sich.

Die Richtung ist die konservative: untertrieben, nicht erfunden (`APPROVED`
ist per API nicht setzbar — `BILANZ_STATUS` enthält es bewusst nicht). Aber
ein rechtlich bindendes Dokument, das den eigenen Prüfstand anders ausweist
als der Trail, ist ein Mangel.

#### Die Entscheidung (2026-10-22, Fachverantwortliche)

**Fail-closed.** Der Freigabestatus ist der Endzustand des Statusfelds: aus
`APPROVED` ist kein Statuswechsel mehr möglich. (Die Alternative — die
Freigabe als eigenes Feld `wpFreigegebenAt` — wäre die sauberere
Ursachenbehebung, weil Arbeitsstatus und Audit-Freigabe zwei verschiedene
Tatsachen sind; sie braucht aber eine Migration und wurde für diesen
Durchgang nicht gewählt.)

#### Die Behebung

`common/utils/status-transition.ts` → `assertFreigabemarkerUnveraendert()`,
aufgerufen im Bilanz-, GuV- und Anhang-Service (symmetrisch — der Marker
kann heute nur auf der Bilanz entstehen, aber die Regel soll an keiner
Stelle fehlen).

**Die Freigabe selbst ist nicht betroffen:** sie schreibt den Status direkt
(`setBilanzStatus`, nicht über den Update-Pfad) und setzt damit `APPROVED`.

#### Die Negativprobe

Schutz entfernt → `expected 200 to be 400` (die Antwort enthielt den
Status `VALIDATED` bzw. `ARCHIVED` — der Marker war wirklich weg).

#### Der Test

`e2e/vier-augen-marker.e2e.spec.ts` (5 Tests): nach der Freigabe steht
`APPROVED`; auf `VALIDATED` und auf `ARCHIVED` geht es nicht (400, der
Marker bleibt); **Gegenproben**: ohne Freigabe bleibt der Weg auf
`ARCHIVED` offen, und die Positionen einer freigegebenen Bilanz bleiben
eingefroren.

Dazu der Unit-Test an der Quelle der Wahrheit
(`common/utils/status-transition.spec.ts`, 7 neue Fälle).

**Merksatz:** Ein Befund, der zur Haelfte behoben wurde, ist nicht behoben.
Der Nachtrag-29-Angriff nannte **beide** Haelften („zurückrechnen, anschließend
Positionen ändern") — geschlossen wurde nur die zweite. Das war nur
auffaellig, weil der Status am PDF **gedruckt** wird: der Marker war
zunaechst nur ein Anzeigefeld und wurde erst durch den PDF-Befund zur
Aussage.

---

### Nachtrag 2026-10-21 (Nachtrag 74): Der DATEV-Import schrieb Bücher in einen Mandanten, für den die Person nur Wirtschaftsprüfer ist

#### Der Befund

Dieselbe Familie, jetzt bei einem **Schreibvorgang in die Bücher**.
`POST /api/datev-import/execute` legt Bilanz **und** GuV an bzw. ersetzt die
Positionen — das ist kein Lesen, das ist die Buchhaltung des Mandanten.

- der `RolesGuard` prüft STEUERBERATER/KANZLEI_ADMIN auf dem
  **Kontext-Mandanten** (`x-mandant-id`);
- der `DatevImportService` prüft `assertMandantAccess(dto.mandantId, user)` —
  den **Zugriff** auf den Mandanten der Datei.

**Gemessen.** Eine Person, die in Mandant A (Demo GmbH) STEUERBERATER und in
Mandant B (Beispiel GmbH) nur WIRTSCHAFTSPRUEFER ist:

```
POST /api/datev-import/execute (Kontext = A) -> HTTP 201
  importedCount: 2, bilanzId: …, guvId: …
Bilanzen in B / Jahr 2055: 1, GuV: 1
```

Die Bücher von Mandant B wurden geschrieben — durch dieselbe Person, die
für Mandant B Wirtschaftsprüfer ist. Das bricht die Unabhängigkeit nach
IDW PS 880: **wer die Bücher schreibt, prüft sie nicht.**

Bemerkenswert: der Kommentar im Service beschrieb die Regel bereits —
„Der Import läuft über den Mandanten der Datei, nicht über einen aktiven
Mandanten-Kontext — die beiden Fragen sind unabhängig". Sie war nur nicht
als **Prüfung** hinterlegt.

#### Die Behebung

`assertImportRolle()` im Service: STEUERBERATER oder KANZLEI_ADMIN auf dem
Mandanten der Datei — für `preview` und `execute`.

#### **Nicht** geändert: die PDF-Erzeugung

`POST /api/pdf/...` hat dieselbe Struktur (Rolle am Kontext, Ziel im Body) —
dort ist sie aber **korrekt**: die PDF-Erzeugung ist ein Lesevorgang, und
der Wirtschaftsprüfer eines Mandanten muss das PDF des Mandanten
erzeugen können, um es zu prüfen und zu signieren. Eine Rollenbindung auf
dem Zielmandanten würde hier den legitimen Weg sperren.

**Merksatz:** Die Regel lautet nicht „die Rolle muss immer auf dem
Zielmandanten gelten", sondern „**bei Schreibvorgängen** muss die Rolle
gelten, die der Vorgang verlangt". Lesevorgänge brauchen Zugriff, keine
Kanzleizustaendigkeit.

#### Landkarte der Familie

Die systematische Suche nach der Familie ergab: **entscheidend ist, woher
eine Route ihre mandantId nimmt.**

| Quelle der mandantId | Rolle geprueft auf | Status |
|---|---|---|
| Kontext (`@MandantId()`, Header/Query) | demselben Mandanten | korrekt — u. a. `einreichen`, `veroeffentlichen`, DATEV-Export, `bilanz`/`guv`/`anhang` (lehnen zusaetzlich eine abweichende Body-mandantId mit 400 ab) |
| **Body** (`dto.mandantId`) | dem **Kontext**-Mandanten | **Bruch** — behoben in `signatur` (N73) und `datev-import` (N74) |
| Body, aber **Lesevorgang** | dem Kontext-Mandanten | bewusst unveraendert: `pdf` — der WP eines Mandanten muss dessen PDF erzeugen koennen, um es zu pruefen und zu signieren |

#### Die Negativprobe

Alte Regel (Pruefung entfernt):

```
schreibt keine Buchhaltungsdaten ... -> HTTP 201 (importedCount 2)   erwartet 403
Gegenprobe: der Steuerberater darf importieren -> gruen
```

Auch hier brauchte die Gegenprobe ein **eigenes Jahr**: der Import legt
Bilanz und GuV an, und mit einem gemeinsamen Jahr lief die Gegenprobe im
Negativproben-Lauf auf „existiert bereits Bilanz/GuV" (400) — rot, aber aus
dem falschen Grund.

#### Der Test

`e2e/datev-import-rolle.e2e.spec.ts` (2 Tests): die Negativprobe (403 **und**
keine Bilanz/GuV in der Datenbank) und die Gegenprobe (der Steuerberater des
Mandanten importiert, die Bilanz existiert).

---

### Nachtrag 2026-10-21 (Nachtrag 75): Ein archivierter Mandant bekam weiterhin ein neues WORM-PDF

#### Der Befund

Die Archiv-Entscheidung (2026-10-09): „Der Bestand bleibt lesbar und
nachvollziehbar (§ 147 AO), es entstehen **keine neuen Belege**." Gesperrt
waren Bilanz, GuV, Anhang, Konsolidierung, DATEV-Import, WP-Strecke und die
qeS-Signatur. Die **PDF-Erzeugung** war es nicht.

**Gemessen.**

```
PATCH /api/mandant/<id>/archivierung      -> HTTP 200
POST  /api/pdf/bilanz/<id>/generate       -> HTTP 200
  wormObjectKey: mandant/…/bilanz/2094/….pdf
WORM-Objekte vorher/nachher: 13 / 14
Audit: {"action":"CREATE","entityType":"WormObject"}
```

Das WORM-PDF ist nicht bloß eine Darstellung — es ist das
**Veroeffentlichungsobjekt** (zehn Jahre aufbewahrt) und damit ein neuer
Beleg im Bestand eines Mandanten, der aus dem aktiven Bestand
verschwunden ist.

Der Kommentar im Signatur-Service behauptete: „Alle anderen Schreibpfade
waren bereits über `assertMandantNichtArchiviert` gesperrt." Das war eine
**Behauptung, kein Beleg** — dieselbe Falle wie in Nachtrag 67/70.

#### Die Behebung

`assertMandantBearbeitbar()` im PDF-Service, auf allen vier Generate-Pfaden
(Bilanz, GuV, Anhang, Abschluss).

**LESEN bleibt offen:** der Download (`downloadForEntity`) ist bewusst
**nicht** gesperrt — der Bestand eines archivierten Mandanten muss zur
Nachvollziehbarkeit abrufbar bleiben (§ 147 AO).

**Bewusst nicht geändert:** der E-Bilanz-XBRL-Export. Er legt kein
aufbewahrungspflichtiges Objekt an (die Datei wird zurückgegeben), sondern
nur einen Audit-Eintrag — die Nachweisführung dokumentiert den Export. Ein
Export ist Lesen, kein Fortschreiben.

#### Die Negativprobe

Alte Regel (Pruefung entfernt):

```
legt nach der Archivierung kein weiteres PDF an -> HTTP 200 (mit wormObjectKey)   erwartet 409
Gegenprobe: Bestand bleibt abrufbar (Download)   -> gruen
Gegenprobe: nach dem Aufheben klappt es wieder    -> gruen
```

#### Der Test

`e2e/archiv-pdf-sperre.e2e.spec.ts` (4 Tests): die Vorbedingung (vor der
Archivierung entsteht ein Beweis-PDF), die Negativprobe (409 **und** kein
neues WORM-Objekt) und zwei Gegenproben (Download bleibt offen, nach dem
Aufheben klappt es wieder).

---

### Nachtrag 2026-10-21 (Nachtrag 76): Zwei Befunde — ein archivierter Mandant wurde eingereicht, und ein Mehrfachrollen-Fall sperrte den Admin aus

#### Befund 1: Ein archivierter Mandant wurde noch zum Bundesanzeiger eingereicht

Die Einreichung legt einen neuen Datensatz an (`BanzSubmission`) und
schreibt den Abschluss fort (`SIGNED -> SUBMITTED`).

```
PATCH /api/mandant/<id>/archivierung        -> HTTP 200
POST  /api/jahresabschluss/<id>/einreichen  -> HTTP 200
Status des Abschlusses: SUBMITTED (Bestellnummer: MESS-…)
BanzSubmission-Eintraege: 1
```

Der Signaturpfad ist gesperrt (Nachtrag 60) — aber ein Abschluss, der **vor**
der Archivierung signiert wurde, ist `SIGNED` und damit einreichbar. Ein
Mandant, der aus dem aktiven Bestand verschwunden ist, konnte damit noch
veroeffentlicht werden.

**Behoben:** Archiv-Sperre in `einreichen()` und `veroeffentlichen()`.

#### Befund 2: Ein Fehler aus Nachtrag 68 — mehrere Rollen auf einem Mandanten

Bei der Messung stiess ich auf einen **Fehler in meinem eigenen Code
aus Nachtrag 68**: `rollenBindung()` baute eine Map `mandantId -> rolle`.
`UserMandantRole` hat aber `@@unique([userId, mandantId, rolle])` — ein User
kann **mehrere** Rollen auf demselben Mandanten haben. Bei mehreren Rollen
ueberschrieb der letzte Eintrag die anderen:

```
PATCH /api/mandant/<id>/archivierung
-> 403 "Nur KANZLEI_ADMIN dieser Kanzlei darf den Mandanten verwalten"
```

Wer KANZLEI_ADMIN **und** STEUERBERATER auf einem Mandanten hat (eine ganz
normale Kanzlei-Konstellation), galt als „kein Admin" — ein **berechtigter**
Weg war gesperrt.

**Behoben:** alle Rollen eines Mandanten sammeln — genau wie es der
`RolesGuard` seit Nachtrag 40 tut („ALLE Eintraege sammeln, nicht den ersten
nehmen"). Ich hatte dieselbe Falle an einer zweiten Stelle gebaut.

#### Die Negativproben

```
Rollenbindung (alt): der Unit-Test "mit KANZLEI_ADMIN neben einer zweiten
  Rolle" -> rot mit ForbiddenException
Einreich-Sperre (alt): 200 + status SUBMITTED   erwartet 409
  Gegenprobe (eigener Abschluss): bleibt gruen
```

**Die Gegenprobe brauchte einen eigenen Jahresabschluss:** die Einreichung
setzt den Status auf `SUBMITTED`; mit einem gemeinsamen Abschluss lief sie im
Negativproben-Lauf auf „steht auf SUBMITTED" — rot, aber aus dem falschen
Grund.

#### Die Tests

- `e2e/archiv-einreichen-sperre.e2e.spec.ts` (2 Tests): die Negativprobe
  (409, der Abschluss bleibt `SIGNED`, **kein** Einreichungsbeleg) und die
  Gegenprobe (nach dem Aufheben klappt die Einreichung wieder).
- `src/modules/mandant/services/mandant.service.spec.ts`: der
  Mehrfachrollen-Fall (KANZLEI_ADMIN neben STEUERBERATER auf demselben
  Mandanten → die Archivierung muss klappen).

**Merksatz:** Eine Rolle je Mandant ist die Ausnahme, nicht die Regel —
`@@unique([userId, mandantId, rolle])` erlaubt mehrere. Jede Stelle, die
Rollen aus der Session liest, muss **alle** sammeln. Die erste Fassung
dieser Zugriffsart stand an zwei Stellen (im `RolesGuard` und in der
Rollenbindung) — die zweite ist erst beim Messen eines ganz anderen Befundes
aufgefallen.

---

### Nachtrag 2026-10-22 (Nachtrag 82): Das Webhook-HMAC-Secret lag im Klartext in der Datenbank

#### Der Befund

`WebhookSubscription.secret` — das HMAC-Secret, mit dem **jede** ausgehende
Webhook-Nachricht signiert wird — wurde unverändert gespeichert:

```ts
// webhook.service.ts, createSubscription()
const plaintextSecret = args.secret ?? randomBytes(24).toString('base64url');
const created = await this.repository.createSubscription({
  ...
  secret: plaintextSecret,
```

**Gemessen** an der laufenden API (nicht am Quelltext):

```
POST /api/webhook-subscriptions
  {kanzleiId, url, events, secret: "MessSecretKlartext0123456789ABCDEFGH"}
-> HTTP 201, plaintextSecret zurueckgegeben

SELECT id, secret FROM webhook_subscription
  89e69e71-… | MessSecretKlartext0123456789ABCDEFGH    <- byteweise identisch
  861f04f1-… | EppjYUVXlZbKiJgwWqsq8FLOifulwmB-       <- servergeneriert, ebenfalls Klartext
```

Die Datenbank ist das aufbewahrungspflichtige System (§ 146 / § 147 AO,
GoBD). Ein Dump davon — Backup, Restore, Leck — lieferte ein **vollständiges
HMAC-Secret**. Damit ließ sich jede ausgehende Webhook-Nachricht fälschen:
der Empfänger hätte eine scheinbar gültige Signatur gesehen, während die
Meldung einen Veröffentlichungsvorgang behauptete, den es nicht gab.

#### Die Begründung, die den Befund verursacht hat

Im DTO stand wörtlich:

> Das `secret` wird VOM Client gesetzt (32+ Zeichen) … Wird im Klartext
> gespeichert (nicht hashen) — das Secret MUSS für HMAC-Signatur lesbar
> bleiben.

Die Schlussfolgerung „muss lesbar bleiben" ist **falsch**. Richtig ist nur
die Hälfte davor: *hashen* ist bei einem HMAC-Secret tatsächlich unmöglich,
weil der Server selbst signieren muss — ein Hash kann kein HMAC-Schlüssel
sein. *Verschlüsseln* ist es nicht: der Wert muss nicht **lesbar** sein,
sondern nur **entschlüsselbar**. Die Behauptung hat den Klartext-Speicher
nicht begründet, sondern gerechtfertigt.

#### Die Familie (gemessen, nicht angenommen)

Alle geheimnis-ähnlichen Felder des Schemas wurden geprüft:

| Geheimnis | Ablage | Bewertung |
|---|---|---|
| `User.passwordHash` | bcrypt-Hash | ✓ |
| `User.totpSecret` | AES-256-GCM (`EncryptionService`) | ✓ — bereits verschlüsselt |
| `User.mfaRecoveryCodes` | Feld existiert, **kein Schreibpfad** im Code | ✓ — kein Klartext in der Praxis |
| `UserSession.refreshTokenHash` | SHA-256-Hash | ✓ |
| `APIKey.keyHash` | SHA-256-Hash | ✓ |
| `WebhookSubscription.secret` | **Klartext** | ✗ **der Befund** |

Das Webhook-Secret war das **einzige** Klartext-Geheimnis im Projekt — und
zugleich das einzige, bei dem ein Hash grundsätzlich unmöglich ist. Genau
diese Kombination hat die falsche Begründung plausibel gemacht.

Gegenproben am Klartext-Pfad selbst (gemessen, alle sauber): der
Public-DTO liefert kein Secret, die Delivery-History liefert kein Secret,
der Audit-Eintrag enthält kein Secret, der Response-Body des Ziels wird
nicht persistiert.

#### Die Behebung

`common/utils/verschluesseltes-geheimnis.ts` (neu): `verschluesseln()` /
`entschluesseln()` / `istVerschluesselt()` mit dem Marker `enc:v1:`.

- `createSubscription()` legt das Secret **verschlüsselt** ab
  (AES-256-GCM, derselbe `EncryptionService`, der das TOTP-Secret schützt).
- `deliver()` entschlüsselt **an genau einer Stelle** — dort, wo signiert
  wird. Der Klartext-Wert entsteht nur noch im Speicher.
- Der Client bekommt das Plaintext-Secret unverändert **einmal** zurück; er
  muss es selbst speichern, sonst kann er die Signatur nicht prüfen.

Der Marker ist nicht Kosmetik: ein clientgewähltes Secret (32+ Zeichen, frei
wählbar) könnte sonst wie ein Chiffretext aussehen. Er ermöglicht
zugleich die Selbstheilung (s. u.).

#### Zwei Fehlerfälle, die mit der Verschlüsselung erst entstehen

**1. Unlesbares Secret → die Zustellung darf nicht hängen.** Chiffretext
beschädigt oder Master-Key rotiert ⇒ `entschluesseln()` wirft. Vor dem Fix
wäre die Signatur mit dem Chiffretext gerechnet worden (der Empfänger hätte
jede Nachricht als unlesbar verworfen). Jetzt wird die Signatur **gar nicht
erst erzeugt**, und die Delivery geht sichtbar auf `FAILED` → `DEAD_LETTER`
mit `errorMessage: "HMAC-Secret nicht lesbar: …"`. Eine Zustellung, die auf
`PENDING` stehen bleibt, wäre schlimmer als eine, die sichtbar fehlschlägt.

**2. Altzeilen im Klartext → Selbstheilung.** Eine Zeile, deren Secret noch
unverschlüsselt ist, wird beim ersten Zugriff erkannt, **sofort
nachverschlüsselt** und nie stillschweigend weiterverwendet. Die Zustellung
läuft weiter (der Wert ist gültig, er war nur ungeschützt abgelegt); das
Nachschreiben ist Nacharbeit und blockiert den Auftrag nicht — ein Fehler
dabei wird protokolliert.

Warum kein harter Abbruch bei Altzeilen: es gibt keinen Rotations-Endpunkt.
Ein Abbruch würde die Subscription unbrauchbar machen und die Kanzlei mit
einer Sperre im Weg der Not stehen lassen (Neuanlage ist der einzige
Ausweg). Der Ausweg existiert — er soll aber nicht erzwungen werden, solange
der Klartext-Wert technisch in Ordnung ist.

#### Die Negativproben (zwei Dimensionen)

**Dimension 1 — der alte Schreibpfad** (`secret: plaintextSecret`):

```
e2e:  "das Secret darf nicht im Klartext abgelegt sein:
        expected 'MessSecretKlartext0123456789ABCDEFGH' not to be
                'MessSecretKlartext0123456789ABCDEFGH'"
Unit: "das Secret darf nicht unveraendert in der Datenbank stehen" (identisch)
Gegenprobe (Auslieferung/Audit): bleibt gruen — dieser Pfad war nie defekt
```

**Dimension 2 — der halb behobene Fall** (verschlüsselt schreiben, aber mit
dem Chiffretext signieren). Das ist der teurere Fehler, weil er *aussieht*,
als sei alles in Ordnung:

```
"signiert die Zustellung mit dem entschluesselten Secret":
  expected 'enc:v1:SM9dRpnGr/7SillX.WYOsY4jnEvDx2…' to be
         'MessSecretKlartext0123456789ABCDEFGH'
"heilt eine Altzeile im Klartext selbst": updateSubscriptionSecret 0× statt 1×
"laesst die Delivery bei unlesbarem Secret sichtbar fehlschlagen":
  signWebhookPayload wurde aufgerufen, obwohl das Secret unlesbar war
```

#### Die Tests

- `src/modules/webhook/services/webhook.service.spec.ts` (4 neue Fälle):
  das Secret liegt nicht im Klartext ab **und** entschlüsselt sich zu genau
  dem Secret, das die API dem Client gegeben hat; die Zustellung signiert mit
  dem entschlüsselten Wert; die Altzeile wird selbst geheilt; ein unlesbares
  Secret lässt die Delivery sichtbar fehlschlagen. Der `EncryptionService` ist
  **echt** (kein Mock) — eine nachgebaute Verschlüsselung würde nur die
  Nachbildung messen.
- `e2e/webhook-secret-verschluesselt.e2e.spec.ts` (2 Tests): über die
  laufende API anlegen, in der Datenbank nachsehen (nicht der Klartext,
  als verschlüsselt markiert, **entschlüsselt sich zum selben Secret**), und
  die Gegenprobe: weder Liste noch Delivery-History noch Audit-Eintrag
  enthalten das Secret.

**Merksatz:** „Muss lesbar bleiben" ist die Begründung für einen
Klartext-Speicher — aber *lesbar* und *entschlüsselbar* sind verschiedene
Dinge. Bei einem HMAC-Secret ist Hashen unmöglich (der Server muss selbst
signieren), Verschlüsselen aber möglich und ausreichend. Wer eine
Klartext-Ablage begründet, muss die Begründung an der **Alternative**
messen, nicht an ihrer Plausibilität.

**Merksatz:** Eine Verschlüsselung schafft einen neuen Fehlerfall (Chiffretext
unlesbar, Master-Key rotiert). Dieser Fall muss **sichtbar** in den Zustand
eingehen. „Der Fehler wirft" ist keine Behandlung — eine Zustellung, die auf
`PENDING` stehen bleibt, sieht für den Betreiber wie eine ausstehende
Zustellung aus.

#### Offener Punkt für den Produktivbetrieb

Ein Secret, das **einmal** im Klartext in der Datenbank lag, gilt als
potenziell kompromittiert — ein alter Dump bleibt gültig. Es gibt bisher
**keine produktiven Subscriptions** (die Plattform ist nicht produktiv
deployt; es gibt kein `deploy/`-Verzeichnis und keine Produktions-DB), daher
ist keine Rotation fällig. **Sollten zwischenzeitlich echte Subscriptions
angelegt worden sein**, gilt: Subscription löschen und neu anlegen — der
alte Secret wird dadurch ungültig, der neue ist verschlüsselt abgelegt. Eine
Rotation ohne Neuanlage (eigener Endpunkt) ist nicht gebaut; sie wäre eine
Produktentscheidung, keine Korrektur.

---

### Nachtrag 2026-10-22 (Nachtrag 83): Die Custom-Domain-Verifikation beweist nichts, und zwei Kanzleien konnten dieselbe Domain beanspruchen

#### Der Befund (zwei Teile, eine Kette)

**Teil A — die Domain-Eindeutigkeit war case-sensitiv.** DNS ist
case-insensitiv, die Prüfung war es nicht: `isCustomDomainTaken()` suchte per
`findUnique` auf dem exakten String, und der UNIQUE-Constraint greift bei
`"EXAMPLE.DE"` vs. `"example.de"` ebenfalls nicht — zwei verschiedene
Zeichenketten.

**Gemessen** an der laufenden API (zwei Kanzleien, die Seed-Daten enthalten
nur eine):

```
Kanzlei A: PATCH /api/branding/<A> {customDomain: "beispiel-messung.de"}
        -> HTTP 200
Kanzlei B: PATCH /api/branding/<B> {customDomain: "BEISPIEL-MESSUNG.DE"}
        -> HTTP 200          (statt 400 — die Domain war "frei")

SELECT name, "customDomain" FROM kanzlei WHERE "customDomain" IS NOT NULL;
  Musterkanzlei Steuerberatung GmbH | beispiel-messung.de
  Messkanzlei B GmbH                 | BEISPIEL-MESSUNG.DE
```

**Teil B — der ausgestellte Verifikationstoken wurde nie verglichen.**
`startVerification()` erzeugte einen Token, gab ihn dem Client mit („TXT-Record
Wert `banz-verify=<token>`") — und legte ihn **nirgends ab**. `verifyVerification()`
las den erwarteten Wert stattdessen **aus dem DNS selbst**:

```ts
const records = await listTxtRecords(expectedName);
const expectedValue = records.find((r) => r.value.startsWith('banz-verify='))?.value;
const publicMatch = await verifyTxtRecordViaPublicDns(expectedName, expectedValue);
```

Geprüft wurde damit: *„Es existiert ein TXT-Record mit dem Präfix
`banz-verify=` unter `_banz-verify.<domain>`, und er ist öffentlich sichtbar."*
Nicht geprüft wurde: *„Der Record enthält genau das Token, das diese Kanzlei
gerade erhalten hat."* Der Token konnte also **nicht** in die Prüfung eingehen
— er existierte im System nur noch als Zeichenkette in der Antwort an den
Client.

Drei weitere Fehler im selben Pfad:

- **Ohne Anfrage prüfbar.** `verifyVerification()` brauchte keine vorherige
  `startVerification()` — die Domain ließ sich allein über den Branding-Pfad
  setzen und dann „verifizieren". Das Flag `customDomainVerified` stand danach
  auf `true`, obwohl niemand die Domain nachgewiesen hatte.
- **Der Vergleich war ein Teilstring-Vergleich.** `value === expectedValue ||
  value.includes(expectedValue)` — ein Record, der den erwarteten Wert nur
  *enthält*, galt als Treffer. (Das `includes` ist kein Notbehelf für
  fehlende Quotes: Node liefert TXT-Werte ohne Quotes — gemessen.)
- **Der Provider war eine Voraussetzung.** `listTxtRecords()` wirft ohne
  konfigurierte Zone (`HETZNER_DNS_ZONE_ID` fehlt) — der dokumentierte
  Handpfad („User trägt TXT-Record manuell ein") konnte damit gar nicht
  durchlaufen.

#### Die Kette

Teil B allein ist ein schwaches Beweis. Zusammen mit Teil A ist es eine
Übernahme fremder Domains: Kanzlei A besitzt `example.de` und hinterlässt
den TXT-Record (er wird nie gelöscht). Kanzlei B setzt `EXAMPLE.DE` — der
Unique-Constraint greift nicht, die Eindeutigkeitsprüfung greift nicht. B
ruft „prüfen" auf, findet A's Record und ist **verifiziert** für eine Domain,
die B nicht gehört.

Die Domain-Auflösung über den Host-Header ist heute noch nicht implementiert
(`findByCustomDomain()` hat keine Aufrufer — „M4-Vorbereitung"). Der
Produktivschaden ist heute ein **falsches Flag** in der Branding-API und in
der Oberfläche („Ihre Domain ist verifiziert"); mit dem DNS-Routing wird daraus
eine Domain-Übernahme. Der Befund ist deshalb jetzt zu schließen und nicht
erst mit dem Routing.

#### Die Behebung

1. **Normalisierung an der Grenze** (`common/utils/domain-normalisierung.ts`):
   getrimmt, kleingeschrieben, ohne abschließenden Punkt. Angewendet an
   **beiden** Schreibpfaden (`branding.service.updateBranding` und
   `domain-verification.startVerification`) — eine Stelle allein lässt die
   andere unnormalisiert durch.
2. **Eindeutigkeitsprüfung case-insensitiv**
   (`kanzlei.repository.isCustomDomainTaken` → `mode: 'insensitive'`). Die
   Datenbank-Constraint bleibt als zweite Schicht bestehen; die Anwendung
   prüft vorher, damit der Nutzer eine verständliche Meldung bekommt statt
   eines Prisma-Fehlers.
3. **Token persistieren, vergleichen, löschen.** Neue Spalten
   `customDomainVerificationToken` und `customDomainVerificationRequestedAt`
   (Migration `2026_10_22_210000_domain_verification_token`). Der erwartete
   Wert ist jetzt `banz-verify=<Token dieser Kanzlei>`; der Vergleich ist
   **exakt** (mit Entfernen umschließender Quotes, weil manche Resolver so
   liefern). Nach dem Erfolg wird der Token gelöscht — er ist **einmalig**
   verwendbar.
4. **Fail-closed ohne Anfrage.** Ohne gespeicherten Token gibt es keine
   Verifikation (400 mit klarer Meldung), statt irgendeinen Record
   anzuerkennen.
5. **Neue Domain entwertet die Anfrage.** `updateBranding` löscht bei einer
   Domain-Änderung den Token — er gehört zur TXT-Record-Adresse der alten
   Domain.
6. **Der Provider ist keine Voraussetzung mehr.** Die Prüfung stützt sich auf
   den öffentlichen DNS; der Provider liefert nur noch die Auto-Anlage und
   die Diagnose. Damit funktioniert auch der dokumentierte Handpfad.

#### Eine Verhaltensänderung, die eine Testerwartung verschiebt

Der Provider war bisher eine **Voraussetzung** der Prüfung: ohne konfigurierte
Zone brach `listTxtRecords()` ab, und der Endpunkt antwortete **503**
(„DNS-Provider ist nicht konfiguriert (HETZNER_DNS_ZONE_ID fehlt)"). Das war
die Korrektur vom 2026-10-05 — sie sollte verhindern, dass ein nackter
`Error` als **500** ankommt.

Mit der Provider-Unabhängigkeit entfällt diese Voraussetzung: die Prüfung
misst jetzt den öffentlichen DNS und antwortet **200 mit `verified: false`**
und einer Begründung, die den fehlenden Provider nennt. Der Handpfad
(„User trägt TXT-Record manuell ein") wird damit erstmals ausführbar — vorher
konnte er in einer Umgebung ohne Provider-Zone gar nicht durchlaufen.

**Die Testerwartung wurde entsprechend verschoben** (`frontend/e2e/custom-domain.spec.ts`):
vorher „503 und die Meldung nennt HETZNER_DNS_ZONE_ID", jetzt „200,
`verified: false`, und die Begründung nennt HETZNER_DNS_ZONE_ID". Der
Schutz, den der Test wollte, bleibt unverändert: **kein 500, und eine
verständliche Meldung**.

#### Die Negativproben (drei Dimensionen)

**A — Normalisierung und case-insensitive Prüfung zurückgebaut:**

```
"weist die case-insensitive Doppelbeanspruchung ab":
  expected 200 to be 400   (die Antwort enthielt customDomain:
                           "E2E-EINDEUTIGKEIT-….DE" — die zweite Kanzlei
                           hatte die Domain bekommen)
"speichert die Domain normalisiert (klein)":
  expected 'E2E-Normalisierung-….DE' to be 'e2e-normalisierung-….de'
Gegenprobe (eigene Domain behalten): bleibt grün
```

**B — Token-Vergleich zurückgebaut** (erwarteter Wert wieder aus dem DNS):

```
"weist einen Record mit FREMDEM Token ab":
  expected true to be false          <- der alte Code hat den fremden
                                        Token akzeptiert und "verifiziert"
"verweigert die Pruefung ohne laufende Verifikationsanfrage":
  promise resolved "{ verified: false, … }" instead of rejecting
```

**C — exakter Vergleich zurückgebaut** (`includes` wieder rein):

```
"weist einen Wert ab, der den erwarteten nur ENTHAELT":
  expected true to be false
```

**Ein Zwischenbefund aus der Negativprobe B:** Der Test „weist einen Record
mit fremdem Token ab" war beim ersten Durchlauf **grün** — aus dem falschen
Grund: der Mock lieferte dem alten Codepfad eine leere Record-Liste, der
Test prüfte also nur den Zweig „kein Record gefunden". Erst als der Mock
den realen Record lieferte, wurde der alte Code rot. Ein Negativprobe, die
im ersten Lauf grün ist, prüft den Falschen.

#### Die Tests

- `e2e/customdomain-eindeutigkeit.e2e.spec.ts` (3 Tests): die
  Doppelbeanspruchung in abweichender Schreibweise wird abgewiesen (400) und
  steht nur einmal in der Datenbank; die gespeicherte Domain ist
  normalisiert; **Gegenprobe**: dieselbe Kanzlei darf ihre eigene Domain
  unveraendert behalten.
- `src/modules/dns/services/domain-verification.service.spec.ts` (5 neue
  Fälle): der Vergleich gegen das Token der laufenden Anfrage; ein Record
  mit **fremdem** Token wird abgewiesen und nichts wird gespeichert; ohne
  Anfrage gibt es keine Verifikation; nach dem Erfolg wird der Token
  gelöscht; `startVerification()` speichert den Token und normalisiert die
  Domain.
- `src/modules/dns/services/dns-provider.service.spec.ts` (5 Fälle): der
  exakte TXT-Vergleich (mit gemocktem DNS-Modul — die Vergleichslogik selbst
  ist die echte).
- `src/common/utils/domain-normalisierung.spec.ts` (6 Fälle).

**Merksatz:** Ein Beweis, den die Anwendung selbst ausstellt, muss
**gespeichert** werden, sonst kann er nicht geprüft werden. „Der erwartete
Wert wird aus der Umgebung gelesen und mit der Umgebung verglichen" ist kein
Vergleich — er bestätigt, dass die Umgebung mit sich selbst übereinstimmt.

**Merksatz:** Case-Sensitivity ist keine reine Textfrage. Für DNS ist
`EXAMPLE.DE` **dieselbe** Domain wie `example.de` — ein Unique-Constraint auf
dem Originalstring schützt dann vor nichts. Die Normalisierung gehört an die
Grenze, und zwar an **alle** Schreibpfade.

**Merksatz:** Eine Negativprobe, die im ersten Lauf grün ist, prüft den
Falschen. Im Mock muss die Umgebung so beschaffen sein, dass der alte Code
sie tatsächlich akzeptiert — sonst wird der Fehlerzweig geprüft statt der
Regel.

---

#### Verifikation (Nachtrag 83)

| Prüfung | Ergebnis |
|---|---|
| `npm run typecheck` (src + e2e + prisma + Tools) | 0 Fehler |
| `npx eslint src --max-warnings 0` | 0 Warnungen |
| `npx vitest run` | **897/901** (113 Dateien, 4 übersprungen, 0 Fehlschläge) |
| `npx playwright test` | **80/80** |
| `npx tsc --noEmit` (Frontend) | 0 Fehler |

### Nachtrag 2026-10-22 (Nachtrag 84): Die DNS-Verifikation schrieb das Branding, ohne den Branding-Cache zu invalidieren

#### Der Befund

`GET /api/branding/:kanzleiId` liefert aus dem Cache (`branding:<kanzleiId>`,
TTL **1 Stunde**). Die DNS-Verifikation schreibt `customDomain` und
`customDomainVerified` — genau die Felder, die dieser Cache hält — und
invalidierte den Cache nicht.

**Gemessen** an der laufenden API:

```
POST /api/dns/<id>/start-verification  {customDomain: "mess-cache-…"}
  -> HTTP 200
SELECT "customDomain" FROM kanzlei
  -> "mess-cache-….example.de"
GET /api/branding/<id>
  -> {"customDomain": null}          <- bis zu einer Stunde alt
```

#### Die Familie: wer invalidiert, wer nicht

Alle Schreibpfade auf die Kanzlei-Zeile wurden geprüft:

| Schreibpfad | Invalidiert `branding:`? |
|---|---|
| `branding.service.updateBranding` (Farben, Domain) | ja |
| `branding.service.uploadLogo` | ja |
| `branding.service.deleteLogo` / `clearLogo` | ja |
| `domain-verification.startVerification` (setzt `customDomain`) | **nein** |
| `domain-verification.verifyVerification` (setzt `customDomainVerified`) | **nein** |
| `subscription.service` (Tarif, Status) | nicht nötig — der Tarif steckt nicht im Branding-DTO |

Der Fehler war leicht zu übersehen: das Branding-Modell invalidiert an
**allen drei** eigenen Schreibpfaden. Nur der Schreibpfad **außerhalb** des
Moduls blieb unberücksichtigt — und der ist genau der, den man nicht im
Blick hat, wenn man das Branding-Modum liest.

#### Die Wirkung

Der Nutzer startet die Verifikation, trägt den TXT-Record ein, die Prüfung
gelingt — und nach einem Neuladen der Seite steht wieder „Domain nicht
verifiziert". Bis zu einer Stunde lang zeigt die Oberfläche einen Stand, den
es nicht mehr gibt. Das PDF ist **nicht** betroffen (es verwendet die Domain
nicht), der Audit-Trail ebenfalls nicht (er schreibt in die Datenbank).

#### Die Behebung

1. `DomainVerificationService` invalidiert den Branding-Cache nach dem
   Schreiben — **nach** dem Write und **außerhalb** des try/catch: eine
   gescheiterte Invalidierung ist ein veralteter Cache, aber *kein*
   gescheiterter Schreibvorgang. Beides zu vermischen wäre genau der Fehler,
   den dieser Block 2026-10-06 behoben hat (der Aufrufer glaubte, die Domain
   sei nicht gespeichert).
2. **Ein Wächter statt eines Einzelfalltests**
   (`src/common/cache/branding-cache-invalidation.spec.ts`): jede Datei der
   Service-Schicht, die ein Branding-Feld schreibt, muss den Branding-Cache
   invalidieren. Der Einzelfalltest fällt nicht, wenn ein **weiterer**
   Schreiber dazukommt — der Wächter schon.

Der Wächter prüft die Service-Schicht. Ausgenommen sind die Datenschicht
(`common/repositories/`) und die Routing-Schicht (`controllers/`) — beide sind
per Definition nicht zuständig für die Cache-Pflege, und der Aufrufer wird
erfasst. Es gibt **keine Ausnahmeliste** für einzelne Dateien.

#### Die Negativprobe

Invalidierung entfernt → **vier** Tests rot, jeder aus dem richtigen Grund:

```
Unit   "invalidiert den Branding-Cache nach dem Schreiben":
       expected "spy" to be called with arguments: [ … ]
Unit   "invalidiert den Branding-Cache auch nach der Verifikation":
       expected "spy" to be called with arguments: [ … ]
Wächter "invalidiert den Branding-Cache in jedem Schreibpfad":
       diese Dateien schreiben ein Branding-Feld, invalidieren den
       Branding-Cache aber nicht:
       src/modules/dns/services/domain-verification.service.ts
e2e    "liefert die Domain sofort, nachdem die Verifikation sie gesetzt hat":
       die Branding-API lieferte einen veralteten Wert (der Cache wurde nicht
       invalidiert): expected null to be 'e2e-cache-….example.de'
```

#### Die Tests

- `src/common/cache/branding-cache-invalidation.spec.ts` (2 Tests): der
  Wächter — plus ein **Vorbildungstest**, der sicherstellt, dass der Wächter
  überhaupt Schreibpfade findet (ein leerer Fund wäre genauso grün wie der
  Befund).
- `src/modules/dns/services/domain-verification.service.spec.ts` (2 neue
  Fälle): der Cache wird nach dem Schreiben invalidiert — beim Start und bei
  der Verifikation.
- `e2e/branding-cache-invalidation.e2e.spec.ts` (1 Test): nach
  `start-verification` liefert die Branding-API **sofort** die neue Domain
  (ohne Wartezeit und ohne Reload).

**Merksatz:** Ein Cache gehört dem Modul, das ihn liest — die **Daten** aber
dem Modul, das sie schreibt. Wer Felder schreibt, die ein fremder Cache
hält, muss ihn invalidieren; sonst zeigt die Oberfläche einen Stand, den es
nicht mehr gibt.

**Merksatz:** „An allen drei eigenen Schreibpfaden invalidiert" sagt nichts
über den vierten — den in einem anderen Modul. Eine Regel, die eine
Modulgrenze überschreitet, braucht einen Wächter, der sie überschreitet:
der Einzelfalltest schützt die eine Stelle, der Wächter die Regel.

#### Verifikation (Nachtrag 84)

| Prüfung | Ergebnis |
|---|---|
| `npm run typecheck` (src + e2e + prisma + Tools) | 0 Fehler |
| `npx eslint src --max-warnings 0` | 0 Warnungen |
| `npx vitest run` | **902/906** (115 Dateien, 4 übersprungen, 0 Fehlschläge) |
| `npx playwright test` | **80/80** |

---

### Nachtrag 2026-10-22 (Nachtrag 85): Der bezahlte Tarifwechsel lief in der Produktion ins Leere

#### Der Befund

Die Billing-Konfiguration der Produktions-Vorlage war **unvollständig** — und
die Lücken führten zu zwei verschiedenen, schwer verständlichen Fehlern.

`infra/hetzner/.env.prod.example` enthielt **keinerlei** Billing-Konfiguration:
kein `STRIPE_SECRET_KEY`, kein `STRIPE_WEBHOOK_SECRET`, kein `STRIPE_PRICE_*`,
kein `BILLING_PROVIDER`, kein `BILLING_MOCK_ENABLED`.

**Gemessen** mit genau dieser Konfiguration (Server ohne `STRIPE_SECRET_KEY`
und ohne `BILLING_MOCK_ENABLED`):

```
[BillingProviderService] Billing-Provider: MOCK — STRIPE_SECRET_KEY nicht gesetzt

POST /api/subscription/<id>/checkout {tier: 'PREMIUM'}
  -> HTTP 200, providerName = 'mock',
     url = …?upgrade=success&mock_session=mock_1792702755256_…&tier=PREMIUM&…
POST /api/subscription/<id>/mock-activate {mockSession: 'mock_…'}
  -> HTTP 404 "Nicht gefunden"
SELECT "subscriptionTier" FROM kanzlei
  -> PILOT          (unveraendert)
```

Die Kanzlei sah „Premium gebucht", der Tarif blieb PILOT. In der Produktion
war damit **kein einziger bezahlter Tarifwechsel** möglich — und die
Premium-Funktionen (`custom-domain`, `public-api`, `white-label-branding`)
waren praktisch nicht erreichbar.

#### Die Familie: eine Regel, an zwei Stellen nicht eingehalten

Nachtrag 11 (2026-10-11) hatte genau diesen Fehler am **Mock-Activate**
gefunden und behoben: „der Provider heißt *mock*, weil `STRIPE_SECRET_KEY`
fehlt — das ist eine **Nebenwirkung** der Konfiguration, keine
Entscheidung." Der Checkout war dieselbe Lücke, eine Ebene darüber:

| Weg | Gate | Folge bei fehlender Konfiguration |
|---|---|---|
| `mock-activate` (Nachtrag 11) | `BILLING_MOCK_ENABLED` | 404 ✓ (geschlossen) |
| `checkout` (Nachtrag 85) | **keins** | 200 mit einer Session, die **ins Leere** führt ✗ |
| `BillingProviderService` (Nachtrag 85) | **Nebenwirkung** | Provider wird still zum Mock ✗ |
| `STRIPE_PRICE_*` (Nachtrag 85) | Platzhalter-Default | Stripe antwortet „No such price" ✗ |

Der dritte Punkt verdient eine eigene Notiz: die Preis-IDs standen als
Konstante mit **Platzhalter** (`price_premium_149eur`). Die Platzhalter sehen
wie echte Stripe-IDs aus. Mit gesetztem Key, aber ohne gesetzte
`STRIPE_PRICE_*`, schickte der Checkout genau diese Zeichenkette an Stripe —
die Antwort war „No such price", also ein **Account-Problem** als Diagnose,
obwohl es ein **Konfigurationsproblem** war.

Und ein Nebenbefund, der dieselbe Klasse trifft: `.env.example` deklarierte
schon lange `BILLING_PROVIDER=mock` — **der Code las die Variable nie.**
Die Vorlage versprach einen Schalter, den es nicht gab; die Wahl hing
ausschließlich an `STRIPE_SECRET_KEY`. Wer sich auf die Dokumentation
verlassen hat, hat nicht das Verhalten bekommen, das dort beschrieben war.
Mit dem Fix ist die Zusage wahr.

#### Die Behebung

1. **Der Mock-Checkout teilt die Schranke der Mock-Aktivierung.** Beide
   greifen auf dieselbe Entscheidung zu (`BILLING_MOCK_ENABLED`, fail-closed
   bei fehlender Variable) — jetzt über **eine** Helper-Methode, nicht über
   zwei Kopien der Bedingung.
2. **Die Provider-Wahl ist eine Entscheidung.** `BILLING_PROVIDER=stripe|mock`
   wird ausgewertet:
   - `stripe` ohne `STRIPE_SECRET_KEY` → der Dienst **startet nicht** (ein
     unbeabsichtigter Mock im Produktivbetrieb ist ausgeschlossen);
   - nicht gesetzt → Ableitung aus dem Key, aber mit einer **lauten**
     Warnung, die die Ursache benennt (kein stiller Betrieb).
3. **Die Preis-ID kommt aus der Konfiguration.** Fehlt `STRIPE_PRICE_<TIER>`,
   bricht der Checkout mit einer Meldung ab, die die Variable nennt. Die
   Platzhalter-Konstante ist entfernt — Platzhalter, die wie echte Werte
   aussehen, gehören nicht in den Code.
4. **Die Produktions-Vorlage enthält den Billing-Block** (mit
   `CHANGE_ME`-Platzhaltern): `BILLING_PROVIDER`, `BILLING_MOCK_ENABLED`,
   `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_*`.

#### Die Negativprobe

Schranke entfernt, Server mit der Konfiguration der Prod-Vorlage → **drei**
Tests rot, jeder aus dem richtigen Grund:

```
Unit   "ohne BILLING_MOCK_ENABLED gibt es keine Mock-Session":
       promise resolved "{ …(3) }" instead of rejecting
Unit   "BILLING_MOCK_ENABLED=false ebenfalls nicht":
       promise resolved "{ …(3) }" instead of rejecting
e2e    "Checkout und Aktivierung passen zusammen":
       eine gelieferte Session muss einloesbar sein — sonst hat der
       Checkout eine tote Session erzeugt: expected 404 to be 200
```

Die Gegenproben blieben grün: mit ausdrücklicher Freischaltung läuft der
Mock-Checkout weiter (Pilot und Playwright brauchen ihn), und der echte
Provider ist von der Mock-Schranke nicht betroffen.

#### Der Test

Der e2e-Test ist bewusst als **Invariante** formuliert und nicht als
Statuscode-Test — er gilt in jeder Konfiguration:

> *Der Checkout liefert niemals eine Session, die nicht aktiviert werden
> kann.*

Ist der Mock freigeschaltet, müssen Checkout **und** Aktivierung
funktionieren; ist er es nicht, antwortet der Checkout 503 mit einer
Meldung, die die Ursache nennt, **und erzeugt gar keine Session**.

#### Verifikation (Nachtrag 85)

| Prüfung | Ergebnis |
|---|---|
| `npm run typecheck` (src + e2e + prisma + Tools) | 0 Fehler |
| `npx eslint src --max-warnings 0` | 0 Warnungen |
| `npx vitest run` | **914/918** (117 Dateien, 4 übersprungen, 0 Fehlschläge) |
| `npx playwright test` | **80/80** |
| `npx tsc --noEmit` (Frontend) | 0 Fehler |

**Merksatz:** Eine Regel, die an **einer** Stelle einer Kette gilt, gilt an
den anderen noch lange nicht. Nachtrag 11 hat die Mock-*Aktivierung*
geschlossen — der Mock-*Checkout* blieb offen, und die Lücke fiel erst auf,
als jemand die Produktions-Vorlage las statt den Pilot zu testen. Die
beiden Wege gehoeren zur selben Regel („der Mock-Modus ist eine
Entscheidung") und gehoeren damit in **eine** Pruefung.

**Merksatz:** Eine Konfigurationsluecke ist nur zur Haelfte ein
Konfigurationsproblem: zur anderen Haelfte ist sie ein **Fehlerbild**. Fehlt
`STRIPE_SECRET_KEY`, war der Provider ein Mock (stiller Betrieb); fehlte die
Price-ID, war es „No such price" (ein Account-Problem als Diagnose). Beide
Male war die eigentliche Ursache eine fehlende Konfiguration.

---

### Nachtrag 2026-10-23 (Nachtrag 86): Der Einreichungsbeleg enthielt nicht das eingereichte Dokument

#### Der Befund

Der Einreichungsbeleg (`BanzSubmission`) speicherte **immer** das signierte
PDF — unabhängig davon, über welchen Kanal der Mandant veröffentlicht. Bei
`XML_XBRL` und `EBILANZ_TAXONOMIE` (zwei der drei Seed-Mandanten) ist aber
nicht das PDF eingereicht worden, sondern die **XBRL** — und die wurde
nirgends aufbewahrt.

**Gemessen** an der laufenden API (Mandant „Beispiel GmbH", Kanal
`XML_XBRL`; kompletter Ablauf: Bilanz/GuV/Anhang → Abschluss → Vier-Augen →
qeS-Signatur → Einreichung):

```
POST /api/jahresabschluss/<id>/einreichen
  -> HTTP 200, channel: "XML_XBRL"

SELECT "channel", "payloadFormat", "rawPayload" FROM banz_submission
  channel        = XML_XBRL
  payloadFormat  = PDF
  rawPayload[0..8] = "%PDF-1.3"        (23.665 Bytes)
```

Der Beleg behauptet also, die **Rohdaten der Einreichung** zu enthalten —
und enthält ein PDF, das bei diesem Kanal nie eingereicht wurde. Die
Verfahrensdokumentation stuft den E-Bilanz-Upload ausdrücklich als
„außerhalb der Anwendung" ein; die Anwendung konnte die Datei also gar nicht
kennen.

#### Die Familie: der Code widersprach dem eigenen Schema

| Stelle | Aussage |
|---|---|
| `schema.prisma` | `rawPayload Bytes // Generierte XML/XBRL/PDF-Daten` |
| `schema.prisma` | `payloadFormat String // "XML" \| "XBRL" \| "PDF" \| "ZIP"` |
| `schema.prisma` (WormObject) | `entityType String // "BILANZ_PDF" \| … \| "BILANZ_XML" \| etc.` |
| **Code** | `payloadFormat: 'PDF'` (hart verdrahtet), Nutzlast = PDF |

Drei Stellen im Schema sahen XML/XBRL vor — der Code kannte nur PDF. Die
XBRL-Archivierung existierte nicht: der Generator (`xbrl-generator.service.ts`)
lief ins Leere, es gab **keinen** WORM-Upload, keinen Hash, kein Manifest.
Die Datei existierte nur in der HTTP-Antwort des Export-Endpoints; nach dem
Download beim Mandanten war sie nirgends mehr.

#### Die Entscheidung (2026-10-23, Fachverantwortliche)

**Option A — XML archivieren und als Nutzlast protokollieren.** Die beim
Einreichen erzeugte XBRL wird im WORM abgelegt (zehn Jahre, eigener
EntityType, Object-Lock COMPLIANCE, Legal Hold) und als Nutzlast des Belegs
geführt (`payloadFormat: 'XBRL'`). Das signierte PDF bleibt als
Beweisdokument im WORM, wo es bereits liegt.

Verworfen wurden: „Beleg bleibt PDF, wird aber ehrlich markiert" (die
eingereichten Daten blieben unaufbewahrt) und „Einreichung für XML-Kanäle
ablehnen" (dann hätte die Anwendung gar keinen Beleg erzeugen können).

#### Die Behebung

1. **`XbrlGeneratorService.generateUndArchivieren()`** — erzeugt die XBRL
   über **denselben** Erzeugungsweg (`generateEbilanzXbrl()`, keine
   zweite Implementierung) und legt sie im WORM ab: eigener EntityType
   `ABSCHLUSS_XBRL`, `retentionDays: 3650`, `objectLockMode: COMPLIANCE`,
   `legalHold: true`, eigener Key `mandant/<id>/abschluss_xbrl/<gj>/<uuid>.xbrl`,
   Audit-Eintrag auf `WormObject`.
2. **`AbschlussService.einreichen()`** — die Nutzlast folgt dem Kanal:
   - `PDF_DIRECT` → das signierte PDF (unveraendert)
   - `XML_XBRL` / `EBILANZ_TAXONOMIE` → die XBRL, **frisch erzeugt** und
     archiviert

   Die XBRL wird **nach** der Abweichungsprüfung erzeugt: die Daten
   entsprechen damit der signierten Fassung (§ 147 AO) — die protokollierte
   Nutzlast ist die Fassung, die der Kanzlei zur Einreichung gedient hat.
3. **Der reine Export archiviert nichts** — sonst erzeugte jeder
   Vorschau-Klick einen zehnjährigen WORM-Objekt.
4. **`payloadFormat` steht jetzt auch in der API-Antwort** — vorher
   stand es nur im Datenbankzweig, für einen XML-Kanal also unsichtbar.

#### Die Negativprobe

Nutzlast wieder kanalunabhängig (das PDF) → **ein** Test rot, aus dem
richtigen Grund:

```
e2e "XML-Kanal: der Beleg enthaelt die XBRL — und sie liegt im WORM":
    expected 'PDF' to be 'XBRL'
Gegenprobe (PDF-Kanal): bleibt gruen
```

Ein erster Negativprobe-Versuch war **nicht** verwertbar: `if (false && …)`
brachte den TypeScript-Compiler zum Scheitern, der Server startete nicht,
und der e2e-Test wurde **übersprungen** statt ausgeführt. Ein
übersprungener Test ist kein fehlgeschlagener Test — die Negativprobe
gilt erst mit übersetztem Code.

#### Die Tests

- `e2e/einreichungsbeleg-kanal.e2e.spec.ts` (2 Tests): der Beleg eines
  XML-Kanals enthält die XBRL (`<?xml`, der Hash passt zur Nutzlast), und
  die Datei liegt im WORM (3650 Tage, Legal Hold, COMPLIANCE, eigener Key);
  **Gegenprobe**: beim PDF-Kanal bleibt es beim PDF.
- `src/modules/ebilanz/services/xbrl-archivierung.spec.ts` (4 Fälle): der
  Upload (EntityType, Key, Content-Type, die Nutzlast ist XML), das
  Manifest (Retention, Legal Hold, Lock-Modus), der Audit-Eintrag — und die
  Gegenprobe, dass der **reine Export** nichts archiviert.

**Merksatz:** Ein Beleg, der etwas anderes enthaelt als das, was
eingereicht wurde, ist keine Luecke in der Nachvollziehbarkeit — er ist
eine **falsche Aussage** im Audit-Trail. Die Verfahrensdokumentation sagte
„E-Bilanz-Upload ausserhalb der Anwendung"; das Schema sagte
„Generierte XML/XBRL/PDF-Daten"; nur der Code kannte PDF. Drei Stellen
sagten dasselbe, und keine davon wurde abgeglichen.

**Merksatz:** Ein Schema, das Werte aufzaehlt, die der Code nie erzeugt,
ist ein **Befund**, kein Kommentar. `payloadFormat: "XML" | "XBRL" | "PDF"
| "ZIP"` neben `payloadFormat: 'PDF'` im Code ist eine offene Frage, die
niemand beantwortet — genau wie der Nachtrag-38-Kommentar („ist bewusst
nicht enthalten"), der in Wahrheit falsch war.

---

#### Verifikation (Nachtrag 86)

| Prüfung | Ergebnis |
|---|---|
| `npm run typecheck` (src + e2e + prisma + Tools) | 0 Fehler |
| `npx eslint src --max-warnings 0` | 0 Warnungen |
| `npx vitest run` | **920/924** (119 Dateien, 4 übersprungen, 0 Fehlschläge) |
| `npx playwright test` | **80/80** |
| `npx tsc --noEmit` (Frontend) | 0 Fehler |

---

### Nachtrag 2026-10-23 (Nachtrag 87): Der DATEV-Export erzeugte eine Datei ohne Buchungswirkung

#### Der Befund

Der DATEV-Export schrieb **zwei Zeilen je GuV-Position**: eine Soll-Zeile
und eine Haben-Zeile — mit **identischen** Konto-/Gegenkonto-Angaben.

Im Sachkonten-Buchungsstapel (den die Datei deklariert: Spalten `Umsatz`,
`SH`, `WKZ`, `Konto`, `Gegenkonto`, …) ist **eine Zeile = eine Buchung**:
Konto auf der Soll-Seite, Gegenkonto auf der Haben-Seite, beide in derselben
Zeile. Die zweite Zeile war deshalb nicht „die Gegenseite", sondern eine
**zweite Buchung** — mit demselben Konto-Paar und dem negierten Betrag.

**Gemessen** (Export einer GuV mit 1.000 Erlöse + 400 Materialaufwand, dann
der Import der Anwendung darauf):

```
Export:
  "1000,00";"S";…;"1800";"4400";…      <- Soll-Zeile
  "-1000,00";"H";…;"1800";"4400";…     <- Haben-Zeile, GLEICHE Konten
  "400,00";"S";…;"5000";"1800";…
  "-400,00";"H";…;"5000";"1800";…     <- dito

Import derselben Datei:
  importedCount: 0, skippedCount: 3, warnings: []
```

Jedes Konto saldiert auf 0:

```
4400: Soll +1000 (Zeile 1) + Haben +1000 (Zeile 2) = 0
1800: Haben +1000 (Zeile 1) + Soll +1000 (Zeile 2) = 0
```

Der Import überspringt Konten mit Saldo 0 („kein Buchungseffekt") — die
exportierte Datei war damit **ohne Buchungswirkung**. In einer echten
DATEV-Software heben sich die beiden Zeilen genauso auf: die Kanzlei
übernimmt eine Datei, in der jede Buchung doppelt und damit wirkungslos
steht. Die Schnittstelle, deren Zweck die Übernahme in die EDV der Kanzlei
ist, lieferte eine wertlose Datei.

#### Der zweite Teil: der Import schwieg

`skippedCount: 3` — und `warnings: []`. Der Import übersprang die drei
Konten **stumm**. Ein Konto, dessen Soll- und Habenbuchungen sich
aufheben, ist genau das Bild einer doppelt exportierten Buchung; der Import
hat darauf nicht hingewiesen. Deshalb blieb der Fehler im Export
unentdeckt: der Import meldete „3 übersprungen" und keine Begründung.

#### Der dritte Teil: der Fehler war testgeschrieben

`e2e/datev.e2e.spec.ts` hatte einen eigenen Test dafür:

```ts
it('Generierte CSV hat 2 Zeilen pro GuV-Position (Soll + Haben)', …)
expect(body.metadata.buchungsZeilenCount % 2).toBe(0);
expect(sCount).toBe(hCount);          // gleich viele S- und H-Zeilen
```

Der Defekt war damit nicht nur unbemerkt — er war **als richtig
festgeschrieben**. Ein grüner Test, der das Falsche beschreibt, ist
schlimmer als kein Test: Er verspricht Schutz für eine Regel, die es nicht
gibt, und er zwingt jede spätere Korrektur in die Rolle eines
„Regelbruchs". Der Test ist jetzt gegen das richtige Verhalten umgestellt
(eine Zeile je Position, beide Seiten in derselben Zeile, keine gespiegelte
H-Zeile) — mit der Begründung im Kommentar, damit die Änderung nachvollziehbar
bleibt.

#### Der vierte Teil: der Kommentar, der die Fehlvorstellung erzeugt hat

Der Docstring von `calculateSaldovortrag()` im Import behauptete:

> „Bei einer typischen DATEV-Buchung gibt es zwei Zeilen: Soll und Haben,
> die den gleichen Absolutbetrag (mit unterschiedlichem Vorzeichen) haben …
> also summieren wir einfach `umsatz`."

Der Code rechnet aber **eine** Zeile je Buchung — `konto` auf der
SH-Seite, `gegenkonto` auf der anderen Seite (doppelte Buchführung). Das ist
die Konvention des Sachkonten-Buchungsstapels, den der Export selbst
deklariert.

Nach der **beschriebenen** Lesart wäre jede Buchung doppelt gezählt worden.
Genau diese Fehlvorstellung hat beim Export zu den Doppelzeilen geführt:
Die zweite Zeile war nicht „die Gegenseite", sondern eine zweite Buchung,
die die erste aufhob. Der Kommentar ist damit nicht Kosmetik — er war die
Quelle des Fehlers, und er ist jetzt auf das korrigiert, was der Code tut
(und was das Format vorgibt).

#### Die Behebung

1. **Eine Zeile je Buchung.** Der Export schreibt jetzt je Position genau
   eine Zeile: Ertrag → `Soll Bank / Haben Ertrag`, Aufwand → `Soll
   Aufwandskonto / Haben Bank`. Beide Seiten stehen damit in derselben
   Zeile — wie es das Format und der Import der Anwendung verlangen.
   Nebeneffekt: das Limit `DATEV_MAX_BUCHUNGS_ZEILEN` (99.999) galt vorher
   gegen **Doppelzeilen** und war damit effektiv halbiert.
2. **Der Import warnt bei Nullsalden.** Ein Konto mit Saldo 0 wird
   weiterhin übersprungen (diese Regel ist richtig: es hat keinen
   Buchungseffekt) — aber es wird **begründet**: „Soll und Haben gleichen
   sich aus. Die Buchung hebt sich auf und wurde nicht übernommen."

#### Die Negativprobe

Die zweite Zeile wieder eingebaut → der e2e-Test rot, aus dem richtigen
Grund:

```
e2e "exportiert eine Buchung je Position — und sie kommt wieder an":
    je Position genau eine Buchungszeile (gefunden: 4)
```

#### Die Tests

- `e2e/datev-roundtrip.e2e.spec.ts` (1 Test): der **Round-Trip** über die
  laufende Anwendung — exportieren, die Datei mit dem Import der
  Anwendung einlesen, und prüfen, dass die importierten Positionen
  1.400 EUR tragen (statt 0). Zusätzlich die Zeilenstruktur (Umsatz,
  Soll/Haben, Konto, Gegenkonto).
- `src/modules/datev/services/datev-export.service.spec.ts` (5 Fälle): eine
  Zeile je Position, die Buchungsseiten, die Gegenprobe (eine Nullposition
  erzeugt keine Zeile) und die Zeilenzahl in den Metadaten.

**Merksatz:** Ein Export ist nur so gut wie sein **Round-Trip**. Der
DATEV-Export und der DATEV-Import derselben Anwendung wurden nie
gegeneinander geprüft — jeder hatte seine eigenen Tests. Der Import liest
das Format, das der Export schreibt; beide können denselben Fehler machen
und sich trotzdem "testen".

**Merksatz:** Zwei Zeilen mit identischen Konto-/Gegenkonto-Angaben sind
**keine** doppelte Buchführung, sondern zwei Buchungen. Das Format trägt
beide Seiten in **einer** Zeile; wer sie auf zwei Zeilen verteilt, hat
jedes Konto auf 0 saldiert.

**Merksatz:** Ein „stummer Skip" ist ein Befund, kein Detail. Der Import
hat die Konten korrekt übersprungen (Saldo 0 = kein Buchungseffekt) — aber
er hat nicht **gesagt**, warum. Die Begründung wäre der Hinweis gewesen,
an dem der Fehler im Export auffällt.

---

#### Verifikation (Nachtrag 87)

| Prüfung | Ergebnis |
|---|---|
| `npm run typecheck` (src + e2e + prisma + Tools) | 0 Fehler |
| `npx eslint src --max-warnings 0` | 0 Warnungen |
| `npx vitest run` | **926/930** (121 Dateien, 4 übersprungen, 0 Fehlschläge) |
| `npx playwright test` | **80/80** |

---

### Nachtrag 2026-10-23 (Nachtrag 88): Die öffentliche API meldete die Vorgangsnummer nie — und verschwieg, dass die Liste abgeschnitten war

#### Der Befund

`GET /api/v1/mandanten/:id/banz-submissions` hatte **zwei** Fehler, die
sich gegenseitig die Sichtbarkeit genommen haben.

**Gemessen** an der laufenden API (drei Einreichungsbelege, `pageSize=2`):

```
GET /api/v1/mandanten/<id>/banz-submissions?pageSize=2 -> 200
  items       : 2
  total       : 3
  hasMore     : false        <-- bei 3 Sätzen und pageSize 2
  nextCursor  : null
  Submission …: status=SUBMITTED banzVorgangsnummer=null

  DB: banzBestellnummer  = ["MESS-BESTELL-1","MESS-BESTELL-2","MESS-BESTELL-3"]
  DB: banzVorgangsnummer = [null,null,null]
```

#### Teil 1: die Nummer kam aus dem falschen Feld

Die API las `banzVorgangsnummer` — ein Feld, das **niemand schreibt**. Die
Einreichung schreibt seit Nachtrag 62 (2026-10-20) `banzBestellnummer`: das
eindeutige Feld (`@unique`), das die Bestellnummer des Bundesanzeigers
trägt. `banzVorgangsnummer` existiert nur noch im Schema und wird
ausschließlich **gelesen** — von dieser einen Stelle.

Damit meldete die öffentliche API für jede Einreichung
`banzVorgangsnummer: null`, während der Datensatz die Nummer sehr trug. Ein
externes ERP (DATEV, Addison) konnte die Einreichung **nicht zuordnen** —
die Nummer, die das Portal vergeben hat, kam nicht an.

Zwei Felder für dieselbe Sache, von denen nur eines beschrieben wird: der
`_`-Kern des Fehlers ist die Divergenz, nicht der Lesefehler.

#### Teil 2: `hasMore: false` trotz abgeschnittener Datensätze

Die Liste wurde als **Gesamtliste** geladen und im Service auf `pageSize`
gekürzt — ohne Cursor. Also:

```
items: 2, total: 3, hasMore: false, nextCursor: null
```

Der dritte Beleg war für den Client **unerreichbar**, und die API sagte ihm
zugleich, es sei alles geliefert. Ein Client, der `hasMore` vertraut (wie
die Doku es beschreibt), beendet die Schleife nach der ersten Seite.

Das war die **einzige** Liste der öffentlichen API ohne Cursor-Paging —
Mandanten, Bilanzen, GuV und Anhang nutzen alle `take: pageSize + 1` mit
echtem Cursor. Die Ausnahme fiel erst auf, weil das Fehlerbild so
sichtbar war.

#### Teil 3: der Kommentar, der das begründete

```ts
// (Praktisch entschaerft: `prisma.banzSubmission` wird im Repository an
//  KEINER Stelle geschrieben — die Tabelle ist bislang leer. Der Weg zu
//  echter Paginierung ist, zuerst die Submission-Erzeugung zu
//  implementieren, …)
```

**Falsch** — seit dem 2026-10-20 existiert die Submission-Erzeugung
(`abschluss.service.ts` → `tx.banzSubmission.create({…})`). Der Kommentar
beschrieb einen Zustand, der zwei Wochen älter war als der Code, und er
begründete genau das falsche Verhalten. Wer den nächsten Ausbau angeht, liest
diese Begründung — und lässt die Liste so, wie sie ist.

#### Die Behebung

1. **Die richtige Quelle.** Der Repository-Eintrag liest `banzBestellnummer`.
   Der **öffentliche** Feldname `banzVorgangsnummer` bleibt (API-Vertrag, so
   in der Swagger-Dokumentation beschrieben) — geändert wird die Quelle.
2. **Echtes Cursor-Paging.** Neu im Repository:
   `findBanzSubmissionsByMandantPaginated({mandantId, cursor, pageSize})`
   (`take: pageSize + 1`, Sortierung `preparedAt` + `id` — die Submissions
   haben kein `updatedAt`) und `countBanzSubmissionsByMandant()`. Der
   Controller nimmt den Cursor jetzt an; `hasMore` und `nextCursor` werden
   wie in den übrigen Listen berechnet.
3. **Der Kommentar** ist korrigiert — er behauptet keine Zukunft mehr.

#### Die Negativprobe

Feldquelle und Paging zurückgebaut → **drei** Tests rot, jeder aus dem
richtigen Grund:

```
"meldet die Vorgangsnummer — nicht null":
    .toMatch() expects to receive a string, but got object   (null)
"meldet hasMore und liefert einen Cursor":
    bei 3 Sätzen und pageSize 2 gibt es mehr: expected false to be true
"der Cursor führt zum Rest der Liste":
    die zweite Seite muss den dritten Beleg liefern: expected 2 to be 1
```

#### Die Tests

`e2e/public-api-submissions.e2e.spec.ts` (3 Tests): die Vorgangsnummer wird
gemeldet (nicht `null`), `hasMore` stimmt und ein Cursor wird geliefert, und
der Cursor führt zum dritten Beleg — also ist kein Datensatz unerreichbar.

**Merksatz:** Zwei Felder für dieselbe Sache sind eine Einladung, das
falsche zu lesen. Hier las die API das Legacy-Feld (niemand schrieb es),
das die Einreichung nicht mehr füllt — die öffentliche Sicht war damit
dauerhaft leer, ohne dass ein Fehler auftrat.

**Merksatz:** Ein Kommentar, der eine Begründung liefert, ist ein
**Fakt**, kein Geräusch. "Die Tabelle ist bislang leer" hat den Fehler
zwei Wochen lang am Leben gehalten — und der Kommentar war zwei Wochen
älter als der Code, der daneben stand.

**Merksatz:** Ein einzelner Endpunkt ohne Paging ist in einer API, die
sonst überall paged, kein Detail: er ist die Stelle, an der `hasMore`
gelogen hat. Die Ausnahme von der Regel ist fast immer die fehlerhafte
Stelle.

#### Verifikation (Nachtrag 88)

Gemeinsam mit Nachtrag 89 in einem Lauf über den Gesamtstand gemessen.

| Prüfung | Ergebnis |
|---|---|
| `npm run typecheck` (src + e2e + prisma + Tools) | 0 Fehler |
| `npx eslint src --max-warnings 0` | 0 Warnungen |
| `npx vitest run` | **933/937** (123 Dateien, 4 übersprungen, 0 Fehlschläge) |
| `npx playwright test` | **80/80** |
| `npx tsc --noEmit` (Frontend) | 0 Fehler |

---

### Nachtrag 2026-10-23 (Nachtrag 89): Die Archivsperre stand nur im Anlege-Pfad der Konsolidierung

#### Der Befund

Die Archivregel („Der Bestand bleibt zur Nachvollziehbarkeit erhalten
(§ 147 AO), wird aber nicht fortgeschrieben") war in der Konsolidierung an
**einem** von zwei Schreibpfaden eingelöst: `createEinheit` ✓ sperrt,
`applyKonsolidierung` ✗ nicht — und `applyKonsolidierung` legt die
**Konzern-Bilanz und die Konzern-GuV** an, also zwei neue Sätze mit Status
`VALIDATED`.

**Gemessen** an der laufenden API (Mutter archivieren, dann anwenden):

```
PATCH /api/mandant/<M>/archivierung                    -> HTTP 200
POST  /api/bilanz?mandantId=<M>                         -> HTTP 403   (Gegenprobe ✓)
POST  /api/konsolidierung/einheiten/<E>/apply
  -> HTTP 201 {"konzernBilanzId":"…","konzernGuvId":"…","salden":{…}}
SELECT id, geschaeftsjahr, status FROM bilanz
  WHERE mandantId='<M>' AND konzernEinheitId='<E>'
  -> [{"geschaeftsjahr":2087,"status":"VALIDATED"}]
```

⇒ Ein **archivierter** Mandant bekam doch wieder neue Belege — genau die
Regel, die Nachtrag 13/15 eingeführt und Nachtrag 75/76 an den PDF- und
Einreichungspfaden durchgesetzt hat.

#### Die Besonderheit: der Test kannte den Befund und prüfte ihn nicht

Der Kopfkommentar des vorhandenen Tests
(`konsolidierung-archiv.spec.ts`) benennt `applyKonsolidierung` **wörtlich**
als betroffenen Pfad:

> „Die Archivierung wurde in Bilanz, GuV, Anhang und DATEV-Import verdrahtet.
> `konsolidierung.service` nicht — obwohl `applyKonsolidierung` über
> `createWithPositionen` eine neue Konzern-Bilanz UND eine Konzern-GuV
> anlegt."

Getestet wurde nur `createEinheit`. Die Regel war also **beschrieben** und
an einer Stelle eingelöst — ein Kommentar, der den Befund benennt, ist noch
kein Wächter. Der Test wurde um die beiden apply-Fälle ergänzt.

#### Die Behebung

`applyKonsolidierung` prüft jetzt **vor** der Rechnung, ob ein beteiligter
Mandant archiviert ist (`assertKeinArchivierterBeteiligter` — Mutter **und**
Tochter, wie im Anlege-Pfad). Der Helper lädt die Archivzeitpunkte in einer
Query; die Regel steht damit an beiden Schreibpfaden am selben Ort.

#### Die Negativprobe

Guard entfernt → **drei** Tests rot, jeder aus dem richtigen Grund:

```
e2e "ein archivierter Mandant bekommt keine neuen Belege":
    Antwort: {"konzernBilanzId":"c958ca42-…","konzernGuvId":"9f710294-…"}
    expected 201 to be 409
Unit "eine archivierte MUTTER wird beim Anwenden abgelehnt":
    expected BadRequestException: Konsolidierung nicht anwendbar …
    to be an instance of ConflictException
Unit "eine archivierte TOCHTER wird beim Anwenden abgelehnt":
    dito
```

Der Unit-Test prüft zusätzlich, dass die **Berechnung nicht startet**
(`findByMandantAndJahr` wurde nicht aufgerufen) — die Sperre greift vor der
Rechnung, nicht danach. Ohne diese Zusatzprüfung wären die Unit-Tests aus
dem falschen Grund rot gelaufen (sie wären in ungemockte Pfade weitergelaufen).

#### Die Tests

- `e2e/konsolidierung-archiv-apply.e2e.spec.ts` (2 Tests): der Normalweg
  (aktive Mandanten → `apply` → 201 **mit** Konzern-Sätzen) und der
  Archivfall (→ 409, **keine** neuen Sätze in der Datenbank).
- `konsolidierung-archiv.spec.ts` (2 neue Fälle): Mutter und Tochter beim
  Anwenden.

**Merksatz:** Ein Kommentar, der einen Befund benennt, ist noch kein
Wächter. Hier stand der Satz „`applyKonsolidierung` legt eine neue
Konzern-Bilanz UND eine Konzern-GuV an" seit 2026-10-12 im Test — getestet
wurde der andere Pfad. Wer einen Befund beschreibt, muss ihn **am
genannten Ort** absichern.

**Merksatz:** Eine Regel an **einem** von zwei Schreibpfaden ist keine
Regel. Der Anlege-Pfad wurde gesperrt, der Ausführungspfad nicht — und die
Ausführung ist die, die Belege erzeugt.

#### Verifikation (Nachtrag 89)

| Prüfung | Ergebnis |
|---|---|
| `npm run typecheck` (src + e2e + prisma + Tools) | 0 Fehler |
| `npx eslint src --max-warnings 0` | 0 Warnungen |
| `npx vitest run` | **933/937** (123 Dateien, 4 übersprungen, 0 Fehlschläge) |
| `npx playwright test` | **80/80** |
| `npx tsc --noEmit` (Frontend) | 0 Fehler |

---

### Nachtrag 2026-10-24 (Nachtrag 90): Eine Beteiligungsquote von 1 % wurde zu 100 % angewendet

#### Der Befund

Die Beteiligungsquote wird an mehreren Stellen gelesen — mit drei
verschiedenen Lesarten derselben Zahl:

| Stelle | Lesart |
|---|---|
| `normiereBeteiligungsquote(wert)` | `wert > 1 ? wert / 100 : wert` — **Prozent oder Bruchteil** |
| `anteilEKEK = (ek * beteiligungsquote) / 100` | immer Prozent |
| `anteilEK = (eigenkapital * quote) / 100` (Kontext) | immer Prozent |
| `elimBetrag = (umsatzTochter * beteiligungsquote) / 100` | immer Prozent |

Der **gespeicherte** Wert ist aber **immer Prozent**: das DTO begrenzt auf
`@Min(0) @Max(100)`, die Spalte ist `Decimal(5,2)`, und das Frontend-Feld
heißt „Beteiligungsquote (%)". Damit war der Wert 1 % (also `1`) nicht von
100 % (als Bruchteil `1`) zu unterscheiden — und **1 % wurden zu 100 %**.

#### Gemessen

An der laufenden API (Tochter mit 1000 EUR Aktiva, Mutter ebenfalls 1000
EUR; ausgewertet wird die Konzern-Position `B.IV.`):

```
Beteiligungsquote  1 %   -> Konzern-Bilanz 2000   (erwartet 1010)
Beteiligungsquote  0,5 % -> Konzern-Bilanz 1500   (erwartet 1005)
Beteiligungsquote 60 %   -> Konzern-Bilanz 1600   (erwartet 1600)   ok
```

Bei 1 % Beteiligung ging die Tochter **zu 100 %** in den Konzernabschluss
ein: die Minderheitsbeteiligung war um das Hundertfache überhöht
(§ 305 Abs. 1 HGB — der nicht kontrollierte Anteil wurde als
Konzernvermögen ausgewiesen). Bei 0,5 % immerhin zur Hälfte.

Der Standardfall (60 %, 100 %) war in Ordnung — und genau deshalb fiel
nichts auf: die Fehlergrenze liegt bei einer Quote **unter 2 %**, also
genau dort, wo Minderheitsbeteiligungen im echten Leben vorkommen.

#### Der Test, der den Fehler festschrieb

```ts
it('normalisiert Prozent und Bruchteil', () => {
  expect(n(100)).toBe(1);
  expect(n(60)).toBeCloseTo(0.6);
  expect(n(0.6)).toBeCloseTo(0.6);   // <-- ein Bruchteil gilt als Eingabe
```

Der Test behauptete, der Helper dürfe **beide** Formen annehmen. Genau
diese Flexibilität machte den Wert 1 % mehrdeutig — und sie war der Grund,
nicht die Ursache nebenbei. Der Test wurde umgeschrieben: die Quote ist
Prozent, `1` ist `1 %`.

#### Die Behebung

**Eine Regel, eine Stelle.** `beteiligungsquoteAlsFaktor(wert)` ist der
einzige Ort, an dem die Quote gelesen wird:

- gespeichert wird **Prozent** (unverändert),
- der Faktor ist immer `wert / 100`,
- unplausible Werte (≤ 0, > 100 %) werden wie bisher auf 100 % gesetzt —
  aber jetzt **protokolliert** (die Begründung „lieber zu viel einbezogen
  (sichtbar falsch) als zu wenig (unsichtbar falsch)" verlangt, dass man
  es auch sieht),
- der Faktor wird **einmal** in `applyKonsolidierung` bestimmt und an
  alle Verwendungen weitergegeben (Aggregation Bilanz, Aggregation GuV,
  Kapitalkonsolidierung, Aufwand/Ertrag-Eliminierung, Salden-Report).

Der Eliminations-Kontext trägt jetzt den **Faktor** statt der Prozentzahl —
so kann sich dort keine eigene Lesart mehr einschleichen.

Die Entscheidung „0 % bedeutet 100 %" ist **unverändert** geblieben: sie
stand schon im Code und ist begründet. Neu ist nur, dass sie protokolliert
wird und dass sie jetzt **überall** gilt (vorher rechnete die
Kapitalkonsolidierung mit 0 %, die Aggregation mit 100 % — zwei
verschiedene Ergebnisse für dieselbe Einheit).

#### Die Negativprobe

Alte Lesart wiederhergestellt → **zwei** Tests rot, jeder aus dem
richtigen Grund:

```
e2e "1 % Beteiligung bringen 10 EUR der Tochter in den Konzern":
    die Tochter ist zu 100 % eingeflossen (die Quote wurde als Bruchteil
    gelesen): expected 2000 to be 1010
Unit "liest die Quote als Prozent: 1 % ist 1 %, nicht 100 %":
    expected 1 to be close to 0.01, received difference is 0.99
```

Die Gegenprobe (60 %) blieb in beiden Läufen grün — der Fix hat den
funktionierenden Weg nicht verändert.

#### Die Tests

- `e2e/konsolidierung-beteiligungsquote.e2e.spec.ts` (2 Tests): 1 %
  müssen 10 EUR der Tochter einbringen (1000 + 10 = 1010), 60 % dagegen
  600 EUR (1000 + 600 = 1600).
- `konsolidierung.service.spec.ts`: der umgeschriebene Helper-Test und
  ein neuer Test, der den Faktor 0,01 an der Aggregation prüft.

**Merksatz:** Eine Zahl, die an mehreren Stellen gelesen wird, braucht
**eine** Stelle, an der sie gelesen wird. Hier durfte der Helper zwei
Formen annehmen (Prozent *oder* Bruchteil) — damit wurde der Wert 1 %
mehrdeutig, und die Mehrdeutigkeit entschied sich still zu 100 %.

**Merksatz:** Ein Helper, der „flexibel" zwei Einheiten akzeptiert, ist
selbst die Ursache des Fehlers — nicht die Stelle, die ihn aufruft. Eine
enge, eindeutige Signatur (`prozent rein, faktor raus`) verhindert den
Fehler an der Wurzel; die „Sicherheitsnetze" (`wert > 1 ? ... : ...`)
verdecken ihn nur.

**Merksatz:** Der Standardfall ist selten der Fehlerfall. 60 % und 100 %
waren korrekt — der Fehler lag unter 2 %, also genau dort, wo
Minderheitsbeteiligungen vorkommen. Eine Prüfung braucht den **Grenzfall**,
nicht den Standardfall.

#### Verifikation (Nachtrag 90)

| Prüfung | Ergebnis |
|---|---|
| `npm run typecheck` (src + e2e + prisma + Tools) | 0 Fehler |
| `npx eslint src --max-warnings 0` | 0 Warnungen |
| `npx vitest run` | **936/940** (124 Dateien, 4 übersprungen, 0 Fehlschläge) |
| `npx playwright test` | **80/80** |
| `npx tsc --noEmit` (Frontend) | 0 Fehler |

---

### Nachtrag 2026-10-24 (Nachtrag 91): Der DATEV-Override legte Passiva-Positionen auf die Aktiva-Seite

#### Der Befund

Der User-Override des DATEV-Imports (die manuelle Zuordnung eines
DATEV-Kontos zu einer HGB-Position) hat die **Bilanzseite** aus dem
Nummernformat abgeleitet:

```ts
const isBilanzAktiva  = hgbPosition.startsWith('A.') || 'B.' || 'C.';
const isBilanzPassiva = hgbPosition.startsWith('PA'..'PE')
                     || hgbPosition === 'A.I.' || 'A.II.' || 'A.III.' || 'A.IV.' || 'A.V.';
if (isBilanzPassiva && !isBilanzAktiva) → PASSIVA
else if (B.IV.)                        → AKTIVA
else if (isBilanzAktiva)               → AKTIVA
```

Die zweite Zeile ist **toter Code**: 'A.I.' beginnt zugleich mit 'A.',
`isBilanzPassiva && !isBilanzAktiva` ist also nie wahr. Die
EK-Erkennung hat nie ausgelöst.

#### Gemessen

An der laufenden API (DATEV-Konto '3300' = Verbindlichkeiten aus
Lieferungen und Leistungen, 1000 EUR):

```
Gegenprobe: Auto-Mapping (3300 -> C.4.)
    AKTIVA  B.IV.    1000.00
    PASSIVA C.4.     1000.00
    Aktiva 1000.00 | Passiva 1000.00 | ausgeglichen: ja

BUG: User-Override (3300 -> C.4.)
    AKTIVA  B.IV.    1000.00
    AKTIVA  C.4.     1000.00
    Aktiva 2000.00 | Passiva 0.00   | ausgeglichen: NEIN
```

'C.4.' beginnt mit 'C.' — die Heuristik machte daraus **AKTIVA**. Die
Verbindlichkeiten standen auf der Aktivseite, die Bilanz war nicht
ausgeglichen, und der Import meldete `importedCount=2,
skippedCount=0` **ohne jede Warnung**. Dieselbe Position, derselbe
Import — nur der Weg unterschied sich.

Dasselbe mit 'A.V.' (Sonstige Eigenkapitalposten, § 266 Abs. 3 HGB):
wieder AKTIVA.

#### Das Grundproblem: die Kontonummer bestimmt die Seite nicht

Nach § 266 HGB verwenden **beide** Bilanzseiten dieselben Buchstaben:
A./B./C. stehen auf Aktiva (Anlagevermögen, Umlaufvermögen,
Rechnungsabgrenzungsposten) **und** auf Passiva (Eigenkapital,
Rückstellungen, Verbindlichkeiten).

Das ist auch in dieser Anwendung so: der Seed legt `A.III.1.` als AKTIVA
(„Anteile an verbundenen Unternehmen", § 266 Abs. 2) **und** als PASSIVA
(„Gesetzliche Rücklage", § 266 Abs. 3) an — dieselbe Nummer, zwei
Seiten. **Die Seite ist Teil der Identität einer Position.**

Eine Regel, die die Seite aus dem Nummernformat liest, kann deshalb
nicht stimmen — sie kann nur zufällig sometimes stimmen.

#### Die Behebung

Neu: `src/modules/datev-import/mappings/hgb-position-auflosung.ts`. Die
Seite kommt aus den Quellen, die in der Anwendung **eindeutig** sind:

1. **Die SKR04-Reverse-Tabelle** — die gepflegte Konvention der
   Anwendung, in der jede HGB-Position genau eine Seite trägt:
   'A.I.' → PASSIVA (Gezeichnetes Kapital), 'B.IV.' → AKTIVA,
   'C.4.' → PASSIVA. (Widerspruchsfrei geprüft: keine Position kommt
   mit zwei Seiten vor.)
2. **Der HGB-Bilanz-Katalog** (§ 266), wenn die Position dort nur auf
   einer Seite steht.
3. **GuV-Positionen** (Ziffern wie '1.', '5a.') — keine Bilanzseite.
4. Sonst: **mehrdeutig** (steht auf beiden Seiten, in keiner Tabelle)
   oder **unbekannt** → der Override wird **abgelehnt** (fail-closed),
   das Konto übersprungen, und der Grund genannt.

Zusätzlich: **jedes** übersprungene Konto erzeugt jetzt eine Warnung
mit Begründung. Vorher war der Skip beim Override **stumm** — das
Konto verschwand, ohne dass der Import einen Grund nannte.

#### Die Negativprobe

Alte Heuristik wiederhergestellt (und der Server mit ihr neu gestartet)
→ **zwei** e2e-Tests rot, jeder aus dem richtigen Grund:

```
"der User-Override auf C.4. legt die Position auf die Passiva-Seite":
    C.4. (Verbindlichkeiten aus L+L) ist eine Passiva-Position:
    expected 'AKTIVA' to be 'PASSIVA'
"eine mehrdeutige Position wird abgelehnt — mit Begründung":
    die mehrdeutige Position darf nicht importiert werden:
    expected { …(11) } to be undefined
```

Die Gegenprobe (Auto-Mapping) blieb grün.

#### Die Tests

- `e2e/datev-override-seite.e2e.spec.ts` (3 Tests): der Override legt
  'C.4.' auf PASSIVA **und** die Bilanz ist ausgeglichen; das
  Auto-Mapping legt dieselbe Position auf dieselbe Seite; eine
  mehrdeutige Position wird abgelehnt und der Grund genannt.
- `hgb-position-auflosung.spec.ts` (7 Tests): die Auflösung selbst
  (Passiva-, Aktiva-, GuV-, mehrdeutige und unbekannte Positionen).

**Merksatz:** Nicht das Format entscheidet, sondern die **Tabelle**.
Dasselbe Konto auf zwei Wegen unterschiedlich zu behandeln, ist kein
Zufall, sondern zwei Regeln an zwei Stellen — die zweite war geraten.

**Merksatz:** Ein Nummernkreis, der auf beiden Seiten eines Formulars
vorkommt (A./B./C. auf Aktiva und Passiva), kann eine Seite **nicht**
aus der Nummer ableiten. Wer es versucht, rät — und rät falsch, sobald
die Ausnahme auftaucht.

**Merksatz:** Ein übersprungener Datensatz ohne Begründung ist eine
stille Datenlücke. Der Import meldete „2 importiert, 0 übersprungen"
und zeigte eine unausgeglichene Bilanz.

#### Verifikation (Nachtrag 91)

| Prüfung | Ergebnis |
|---|---|
| `npm run typecheck` (src + e2e + prisma + Tools) | 0 Fehler |
| `npx eslint src --max-warnings 0` | 0 Warnungen |
| `npx vitest run` | **946/950** (126 Dateien, 4 übersprungen, 0 Fehlschläge) |
| `npx playwright test` | **80/80** |
| `npx tsc --noEmit` (Frontend) | 0 Fehler |

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