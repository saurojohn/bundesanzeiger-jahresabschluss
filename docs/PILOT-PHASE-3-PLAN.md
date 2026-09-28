# Pilot-Phase-3 Plan — Skalierung auf 5–8 Kanzleien

> **Zweck**: Skalierung über die ursprünglichen 3 Pilot-Kanzleien (Phase 2)
> hinaus auf 5–8 Kanzleien + 30–50 Mandanten, vor dem Stripe-Go-Live
> und dem breiten Marktstart.
>
> **Status**: Bereit zur Umsetzung (Code ist live, Schema ist migriert)
> **Ziel**: Bis Q1/2027 abgeschlossen
> **Voraussetzung**: Hetzner-VM-Deployment (Phase 1) + Schema-Migration

---

## 1. Ziele

| Ziel | KPI | Aktuell (Phase 2) | Ziel (Phase 3) |
|---|---|---|---|
| Pilot-Kanzleien | Anzahl | 3 | 5–8 |
| Mandanten insgesamt | Anzahl | 15 | 30–50 |
| Echte BAnz-Submissions pro GJ | Anzahl | 11 | 25+ |
| Pilot-Kanzleien mit DATEV-Workflow | Anzahl | 1 | 3+ |
| Pilot-Kanzleien mit qeS-Signatur | Anzahl | 1 | 3+ |
| Pilot-Kanzleien mit White-Label-Branding | Anzahl | 0 | 2+ |

**Begründung für diese Größenordnung**:
- Mindestens 5 Kanzleien liefern statistisch relevante Feedback-Daten
- DATEV-Workflow bei 3 Kanzleien testet die Auto-Round-Trip-Stabilität
- 2 White-Label-Kanzleien liefern Custom-Domain-Bugs vor Stripe-Launch
- 25 echte BAnz-Submissions decken die meisten GoBD-Edge-Cases ab

---

## 2. Zielgruppen-Definition

### 2.2 Erst-Rekrutierung (Q4/2026): 3 zusätzliche Kanzleien

**Typ A: DATEV-Schwerpunkt** (Steuerberater mit eigener DATEV-Lizenz)

- **Wer**: 2–5-MA-Kanzleien, die ihre Mandanten über DATEV-Buchhaltung führen
- **Warum**: Validiert den DATEV-Import-Pfad mit echten Mappings; deckt typische
  Mittelständler-Buchhaltung ab
- **Akquise-Kanäle**:
  - DATEV-Partnerverzeichnis (öffentlich)
  - Steuerberater-Verbände (DStV, Lohnsteuerhilfe-Vereine)
  - LinkedIn-Suche: "DATEV-Kanzlei Inhaber Hessen/Bayern/NRW"
- **Onboarding**: 2 Wochen (DATEV-Workflow-Schulung)

**Typ B: WP-Praxis mit Konzern-Mandanten** (Wirtschaftsprüfer)

- **Wer**: 3–10-MA-WP-Praxen, die Konzernabschlüsse nach PublG §11 prüfen
- **Warum**: PublG-Konsolidierung + WP-Plausi ist M3-Feature — bisher nur
  1 WP-Pilot. Brauchen zweite Stimme für Plausi-Regeln.
- **Akquise-Kanäle**:
  - IDW-Mitgliederverzeichnis
  - WPK-Suche (Wirtschaftsprüferkammer)
  - Branchenveranstaltungen (DATEV-Spin-off-Kongresse)
- **Onboarding**: 4 Wochen (Konzernabschluss-Schulung + IDW PS 880)

**Typ C: White-Label-Früh-Adopter** (Kanzlei mit eigenem Branding-Wunsch)

- **Wer**: 5+ MA mit eigener IT-Abteilung, die Mandanten eine "ihre"-Domain geben wollen
- **Warum**: Validiert Custom-Domain + Cert-Renewal-End-to-End vor Stripe-Kunden
- **Akquise-Kanäle**:
  - LinkedIn: "Steuerberatung 4.0" / "digitale Kanzlei"
  - XING-Gruppe "Digitale Steuerberatung"
  - BStBK-Newsletter-Aufnahme (Pilot-Kunden-Empfehlung)
- **Onboarding**: 3 Wochen (DNS-Setup + Cert-Verifikation)

### 2.3 Zweite Welle (Q1/2027): 2–5 weitere Kanzleien

