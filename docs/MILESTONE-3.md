# Milestone 3 (Monate 7-9) — DATEV-Import & Konzernabschluss

> **Stand**: 2026-09-24 (M3 Sprint 0 in Vorbereitung)
> **Voraussetzung**: M1 + M2 abgeschlossen, Pilot-Phase-2 läuft
> **Ziel**: 3 Pilot-Kanzleien produktiv + Konzernabschluss-Modul

---

## 1. M3-Sprint-Plan

### M3 Sprint 0 (Woche 28-29): DATEV-Import (Reverse)

**Ziel**: Buchungssätze aus DATEV zurück in unsere DB → Bilanz/GuV wird auto-befüllt

**Output**:
- CSV-Parser für EXTF_Buchungsstapel + EXTF_Sachkonten
- Reverse-Mapping SKR04/SKR03 → HGB-GuV-Positionen
- Bilanz/GuV-Auto-Befüllung aus Saldovortrag
- Frontend: DATEV-Import-UI mit File-Upload + Mapping-Vorschau

### M3 Sprint 1 (Woche 30-31): Konzernabschluss (PublG §11)

**Ziel**: Konzern-Light-Variante — Mutter + 1 Tochter konsolidieren

**Output**:
- Konzernabschluss-Datenmodell (Konsolidierungs-Einheit)
- Konzern-Bilanz + Konzern-GuV mit Konsolidierungs-Buchungen
- Konsolidierungs-Logik (Mutter-Tochter, Upstream-Downstream)
- E-Bilanz-Taxonomie-Erweiterung für Konzern

### M3 Sprint 2 (Woche 32-33): Wirtschaftsprüfer-Modul

**Ziel**: WP-spezifischer Workflow mit Plausibilitätsregeln

**Output**:
- IDW-Plausibilitätsregeln (z.B. Eigenkapitalquote, Liquidität)
- WP-Notizen je Bilanz/GuV-Position
- Bestätigungs-Workflow (Sign vs. Approve)
- WP-Bericht-Generierung

### M3 Sprint 3 (Woche 34-35): Multi-Mandanten-Skalierung

**Ziel**: 15 → 50 Mandanten ohne Performance-Issues

**Output**:
- Pagination auf allen Listen-Endpoints
- Performance-Optimierung (Database-Indices, Prisma-Query-Tuning)
- Load-Tests (3 Kanzleien, 50 Mandanten, 500 Bilanzen)

### M3 Sprint 4 (Woche 36-37): White-Label-Vorbereitung

**Ziel**: M4-Vorbereitung für White-Label + Multi-Tenant

**Output**:
- Kanzlei-Branding (Logo, Farben)
- Multi-Tenant-Architecture-Refactoring
- Mandant-isolierte Cache-Layer

### M3 Sprint 5 (Woche 38-39): Pilot-Phase-2 Abschluss + M3-Handoff

**Ziel**: M3 finalisieren, M4 vorbereiten

**Output**:
- Pilot-Kanzleien-Feedback auswerten
- Konzern-Pilot (1 Mandant mit 2 Gesellschaften)
- M3-Release-Tag `m3-kanzlei-ready`

---

## 2. Sprint 0 Detail: DATEV-Import

### 2.1 Use Case

Kanzlei arbeitet seit Jahren mit DATEV. Bilanz und GuV für einen Mandanten sind dort
bereits vorhanden. Wir bieten die Möglichkeit, **Daten aus DATEV zu importieren** statt
sie manuell zu erfassen.

### 2.2 Datenquellen

| DATEV-Datei | Format | Inhalt |
|---|---|---|
| `EXTF_Buchungsstapel.csv` | CSV (Semikolon, UTF-8) | Einzelbuchungen des Geschäftsjahres |
| `EXTF_Sachkontobeschriftungen.csv` | CSV (Semikolon, UTF-8) | Kontenplan-Beschreibungen |
| `EXTF_DebKred_Stamm.csv` | CSV (Semikolon, UTF-8) | Debitoren/Kreditoren-Stammdaten |

### 2.3 Import-Workflow

```
[Kanzlei lädt CSV hoch]
       ↓
[Wir parsen die CSV]
       ↓
[Wir validieren Format (Header + Buchungs-Zeilen)]
       ↓
[Wir berechnen Salden pro Sachkonto]
       ↓
[Reverse-Mapping SKR04 → HGB-Position]
       ↓
[Wir zeigen Mapping-Vorschau (welches Konto → welche Position)]
       ↓
[Kanzlei bestätigt Mapping]
       ↓
[Wir speichern Buchungen als GuVPositionen]
       ↓
[Audit-Log: IMPORT_DATEV]
```

### 2.4 Reverse-Mapping-Engine

