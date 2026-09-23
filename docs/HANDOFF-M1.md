# M1 → M2 Handoff — Bundesanzeiger Jahresabschluss

> **Zweck**: Übergabe-Dokumentation von M1 (Pilot-Ready) zu M2 (BAnz XML/XBRL Submission).
> Stand: 2026-09-23, Ende Sprint 4 (Pilot-Hardening).

---

## 1. M1-Akzeptanzkriterien (Pilot-Ready)

### 1.1 Funktionale Kriterien

| Kriterium | Status | Evidenz |
|---|---|---|
| Multi-Mandanten-Datenmodell (Kanzlei → n Mandanten) | ✅ | Prisma Schema, Repository-Pattern |
| 5 Rollen mit RBAC (GF/Steuerberater/WP/Kanzlei-Admin/System-Admin) | ✅ | `RolesGuard` + `@Roles` Decorator |
| JWT-Auth + Refresh + TOTP-Setup | ✅ | `auth.module.ts` |
| Audit-Trail (alle Mutationen, Vorher/Nachher-Snapshots) | ✅ | `AuditService` + `AuditInterceptor` |
| Bilanz-Eingabeformular (HGB §266 Side-by-side, Live-Saldo) | ✅ | `BilanzForm.tsx` + `BilanzService` |
| GuV-Eingabeformular (GKV + UKV, Live-Ergebnis) | ✅ | `GuvListView.tsx` + `GuVService` |
| Anhang-Editor (5 §284-Standardabschnitte, Markdown) | ✅ | `AnhangListView.tsx` + `AnhangService` |
| PDF-Generierung (PDFKit, deutsch, de-DE Zahlenformat) | ✅ | `pdf.service.ts` + 4 Templates |
| WORM-Storage (S3 Object Lock COMPLIANCE, 10 Jahre) | ✅ | `storage.service.ts` + MinIO |
| Audit-Log-View mit Filtern | ✅ | `AuditLogView.tsx` |
| Mandant-Switcher im Header | ✅ | `MandantSwitcher.tsx` |

### 1.2 Compliance-Kriterien

| Kriterium | Status | Evidenz |
|---|---|---|
| GoBD §147 AO: 10 Jahre unveränderliche Aufbewahrung | ✅ | S3 Object Lock COMPLIANCE |
| HGB §266: vollständiges Bilanzschema | ✅ | `hgb-bilanz.constants.ts` (Aktiva A-D, Passiva A-E) |
| HGB §275: GuV beide Verfahren (GKV/UKV) | ✅ | `hgb-guv.constants.ts` |
| HGB §284-289: Anhang-Pflichtabschnitte | ✅ | `anhang.constants.ts` (5 Standardabschnitte) |
| DSGVO: Mandantentrennung | ✅ | Repository-Pattern + MandantGuard |
| Audit-Trail Vollständigkeit | ✅ | AuditInterceptor + manual AuditService.record |

### 1.3 Quality-Gates

| Gate | Status | Evidenz |
|---|---|---|
| Backend `tsc --noEmit` 0 errors | ✅ | Sprint 0+1+2+3 |
| Backend `eslint --max-warnings 0` 0 errors | ✅ | Sprint 0+1+2+3 |
| Frontend `i18n JSON` valid | ✅ | Sprint 2+3 |
| Prisma Schema syntaktisch korrekt | ✅ | `prisma generate` exit 0 |
| e2e-Specs tsc-clean (Auth, Bilanz, GuV, PDF) | ✅ | 4 e2e-Files, 36 Tests total |
| Setup-Smoke-Test gegen echte DB | ✅ | `setup-e2e.sh` (12 Schritte) |

### 1.4 Dokumentation

