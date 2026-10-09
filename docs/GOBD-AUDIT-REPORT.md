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

## 1. Compliance-Übersicht

| Anforderung | GoBD-Referenz | Status | Beleg |
|---|---|---|---|
| Unveränderbarkeit der Bücher/ Aufzeichnungen | § 146 AO + § 147 AO + GoBD Rz. 10.1 | ✅ | WORM-Object-Lock COMPLIANCE-Mode + 3650 Tage Retention |
| Vollständigkeit | § 146 Abs. 1 AO + GoBD Rz. 10.1 | ✅ | Audit-Trail mit Vorher/Nachher-Snapshots |
| Mandant-Trennung | § 146 Abs. 2 AO | ✅ | Repository-Pattern + MandantGuard + ESLint |
| Aufbewahrungsfristen 10 Jahre | § 147 Abs. 3 AO + § 257 HGB | ⚠️ Teilweise | WORM-Retention 3650 Tage + Löschsperren (Bilanz/GuV/Anhang nur DRAFT, Mandant mit Bestand 409, Konsolidierungseinheit ab COMPLETED). **Offen:** Archivierung/Pseudonymisierung statt Löschung — Rechtsentscheidung, siehe Nachtrag 5 |
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

### 7.1 Quality Gates (Stand 2026-10-09)

| Metrik | Stand |
|---|---|
| Backend tsc-Errors | 0 (`npm run typecheck`, inkl. `tsconfig.test.json`) |
| Backend eslint-Warnings | 0 (`--max-warnings 0`) |
| Backend Unit-Tests | **524 / 524 grün** (52 Dateien) |
| Frontend tsc-Errors | 0 |
| Playwright e2e | **62 / 62 grün**, 0 übersprungen |
| Migrationen auf leerer DB | 6 angewandt, `migrate diff` ohne Abweichung |
| Hash-Chain verifizierbar | ✅ `sequenz`-basiert, `verifyIntegrity()` lückenlos |
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