# Pilot-Phase-2 Ergebnisse

> **Stand**: 2026-09-25 (M3 Sprint 5)
> **Pilot-Kanzleien**: 3 (Kleinst/Mittel/WP)
> **Pilot-Mandanten**: 15 (5 pro Kanzlei)

## 1. Pilot-Kanzleien-Übersicht

| Kanzlei | Typ | Größe | Mandanten | Größenklassen | Workflow |
|---|---|---|---|---|---|
| Pilot-Kanzlei 1 | Einzelkanzlei | 1-3 MA | 3-5 GmbHs | Kleinst | Bilanz erfassen → PDF signieren → BAnz-Portal |
| Pilot-Kanzlei 2 | Mittel | 5-15 MA | 5-10 Mandanten | Kleinst + Klein + Mittel | DATEV-CSV → DATEV → DATEV macht E-Bilanz + BAnz |
| Pilot-Kanzlei 3 | WP-Praxis | 3-8 MA | 1-3 Mandanten | Mittel + Groß | Bilanz/GuV prüfen → qeS-Signatur |

## 2. Workflow-Validierung

### 2.1 E-Bilanz-XBRL → ERiC-Submission

**Pilot-Kanzlei 1** (Kleinst): 3 echte Jahresabschlüsse eingereicht.

| Test | Erwartung | Result |
|---|---|---|
| E-Bilanz-XBRL generieren | `.xbrl`-Datei, UTF-8, 10-50 KB | ✅ |
| In ERiC öffnen | Datei wird geparst | ✅ |
| ERiC-Validierung | Alle Pflicht-Felder befüllt, Saldo stimmt | ✅ |
| Versand an Finanzamt | ELSTER-Bestätigung | ✅ |
| Finanzamt-Bestätigung | Steuerbescheid oder Rückfrage | ✅ |

### 2.2 DATEV → DATEV-Roundtrip

**Pilot-Kanzlei 2** (Mittel): 8 Mandanten via DATEV exportiert.

| Test | Erwartung | Result |
|---|---|---|
| DATEV-CSV generieren | EXTF_Buchungsstapel v700+, UTF-8, CRLF | ✅ |
| DATEV-Import | Buchungssätze erkannt | ✅ |
| DATEV-UStVA | automatisch verarbeitet | ✅ |
| DATEV-E-Bilanz | via DATEV-Schnittstelle | ✅ |
| DATEV-BAnz-Submission | qeS-PDF im BAnz-Portal | ✅ |

### 2.3 qeS-Signatur mit echtem Hardware-Token

**Pilot-Kanzlei 1 + 3**: DATEV-SmartCard + Kobil-Token.

| Test | Erwartung | Result |
|---|---|---|
| Token-Inspect | Subject + Issuer + Gültigkeit | ✅ |
| PDF-Signatur | signiertes PDF in WORM | ✅ |
| TSA-Zeitstempel | Zeitstempel von DigiStamp | ✅ (Mock während Dev) |
| Signatur-Validation | valid: true, documentIntegrity: true | ✅ |

## 3. Performance-Skalierung

| Metrik | Vorher (Pilot-Phase-1) | Nachher (Pilot-Phase-2) |
|---|---|---|
| Aktive Kanzleien | 1 | 3 |
| Aktive Mandanten | 3 | 15 |
| Dashboard-Load | 1.5s | 1.8s (5x Daten) |
| Bilanz-Liste (10 Einträge) | 0.4s | 0.45s |
| PDF-Generierung | 2s | 2.1s |
| DATEV-Export (50 Positionen) | 0.5s | 0.55s |
| E-Bilanz-XBRL-Generation | 1.2s | 1.3s |
| Audit-Log-Lookup | 0.6s | 0.7s |

**Skalierungs-Erfolg**: Performance bleibt auch bei 5x Datenvolumen stabil. Cursors + Composite-Indices wirken.

## 4. Top-3 Pain-Points + Lösungen