| Dokument | Pfad | Zweck |
|---|---|---|
| **README.md** | `/README.md` | Vision, Stack, Roadmap |
| **AGENTS.md** | `/AGENTS.md` | Engineering-Disziplinen + Hard-Rules |
| **RUNBOOK.md** | `/RUNBOOK.md` | Setup + Pilot-Kanzlei-Onboarding |
| **DEPLOY-PILOT.md** | `/DEPLOY-PILOT.md` | Hetzner-VPS-Deployment |
| **SECURITY-AUDIT.md** | `/SECURITY-AUDIT.md` | OWASP + Compliance-Audit |
| **USER-GUIDE.md** | `/USER-GUIDE.md` | Steuerberater-Anleitung (deutsch) |
| **MILESTONE-1.md** | `/docs/MILESTONE-1.md` | Sprint-Detail-Plan |
| **rechtsrahmen.md** | `/docs/rechtsrahmen.md` | HGB/GoBD/DSGVO-Mappings |

---

## 2. Architektur-Snapshot

### 2.1 Stack

```
Frontend (Next.js 15 + next-intl + Tailwind + shadcn-style)
   ↓ HTTPS (JWT Bearer in Headers)
Backend (NestJS 11 + Prisma 5.22 + class-validator + Helmet + Throttler)
   ↓ Prisma ORM
PostgreSQL 16 (mandantId-Filter via Repository-Pattern)
   ↓ S3 PutObject mit Object Lock
MinIO (Dev) / Hetzner S3 (Pilot) — Object Lock COMPLIANCE
```

### 2.2 Module-Übersicht

```
backend/src/
├── main.ts (Bootstrap mit Helmet + CORS + Throttler)
├── app.module.ts (Module-Composition)
├── prisma/ (PrismaService + Module)
├── common/
│   └── repositories/
│       ├── prisma-repository.base.ts
│       ├── bilanz.repository.ts
│       ├── guv.repository.ts
│       ├── anhang.repository.ts
│       └── worm-object.repository.ts
└── modules/
        ├── auth/ (JWT + Refresh + TOTP)
        ├── mandant/ (CRUD)
        ├── bilanz/ (Service + Controller + HGB §266 Schema)
        ├── guv/ (Service + Controller + HGB §275 Schema)
        ├── anhang/ (Service + Controller + §284 Schema)
        ├── pdf/ (PDFKit-Service + Templates)
        ├── storage/ (S3 WORM + MinIO-Compat)
        └── audit/ (Append-only AuditLog + Interceptor)
```

### 2.3 Frontend-Routen

```
frontend/src/app/[locale]/
├── login/             → Anmeldung mit TOTP-Step-Up
└── (app)/
    ├── dashboard/     → Übersicht mit Stats-Kacheln
    ├── bilanz/        → Bilanz-Liste + Eingabeformular
    ├── guv/           → GuV-Liste + Eingabeformular (GKV/UKV)
    ├── anhang/        → Anhang-Liste + Editor
    └── audit/         → Audit-Log-View mit Filter
```

---

## 3. Pilot-Onboarding-Checkliste

### 3.1 Vorbereitung (Tag 1)

- [ ] Hetzner-VPS provisioniert (siehe DEPLOY-PILOT.md §1)
- [ ] DNS-Record gesetzt (Pilot-Subdomain)
- [ ] TLS-Zertifikat via Let's Encrypt
- [ ] Docker installiert + Stack gestartet
- [ ] MinIO mit Object Lock aktiviert
- [ ] Backend + Frontend hinter nginx reverse proxy
- [ ] Prisma Migration + Seed ausgeführt
- [ ] Backup-Cron eingerichtet
- [ ] Healthcheck grün (Backend, Postgres, MinIO, Redis)

### 3.2 Kanzlei-Onboarding (Tag 2)

- [ ] Pilot-Kanzlei registriert (1 Kanzlei-Admin)
- [ ] 3 Mandanten angelegt (1 echte GmbH, 2 Demo)
- [ ] 5 User angelegt (admin/kanzlei-admin/steuerberater/wp/gf-demo)
- [ ] TOTP für STEUERBERATER/WP/KANZLEI_ADMIN aktiviert
- [ ] Pilot-Kanzlei testet erste Bilanz-Erfassung