```typescript
// SKR04 → HGB
const skr04ToHgb: Map<string, HgbMapping> = {
  '4400': { hgb: 'Umsatzerloese', typ: 'ERLOES', konto: '8400' },
  '4410': { hgb: 'Umsatzerloese', typ: 'ERLOES', konto: '8400' },
  '4500': { hgb: 'SonstigeErtraege', typ: 'ERLOES', konto: '8410' },
  '4700': { hgb: 'ErtraegeBeteiligungen', typ: 'ERLOES', konto: '8460' },
  '5000': { hgb: 'Materialaufwand', typ: 'AUFWAND', konto: '8500' },
  '6000': { hgb: 'Personalaufwand', typ: 'AUFWAND', konto: '8520' },
  // ... 45+ Mappings
};
```

### 2.5 UI-Plan

| Schritt | UI |
|---|---|
| 1. Datei hochladen | Drag-and-Drop oder File-Picker |
| 2. Parse-Vorschau | Tabelle mit Buchungs-Zeilen (max. 50 angezeigt) |
| 3. Salden-Berechnung | Pro Sachkonto: Summe Soll + Summe Haben = Saldo |
| 4. Mapping-Vorschau | Tabelle: DATEV-Konto → HGB-Position → Betrag |
| 5. Konflikt-Resolver | Unmapped Konten müssen manuell zugeordnet werden |
| 6. Confirm | "Import starten" Button |
| 7. Result | "Import erfolgreich" + Anzahl importierter Buchungen |

---

## 3. Was noch zu klären ist

### 3.1 DATEV-Datei-Verfügbarkeit

- **Wer liefert die CSV?** Kanzlei muss DATEV-Export selbst durchführen.
- **DATEV-API**: Es gibt einen DATEV-Connect-Schnittstelle, aber kostenpflichtig (DATEV-Mitgliedschaft erforderlich)
- **DATEV-Buchungsdatenservice (BDS)**: API-basierter Transfer, ebenfalls DATEV-Mitglied erforderlich

→ Für M3 Pilot: Kanzlei erstellt CSV manuell aus DATEV-Software

### 3.2 Reverse-Mapping-Qualität

- **SKR03 vs SKR04**: zwei verschiedene Kontenrahmen, separate Mappings
- **Custom-Kontenpläne**: Manche Kanzleien nutzen branchenspezifische Kontenrahmen (z.B. KHBV für Krankenhäuser) — M3 Pilot beschränkt sich auf SKR03/SKR04
- **Mapping-Lücken**: Einige DATEV-Konten haben keine HGB-Entsprechung (z.B. 0990 Gewinnvortrag Vorjahr) — manuelle Zuordnung erforderlich

### 3.3 Performance

Bei einer mittelgroßen GmbH mit ~5000 Buchungs-Zeilen pro GJ:
- Parse: ~500ms
- Mapping: ~200ms
- Insert: ~2s (5000 Inserts in einer Transaction)
- Gesamt: ~3s für Import

→ Performance ausreichend für Pilot-Phase-2.

---

## 4. Erfolgs-Kriterien Sprint 0

| Kriterium | Status |
|---|---|
| CSV-Parser liest EXTF_Buchungsstapel v700+ | ☐ |
| Reverse-Mapping SKR04 → HGB (80% Coverage) | ☐ |
| Saldovortrag-Berechnung pro Konto | ☐ |
| UI mit Mapping-Vorschau + Konflikt-Resolver | ☐ |
| Audit-Log: IMPORT_DATEV mit Buchungs-Count | ☐ |
| e2e-Tests: Parsing + Mapping + Insert | ☐ |
| 100% deutsche UI-Texte | ☐ |

---

## 5. Abhängigkeiten zu M1/M2

| Komponente | Wird genutzt für |
|---|---|
| `BilanzRepository` (M1) | Speichern importierter Bilanz-Positionen |
| `GuVRepository` (M1) | Speichern importierter GuV-Positionen |
| `MandantGuard` (M1) | Mandant-Trennung beim Import |
| `AuditService` (M1) | Audit-Log für IMPORT_DATEV |
| `skr04-ertrag.ts` / `skr04-aufwand.ts` (M2) | Reverse-Mapping-Quelle |
| `DatevCsvWriter` (M2) | Reverse-Parser (gleiche CSV-Format-Konventionen) |

---

## 6. Was User (焌SauroJohn) macht

- [ ] Pilot-Kanzleien für DATEV-Import-Roundtrip auswählen (Pilot-Kanzlei 2 + 3)
- [ ] Beispiel-CSV-Dateien aus DATEV-Software exportieren (für Tests)
- [ ] Mapping-Qualität-Feedback nach Pilot (welche Konten sind häufig nicht gemappt?)
- [ ] M3-Sprint-1-Planung (Konzernabschluss — Pilot-Kanzlei 3 hat Konzern-Mandant)

---

**Stand**: 2026-09-24
**Start M3 Sprint 0**: 2026-11-07 (nach Pilot-Phase-2)
**Abschluss M3**: 2027-02-07
**M4-Release**: 2027-05-07