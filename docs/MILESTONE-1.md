# Milestone 1 (Monate 1-3) — Fundament & Pilot-Mandant

**Ziel**: Ein Steuerberater kann für 3 GmbH-Mandanten den vereinfachten Jahresabschluss
(Kleinstkapitalgesellschaft gemäß § 326 HGB) im System erfassen, als GoBD-konformes PDF
generieren und im Audit-Trail nachvollziehbar dokumentieren.

**Kein** BAnz-XML/XBRL-Submit in M1 (kommt in M2). M1 ist die **Eingabe- und Validierungsschicht**.

## Sprint 0 (Woche 1-2) — Repository- & Stack-Bootstrap

### Sprint 0.1 — Backend-Skeleton
- [ ] `backend/package.json` mit NestJS 11, Prisma 5.22, alle Dependencies (siehe AGENTS.md §2.3)
- [ ] `backend/tsconfig.json` (strict mode, ES2022)
- [ ] `backend/src/main.ts` — Bootstrap mit CORS, Helmet, Throttler, ValidationPipe
- [ ] `backend/src/app.module.ts` — ConfigModule + PrismaModule + AuthModule + AuditModule (Stub)
- [ ] `backend/Dockerfile` — Multi-stage (build → runtime: node:22-bookworm-slim)
- [ ] `backend/eslint.config.mjs` — Inkl. `no-restricted-syntax`-Regel für Prisma-FindUnique

### Sprint 0.2 — Frontend-Skeleton
- [ ] `frontend/package.json` — Next.js 15, next-intl, shadcn/ui, Tailwind
- [ ] `frontend/src/app/layout.tsx` — Root layout mit `NextIntlClientProvider`
- [ ] `frontend/src/app/(auth)/login/page.tsx` — Login-Formular (Email + Passwort)
- [ ] `frontend/src/messages/de-DE.json` — Mindestens 50 Strings für Login + Dashboard
- [ ] `frontend/src/app/(mandant)/dashboard/page.tsx` — Mandant-Übersicht (Platzhalter)

### Sprint 0.3 — Datenbank-Bootstrap
- [ ] `backend/prisma/schema.prisma` — Models: User, Mandant, UserMandantRole, AuditLog
- [ ] `infra/docker-compose.yml` — Postgres 16 + Redis 7 + Backend + Frontend
- [ ] `scripts/seed-mandanten.sh` — 1 Kanzlei + 3 Mandanten + 5 User (verschiedene Rollen)

### Sprint 0.4 — CI
- [ ] `.github/workflows/backend-ci.yml` — tsc + eslint + vitest
- [ ] `.github/workflows/frontend-ci.yml` — tsc + eslint + playwright
- [ ] `.github/workflows/e2e.yml` — Full-Stack E2E auf Postgres-Test-DB

**Akzeptanz Sprint 0**:
- `docker compose up` startet alle Services
- Login funktioniert mit seed-User
- Audit-Trail-Endpoint loggt jede Mutation

## Sprint 1 (Woche 3-5) — Auth + RBAC

### Sprint 1.1 — Auth
- [ ] `auth.service.ts` — Login (bcrypt-verify), JWT-Token (15min) + Refresh-Token (7 Tage)
- [ ] `auth.controller.ts` — `/api/auth/login`, `/api/auth/refresh`, `/api/auth/logout`
- [ ] `jwt.strategy.ts` — Passport JWT Strategy
- [ ] `totp.service.ts` — TOTP-Secret-Generation + Verify (otplib)
- [ ] Login-UI: Email/Passwort → TOTP-Eingabe (für Steuerberater/WP/Admin)

### Sprint 1.2 — RBAC
- [ ] `@Roles(...roles)` Decorator
- [ ] `RolesGuard` — prüft `user.roles` gegen erforderliche Rollen
- [ ] `MandantGuard` — prüft `user.mandantAccess` (Kanzlei-Admin darf alle seiner Kanzlei)
- [ ] `UserMandantRole` — m:n-Tabelle (User × Mandant × Role)
- [ ] Seed-Daten: 1 Steuerberater mit Zugriff auf 3 Mandanten, 1 GF mit Zugriff auf 1 Mandanten