Diese Welle fokussiert auf:
- **DATEV-Konzerne** mit hohem Mandanten-Volumen (>50 Mandanten, Premium-Tier-Kandidaten)
- **Hybrid-Kanzleien** (DATEV + Eigen-Workflow)
- **Kanzleien mit explizitem Stripe-Bedarf** (Test-Piloten für Bezahlmodell)

---

## 3. Akquise-Strategie

### 3.1 Direkt-Akquise

```
Persönliches Anschreiben (vom Geschäftsführer, NICHT vom Bot):

"Sehr geehrte/r [Name],

wir haben Ihre Kanzlei im [Verzeichnis] gesehen und sind auf der Suche
nach 3 Pilot-Kanzleien für unsere Bundesanzeiger-Jahresabschluss-Plattform.
Wir haben bereits [Phase-2-Resultate] und suchen Partner, die mit uns
gemeinsam den nächsten Schritt gehen.

Im Pilot-Programm:
  - 12 Monate kostenfrei (PILOT-Tier)
  - Persönlicher Onboarding-Support
  - Direkter Draht zum Engineering-Team
  - Mitgestaltung der Roadmap

Können wir nächste Woche 30 Minuten telefonieren?

[Vorname Nachname, Geschäftsführer]
[Telefon, Email]"
```

### 3.2 Vermittler-Pilot

**Steuerberater-Verbände** (DStV, Lohnsteuerhilfe Bayern/NRW/Sachsen):
- Pilot-Vorstellung auf Verbandstagungen (Q1/2027)
- 30-Min-Demo + Live-E-Bilanz-Generierung
- Follow-up-Email mit Trial-Account

**DATEV-Partner-Programm**:
- DATEV hat ein "Solution-Partner"-Programm für externe Tools
- Pilot-Kanzleien könnten unsere Plattform über DATEV-Empfehlung bekommen
- Mittelfristig: Aufnahme in DATEV-Marktplatz (Phase 4+)

### 3.3 Inbound-Marketing

- **Website**: Landing-Page mit Live-Demo + "Pilot-Partner werden" CTA
- **SEO-Content**: "Bundesanzeiger-Pflicht 2026: Was Steuerberater wissen müssen"
- **LinkedIn**: Quartalsweise Posts über Pilot-Fortschritt
- **Newsletter**: Anmeldung für "GoBD-Updates" → automatisch Pilot-Einladung

---

## 4. Onboarding-Checkliste

Pro Pilot-Kanzlei (alle Typen):

```
Phase 1: Vertragsabschluss (Woche 0)
  [ ] DSGVO-Auftragsverarbeitungsvertrag (AVV) unterschrieben
  [ ] GoBD-konforme Datenverarbeitung bestätigt
  [ ] Mandant-Trennung + Audit-Trail erklärt
  [ ] Support-Kanäle vereinbart (Email + wöchentlicher Call)

Phase 2: Account-Setup (Woche 1)
  [ ] Kanzlei-Admin-User angelegt (TOTP aktiviert)
  [ ] Mandanten importiert (oder manuell angelegt)
  [ ] Custom-Branding konfiguriert (Logo + Farben)
  [ ] Optional: Custom-Domain eingerichtet (Typ C)

Phase 3: Workflow-Schulung (Woche 2)
  [ ] Bilanz + GuV erfassen (Hands-on mit Beispieldaten)
  [ ] qeS-Signatur + WORM-Archivierung (Typ A + C)
  [ ] DATEV-Import (nur Typ A + B)
  [ ] WP-Plausi-Check (nur Typ B)

Phase 4: Pilot-Betrieb (Woche 3-12)
  [ ] Echte Mandanten eingeben
  [ ] Echte BAnz-Submission durchführen
  [ ] Feedback sammeln (wöchentlich)
  [ ] Bugs in Issue-Tracker dokumentieren

Phase 5: Erfolgsmessung (Woche 12)
  [ ] Anzahl echte BAnz-Submissions pro GJ
  [ ] Zeitersparnis-Schätzung vs. Excel-Vorlage
  [ ] Zufriedenheits-Score (1-10)
  [ ] Conversion-Wahrscheinlichkeit Premium-Tier
```

---

## 5. Erfolgs-Metriken

