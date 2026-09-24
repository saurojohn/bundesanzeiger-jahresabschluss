# BAnz-Submission-Schemata — Bundesanzeiger Jahresabschluss

> **Stand**: 2026-09-24 (nach Markt-Recherche)
> **Wichtig**: Die Architektur wurde nach Recherche der realen Markt-Situation angepasst.

## 1. Marktrealität (2026)

### 1.1 Keine externe BAnz-XML/XBRL-Submission-API

**Befund**: Der Bundesanzeiger Verlag bietet für **externe Software keine direkte XML/XBRL-Submission-API** für Jahresabschlüsse.

- Altes "XBRL program" des Verlags wurde 2023 durch **eBilanz Online** ersetzt
- eBilanz Online ist eine **registrierungspflichtige Web-App** des Verlags (`ebilanzonline.de`)
- Externe Software kann nur **PDF-Hinterlegung** beim BAnz über das Online-Portal manuell durchführen

### 1.2 E-Bilanz (§ 5b EStG) ist Pflicht ans Finanzamt

- Alle buchführungspflichtigen Unternehmen müssen seit 2013 E-Bilanz ans **Finanzamt** senden
- Übermittlungskanal: **ELSTER / ERiC** (nicht direkt BAnz)
- Format: **XBRL nach amtlicher Taxonomie** (HGB-Kerntaxonomie, jährlich aktualisiert)

### 1.3 Echte M2-Architektur (gewählt: A + C)

Wir generieren drei verschiedene Export-Formate für die Kanzlei:

| Export | Zweck | Empfänger | Format |
|---|---|---|---|
| **E-Bilanz-XBRL** | Elektronische Bilanz ans Finanzamt | Finanzamt via ERiC (durch Kanzlei) | XBRL nach HGB-Kerntaxonomie v6 (2025-04-01) |
| **DATEV-Buchungsstapel** | Buchungssätze in DATEV importieren | DATEV / Addison / etc. | EXTF-Buchungsstapel CSV (Format-Version 12, Main 700) |
| **GoBD-PDF + qeS** | BAnz-Hinterlegung | BAnz-Online-Portal (manuell) | PDF/A-3 + qualifizierte Signatur |

**Kanzlei-Workflow**:
1. Erfasst Bilanz/GuV/Anhang in unserem Tool
2. Generiert qeS-PDF → lädt es ins **BAnz-Online-Portal** hoch
3. Generiert E-Bilanz-XBRL → lädt es in **ERiC** hoch → sendet an Finanzamt
4. Generiert DATEV-CSV → importiert in **DATEV** → DATEV macht alles weitere (UStVA, E-Bilanz via DATEV-Schnittstelle)

---

## 2. E-Bilanz-Taxonomie

### 2.1 Quelle

- **Herausgeber**: XBRL Deutschland e.V. im Auftrag des BMF
- **Pflichtmäßige Aktualisierung**: jährlich (BMF-Schreiben)
- **Aktuelle Version** (Stand 2026): **HGB-Kerntaxonomie v6.0 (2025-04-01)**
- **Download**: `https://www.xbrl.de/taxonomies/` oder `https://www.esteuer.de`
- **Annahme-Periode**: ERiC akzeptiert für VZ 2022-2025

### 2.2 Struktur (Überblick)

Die Taxonomie bildet HGB §266 (Bilanz) und §275 (GuV) ab:

```
HGB-Kerntaxonomie
├── Bilanz (bs.*)
│   ├── Aktiva (bs.ass)
│   │   ├── Anlagevermögen (bs.ass.fixAss)
│   │   └── Umlaufvermögen (bs.ass.currAss)
│   └── Passiva (bs.eqLiab)
│       ├── Eigenkapital (bs.eqLiab.equity)
│       ├── Rückstellungen (bs.eqLiab.provisions)
│       └── Verbindlichkeiten (bs.eqLiab.liab)
├── GuV (pl.*)
│   ├── Umsatzerlöse (pl.rev)
│   ├── Materialaufwand (pl.costOfMat)
│   ├── Personalaufwand (pl.costOfEmpl)
│   ├── Abschreibungen (pl.deprAmort)
│   ├── Sonstige betriebliche Aufwendungen (pl.otherCost)
│   ├── Finanzergebnis (pl.finResult)
│   ├── Steuern (pl.tax)
│   └── Jahresüberschuss/-fehlbetrag (pl.netIncome)
├── Anhang (Notes)
│   ├── Bilanzierungs- und Bewertungsmethoden
│   ├── Erläuterungen Bilanz
│   ├── Erläuterungen GuV
│   └── Sonstige Pflichtangaben
└── Allgemeine Informationen (genInfo)
    ├── Firmenname
    ├── Steuernummer
    ├── Rechtsform
    ├── Geschäftsjahr
    └── Beraterstammdaten
```

