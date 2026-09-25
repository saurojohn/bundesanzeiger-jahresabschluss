# Bundesanzeiger Jahresabschluss — Projektcharter

## Vision

Die digitale Plattform für mittelständische GmbHs, Steuerberater und Wirtschaftsprüfer,
um den **Jahresabschluss (Bilanz + GuV + Anhang + Lagebericht)** gemäß **HGB / PublG** rechtssicher
im **Bundesanzeiger** zu veröffentlichen — papierlos, GoBD-konform und ohne DATEV-Briefing.

## Zielgruppe

- **Geschäftsführer (GF)** mittelständischer GmbHs (10-250 Mitarbeiter, Bilanzsumme € 6-50 Mio)
- **Steuerberater** mit Mandantenbetreuung (Bilanzerstellung + Plausibilitätsprüfung)
- **Wirtschaftsprüfer** als Prüfer und Bestätiger des Abschlusses
- **Kanzlei-Admins** als Multi-Mandanten-Verwalter (White-Label-ready)

## Rechtsrahmen (Kernelement des Produkts)

| Quelle | Anforderung |
|---|---|
| **§ 325 HGB** | Pflichtveröffentlichung im Bundesanzeiger für Kapitalgesellschaften |
| **§ 326 HGB** | Größenabhängige Befreiungen (Kleinst-/kleine/mittlere GmbH) |
| **§ 11 PublG** | Konzernabschluss-Pflichten |
| **GoBD** | Unveränderbarkeit, Vollständigkeit, Nachvollziehbarkeit der eingereichten Daten |
| **§ 147 AO** | 10-jährige Aufbewahrungspflicht für Buchhaltungsbelege |
| **DSGVO / BDSG** | Mandantentrennung, Verschlüsselung, Auftragsverarbeitung |

## Veröffentlichungskanäle (alle 3 unterstützt)

1. **BAnz XML / XBRL** — Maschinenlesbare Rechnungslegungsdaten (Standardkanal)
2. **PDF direkt (Hinterlegung)** — Bei Kleinstkapitalgesellschaften gemäß § 326 HGB
3. **E-Bilanz / TAXONOMIE** — Elektronischer Bundesanzeiger für Konzernabschluss (§ 11 PublG)

## Tech-Stack (übernommen aus de-invoice, wo sinnvoll)

| Schicht | Technologie | Begründung |
|---|---|---|
| Frontend | **Next.js 15 (App Router) + TypeScript** | Server Components, i18n out-of-the-box |
| UI | **Tailwind CSS + shadcn/ui** | German accounting forms sind dichte Formulare → Komponenten wichtig |
| i18n | **next-intl** (de-DE primär) | UI 100% Deutsch, PDF-Texte Deutsch |
| Backend | **NestJS 11 + TypeScript** | Module pro Domäne (Bilanz, GuV, Anhang, BAnz) |
| ORM | **Prisma 5** | Single source of truth, Migrationen versioniert |
| DB | **PostgreSQL 16** | Multi-Mandanten via Row-Level-Security + Mandant-Schema |
| PDF | **PDFKit + @signpdf** | GoBD-konforme PDFs mit qualifizierter Signatur |
| XML/XBRL | **xmlbuilder2 + libxmljs2** | Validierung gegen BAnz-Schemas |
| Auth | **JWT + RBAC + TOTP (otplib)** | Steuerberater/WP/GF Rollen |
| Crypto | **node-forge + bcrypt + argon2id** | Mandantenisolation |
| Queue | **BullMQ + Redis** | BAnz-Submission-Retry, E-Mail-Versand |
| Storage | **S3-kompatibel (Hetzner S3 / MinIO)** | GoBD-konformes Archiv mit WORM |
| E-Mail | **Nodemailer + SMTP** | BAnz-Bestätigungen an Mandanten |
| Tests | **Vitest (unit) + Playwright (e2e)** | Realbrowser-Tests gegen UI |
| Deploy | **Docker + Hetzner VPS** (1-Server-Pilot) → später Cloud-Migration | Single-VM im Pilot, dann Skalierung |

## Mandantenfähigkeit (Kanzlei-Tier)

