# Pilot-Phase-2 — Skalierung auf 3 Kanzleien + 15 Mandanten

> **Stand**: 2026-09-24 (M2 abgeschlossen)
> **Ziel**: Pilot-Phase-2 validieren das M2-Backend in der Praxis (ERiC, DATEV, BAnz-Portal)

## 1. Ziele

| Ziel | Erfolgs-Kriterium |
|---|---|
| **Validierung der M2-Workflows in der Praxis** | Mind. 1 echter Jahresabschluss pro Pilot-Kanzlei erfolgreich ans Finanzamt übermittelt |
| **Skalierung Mandant-Verwaltung** | 1 → 15 Mandanten ohne Performance-Probleme |
| **DATEV-Roundtrip** | DATEV-Export → DATEV-Import funktioniert ohne Datenverlust |
| **ERiC-Submission** | E-Bilanz-XBRL wird von ERiC akzeptiert |
| **qeS-Signatur in Produktion** | Realer DATEV-Sign-Card / Kobil-Token funktioniert |

## 2. Pilot-Kanzleien-Profil

### Pilot-Kanzlei 1: Kleinst/Mittel Steuerberatung

| Attribut | Wert |
|---|---|
| **Typ** | Einzelkanzlei / kleine GbR |
| **Größe** | 1-3 Mitarbeiter |
| **Mandanten** | 3-5 GmbHs (Pilot-Daten aus M1) |
| **Größenklassen** | Kleinst + Klein |
| **Veröffentlichungs-Kanäle** | PDF_DIRECT + XML_XBRL |
| **Signatur-Setup** | DATEV-SmartCard |
| **Workflow** | Bilanz erfassen → PDF signieren → BAnz-Portal |

### Pilot-Kanzlei 2: Mittel Steuerberatung

| Attribut | Wert |
|---|---|
| **Typ** | Mittelständische Kanzlei mit DATEV-Mitgliedschaft |
| **Größe** | 5-15 Mitarbeiter |
| **Mandanten** | 5-10 Mandanten (Mix Kleinst/Klein/Mittel) |
| **Größenklassen** | Kleinst + Klein + Mittel |
| **Workflow** | DATEV-CSV-Export → DATEV-Import → DATEV macht E-Bilanz + BAnz |

### Pilot-Kanzlei 3: Wirtschaftsprüfungs-Kanzlei

| Attribut | Wert |
|---|---|
| **Typ** | WP-Praxis mit Prüfungsauftrag |
| **Größe** | 3-8 Mitarbeiter |
| **Mandanten** | 1-3 Mandanten (Mittel + Groß) |
| **Workflow** | Bilanz/GuV prüfen → qeS-Signatur → Konzern-Light-Variante (M3) |

## 3. Onboarding-Pipeline

### 3.1 Schritt 1: Kanzlei-Auswahl

| Rolle | Verantwortlich | Aktion |
|---|---|---|
| **Kanzlei-Lead** | User (焌SauroJohn) | Identifiziert Pilot-Kanzlei via bestehendes Netzwerk |
| **Kanzlei-Demo** | Mavis | Bereitet Demo-Mandanten vor (3-5 fiktive GmbHs) |
| **Termin** | Kanzlei-Lead | 1h Online-Demo + 1h Onboarding |

### 3.2 Schritt 2: Vertragliche Grundlagen

- **Auftragsverarbeitungsvertrag (AVV)** gemäß DSGVO Art. 28
- **NDA** zwischen User und Pilot-Kanzlei
- **Test-Mandanten-Vereinbarung**: Kanzlei darf 3 fiktive GmbHs nutzen
- **Hardware-Token**: Kanzlei besorgt DATEV-SmartCard / Kobil-Token selbst

### 3.3 Schritt 3: Account-Erstellung