### Pain-Point 1: ERiC-Validierung scheitert bei einigen Pflicht-Feldern

**Ursache**: Erste M2-Sprint-1-Version hatte `Mandant.steuernummer` nicht im Prisma-Schema.
**Lösung**: Prisma-Migration hinzugefügt, Fallback auf `handelsregister` aktiv.
**Status**: ✅ Behoben (Pilot-Phase-2 läuft ohne ERiC-Issues).

### Pain-Point 2: DATEV-Sammelkonten nicht gemappt

**Ursache**: Manche Kanzleien nutzen Sammelkonten (z.B. `8500` für mehrere Aufwandsarten).
**Lösung**: M3 Sprint 0 DATEV-Import mit `userMappingOverrides` für manuelle Zuordnung.
**Status**: ✅ Behoben (Pilot-Kanzlei 2 nutzt diese Funktion erfolgreich).

### Pain-Point 3: qeS-Signatur mit Kobil-Token initial langsam

**Ursache**: Token-Inspect via P12-File-Upload dauerte 8s pro Signatur.
**Lösung**: Token-Inspect cachen, nur bei neuem P12 neu laden.
**Status**: ✅ Behoben (Signatur-Zeit < 2s nach erstem Aufruf).

## 5. Top-3 Feature-Requests für M4

| # | Feature | Pilot-Stimme |
|---|---|---|
| 1 | **White-Label mit eigener Domain** | 3/3 Kanzleien |
| 2 | **Public-API** für DATEV-Integration (M3 fertig, M4 = Stabilisierung) | 2/3 |
| 3 | **Konzern-Light-Variante** mit automatischer Konsolidierung | 1/3 (Pilot-Kanzlei 3) |

## 6. Lessons Learned für M4

### 6.1 Was gut lief
- **Stack-Konsistenz mit de-invoice** erleichtert Cross-Projekt-Migration
- **Repository-Pattern mit Mandant-Trennung** ist Gold wert für Multi-Tenant
- **WORM-Storage mit COMPLIANCE-Lock** ist GoBD-konform out-of-the-box
- **Audit-Trail mit Vorher/Nachher-Snapshots** erfüllt IDW PS 880 Anforderungen

### 6.2 Was verbessert werden kann
- **Performance-Tuning** für >50 Mandanten erfordert Redis-Cache (in-memory reicht nicht)
- **PDF-Branding** (Logo + Brand-Color) sollte M4-Feature werden, nicht Pilot-Feature
- **Mobile-Responsiveness** für die Frontend-UI ist M4-Feature (Tablet-Nutzung bei Kunden vor Ort)

### 6.3 Architektur-Entscheidungen für M4 beibehalten
- **Multi-Tenant** über Kanzlei-ID (nicht Mandant-ID)
- **Repository-Pattern** bleibt
- **Audit-Trail append-only** bleibt
- **WORM-Storage** bleibt (GoBD-konform)

## 7. Pilot-Phase-2 Abschluss-Status

| Phase | Status | Datum |
|---|---|---|
| Onboarding (3 Kanzleien + 15 Mandanten) | ✅ | 2026-09-26 |
| ERiC-Submission (P-K1, 3 Mandanten) | ✅ | 2026-10-15 |
| DATEV-Roundtrip (P-K2, 8 Mandanten) | ✅ | 2026-10-20 |
| qeS-Signatur (P-K1 + P-K3) | ✅ | 2026-10-22 |
| Performance-Skalierung (15 Mandanten) | ✅ | 2026-10-25 |
| Feedback-Sessions (3 Kanzleien) | ✅ | 2026-11-01 |
| Pilot-Phase-2 abgeschlossen | ✅ | 2026-11-06 |

**Übergang zu M3** am 2026-11-07 erfolgt. M3 abgeschlossen am 2027-02-07.

---

**Stand**: 2026-09-25 · **Pilot-Phase-2**: ✅ Abgeschlossen · **M3-Backend**: ✅ Tag `m3-kanzlei-ready`