### 2.3 XBRL-Sign-Convention (WICHTIG!)

Aus der Recherche (finamt-Projekt als Referenz):

- **Aufwands-Konzepte** (materialServices, staff, deprAmort, otherCost, interestExpense) werden **positiv** gespeichert
- **Calculation-Linkbase** hat `weight="-1"` für diese Konzepte → automatische Subtraktion
- **Niemals negativ in der Instance** speichern — sonst doppelte Negation → Validation-Fehler
- Beispiel:
  ```
  pl.costOfMat = 10000  (NICHT -10000!)
  pl.rev = 50000
  Calculation: rev + costOfMat(weight=-1) = 40000
  ```

### 2.4 Pflicht-Felder für Kleinstkapitalgesellschaft (§ 267a HGB)

```xml
<xbrli:xbrl xmlns="..." xmlns:link="..." xmlns:xbrli="..." xmlns:xbrldi="..." xmlns:iso4217="..." xmlns:bs="..." xmlns:pl="..." xmlns:genInfo="..." xmlns:de-gaap-ci="...">

  <!-- Allgemeine Informationen -->
  <genInfo.companyInfo.companyName contextRef="V_Y">{firmenname}</genInfo.companyInfo.companyName>
  <genInfo.companyInfo.legalForm contextRef="V_Y">{rechtsform}</genInfo.companyInfo.legalForm>
  <genInfo.companyInfo.taxNumber contextRef="V_Y">{steuernummer}</genInfo.companyInfo.taxNumber>
  <genInfo.companyInfo.fiscalYearBegin contextRef="V_D">{yyyy-mm-dd}</genInfo.companyInfo.fiscalYearBegin>
  <genInfo.companyInfo.fiscalYearEnd contextRef="V_D">{yyyy-mm-dd}</genInfo.companyInfo.fiscalYearEnd>

  <!-- Bilanz Aktiva -->
  <bs.ass.fixAss.intangAss.develCost contextRef="V_D">{betrag}</bs.ass.fixAss.intangAss.develCost>
  <!-- ... weitere Positionen ... -->
  <bs.ass total="true" contextRef="V_D">{summeAktiva}</bs.ass>

  <!-- Bilanz Passiva -->
  <bs.eqLiab.equity.subscribed cap="instant" openDate="V_Y" closeDate="V_D">{gezeichnetesKapital}</bs.eqLiab.equity.subscribed>
  <!-- ... weitere Positionen ... -->
  <bs.eqLiab total="true" contextRef="V_D">{summePassiva}</bs.eqLiab>

  <!-- GuV -->
  <pl.rev contextRef="V_D">{umsatzerloese}</pl.rev>
  <!-- ... weitere Positionen ... -->
  <pl.netIncome contextRef="V_D">{jahresueberschuss}</pl.netIncome>
</xbrli:xbrl>
```

### 2.5 Context-Refs

- `V_D` (Duration): Berichtszeitraum für GuV-Positionen
- `V_Y` (Instant): Stichtag für Bilanz-Positionen
- `openDate` / `closeDate`: Geschäftsjahresbeginn/-ende

### 2.6 Validation

Vor Submission muss die `.xbrl`-Datei gegen die **Taxonomie-XSD** validiert werden:

```bash
# ERiC eigene Validierung (über ERiC-SDK)
eric -v xbrl file.xbrl

# Oder: AriesXDRY-Open-Source-Validator
java -jar AriesXBRLEvaluator.jar -f file.xbrl -t hgb-kt-2025-04-01.zip
```

### 2.7 Mapping HGB-Konten → Taxonomie-Codes

Beispiel-Mapping für die gängigsten Positionen:

| HGB-Position (§ 266) | Steuer-Konto (SKR04) | Taxonomie-Code |
|---|---|---|
| Gezeichnetes Kapital | 0800 | bs.eqLiab.equity.subscribed |
| Kapitalrücklage | 0820 | bs.eqLiab.equity.capRes |
| Gewinnrücklage | 0840 | bs.eqLiab.equity.earnRes |
| Jahresüberschuss | 0980 | pl.netIncome (auch bs.eqLiab.equity.netIncome) |
| Bankguthaben | 1200 | bs.ass.currAss.cashEquiv.bank |
| Forderungen aus L+L | 1400 | bs.ass.currAss.recv.trade |
| Verbindlichkeiten aus L+L | 1600 | bs.eqLiab.liab.trade |
| Pensionsrückstellung | 0700 | bs.eqLiab.provisions.pension |

(Volles Mapping 80+ Positionen siehe `backend/src/modules/ebilanz/mappings/hgb-kt-v6.ts`)

