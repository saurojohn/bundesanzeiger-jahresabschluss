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
| TODO-8.7 | Entscheiden: `assertMandantAccess` in 10 Services — Tiefenschutz oder toter Code? Empfehlung: behalten, aber als „nur ohne Guard wirksam" kennzeichnen und einen Test schreiben, der den Service **direkt** (ohne HTTP) prüft | Dev + Compliance | Sprint 5 |

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
| Jahresabschluss-Aggregat | 🟡 **anlegen, lesen, abschließen und signieren** (Nachtrag 28/30/35: POST + GET, `POST :id/finalize`, `signAbschluss` mit `FINALIZED`-Sperre). Offen: Saldoabgleich A.V.↔GuV **warnt** statt zu sperren (Entscheidung 1); `SIGNED → SUBMITTED → PUBLISHED` haben keinen Schreibpfad (TODO-8.10); Entwurfs-PDF landet im 10-Jahres-WORM (TODO-8.9, vor dem Pilot zu entscheiden) |
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
| TODO-8.1 | Verfahrensdokumentation (GoBD Rz. 10.3) erstellen | Compliance | Q4/2026 |
| TODO-8.2 | Internes-Kontrollsystem-Doku (IKS) | Compliance + WP | Q4/2026 |
| TODO-8.3 | Externer GoBD-Auditor beauftragen | Geschäftsführung | Q4/2026 |
| TODO-8.4 | Schema-Migration für Audit-Hash-Chain ausführen | DevOps | nach Pilot-Phase-2-Ende |
| TODO-8.5 | Cross-Region-Replikation (S3 + DB) | DevOps | Sprint 5+ |
| TODO-8.6 | Automatisierter monatlicher Restore-Test in CI | DevOps | Sprint 5+ |
| TODO-8.7 | `assertMandantAccess` in 10 Services — Tiefenschutz oder toter Code? (Nachtrag 34: über HTTP nicht erreichbar, der `MandantGuard` wirkt identisch zuerst) | Dev + Compliance | Sprint 5 |
| TODO-8.8 | Audit-Trail "fire and forget" (~50 Stellen) bewerten: Fachschreibvorgang + Audit in eine Transaktion, plus Condition auf Alter des ältesten Eintrags (Nachtrag 31) | Dev + Compliance | Sprint 5 |
| TODO-8.9 | **Entwurfs-PDF des Jahresabschlusses**: darf `generateAbschlussPdf` einen `DRAFT` rendern, der mit 10-Jahres-Object-Lock im Beweis-Archiv landet? Varianten a/b/c in Nachtrag 35 (Nachtrag 35, Befund 4) | Produkt + Compliance | **vor dem Pilot** |
| TODO-8.10 | `SIGNED → SUBMITTED → PUBLISHED` haben Beschriftung und Typ, aber keinen Schreibpfad; `banzBestellnummer` und `veroeffentlichtAm` sind unbeschrieben (Nachtrag 35, Befund 3) | Dev | M4 |
| ~~TODO-8.11~~ | ~~Kein Wächter für tote Knöpfe~~ — **erledigt in Nachtrag 39**: `tote-knopfe.spec.ts` prüft den gesamten Quellbaum, ohne Ausnahmeliste | — | erledigt |
| TODO-8.12 | Der Signier-Knopf ist an 5 Stellen **ohne Rollenprüfung** sichtbar; `POST /signatur/*` ist auf `WIRTSCHAFTSPRUEFER` beschränkt. Ein STEUERBERATER trägt P12 hoch, gibt das Passwort ein und erhält 403. `GET /api/auth/me` liefert die Rolle — die Auswertung fehlt (Nachtrag 38) | Dev + UX | Sprint 5 |
| TODO-8.13 | **Gegenprobe negativ — vorerst keine Änderung.** Zwei echte Instanzen auf derselben Datenbank, 60 Schreibvorgänge abwechselnd auf beide verteilt: `integrity` → **OK**. Die Selbstsortierung aus Nachtrag 41 deckt auch den Mehrinstanzfall, weil die Reihenfolge aus der Datenbank kommt und die Berechnung idempotent ist. Restrisiko: ein schmales Fenster (siehe Nachtrag 45), nicht beobachtet | Dev | beobachten, M4 |
| TODO-8.14 | **Ungeklärt, eingegrenzt (Nachtrag 43):** Der Eintrag `seq=249` wurde **einmal** gehasht, mit `mandantId="074e…"` und einem before/after-`newState`. In der Datenbank steht `mandantId = null` und ein **Mandant-Schnappschuss** als `newState`. Die Anwendung hat **genau eine** `auditLog.update`-Stelle (die Hash-Schreibung selbst). Die Zeile wurde also von außerhalb dieser Anwendung verändert — Beleg unten | Dev + Compliance | Sprint 5 |
| TODO-8.15 | **Komponentensignatur am offenen Aggregat**: `sign-guv` / `sign-anhang` hängen ohne Statusprüfung an den Jahresabschluss — gemessen 2 Signaturen + 5 WORM-Objekte bei `status: DRAFT`. Entscheidung: zulässig (Modell braucht ein trennendes Feld) oder unzulässig (Sperre analog `sign-abschluss`) (Nachtrag 42) | Fachbereich + Compliance | **vor dem Pilot** |

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
| TODO-8.13 | **Gegenprobe negativ — vorerst keine Änderung.** Zwei echte Instanzen auf derselben Datenbank, 60 Schreibvorgänge abwechselnd auf beide verteilt: `integrity` → **OK**. Die Selbstsortierung aus Nachtrag 41 deckt auch den Mehrinstanzfall, weil die Reihenfolge aus der Datenbank kommt und die Berechnung idempotent ist. Restrisiko: ein schmales Fenster (siehe Nachtrag 45), nicht beobachtet | Dev | beobachten, M4 |
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
| TODO-8.16 | `dns.controller.ts` verspricht im Kommentar eine Rollenbindung, die nur im Service existiert. Entweder `@Roles` an die Route heben oder den Kommentar auf die Wirklichkeit korrigieren („Autorisierung im Service, siehe `assertKanzleiAdminAccess`") — sonst wird sie beim Refaktorieren stillschweigend vergessen | Dev | Sprint 5 |
| TODO-8.18 | **Nachtrag 46 behoben.** Vor dem Pilot den Zahlungsweg einmal **echt** durchspielen: Checkout → Stripe sendet Webhook → Tarifwechsel sichtbar. Der Mock-Provider liefert für `handleWebhook()` immer `null`, der Pilotbetrieb prüft den Weg also nicht | Produkt + Dev | **vor dem ersten bezahlten Mandanten** |

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

### Nachtrag 2026-10-19 (Nachtrag 46): Stripe konnte nie ein Webhook zustellen — und die Reparat��� hätte eine Tür geöffnet

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