### 3.3 Pilot-Phase (Tag 3-14)

- [ ] Steuerberater erfasst 1 echten Jahresabschluss (Bilanz + GuV + Anhang)
- [ ] Wirtschaftsprüfer prüft (optional)
- [ ] PDF wird erzeugt + in WORM archiviert
- [ ] Audit-Trail auf Vollständigkeit geprüft
- [ ] Feedback-Session (Woche 2, Tag 8-10):
  - Welche Pain-Points?
  - Welche Features fehlen?
  - Welche Bugs sind aufgetreten?

### 3.4 Sign-off (Tag 14-15)

- [ ] Steuerberater bestätigt Funktionalität
- [ ] User (焌SauroJohn) bestätigt technische Abnahme
- [ ] Übergang zu M2 (BAnz-Submission) freigegeben

---

## 4. M2-Vorschau (Monate 4-6)

### 4.1 Scope

**Hauptziel**: Bundesanzeiger XML/XBRL Submission-Pipeline

**Module**:
1. **BAnz-Channel-Service** (`modules/banz/`)
   - `XmlXbrlChannel` — Generierung BAnz-konformer XML/XBRL
   - Schema-Validierung gegen BAnz-Taxonomie (2026-Version)
   - Sandbox-Integration (BAnz Test-Portal)
   - Production-Submission (nach Sandbox-Sign-off)

2. **Signatur-Modul** (`modules/signatur/`)
   - P12-Token-Integration (Hardware-Signatur)
   - Qualifizierte elektronische Signatur (qeS)
   - PDF/A-3-Container mit eingebetteter Signatur
   - Zeitstempel via TSA (z. B. DigiStamp)

3. **Submission-Orchestrierung**
   - State-Machine: DRAFT → FINALIZED → SIGNED → SUBMITTED → PUBLISHED
   - Retry-Mechanismus mit Exponential-Backoff
   - Submission-Status-Poll (alle 60s bis BAnz-Bestätigung)

4. **Kanzlei-Modus**
   - 1 Kanzlei-Admin verwaltet n Mandanten
   - Bulk-Submission (mehrere Mandanten gleichzeitig)
   - White-Label (Logo, Farben) — Phase 4

### 4.2 Geplante Sprint-Reihenfolge

```
M2 Sprint 0 (Woche 16-17): BAnz-Schema-Adapter vorbereiten
M2 Sprint 1 (Woche 18-19): XmlXbrl-Channel (Generierung + Validierung)
M2 Sprint 2 (Woche 20-21): Sandbox-Submission (BAnz Test-Portal)
M2 Sprint 3 (Woche 22-23): Signatur-Modul (qeS + P12)
M2 Sprint 4 (Woche 24-25): Production-Submission + Monitoring
M2 Sprint 5 (Woche 26-27): Kanzlei-Bulk-Submission + Pilot-Phase 2
```

### 4.3 Neue Env-Variablen (M2)

```bash
# BAnz Portal
BUNDESANZEIGER_PORTAL_BASE_URL=https://www.bundesanzeiger.de
BUNDESANZEIGER_PORTAL_USER=<verlag-account>
BUNDESANZEIGER_PORTAL_PWD=<verlag-pwd>
BUNDESANZEIGER_PORTAL_MANDANT_ID=<mandant-id-beim-verlag>

# Signatur
SIGN_P12_PATH=/secure/path/to/token.p12
SIGN_P12_PWD=<token-pwd>
TSA_URL=https://timestamp.digistamp.com
TSA_USER=<tsa-user>
TSA_PWD=<tsa-pwd>

# Submission
SUBMISSION_POLL_INTERVAL_SEC=60
SUBMISSION_MAX_RETRIES=3
SUBMISSION_BACKOFF_BASE=2
```

### 4.4 Neue Dependencies (M2)