---

## 3. DATEV-Format (Buchungsstapel)

### 3.1 Quelle

- **Herausgeber**: DATEV eG
- **Spezifikation**: DATEV-Format Hauptversion 700+, Buchungsstapel-Format 12+
- **Download**: `https://developer.datev.de/en/file-format/details/datev-format/format-description/booking-batch`
- **Kontenpläne**: SKR03 / SKR04 (Standard-Kontenrahmen)

### 3.2 Datei-Struktur

```
EXTF_Buchungsstapel.csv (UTF-8, Komma-getrennt, Anführungszeichen für Strings)
├── Header-Zeile (1)
├── Buchungs-Zeilen (n)
```

### 3.3 Header-Felder (13 Felder)

| # | Feld | Beispiel |
|---|---|---|
| 1 | Formatname | HEADER |
| 2 | Version-Nummer | 12 (Buchungsstapel) |
| 3 | Beraternummer | DATEV-Berater-Nummer |
| 4 | Mandantennummer | DATEV-Mandant-Nummer |
| 5 | Wirtschaftsjahr-Beginn | TT.MM.JJJJ |
| 6 | Wirtschaftsjahr-Ende | TT.MM.JJJJ |
| 7 | Sachkontenlänge | 4 oder 5 |
| 8 | Datum-von | TT.MM.JJJJ |
| 9 | Datum-bis | TT.MM.JJJJ |
| 10 | Bezeichnung | "Buchungsstapel" |
| 11 | Diktatkürzel | "Buchhaltung" |
| 12 | Buchungstyp | 1 (Standard) / 2 (Eröffnung) |
| 13 | Rechnungslegungszweck | "00" (kein spezieller) |

### 3.4 Buchungs-Zeile (17 Felder)

| # | Feld | Format | Beispiel |
|---|---|---|---|
| 1 | Umsatz | Dezimal mit Komma, 2 Nachkommastellen | 1234,56 |
| 2 | Soll-/Haben-Kennzeichen | "S" / "H" | "S" |
| 3 | WKZ Umsatz | ISO-4217-Code | "EUR" |
| 4 | Kurs | 0 (EUR) |  |
| 5 | Basisumsatz | (nur Fremdwährung) |  |
| 6 | WKZ Basisumsatz | (nur Fremdwährung) |  |
| 7 | Konto | 4-9 stellig | 4400 |
| 8 | Gegenkonto | 4-9 stellig | 70000 |
| 9 | BU-Schlüssel | 4-stellig (z. B. "0" für leer) | "0" |
| 10 | Belegdatum | TTMM | 0105 |
| 11 | Belegfeld 1 | Max 36 Zeichen | "Rg-2026-001" |
| 12 | Belegfeld 2 | Max 12 Zeichen, Datum TTMMYY |  |
| 13 | Skonto | 0,00 wenn leer |  |
| 14 | Buchungstext | Max 60 Zeichen | "Kunde Müller, Beratung Q1" |
| 15 | Postensperre | 0/1 | 0 |
| 16 | Diverse Adressnummer | OPOS-relevant |  |
| 17 | Geschäftspartnerbank | 3 Stellen (BLZ) |  |

### 3.5 CSV-Beispiel (3 Buchungen)

```
"HEADER";"Version";"Berater";"Mandant";"WJ-Beginn";"WJ-Ende";"Sachkontenlaenge";"Datum-von";"Datum-bis";"Bezeichnung";"Diktat";"Buchungstyp";"Rechnungslegungszweck"
"EXTF_Buchungsstapel";"12";"12345";"67890";"01.01.2026";"31.12.2026";"4";"01.01.2026";"31.12.2026";"Buchungsstapel";"Buchhaltung";"1";"00"

"Umsatz";"SH";"WKZ";"Kurs";"Basis";"BWKZ";"Konto";"Gegenkonto";"BUSchluessel";"Belegdatum";"Belegfeld1";"Belegfeld2";"Skonto";"Buchungstext";"Postensperre";"Adressnummer";"PartnerBLZ"
"12345,67";"S";"EUR";"";"";"";"4400";"8400";"0";"1501";"Rg-2026-001";"";"";"Beratung Q1";"0";"";""
"-12345,67";"H";"EUR";"";"";"";"1200";"4400";"0";"1501";"Rg-2026-001";"";"";"Beratung Q1";"0";"";""
```

### 3.6 Mapping HGB → DATEV