### Sprint 1.3 — Mandanten-Switcher
- [ ] Frontend: Mandanten-Dropdown im Header (zeigt nur zugängliche Mandanten)
- [ ] Mandant-Kontext im localStorage + Cookie (für SSR)
- [ ] API: alle Endpoints filtern automatisch nach aktivem Mandant

**Akzeptanz Sprint 1**:
- Steuerberater kann sich einloggen, sieht 3 Mandanten, kann zwischen ihnen wechseln
- GF kann sich einloggen, sieht 1 Mandanten, hat keinen Zugriff auf andere
- Versuchter Cross-Mandant-Zugriff → 403 + Audit-Log-Eintrag

## Sprint 2 (Woche 6-8) — Bilanz & GuV Eingabe

### Sprint 2.1 — Bilanz-Eingabe
- [ ] `bilanz.controller.ts` — CRUD (Create, Read, Update, Delete)
- [ ] `bilanz.service.ts` — Validierung (Aktiva == Passiva), Periodenprüfung
- [ ] `bilanz-position.entity.ts` — Bilanzpositionen nach HGB-Kontenrahmen
- [ ] `bilanz-formular` Frontend — Bilanz-Aktiva, Bilanz-Passiva, Side-by-side Validierung
- [ ] Reuse: HGB-Kontenplan-Seed (SKR03/SKR04 reduziert auf Bilanzpositionen)

### Sprint 2.2 — GuV-Eingabe
- [ ] `guv.controller.ts` + `guv.service.ts` — analog Bilanz
- [ ] Gesamtkostenverfahren (GKV) + Umsatzkostenverfahren (UKV) — beide Varianten
- [ ] `guv-formular` Frontend — Erlöse, Materialaufwand, Personalaufwand, Abschreibungen, sonstige
- [ ] Validierung: Σ Erlöse - Σ Aufwendungen = Jahresüberschuss/fehlbetrag

### Sprint 2.3 — Anhang (Minimal)
- [ ] `anhang.controller.ts` + `anhang.service.ts` — Freitext-Felder (Bilanzierungs-/Bewertungsmethoden)
- [ ] Pflichtfelder gemäß § 284 HGB (reduziert für Kleinstkapitalgesellschaften)

**Akzeptanz Sprint 2**:
- Steuerberater erstellt für Mandant A eine Bilanz (Aktiva + Passiva, saldengleich)
- Steuerberater erstellt eine GuV mit 8 Positionen, Saldo stimmt
- Anhang wird erfasst
- Alle Eingaben sind Audit-Trail-erfasst (Wer, Wann, Vor-/Nachher-Zustand)

## Sprint 3 (Woche 9-11) — PDF-Generierung (GoBD-konform)

### Sprint 3.1 — PDF-Service
- [ ] `pdf.service.ts` — PDFKit-basierter PDF-Generator
- [ ] `pdf-templates/bilanz-guv.template.ts` — Layout mit Bilanz links, GuV rechts
- [ ] `pdf-templates/anhang.template.ts` — Anhang + Lagebericht
- [ ] **GoBD-Anforderungen**:
  - PDF/A-3 Container (Langzeitarchivierung)
  - Eingebettete Schriftarten (kein externes Font-Loading)
  - Text-Layer (Volltextsuche möglich)
  - Strukturierte Metadaten (XMP)
- [ ] Header: Mandant-Name, Geschäftsjahr, Erstellungsdatum, **WORM-Hinweis**

### Sprint 3.2 — Signatur
- [ ] `signatur.service.ts` — @signpdf/signer-p12 Integration
- [ ] Mock-Token in Dev (Phase 1), echtes Token in Pilot (Phase 2)
- [ ] PDF → PDF/A-3 mit eingebetteter Signatur

### Sprint 3.3 — WORM-Storage
- [ ] S3-kompatibler Client (MinIO für Dev, Hetzner S3 für Pilot)
- [ ] Object Lock mit `COMPLIANCE` Mode (GoBD § 147 AO)
- [ ] Retention: 10 Jahre (3650 Tage)
- [ ] Lifecycle: Nach Ablauf in Glacier-Tier (später M4)