```bash
# 1. Kanzlei-Admin anlegen
POST /api/mandant (KANZLEI_ADMIN-Rolle)
{
  "firmenname": "Pilot-Kanzlei 1",
  "rechtsform": "Einzelkanzlei",
  ...
}

# 2. Kanzlei-Admin-User einladen
POST /api/users (mit E-Mail-Invite)
{
  "email": "admin@pilot-kanzlei-1.de",
  "vorname": "Max",
  "nachname": "Mustermann",
  "rolle": "KANZLEI_ADMIN"
}
# → E-Mail mit Invite-Link wird versendet

# 3. Pilot-Mandanten anlegen
POST /api/mandant (für jeden Pilot-Mandanten)
{
  "firmenname": "Demo GmbH",
  "rechtsform": "GmbH",
  "groessenklasse": "KLEINST",
  "publishChannel": "PDF_DIRECT",
  ...
}
```

### 3.4 Schritt 4: Onboarding-Workshop (1-2 Stunden)

| Block | Dauer | Inhalt |
|---|---|---|
| Willkommen + Tour | 15 min | Login, Mandant-Switcher, Navigation |
| Bilanz-Erfassung | 30 min | Live-Demo: erste echte Bilanz erfassen |
| Export-Workflow | 30 min | E-Bilanz-XBRL → DATEV-CSV → qeS-PDF |
| Audit-Trail | 10 min | Vollständigkeit + Nachvollziehbarkeit |
| Q&A | 15 min | Häufige Fragen |

### 3.5 Schritt 5: Erste echte Einreichung

Kanzlei reicht **eine echte Bilanz/GuV/Anhang** ein:
1. Bilanz erfassen (in unserem Tool)
2. E-Bilanz-XBRL generieren
3. In ERiC importieren
4. An Finanzamt senden
5. Bestätigung des Finanzamts abwarten

Erfolgs-Kriterium: ERiC akzeptiert die XBRL-Datei ohne Validation-Errors.

## 4. Workflow-Validierung

### 4.1 ERiC-Submission

| Schritt | Tool | Erwartung |
|---|---|---|
| E-Bilanz-XBRL generieren | Unser Tool | `.xbrl`-Datei, ~10-50 KB |
| In ERiC öffnen | ERiC (extern) | Datei wird geparst |
| Validierung | ERiC | Alle Pflicht-Felder befüllt, Saldo stimmt |
| Versand ans Finanzamt | ERiC | ELSTER-Bestätigung |
| Rückmeldung Finanzamt | Finanzamt | Steuerbescheid oder Rückfrage |

**Bei Validation-Fehlern**: Mapping-Engine anpassen, neue e2e-Tests, Re-Validierung.

### 4.2 DATEV-Roundtrip

| Schritt | Tool | Erwartung |
|---|---|---|
| DATEV-CSV exportieren | Unser Tool | `.csv`, ~5-30 KB |
| In DATEV importieren | DATEV (extern) | Buchungssätze werden erkannt |
| DATEV verarbeitet | DATEV | UStVA, E-Bilanz, BAnz automatisch |
| BAnz-Submission | DATEV | qeS-signiertes PDF wird eingereicht |
| BAnz-Bestätigung | BAnz-Portal | Vorgaangsnummer per E-Mail |

**Erfolgs-Kriterium**: DATEV akzeptiert alle Buchungszeilen ohne Reject.

### 4.3 qeS-Signatur in Produktion

**Pilot-Kanzlei 1** nutzt DATEV-SmartCard, **Pilot-Kanzlei 3** nutzt Kobil-Token.

| Test | Erwartung |
|---|---|
| Token-Inspect | Subject = "DATEV Trust..." oder "Kobil..." |
| Token-Gültigkeit | validTo > heute + 30 Tage |
| Signatur erfolgreich | signiertes PDF in WORM-Storage |
| Signatur-Validation | valid: true, documentIntegrity: true |

**Bei Fehlern**: TSA-Endpoint konfigurieren, Zertifikats-Trust-Liste erweitern.

## 5. Performance-Tests

### 5.1 Mandanten-Skalierung

| Test | Metrik | Erwartung |
|---|---|---|
| 1 Mandant | Bilanz-Erfassung < 5s | ✅ |
| 15 Mandanten | Dashboard-Load < 2s | ✅ |
| 15 Mandanten | PDF-Generation < 10s pro Mandant | ✅ |
| 15 Mandanten | DATEV-Export < 5s pro Mandant | ✅ |
| 15 Mandanten | Bilanz-Liste < 1s | ✅ |