| HGB-Bilanzposition | DATEV-Konto (SKR04) |
|---|---|
| Bankguthaben | 1200 |
| Forderungen aus L+L | 1400 |
| Sonstige Vermögensgegenstände | 1500 |
| Geleistete Anzahlungen | 1600 |
| Verbindlichkeiten aus L+L | 3300 (Kreditoren) |
| Gezahlte Anzahlungen | 1700 |
| Gezeichnetes Kapital | 0800 |
| Gewinnrücklagen | 0840 |
| Pensionsrückstellungen | 0700 |
| Steuerrückstellungen | 0740 |
| Sonstige Rückstellungen | 0760 |

---

## 4. Qualifizierte Elektronische Signatur (qeS)

### 4.1 Anforderungen

- **Qualifizierte Signatur** nach eIDAS-Verordnung (EU 910/2014)
- Erfordert **qualifiziertes Zertifikat** + sichere Signaturerstellungseinheit
- Gängige Anbieter:
  - **DATEV-SmartCard** (für DATEV-Mitglieder)
  - **Kobil Signtrust** (Universal-Signatur-Ports)
  - **Telesec Signtrust** (DFN-Verein)
  - **GlobalSign** (für Selbständige)

### 4.2 Implementierung

- PDF-A-3-Container mit eingebetteter Signatur
- P12-Token (Hardware oder Software)
- `@signpdf/signer-p12` + `@signpdf/signpdf` (Node.js)
- TSA-Integration für **Zeitstempel** (z. B. DigiStamp)

### 4.3 Workflow

```
Bilanz/GuV/Anhang erfassen
  ↓
PDF generieren (PDFKit, deutsche Beschriftung)
  ↓
PDF/A-3-Container mit eingebetteter Signatur vorbereiten
  ↓
Signatur-Stub: Kanzlei lädt P12-Token in unsere UI
  ↓
Signatur via signpdf/signpdf-Library
  ↓
TSA-Zeitstempel hinzufügen
  ↓
Signiertes PDF in WORM-Storage (BAnz-Pflicht-Archiv)
  ↓
Kanzlei lädt signiertes PDF ins BAnz-Online-Portal hoch
```

---

## 5. M2-Sprint-Plan (aktualisiert)

### M2 Sprint 0 (Woche 16-17): Schema-Mapping-Definition
- HGB-Kerntaxonomie v6 → unsere Bilanz-Positionen (80+ Mappings)
- SKR03/SKR04 → unsere GuV-Positionen
- eBilanz-Pflicht-Felder definieren

### M2 Sprint 1 (Woche 18-19): E-Bilanz-XBRL-Generator
- `backend/src/modules/ebilanz/services/xbrl-generator.service.ts`
- XML-Generierung nach HGB-Kerntaxonomie v6
- Sign-Convention (positiv für Aufwände)
- Context-Refs (V_D für GuV, V_Y für Bilanz)

### M2 Sprint 2 (Woche 20-21): XBRL-Validator
- `backend/src/modules/ebilanz/services/xbrl-validator.service.ts`
- Schema-Validierung gegen HGB-Kerntaxonomie XSD
- Calculation-Linkbase-Validation (Bilanz-Summe = Passiva-Summe)
- Pflicht-Feld-Validation

### M2 Sprint 3 (Woche 22-23): DATEV-Export
- `backend/src/modules/datev/services/datev-export.service.ts`
- EXTF_Buchungsstapel CSV-Generator
- HEADER + Buchungs-Zeilen nach DATEV-Format v700+

### M2 Sprint 4 (Woche 24-25): qeS-Signatur
- `backend/src/modules/signatur/services/signature.service.ts`
- P12-Token-Integration via signpdf/signpdf
- PDF/A-3-Container mit eingebetteter Signatur
- TSA-Zeitstempel

### M2 Sprint 5 (Woche 26-27): Frontend + Pilot-Phase-2
- Export-Buttons im Frontend (eBilanz, DATEV, qeS-PDF)
- Token-Upload-UI
- Pilot-Phase: 3 Pilot-Kanzleien + 15 Mandanten

---

## 6. Referenzen

- **HGB-Kerntaxonomie**: `https://www.xbrl.de/taxonomies/`
- **E-Bilanz ERiC**: `https://www.elster.de/elsterweb/softwareprodukt/eric`
- **DATEV-Format**: `https://developer.datev.de/en/file-format/details/datev-format`
- **DATEV-Kontenpläne**: SKR03 / SKR04 (Standard)
- **eIDAS-Verordnung**: EU 910/2014 (qualifizierte Signatur)
- **§ 5b EStG**: E-Bilanz-Pflicht
- **§ 325-326 HGB**: BAnz-Pflichtpublizität
- **§ 147 AO**: 10-Jahres-Aufbewahrung (GoBD)

---

**Status**: Schema-Mapping vorbereitet, Generierung in Sprint 1
**Nächste Aktion**: AriesXBRLEvaluator-Dependency für Validation evaluieren