**Akzeptanz Sprint 3**:
- Bilanz + GuV werden als PDF/A-3 generiert
- PDF hat qualifizierte Signatur (oder Mock-Dev-Stamp)
- PDF wird in WORM-Storage abgelegt (versuche zu löschen → 403 Forbidden)
- PDF-Download funktioniert über API-Endpoint mit RBAC

## Sprint 4 (Woche 12-13) — Audit-Trail & Pilot-Vorbereitung

### Sprint 4.1 — Audit-Trail-Vollständigkeit
- [ ] `audit.service.ts` — vollständige Implementierung
- [ ] `AuditInterceptor` — auto-loggt alle Mutationen
- [ ] `audit.controller.ts` — `/api/audit` mit Filter (userId, mandantId, entityType, dateRange)
- [ ] Audit-UI im Frontend — Filter + Liste mit Vorher/Nachher-Diff

### Sprint 4.2 — Pilot-Vorbereitung
- [ ] 1 Steuerberater-Kanzlei onboarded (manuell)
- [ ] 3 Pilot-Mandanten (1 echte GmbH, 2 Demo)
- [ ] Benutzer-Onboarding-Flow (E-Mail-Invite, Passwort-Set, TOTP-Aktivierung)
- [ ] Pilot-Support: Kanzlei-Admins bekommen direkten Draht zu uns

**Akzeptanz Sprint 4 (Pilot-Ready)**:
- Kanzlei kann 3 Mandanten verwalten
- Pro Mandant: 1 Bilanz, 1 GuV, 1 Anhang, 1 PDF-Archiv
- Audit-Trail ist vollständig und revisionssicher
- Pilot-Kanzlei gibt Feedback (Woche 13-14)

## Sprint 5 (Woche 14-15) — Pilot-Feedback & M1-Hardening

### Sprint 5.1 — Pilot-Feedback
- [ ] 1:1-Session mit Pilot-Steuerberater (1-2 Stunden)
- [ ] Pain-Points sammeln, priorisieren
- [ ] Top-3-Fixes umsetzen

### Sprint 5.2 — M1-Hardening
- [ ] E2E-Tests: Bilanz-Eingabe → PDF-Download (Playwright)
- [ ] Backend-Tests: alle Services min. 80% Coverage
- [ ] Security-Audit: OWASP Top 10 Self-Check
- [ ] Performance: < 2s für Bilanz-Eingabe → PDF
- [ ] Documentation: `RUNBOOK.md` für Pilot (Onboarding, häufige Probleme)

## M1 Akzeptanzkriterien (Go/No-Go zu M2)

| Kriterium | Status |
|---|---|
| Pilot-Kanzlei onboarded mit 3 Mandanten | ☐ |
| Pro Mandant: Bilanz + GuV + Anhang + PDF-Archiv | ☐ |
| RBAC: 5 Rollen mit Mandant-Isolation | ☐ |
| GoBD: WORM-Storage mit 10-Jahres-Retention | ☐ |
| Audit-Trail: alle Mutationen nachvollziehbar | ☐ |
| E2E-Test-Suite grün (Backend + Playwright) | ☐ |
| Pilot-Sign-off von Steuerberater | ☐ |

## Risiken (M1)

| Risiko | Mitigation |
|---|---|
| Steuerberater will DATEV-Import (für M1 nicht geplant) | Pilot-Mandanten manuell erfassen, DATEV ist M3 |
| TOTP-Setup zu komplex für Pilot-User | Default-OTP-Recovery-Codes vorab generieren |
| BAnz-Submission noch nicht möglich | Pilot-Mandanten akzeptieren "internes Archiv" als M1-Zwischenschritt |
| Hardware-Token für Signatur nicht vorhanden | Dev-Mock, Pilot mit Software-Token (z.B. Kobil Smart Card) |

## Nächste Schritte

Nach M1 → M2 Sprint 0 starten (BAnz XML/XBRL + Kanzlei-Modus).

---

**Status**: Sprint 0 in Arbeit · **Owner**: Mavis (mavis) · **Reviewer**: User (焌SauroJohn)