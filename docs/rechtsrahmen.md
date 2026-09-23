# Rechtsrahmen — HGB / PublG / GoBD / DSGVO

> Quelle: HGB (Handelsgesetzbuch), PublG (Publizitätsgesetz), AO (Abgabenordnung),
> GoBD (Grundsätze zur ordnungsmäßigen Führung und Aufbewahrung von Büchern,
> Aufzeichnungen und Unterlagen in elektronischer Form), DSGVO, BDSG.
>
> **Wichtig**: Diese Zusammenfassung ist **kein Rechtsrat**. Bei Unklarheiten
> → Steuerberater oder Wirtschaftsprüfer konsultieren.

## 1. Pflichtveröffentlichung im Bundesanzeiger (§ 325 HGB)

### 1.1 Wer ist betroffen?

| Rechtsform | Pflicht? |
|---|---|
| GmbH | **Ja** |
| AG | **Ja** |
| GmbH & Co. KG | **Ja** (Kommanditgesellschaft auf Aktien ebenfalls) |
| GbR / Einzelunternehmen | Nein (freiwillig möglich) |
| Eingetragene Genossenschaft | **Ja** (über Genossenschaftsregister) |

### 1.2 Was muss veröffentlicht werden?

- **Erst-offenlegung**: Jahresabschluss (Bilanz + GuV + Anhang) + Lagebericht
- **Folge-offenlegung**: Nur Jahresabschluss (Lagebericht entfällt)
- **Konzernabschluss** (§ 11 PublG): zusätzlich Konzernbilanz + Konzern-GuV + Konzernanhang + Konzernlagebericht

### 1.3 Größenabhängige Erleichterungen (§ 326 HGB)

| Größe | Bilanzsumme | Umsatz | Mitarbeiter | Erleichterung |
|---|---|---|---|---|
| Kleinst | ≤ € 350k | ≤ € 700k | ≤ 10 | Nur Bilanz (kein Anhang), Hinterlegung statt Offenlegung |
| Klein | ≤ € 6 Mio | ≤ € 12 Mio | ≤ 50 | Bilanz + GuV (Anhang verkürzt), Hinterlegung |
| Mittel | ≤ € 20 Mio | ≤ € 40 Mio | ≤ 250 | Vollständig (Bilanz + GuV + Anhang) |
| Groß | > € 20 Mio | > € 40 Mio | > 250 | Vollständig + Konzernabschluss (falls relevant) |

**Pilot-M1**: Kleinstkapitalgesellschaften — vereinfachter Bilanz-Submit (PDF direkt).

### 1.4 Fristen

| Frist | Beschreibung |
|---|---|
| Aufstellungsfrist | Bilanz muss innerhalb der **angemessenen Zeit** (idR 1 Jahr) aufgestellt werden |
| Offenlegungsfrist | Veröffentlichung innerhalb von **12 Monaten** nach Geschäftsjahresende |
| Kleinstkapitalgesellschaft | Hinterlegung bis spätestens 12 Monate nach Geschäftsjahresende |
| Konzernabschluss | Frist beginnt mit Konzern-Geschäftsjahresende |

**Verzug**: Geldbuße bis zu **€ 50.000** (§ 335 HGB). Erzwingung durch Ordnungswidrigkeitenverfahren.

## 2. Bundesanzeiger Veröffentlichungskanäle

### 2.1 BAnz XML / XBRL (Standardkanal)