### 5.2 Concurrency

| Test | Erwartung |
|---|---|
| 3 Kanzleien gleichzeitig online | Keine 503/429 |
| 5 Bilanz-Saves parallel | Alle erfolgreich, kein Datenverlust |
| 10 PDF-Downloads parallel | Alle erfolgreich |

## 6. Support-Modell

### 6.1 Pilot-Phase-Support (2 Wochen)

- **Sofort-Reaktion**: < 4 Stunden (Werktags)
- **E-Mail-Support**: support@banz-jahresabschluss.example
- **Video-Call** bei kritischen Issues

### 6.2 Eskalation

1. Pilot-Kanzlei meldet Issue
2. Mavis-Ticketsystem erfasst
3. User (焌SauroJohn) entscheidet über Priorität
4. Mavis behebt (Backend, Frontend, oder Doku)

### 6.3 Datenschutz-Vorfälle

Bei Datenschutz-Vorfall: SOFORT an security@banz-jahresabschluss.example.

## 7. Rollout-Plan

| Datum | Phase | Kanzlei-Anzahl | Mandanten-Anzahl |
|---|---|---|---|
| 2026-09-25 | M2-Release-Tag | 0 | 3 (Demo) |
| 2026-09-26 bis 2026-10-09 | Pilot-Phase-2 | 1 (Pilot-Kanzlei 1) | 5 |
| 2026-10-10 bis 2026-10-23 | Pilot-Phase-2 erweitert | 2 (+ Pilot-Kanzlei 2) | 10 |
| 2026-10-24 bis 2026-11-06 | Pilot-Phase-2 final | 3 (+ Pilot-Kanzlei 3) | 15 |
| 2026-11-07 | Pilot-Phase-2 Abschluss | 3 | 15 |

## 8. Erfolgs-Kriterien für M3-Übergang

| Kriterium | Owner |
|---|---|
| Alle 3 Pilot-Kanzleien haben ≥ 1 echten Jahresabschluss eingereicht | Pilot-Kanzlei |
| ERiC akzeptiert E-Bilanz-XBRL ohne Validation-Fehler | Mavis + Pilot |
| DATEV-Roundtrip funktioniert (Export → DATEV → BAnz) | Pilot-Kanzlei |
| qeS-Signatur mit echtem Hardware-Token funktioniert | Pilot-Kanzlei |
| Audit-Trail ist vollständig und revisionssicher | Mavis |
| WORM-Storage hält 10-Jahres-Retention | Mavis |
| Performance: 15 Mandanten ohne Issues | Mavis |
| Pilot-Feedback-Session durchgeführt | User |

**Wenn alle Kriterien erfüllt**: Übergang zu M3 (DATEV-Import, Konzern, WP-Modul).

## 9. Was Mavis in Sprint 5 noch baut

- [ ] `Mandant.steuernummer` Prisma-Migration
- [ ] Onboarding-Doku für Pilot-Kanzlei-Lead
- [ ] Performance-Tests gegen 15-Mandanten-Skalierung
- [ ] Support-Ticketsystem (einfache Variante)
- [ ] Backup-Strategie für Pilot-Phase (siehe DEPLOY-PILOT.md)

## 10. Was User (焌SauroJohn) macht

- [ ] Pilot-Kanzlei 1 identifizieren (1. Oktober-Woche)
- [ ] AVV/NDA-Vorlagen vorbereiten
- [ ] Hardware-Token-Bestellung für Pilot-Kanzlei 1 + 3
- [ ] Feedback-Session-Plan mit Kanzlei 1 (Mitte Oktober)
- [ ] M3-Sprint-Planung mit Prioritäten

---

**Stand**: 2026-09-24
**Start Pilot-Phase-2**: 2026-09-26
**Abschluss Pilot-Phase-2**: 2026-11-06
**Übergang M3**: 2026-11-07