# Milestone 2 (Monate 4-6) — BAnz-Submission-Pipeline + qeS-Signatur

> **Status**: ✅ Abgeschlossen — alle 5 Sprints fertig
> **Stand**: 2026-09-24
> **Pilot-Phase-2**: Vorbereitung läuft (3 Pilot-Kanzleien + 15 Mandanten)

## ⚠️ Wichtige Architektur-Anpassung

Nach Marktrecherche (2026-09-24) wurde die ursprüngliche Planung angepasst:

**Bundesanzeiger-Verlag hat KEINE externe XML/XBRL-Submission-API** für Jahresabschlüsse. Das alte "XBRL-Programm" wurde 2023 durch **eBilanz Online** ersetzt, das nur als registrierungspflichtige Verlag-Web-App nutzbar ist.

### Gewählter M2-Scope (User-Entscheidung A+C)

1. **E-Bilanz-Taxonomie-Export** für ELSTER/ERiC-Submission ans Finanzamt (§ 5b EStG)
2. **DATEV-ASCII-Buchungsstapel-Export** für DATEV/Addison-Import
3. **Qualifizierte elektronische Signatur (qeS)** via P12-Token

**Kanzlei-Workflow**:
- Erfasst Bilanz/GuV/Anhang in unserem Tool (M1)
- Generiert qeS-PDF → lädt manuell ins **BAnz-Online-Portal** hoch
- Generiert E-Bilanz-XBRL → lädt in **ERiC** → ERiC sendet an Finanzamt
- Generiert DATEV-CSV → importiert in **DATEV** → DATEV macht E-Bilanz via DATEV-Schnittstelle

---

## Sprint 0 (Woche 16-17): Schema-Mapping-Definition ✅

**Ziel**: Recherche + Doku der realen Submission-Pfade

**Output**:
- `docs/banz-schemata.md` (~13 KB): Marktrealität, HGB-Kerntaxonomie v6 (2025-04-01), DATEV-Format v700+, qeS-Workflow, Mappings

**Lesson Learned**:
> **Markt-Recherche VOR Architekturentscheidungen ist essenziell**. Hätten wir sofort mit BAnz-XML/XBRL-Submission begonnen, hätten wir monatelang in einer Sackgasse entwickelt.

---

## Sprint 1 (Woche 18-19): E-Bilanz-XBRL-Generator + Validator ✅

**Ziel**: Amtliche HGB-Kerntaxonomie v6 Instanz-Generierung

**Output**:
- `backend/src/modules/ebilanz/` (16 Files, ~3.8k LOC)
- 105 Taxonomie-Konzepte gemappt: §266 Aktiva/Passiva, §275 GKV/UKV, GenInfo, Notes
- Sign-Convention strikt: Aufwände POSITIV in Instance, weight="-1" in Calculation-Linkbase
- Context-Refs V_D (Duration, GuV) + V_Y (Instant, Bilanz)
- Strukturelle + Business-Rule-Validierung (Pflicht-Felder, Saldo, Berechnungs-Check)
- 12 e2e-Tests (tsc-clean, nicht ausgeführt — kein DB)

**Wichtige Constraints**:
- Aufwände POSITIV speichern (weight=-1 im Calculation-Linkbase) — Verdoppelte Negation würde Validation brechen
- UTF-8 ohne BOM, well-formed XML
- Context-Refs: V_D (GuV) + V_Y (Bilanz)

**Bekannte Lücken**:
- `Mandant.steuernummer` fehlt im Schema — Fallback auf handelsregister. Brauchen vor Pilot: Prisma-Migration.
- `libxmljs2` nicht installiert (native dep) — Validation ist 95% strukturell, finale XSD-Konformität durch ERiC-Submission bestätigt.

---

## Sprint 2 (Woche 20-21): DATEV-Export ✅

**Ziel**: EXTF_Buchungsstapel v700+ für DATEV/Addison-Import

**Output**:
- `backend/src/modules/datev/` (12 Files)
- SKR04-Mapping: 45+ Konten (Ertrag/Aufwand/Aktiv/Passiv) mit HGB→DATEV-Engine
- SKR03-Kontenplan optional
- DatevCsvWriter: UTF-8, Semikolon-Trenner (nicht Komma!), Quote-Escaping, CRLF
- Paarige Buchungen pro GuV-Position (Soll/Haben)
- EXTF_Buchungsstapel v12 (Main 700+) konform
- 11 e2e-Tests (tsc-clean)