| Metrik | Zielwert | Mess-Methode |
|---|---|---|
| Pilot-Kanzlei-Zufriedenheit | ≥8/10 | Monatliche Umfrage (Email) |
| Echte BAnz-Submissions pro Pilot-Kanzlei | ≥3 pro GJ | Backend-Telemetrie (`/api/audit`) |
| Bug-Schadensrate | <2 Blocker pro Monat | GitHub-Issues-Tag `pilot` |
| Time-to-First-Submission | <2 Wochen ab Onboarding | Onboarding-Tracking |
| Conversion-Rate (PILOT→PAID) | ≥60% bei Phase-3-Abschluss | Stripe-Dashboard (nach Go-Live) |

---

## 6. Risiken + Mitigation

| Risiko | Wahrscheinlichkeit | Mitigation |
|---|---|---|
| Pilot-Kanzlei steigt vorzeitig aus | Mittel | Quartalsweise Check-ins, schneller Bug-Fix-Turnaround |
| DATEV-Import scheitert bei echten Daten | Hoch (Pilot 2 = ein Bestätigungsfall) | Vorab-Test mit anonymisierten Buchungsdaten |
| qeS-Signatur scheitert bei Mandant 1 | Mittel | Backup: Manuelle Signatur + nachträglicher Upload |
| Custom-Domain-Bug | Niedrig | Internes Pre-Pilot mit eigenem Team-Subdomain |
| Datenschutz-Bedenken der Pilot-Kanzlei | Niedrig | DSGVO-AVV + ISO-27001-Nachweis (Phase 4+) |

---

## 7. Budget

| Posten | Kosten | Frequenz |
|---|---|---|
| Hetzner-VM-Miete (Cloud-Deployment) | ~€36/Monat | Laufend |
| Demo-Server (zusätzlich) | ~€10/Monat | 12 Monate |
| Domain + DNS (für Custom-Domains) | ~€15/Jahr | Pro Pilot |
| Wildcard-Cert (Let's Encrypt) | 0€ | Laufend |
| Marketing-Budget (LinkedIn, Verbandstagung) | ~€500/Monat | 6 Monate |
| Personal (1× DevOps @20%, 1× Support @10%) | ~€3.000/Monat | 6 Monate |
| **Gesamt Phase-3 (12 Monate)** | **~€23.000** | |

---

## 8. Timeline

```
2026-Q4 (Okt-Dez):
  - Phase 1 abgeschlossen (3 Pilot-Kanzleien, 15 Mandanten)
  - Hetzner-VMs provisioniert
  - Schema-Migration live
  - Akquise-Welle 1 startet (3 neue Pilot-Kanzleien)

2027-Q1 (Jan-Mär):
  - Onboarding 3 neue Pilot-Kanzleien
  - Erste echte BAnz-Submissions der neuen Kanzleien
  - Akquise-Welle 2 startet (2-5 weitere)
  - Stripe-Go-Live parallel (Phase 3 der technischen Roadmap)

2027-Q2 (Apr-Jun):
  - Phase 3 abgeschlossen (5-8 Kanzleien, 30-50 Mandanten)
  - Stripe-Conversion-Wahrscheinlichkeit messbar
  - Entscheidung: Marktstart vs. weitere Pilot-Iteration
```

---

## 9. Erfolgskriterien für Phase-3-Abschluss

- ✅ Mindestens 5 Pilot-Kanzleien produktiv
- ✅ Mindestens 25 echte BAnz-Submissions insgesamt
- ✅ ≥60% Conversion-Wahrscheinlichkeit PILOT→PAID (geschätzt aus Phase-2-Feedback)
- ✅ Alle Pilot-Kanzleien würden das System weiterempfehlen (NPS ≥40)
- ✅ Keine ungelösten Blocker-Bugs aus Pilot-Phase

**Bei Erfolg**: Marktstart mit Stripe-Live, Scale-Plan Q3/2027.
**Bei Misserfolg**: Erneute Pilot-Iteration, ggf. Feature-Adjustments.

---

## 10. Referenzen

- `docs/PILOT-PHASE-2-RESULTS.md` — Ergebnisse der ersten Welle
- `docs/M3-HANDOFF.md` — Was Pilot-Kanzleien aus M3 mitnehmen
- `docs/MILESTONE-4.md` — Aktueller Production-Tier-Status
- `RUNBOOK.md` § 4 — Pilot-Kanzlei-Onboarding (Single-Kanzlei-Anleitung)
- `USER-GUIDE.md` — End-User-Dokumentation
- `GOBD-AUDIT-REPORT.md` § 9 — Vorbereitung externer Audit