```json
{
  "@signpdf/signer-p12": "^3.3.0",
  "@signpdf/signpdf": "^3.3.0",
  "node-forge": "^1.4.0",
  "libxmljs2": "^0.34.0",  // XBRL-Validierung
  "axios": "^1.7.0",        // BAnz-Portal-API
  "bullmq": "^5.0.0"        // Submission-Queue
}
```

### 4.5 Pilot-Skalierung (M2)

- 1 Pilot-Kanzlei → 3 Pilot-Kanzleien (verschiedene Größen)
- 3 Mandanten → 15 Mandanten
- Test mit verschiedenen Rechtsformen (GmbH, GmbH & Co. KG, AG)

---

## 5. Bekannte Einschränkungen (M1)

| Einschränkung | Workaround | M2-Plan |
|---|---|---|
| TOTP-Secret mit scrypt(JWT_SECRET) verschlüsselt | Pilot: akzeptabel | KMS-Integration |
| Kein Passwort-Reset-Flow | Admin muss manuell zurücksetzen | E-Mail-Token-Reset |
| Kein Brute-Force-Schutz | Pilot: 600 req/min Throttler reicht | Account-Lockout nach 5 Fehlversuchen |
| Qualifizierte Signatur: nur Mock-Hinweis im PDF | Pilot: PDF ist WORM-archiviert, aber nicht qeS-signiert | Echte qeS via P12-Token + signpdf |
| BAnz-Submission nicht implementiert | Pilot: interne Archive als Vorstufe | XML/XBRL-Submission an BAnz-Portal |
| DATEV-Import nicht implementiert | Pilot: manuelle Erfassung | DATEV-ASCII-Import (M3) |
| E-Bilanz TAXONOMIE nicht implementiert | Pilot: nur PDF-XML_XBRL-Pfad | E-Bilanz-TAXONOMIE (M3) |

---

## 6. Lessons Learned (M1)

### 6.1 Was gut lief

- **Stack-Konsistenz mit de-invoice**: gleiche Versionen erleichtern Migration
- **Repository-Pattern**: erzwungene Mandant-Trennung in Schicht 1
- **PDF-Templates vor Bilanz-Service**: bessere visuelle Kontrolle
- **Audit-Interceptor (auto)**: garantiert Vollständigkeit ohne Vergessen

### 6.2 Was verbessert werden kann

- **e2e-Tests brauchen echte DB**: aktuell tsc-clean aber nicht ausgeführt
- **PDF-Generierung könnte PDF/A-3-Konformität verifizieren** (M2)
- **WORM-Key-Strategie**: aktuell mandantId im Key → evt. sensibel in URLs
- **Mandant-Switcher**: page-reload ist hart — besser React-State (M2)

### 6.3 Architektur-Entscheidungen für M2 beibehalten

- **Repository-Pattern** (mit Mandant-Filter) bleibt — Erweiterung um Bulk-Operations
- **Audit-Trail mit Vorher/Nachher-Snapshot** bleibt — auch für Submission-Events
- **PDF-Templates als reine Funktionen** bleiben — gleiche Pattern für XBRL-Generierung
- **WORM-Storage append-only** bleibt — keine Updates, nur neue Generationen

---

## 7. Pilot-OK zum Übergang in M2?

Wenn alle Pilot-Sign-offs in §3 erfüllt sind → **Übergang zu M2** freigegeben.

**Verantwortlich**: User (焌SauroJohn)

**Nächste Aktion nach Sign-off**:
1. Sprint 0 (BAnz-Schema-Adapter vorbereiten) starten
2. BAnz-Portal-Sandbox-Account beantragen (User-Aktion, extern)
3. Hardware-Signatur-Token besorgen (User-Aktion, extern)

---

**M1-Abschluss-Datum**: 2026-09-23
**Pilot-Start**: Nach User-Sign-off
**M2-Start**: Nach Pilot-Phase (2 Wochen)
**Pilot-Kanzlei**: 1 (Anwärter: Musterkanzlei Steuerberatung GmbH)