- **Mandant** = 1 GmbH (oder GmbH & Co. KG)
- **Kanzlei** = 1..n Mandanten unter einem Kanzlei-Admin
- **Rollen** (RBAC): `GF | Steuerberater | Wirtschaftsprüfer | Kanzlei-Admin | System-Admin`
- **Mandantentrennung**: Row-Level-Security auf Mandant-ID, alle Queries gehen durch Mandant-Filter
- **White-Label** (Phase 4): Logo, Farben, Domain pro Kanzlei

## Compliance-Drehscheibe

Das Produkt ist kein Buchhaltungs-Tool — es ist eine **Veröffentlichungs- und Compliance-Pipeline**:

```
[ Steuerberater-Daten ] → [ Validierung ] → [ XML/XBRL Generierung ] → [ BAnz Portal ] → [ Bestätigung ]
        ↓                       ↓                     ↓                       ↓              ↓
   GuV/Bilanz             Plausibilitäts-         Signatur +              API/Upload      Archiv (GoBD)
   manuell oder           prüfung                 Zeitstempel                              10 Jahre
   DATEV-Import
```

## Roadmap (4 Meilensteine × 3 Monate = 12 Monate)

### M1 (Monate 1-3) — Fundament & Pilot-Mandant ✅
- Multi-Mandanten-Datenmodell + RBAC (5 Rollen)
- Bilanz + GuV Eingabeformulare (manuell, ohne DATEV)
- PDF-Generierung (GoBD-konform) für Kleinstkapitalgesellschaften
- Auth + Audit-Trail (vollständig, unveränderlich)
- WORM-Storage (S3 Object Lock, 10 Jahre)
- Pilot: 1 Steuerberater mit 3 Mandanten
- **Status**: ✅ Pilot-Ready (Git-Tag `m1-pilot-ready`)

### M2 (Monate 4-6) — BAnz-Submission-Pipeline ✅
- **Marktanpassung (Sep 2026)**: BAnz-Verlag hat keine externe XML/XBRL-Submission-API mehr
- E-Bilanz-XBRL-Generator (HGB-Kerntaxonomie v6 / 2025-04-01) für ERiC → Finanzamt (§ 5b EStG)
- DATEV-Buchungsstapel-Export (EXTF v700+, SKR03/SKR04) für DATEV/Addison
- Qualifizierte elektronische Signatur (qeS) via P12-Token + signpdf + TSA
- Frontend-Integration: E-Bilanz/DATEV/Signatur-UI
- Pilot-Phase-2: 3 Kanzleien + 15 Mandanten
- **Status**: ✅ Backend + Frontend fertig (Tag `m2-pilot-ready`)

### M3 (Monate 7-9) — DATEV-Import & Konzernabschluss ✅
- DATEV-ASCII-Import (Buchführungsdaten → Bilanz/GuV Mapping, reverse direction) ✅
- E-Bilanz / TAXONOMIE für § 11 PublG (Konzern) ✅
- Konzernabschluss-Modul (Konsolidierung Mutter-Tochter) ✅
- Wirtschaftsprüfer-Prüfungsmodul mit Plausibilitätsregeln ✅
- Performance-Skalierung (15 → 50 Mandanten, Cursor-Pagination, 16+ Composite-Indices) ✅
- White-Label-Branding (Logo + Brand-Color + Custom-Domain-Field) ✅
- Pilot: 3 Kanzleien + 15 Mandanten ✅
- **Status**: ✅ Kanzlei-Tier Ready (Git-Tag `m3-kanzlei-ready`)

### M4 (Monate 10-12) — White-Label-Production & Cloud-Migration ⏳
- White-Label-Production (Custom-Domain, Logo-Resize/Cropping)
- Cloud-Migration (Hetzner S3 → S3-Cloud, Multi-VM, K8s optional)
- Public-API (OAuth2 + OpenAPI 3.1 + Webhook-System)
- Subscription-Modell (Starter/Pro/Enterprise via Stripe)
- Mobile-Responsiveness (Tablet-Layout + PWA-Modus)
- GoBD-Zertifizierung (IDW PS 880 Vorbereitung)
- GA: 200+ Mandanten, 99.95% Uptime

## Erfolgsmetriken (Go-Live-Kriterien)

