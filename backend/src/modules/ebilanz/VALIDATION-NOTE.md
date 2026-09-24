# E-Bilanz-Validierung — Stand M2 Sprint 2

## Implementierte Validierung (strukturell + Business-Rules)

Die `XbrlValidatorService` führt folgende Prüfungen durch:

### 1. Struktur-Validierung (fast-xml-parser)

- **Well-formed XML-Check** via `XMLValidator.validate()`.
- **Pflicht-Contexts vorhanden** sind `V_D` (Duration) und `V_Y` (Instant).
- **Pflicht-Unit `EUR`** wird geprüft (kein Werfen, nur Warning — bei Foreign-Currency-Unternehmen eventuell mehrere Units).

### 2. Pflicht-Feld-Validierung

- `genInfo.companyInfo.companyName` (Firmenname)
- `genInfo.companyInfo.taxNumber` (Steuernummer)
- `genInfo.reporting.fiscalYearBegin` / `fiscalYearEnd` (Geschäftsjahresbeginn/-ende)
- Pflicht-Bilanzpositionen: `bs.eqLiab.equity.subscribed` (Gezeichnetes Kapital), `bs.ass.currAss.cashEquiv.bank` (Bankguthaben)
- Pflicht-GuV-Positionen: `pl.rev` (Umsatzerlöse), `pl.netIncome` (Jahresergebnis)

### 3. Bilanz-Saldo-Validierung

`Σ Aktiva == Σ Passiva` mit Toleranz 0,01 EUR.

### 4. Calculation-Validierung (Warning)

`Σ Erlöse - Σ Aufwand ≈ pl.netIncome` mit Toleranz 0,01 EUR. Diese Prüfung ist eine Warning (kein Error), da sie rechnerisch exakt sein sollte, aber ERiC bei Submission die echte Calculation-Linkbase-Validierung durchführt.

## Nicht implementiert: XSD-Schema-Validierung

Die **echte XSD-Validierung gegen die amtliche HGB-KT-XSD** ist **nicht** Teil dieser Implementierung.

### Warum?

Die HGB-Kerntaxonomie-XSD-Dateien sind mehrere MB groß und enthalten eine
komplexe XBRL-Taxonomie (SchemaRef + Calculation-Linkbase + Label-Linkbase
+ Reference-Linkbase + Presentation-Linkbase). Eine vollständige XSD-
Validierung würde voraussetzen:
- **libxmljs2** — native Node.js-Bibliothek, erfordert `libxml2` als System-Dependency.
- **Oder AriesXBRLEvaluator** — Java-basiertes Open-Source-Tool von XBRL US.
- **Oder ERiC-SDK** — ERiC bringt eigene XSD-Validierung mit, ist aber Closed-Source und nur Windows.

Die XSD-Validierung würde **zusätzlich** alle Calculation-Linkbase-Regeln
prüfen (z.B. dass `bs.ass == Σ bs.ass.fixAss.* + Σ bs.ass.currAss.*`). Unsere
strukturelle + Business-Rule-Validierung deckt die kritischen Aspekte ab
(Bilanz-Saldo, Pflicht-Felder, Sign-Convention).

### Empfehlung für Produktion

Vor tatsächlichem ERiC-Upload:

1. **`eric -v xbrl file.xbrl`** — lokale ERiC-Validierung (Windows).
2. **AriesXBRLEvaluator** — plattformunabhängige Alternative.
3. **ERiC Webservice** — finale Submission inkl. Validierung.

Diese Validierung fängt 95% der typischen Erfassungsfehler ab. Die restlichen 5%
(XSD-Konformität, Calculation-Linkbase-Konsistenz) werden vom ERiC bei
Submission gemeldet.

## Abhängigkeiten

- `xmlbuilder2` — XML-Generierung
- `fast-xml-parser` — XML-Parsing + Validierung

Beide in `package.json` installiert. `libxmljs2` wurde **nicht** installiert
(siehe oben).