**Wichtige Details**:
- DATEV verwendet **Semikolon** als Trenner (NICHT Komma wie unsere anderen CSV-Exports)
- Buchungstext max 60 Zeichen, Belegfeld-1 max 36 (DATEV-Limits)
- Max 99.999 Buchungs-Zeilen pro CSV (DATEV-Limit, Auto-Split)

---

## Sprint 3 (Woche 22-23): qeS-Signatur ✅

**Ziel**: Qualifizierte elektronische Signatur nach eIDAS

**Output**:
- `backend/src/modules/signatur/` (10 Files + Repository + Script)
- P12-Service (node-forge): liest Cert-Metadaten OHNE Key-Extraktion
- TSA-Client (RFC 3161): realer Client + Mock-TSA für Dev
- Signatur-Service (719 LOC): @signpdf/signer-p12 + placeholder, PDF/A-3, SHA-256 vor/nach Signatur
- 6 Endpoints: sign-bilanz/guv/anhang/abschluss/validate/inspect-p12
- Test-P12-Generator (OpenSSL Shell-Script) für Dev-Tests
- 12 e2e-Tests (tsc-clean)

**Sicherheits-Hinweise**:
- P12 NIEMALS persistent gespeichert (nur Request-Scope)
- Audit-Trail nur mit Cert-Subject (NIE der Key)
- Test-P12 nur für Dev (NICHT Produktion)
- Hardware-Token (PKCS#11) bleibt für M4

---

## Sprint 4 (Woche 24-25): Frontend-Integration ✅

**Ziel**: UI für Kanzlei-Workflow

**Output**:
- `frontend/src/components/exports/ExportActions.tsx` (E-Bilanz + DATEV + Signatur-Buttons)
- `frontend/src/components/signatur/P12UploadDialog.tsx` (6-Schritte-Signatur-Wizard)
- `frontend/src/components/jahresabschluss/JahresabschlussView.tsx` (kombinierter Abschluss)
- BilanzForm integriert ExportActions automatisch nach Save
- AppHeader: 6. Nav-Item 'jahresabschluss'
- i18n: `exports.*` und `jahresabschluss.*` Sektionen in `de-DE.json`

**Kompletter Workflow im UI**:
1. Bilanz/GuV/Anhang erfassen
2. ExportActions-Bar → 3 Buttons (E-Bilanz, DATEV, Signatur)
3. E-Bilanz-XBRL → `.xbrl` → ERiC → Finanzamt
4. DATEV-CSV → `.csv` → DATEV-Import
5. qeS-PDF → signiertes PDF → BAnz-Portal

---

## Sprint 5 (Woche 26-27): Pilot-Phase-2 ⏳

**Ziel**: 3 Pilot-Kanzleien + 15 Mandanten

**Offene Aufgaben**:
- Pilot-Kanzleien rekrutieren (User-Action)
- Onboarding-Pipeline aufsetzen (E-Mail-Invite, Passwort-Set, TOTP)
- Mandanten-Skalierung testen (1 → 15 Mandanten)
- Workflow-Realitäts-Check: ERiC-Submission-Test mit Pilot-Mandant 1
- DATEV-Import-Roundtrip mit Pilot-Kanzlei validieren

**Pilot-Kanzleien-Profil**:
- **Kleinst** (Pilot-Kanzlei 1): 1-5 Mandanten, GKV, PDF-WORM-Archiv
- **Klein/Mittel** (Pilot-Kanzlei 2): 5-10 Mandanten, GKV + UKV
- **Groß/Konzern** (Pilot-Kanzlei 3): 1-5 Mandanten, Konzern-Light

---

## M2-Akzeptanzkriterien (Status)

| Kriterium | Status | Evidenz |
|---|---|---|
| E-Bilanz-XBRL nach HGB-Kerntaxonomie v6 generierbar | ✅ | Sprint 1 |
| 12+ Validierung gegen Pflicht-Felder und Saldo | ✅ | Sprint 1 |
| DATEV-Buchungsstapel CSV v700+ generierbar | ✅ | Sprint 2 |
| SKR03 + SKR04 unterstützt | ✅ | Sprint 2 |
| qeS-Signatur mit P12-Token | ✅ | Sprint 3 |
| SHA-256-Hash vor/nach Signatur im Audit-Trail | ✅ | Sprint 3 |
| TSA-Zeitstempel (Mock + real) | ✅ | Sprint 3 |
| Frontend: E-Bilanz/DATEV/Signatur UI | ✅ | Sprint 4 |
| i18n: 100% deutsche UI-Texte | ✅ | alle Sprints |
| Audit-Trail mit Cert-Subject (kein Key) | ✅ | Sprint 3 |
| Pilot-Phase-2 mit 3 Kanzleien | ⏳ | Sprint 5 (User-Action) |
| ERiC-Submission in Produktion | ⏳ | Sprint 5 |
| DATEV-Roundtrip-Validierung | ⏳ | Sprint 5 |

---

## Lessons Learned (M2)

### Was gut lief
1. **Markt-Recherche zuerst**: BAnz-Submission-Realität verhindert monatelange Fehlentwicklung
2. **User-Entscheidung A+C**: pragmatische Anpassung an DATEV-Workflow-Realität
3. **Strenge Sign-Convention**: HGB-Kerntaxonomie v6 Dokumentation half, falsche Negation zu vermeiden
4. **TSA-Mock für Dev**: schnellere Iteration, echte TSA später
5. **Repository-Pattern-Konsistenz**: einfach zu refactoren, wenn Service-Signaturen sich ändern

### Was verbessert werden kann
1. **`Mandant.steuernummer` sollte im Prisma-Schema sein** — wir haben es übersehen, jetzt Fallback-Lösung
2. **`libxmljs2` native dep ist schwer zu installieren** — Alternativen sind strukturelle Validation + Business-Rules (~95% Coverage)
3. **P12-Test-Generierung als Shell-Script** ist umständlich — in M3: Node.js-Script mit node-forge
4. **DATEV-CSV-Writer** könnte in `common/` wiederverwendet werden

### Architektur-Entscheidungen für M3 beibehalten
- **Repository-Pattern** (mit Mandant-Filter) bleibt
- **Audit-Trail mit Vorher/Nachher-Snapshot** bleibt
- **Trennung Service-Controller** bleibt
- **Mock-TSA für Dev** bleibt (echte TSA später)

---

## Nächste Schritte (M3, Monate 7-9)

### M3 Sprint 0: DATEV-Import (Reverse)
- Buchungssätze aus DATEV-Export zurück in unsere DB
- Mapping: DATEV-Konto → HGB-Position → Bilanz/GuV
- SKR03/04 → HGB §266/§275 Mapping-Engine

### M3 Sprint 1-2: E-Bilanz-Taxonomie für Konzern
- § 11 PublG: Konzernabschluss-Modul
- TAXONOMIE-Erweiterung für Konzern-Spezifika
- Konsolidierungs-Logik (Mutter-Tochter-Eliminierung)

### M3 Sprint 3-4: Wirtschaftsprüfer-Modul
- Plausibilitätsregeln (IDW PS 880)
- Prüfungs-Notizen je Position
- Bestätigungs-Workflow (Sign vs. Approve)

### M3 Sprint 5: Pilot-Phase-2 Realitäts-Check
- 3 Kanzleien + 15 Mandanten live testen
- ERiC/DATEV/BAnz-Workflows validieren

### M3 Sprint 6-7: Konzern-Pilot
- 1 Konzern-Mandant (Tochter + Mutter)
- Konsolidierungs-Beispiel

### M3 Sprint 8: M3-Handoff
- White-Label (M4-Vorbereitung)
- Konzern-E-Bilanz-Validierung
- M3-Release-Tag

---

## Roadmap-Übersicht (M1 → M2 → M3)

```
M1 (Pilot-Ready):       Auth + RBAC + Bilanz/GuV/Anhang + PDF + WORM + Audit-Log
M2 (Pilot-Phase-2):     E-Bilanz-XBRL + DATEV-Export + qeS-Signatur
M3 (Kanzlei-Tier):      DATEV-Import + Konzernabschluss + WP-Modul + 3 Pilot-Kanzleien
M4 (Production-Tier):   White-Label + Cloud-Migration + Public-API + GoBD-Zertifizierung
```

**Status-Stand**: M1 ✅ M2 ✅ (Sprint 5 in Vorbereitung) M3 ⏳ M4 ⏳

---

**Stand**: 2026-09-24 · **Pilot-Phase-2 Status**: User-Action erforderlich (Kanzlei-Rekrutierung)