| Metrik | M1 ✅ | M2 ✅ | M3 ✅ | M4 (GA) |
|---|---|---|---|---|
| Aktive Mandanten | 3 (Demo) | 15 (Pilot) | 50 | 200 |
| Erfolgreiche BAnz-Einreichungen | 3 (intern) | 15 (Pilot) | 50 | 200 |
| DSGVO-/GoBD-Audit | intern | extern | bestanden | rezertifiziert |
| E2E-Test-Coverage | 60% | 75% | 85% | 90% |
| Uptime | 99% | 99.5% | 99.9% | 99.95% |

## Verzeichnisstruktur

```
bundesanzeiger-jahresabschluss/
├── backend/                 NestJS API
│   ├── src/
│   │   ├── modules/
│   │   │   ├── auth/        JWT + TOTP + RBAC
│   │   │   ├── mandant/     Multi-Mandanten-Verwaltung
│   │   │   ├── bilanz/      Bilanz-Eingabe + Validierung
│   │   │   ├── guv/         GuV-Eingabe + Validierung
│   │   │   ├── anhang/      Anhang + Lagebericht
│   │   │   ├── abschluss/   Jahresabschluss-Orchestrierung
│   │   │   ├── banz/        BAnz-XML/XBRL Generierung + Portal
│   │   │   ├── datev/       DATEV-Import (M3)
│   │   │   ├── konsolidierung/ Konzernabschluss (M3)
│   │   │   ├── pdf/         PDF-Generierung (PDFKit + GoBD)
│   │   │   ├── signatur/    Qualifizierte Signatur
│   │   │   └── audit/       Audit-Trail (GoBD)
│   │   └── main.ts
│   ├── prisma/              Schema + Migrationen
│   ├── e2e/                 Backend-Integrationstests
│   └── Dockerfile
├── frontend/                Next.js App
│   ├── src/app/
│   │   ├── (mandant)/       Mandanten-spezifische Routen
│   │   ├── (kanzlei)/       Kanzlei-Administration
│   │   ├── (admin)/         System-Admin
│   │   └── auth/            Login + TOTP
│   ├── src/messages/        de-DE Strings
│   ├── e2e/                 Playwright Tests
│   └── Dockerfile
├── docs/
│   ├── rechtsrahmen.md      HGB/PublG/GoBG-Mappings
│   ├── banz-schemata.md     BAnz XML/XBRL Schema-Referenz
│   ├── rollen-rbac.md       RBAC-Matrix
│   ├── gobd-architektur.md  GoBD-konforme Architektur
│   └── datenmodell.md       ER-Diagramm
├── infra/
│   ├── docker-compose.yml   Dev-Stack
│   ├── docker-compose.prod.yml
│   └── hetzner-deploy.md    Production-Deployment
└── scripts/
    ├── seed-mandanten.sh    Demo-Mandanten für Pilot
    └── banz-test-fixtures/  XML/XBRL-Test-Submissions
```

## Sofortiger Start (M1 Sprint 0)

1. ✅ Repository + Charter (dieses Dokument)
2. ⏭ Prisma-Schema (Mandant, User, Bilanz, GuV, Anhang, Abschluss, Submission, AuditLog)
3. ⏭ NestJS-Bootstrap + Auth-Modul (JWT + RBAC + TOTP)
4. ⏭ Next.js-Bootstrap mit Login + Mandant-Switcher
5. ⏭ Bilanz-Eingabeformular (Posten → Bilanzposition → Summenvalidierung)
6. ⏭ GuV-Eingabeformular (Kosten-/Erlösarten → Gesamtkostenverfahren)
7. ⏭ PDF-Generierung (vereinfachte Kleinstkapitalgesellschaft-Variante)
8. ⏭ Audit-Trail (alle Schreiboperationen)

## Verwandtes Projekt

Dieses Projekt ist **unabhängig** von [de-invoice](../de-invoice), kann aber perspektivisch
über die Public-API (M4) Datenimporte erhalten (BWA/GuV aus laufender Buchhaltung).
Stack und Konventionen sind bewusst konsistent gehalten (NestJS + Prisma + PDFKit),
damit ein gemeinsamer Mandanten-Login + Migrationen-Vergleich möglich bleibt.

---

**Status**: M1 Sprint 0 in Arbeit · **Lizenz**: proprietär · **Sprache**: Deutsch (UI + PDF + Audit)