- **Format**: Maschinenlesbares XML nach BAnz-Schema
- **API**: Bundesanzeiger Verlag Portal (https://www.bundesanzeiger.de)
- **Authentifizierung**: Verlag-Konto (Online-Registrierung, €-Gebühr)
- **Test-Sandbox**: BAnz Test-Portal (vor Produktion Pflicht)
- **Validierung**: Schema-Validierung vor Submission, automatische Rückmeldung

### 2.2 PDF direkt (Kleinstkapitalgesellschaften)

- **Format**: PDF (text + bildlich) + optional XML-Container
- **Wann**: Bilanzsumme ≤ € 6 Mio und Umsatz ≤ € 12 Mio (Kleinstkapitalgesellschaft-Definition § 267a HGB)
- **Signatur**: Qualifizierte elektronische Signatur (qeS) erforderlich
- **API**: BAnz Portal Upload

### 2.3 E-Bilanz / TAXONOMIE (Konzernabschluss)

- **Format**: XBRL nach amtlicher TAXONOMIE
- **Wann**: Konzernabschluss nach § 11 PublG
- **API**: BAnz-Portal E-Bilanz Schnittstelle
- **Validierung**: TAXONOMIE-Validator (Pflicht vor Submission)

## 3. GoBD (Grundsätze zur ordnungsmäßigen Führung und Aufbewahrung)

### 3.1 Die 7 GoBD-Grundsätze

1. **Nachvollziehbarkeit**: Jede Buchung muss bis zum Originalbeleg zurückverfolgbar sein
2. **Vollständigkeit**: Alle Geschäftsvorfälle sind vollständig zu erfassen
3. **Einzelaufzeichnung**: Jeder Geschäftsvorfall ist einzeln aufzuzeichnen
4. **Verlässlichkeit**: Aufzeichnungen müssen verlässlich (richtig, vollständig, zeitgerecht) sein
5. **Zeitgerechte Verbuchung**: Geschäftsvorfälle sind zeitnah zu erfassen
6. **Ordnung**: Systematische, geordnete Ablage
7. **Unveränderlichkeit**: Originalaufzeichnungen dürfen nicht nachträglich verändert werden

### 3.2 Technische Anforderungen

| Anforderung | Umsetzung in unserem Produkt |
|---|---|
| Unveränderlichkeit | **WORM-Storage (S3 Object Lock, COMPLIANCE-Mode)** für alle Bilanzen/GuVs/Anhang/PDFs |
| Vollständigkeit | Audit-Trail erfasst jede Mutation mit Vor-/Nachher-Zustand |
| Zeitgerechte Buchung | `createdAt`/`updatedAt` Timestamps + Pflicht-Felder |
| 10-Jahres-Aufbewahrung | S3 Object Lock mit `COMPLIANCE` Mode + 3650-Tage-Retention |
| Lesbarkeit | PDF/A-3 für Langzeitarchivierung (ISO 19005-3) |
| Zugriffsschutz | RBAC + JWT + Audit-Trail |

### 3.3 Verbotene Praktiken

- **Nachträgliche Änderung** von Originalaufzeichnungen (stattdessen Storno + Neubuchung)
- **Löschung** von Daten vor Ablauf der Aufbewahrungsfrist
- **Überschreiben** von gespeicherten Dokumenten
- **Fehlende Protokollierung** von Änderungen

## 4. DSGVO / BDSG Anforderungen

### 4.1 Datenkategorien

| Datenkategorie | DSGVO-Klassifikation | Aufbewahrung |
|---|---|---|
| Geschäftsführer-Name | personenbezogen | Bis Ende Geschäftsbeziehung |
| Bilanzpositionen (€-Beträge) | sachbezogen (kein Personenbezug) | 10 Jahre (GoBD) |
| Steuerberater-Zugangsdaten | personenbezogen | Bis Ende Vertragsverhältnis |
| Audit-Logs (Wer hat was gemacht) | personenbezogen | 10 Jahre (GoBD) — DSGVO-Aufbewahrungspflicht kollidiert: berechtigtes Interesse |
| IP-Adressen | personenbezogen (BDSG) | 30 Tage für Sicherheit, dann Anonymisierung |

### 4.2 Rechtsgrundlagen

| Verarbeitung | Rechtsgrundlage |
|---|---|
| Speicherung Bilanz/GuV/Anhang | Rechtliche Verpflichtung (§ 147 AO) |
| Audit-Logs | Berechtigtes Interesse (Art. 6 Abs. 1 lit. f DSGVO) + Rechtliche Verpflichtung |
| Login-Daten | Vertrag (Art. 6 Abs. 1 lit. b) |
| TOTP-Secret | Einwilligung (Art. 6 Abs. 1 lit. a) — widerrufbar |

### 4.3 Pflichten

- **Auftragsverarbeitungsvertrag (AVV)** zwischen Kanzlei und uns (Hetzner Cloud)
- **Verzeichnis der Verarbeitungstätigkeiten** (Art. 30 DSGVO)
- **Datenschutz-Folgenabschätzung** für Audit-Logs (IP-Adressen)
- **Datenminimierung**: Nur erforderliche Daten erheben
- **Verschlüsselung at rest + in transit**: TLS 1.3 + AES-256
- **Rechte der Betroffenen**: Auskunft, Berichtigung, Löschung (mit GoBD-Konflikt), Datenübertragbarkeit

## 5. PublG (Publizitätsgesetz) — Konzernabschluss

### 5.1 Pflicht-Konzernabschluss (§ 11 PublG)

- Konzerne, die **nicht** bereits nach IFRS / US-GAAP konsolidieren
- Konzern muss offenlegen: Konzernbilanz, Konzern-GuV, Konzernanhang, Konzernlagebericht
- Frist: Innerhalb von 12 Monaten nach Konzern-Geschäftsjahresende

### 5.2 E-Bilanz / TAXONOMIE

- **TAXONOMIE-Version**: Aktuell amtliche TAXONOMIE für Berichtsperiode (idR jährlich aktualisiert)
- **Pflicht-Bestandteile**: Bilanz, GuV, Anhang (E-Bilanz)
- **Validierung**: Vor Submission über BAnz E-Bilanz-Validator
- **Update-Mechanismus**: TAXONOMIE-Updates jährlich → System muss updates unterstützen

## 6. Strafen / Bußgelder

| Verstoß | Konsequenz |
|---|---|
| Verspätete Veröffentlichung | Geldbuße bis € 50.000 (§ 335 HGB) |
| Fehlende Veröffentlichung | Erzwingung durch Zwangsgeld |
| Falsche / unvollständige Angaben | Bilanzdelikte (§§ 331-333 HGB): Freiheitsstrafe bis 3 Jahre / Geldstrafe |
| Verstoß gegen GoBD | Schätzungsbefugnis Finanzamt (§ 162 AO) |
| DSGVO-Verstöße | Bußgeld bis € 20 Mio / 4% Jahresumsatz |

## 7. Checkliste für unsere Implementierung

- [ ] **M1**: Bilanz + GuV Eingabe, PDF-Generierung, Audit-Trail (kein Submit)
- [ ] **M2**: BAnz XML/XBRL + BAnz-Portal-Submission (Phase 1: Sandbox, Phase 2: Produktion)
- [ ] **M3**: E-Bilanz TAXONOMIE + DATEV-Import + Konzernabschluss
- [ ] **M4**: GoBD-Audit (extern), IDW PS 880 Vorbereitung

## 8. Quellen

- HGB (Handelsgesetzbuch), insb. §§ 325-335, 267a, 284
- PublG (Publizitätsgesetz), insb. § 11
- AO (Abgabenordnung), insb. §§ 147, 162
- GoBD (BMF-Schreiben vom 28.11.2019, IV A 4 - S 0316/19/10003)
- DSGVO (EU-VO 2016/679)
- IDW PS 880 (Prüfungssicherheit bei elektronischer Datenverarbeitung)
- Bundesanzeiger Verlag Portal: https://www.bundesanzeiger.de

---

**Letzte Aktualisierung**: 2026-09-23
**Reviewer**: Steuerberater / Wirtschaftsprüfer (Pilot-Onboarding)