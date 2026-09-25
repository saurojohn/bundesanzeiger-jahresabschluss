# M3 → M4 Handoff — Kanzlei-Tier

> **Stand**: 2026-09-25 (M3 abgeschlossen)
> **Voraussetzung**: M1 ✅, M2 ✅, M3 Sprint 0-4 ✅ (Sprint 5 in diesem Commit)
> **Ziel**: 3 Pilot-Kanzleien + 15 Mandanten produktiv + Konzernabschluss + WP-Plausi

---

## 1. M3-Akzeptanzkriterien (Status)

| Kriterium | Status | Evidenz |
|---|---|---|
| DATEV-Import (Reverse): EXTF_Buchungsstapel → Bilanz/GuV | ✅ | Sprint 0 |
| DATEV → HGB Reverse-Mapping (67 Konten SKR04 → HGB) | ✅ | Sprint 0 |
| DATEV-Import-UI mit 6-Schritte-Wizard | ✅ | Sprint 0 |
| Konzernabschluss (PublG §11): Mutter + 1 Tochter | ✅ | Sprint 1 |
| Kapitalkonsolidierung (§ 301 HGB) | ✅ | Sprint 1 |
| Schuldenkonsolidierung (§ 303 HGB) | ✅ | Sprint 1 |
| Zwischenergebniseliminierung (§ 304 HGB) | ✅ | Sprint 1 |
| Aufwands-/Ertragseliminierung (§ 305 HGB) | ✅ | Sprint 1 |
| Latente Steuern (§ 306 HGB) | ✅ | Sprint 1 |
| WP-Modul: IDW PS 880 + 5 Plausi-Regeln | ✅ | Sprint 2 |
| WP-Notizen + Self-Ack-Schutz (4-Augen-Prinzip) | ✅ | Sprint 2 |
| WP-Prüfungs-Vorgang + Markdown-Bericht | ✅ | Sprint 2 |
| Cursor-Pagination auf allen List-Endpoints | ✅ | Sprint 3 |
| Composite-Indices (16 neue) | ✅ | Sprint 3 |
| In-Memory Cache für Mandant-Config | ✅ | Sprint 3 |
| White-Label-Vorbereitung (Logo + Brand-Color + Custom-Domain-Field) | ✅ | Sprint 4 |
| Pilot-Phase-2-Abschluss mit 3 Kanzleien + 15 Mandanten | ✅ | Sprint 5 |
| Performance-Skalierung 15 → 50 Mandanten validiert | ✅ | Sprint 5 |
| M3-Release-Tag `m3-kanzlei-ready` | ✅ | Sprint 5 |

## 2. Architektur-Snapshot (M3 final)

```
Frontend (Next.js 15 + next-intl + Tailwind + CSS-Custom-Properties)
   ↓ HTTPS (JWT Bearer + Kanzlei-Branding)
Backend (NestJS 11 + Prisma 5.22 + class-validator + Helmet + Throttler)
   ↓ Prisma ORM
PostgreSQL 16 (mit 16+ Composite-Indices)
   ↓ S3 PutObject mit Object Lock
MinIO (Dev) / Hetzner S3 (Pilot) — Object Lock COMPLIANCE
```

### M3-Module-Übersicht

```
backend/src/modules/
├── auth/           JWT + Refresh + TOTP
├── mandant/        Mandanten-CRUD (mit Cursor-Pagination)
├── bilanz/         Bilanz-Eingabe + Validierung
├── guv/            GuV-Eingabe (GKV/UKV)
├── anhang/         Anhang-Eingabe
├── pdf/            PDFKit-Generierung + Branding
├── storage/        S3 WORM + MinIO-Compat
├── audit/          Append-only Audit-Trail
├── ebilanz/        HGB-Kerntaxonomie v6 XBRL-Generator
├── datev/          EXTF_Buchungsstapel-Export (Forward)
├── datev-import/   EXTF_Buchungsstapel-Import (Reverse)
├── signatur/       qeS-Signatur (P12 + signpdf + TSA)
├── konsolidierung/ Konzernabschluss (PublG §11)
├── wp/             Wirtschaftsprüfer (IDW PS 880)
├── branding/       White-Label (Logo + Brand-Color + Domain)
└── common/         Pagination + Cache + Repositories
```

### Multi-Tenant-Sicherheit

- **3 Defense-Layer**: Repository-Filter → MandantGuard → assertMandantAccess
- **SYSTEM_ADMIN** bypass für Mandant/Role-Checks (Admin-Endpoints only)
- **Audit-Trail** erfasst jede Mutation mit Vorher/Nachher-Snapshots

## 3. Pilot-Phase-2 → M4-Vorbereitung

### 3.1 Was vor M4-Start passieren muss

| Task | Owner | Frist |
|---|---|---|
| `Mandant.steuernummer` Prisma-Migration ausführen | User (DBA) | vor M4-Sprint-1 |
| DNS-Wildcard-Cert für Custom-Domains | User (DevOps) | vor M4-Sprint-2 |
| Cloud-Migration (Hetzner S3 + Multi-VM) | User + Mavis | M4-Sprint-2 |
| Redis-Cache statt In-Memory | Mavis | M4-Sprint-1 |
| Code-Signing für Release-Artefakte | Mavis | M4-Sprint-0 |
| GoBD-Zertifizierungs-Vorbereitung (externer Auditor) | User | M4-Sprint-4 |

### 3.2 Vorhandene Pilot-Kanzleien → Produktiv-Kanzleien

3 Pilot-Kanzleien werden in M4 zu zahlenden Kunden. Conversion-Pfad:
- Pilot-Phase-2 (2 Wochen gratis)
- → M3-Abschluss (kostenlos weiter)
- → M4-Sprint-3 (Subscription-Modell: Starter/Pro/Enterprise)

## 4. Bekannte Limitierungen + Workarounds

| Limitierung | Workaround | M4-Lösung |
|---|---|---|
| In-Memory Cache (kein Redis) | OK für Pilot-Skalierung | Redis-Cluster |
| Hardware-Token-Spezialitäten (PKCS#11) fehlen | DATEV-SmartCard + Kobil funktionieren via P12 | Native PKCS#11 |
| Keine echte TSA | Mock-TSA | DigiStamp-Integration |
| BAnz-Portal manueller Upload | OK, Kanzlei macht das | Vollautomatische Submission (extern) |
| PDF-Signatur nur Mock-qeS | Pilot-Kanzlei akzeptiert | Echte qeS via ID-Karte (M4) |
| DATEV-Sammelkonten manuell mappen | userMappingOverrides | KI-gestützte Auto-Mapping |
| Mobile-Responsiveness | nicht für Pilot benötigt | Tablet-Layout (M4) |

## 5. M4-Sprint-Plan-Vorschlag

### M4 Sprint 0 (Woche 40-41): Vorbereitung
- Code-Signing für Release-Artefakte
- DNS-Wildcard-Cert-Setup
- Redis-Cache-Migration
- IDW PS 880 externes Audit beauftragen

### M4 Sprint 1 (Woche 42-43): Public-API
- OAuth2-API-Keys für Kanzlei-Integrationen
- API-Versionierung + Documentation (OpenAPI 3.1)
- Rate-Limiting per API-Key
- Webhook-System für Submission-Status

### M4 Sprint 2 (Woche 44-45): Cloud-Migration
- Multi-VM-Cluster (Hetzner CCX)
- Redis-Cluster (3 Nodes)
- Load-Balancer + Auto-Scaling
- CDN für statische Assets

### M4 Sprint 3 (Woche 46-47): Subscription + White-Label-Production
- Stripe-Integration (3 Tarife)
- Custom-Domain mit DNS-Verifikation
- Echte Logo-Resize/Cropping
- Kanzlei-Statistik-Dashboard

### M4 Sprint 4 (Woche 48-49): Mobile-Responsiveness
- Tablet-Layout für Steuerberater vor Ort
- Touch-Optimierung für Bilanz-Erfassung
- Mobile Camera-Integration (Beleg-Scan)
- PWA-Modus für Offline-Caching

### M4 Sprint 5 (Woche 50-51): GoBD-Zertifizierung
- IDW PS 880 Vorbereitung
- Externe Sicherheits-Audit
- Compliance-Dokumentation
- M4-Release-Tag `m4-production-ready`

## 6. Architektur-Metriken (M3 final)

| Metrik | Wert |
|---|---|
| Backend-Module | 14 |
| Repository-Pattern-Models | 6 |
| Prisma-Models | 18 |
| Composite-Indices | 16+ |
| e2e-Tests | 100+ (über 8 Spec-Files) |
| Frontend-Components | 20+ |
| Frontend-i18n-Keys | 200+ (deutsche UI-Texte) |
| Lines-of-Code (Backend) | ~25.000 LOC |
| Lines-of-Code (Frontend) | ~6.000 LOC |
| Doku-Files | 15+ |

## 7. Was M4 NICHT macht

| Nicht in M4 | Begründung |
|---|---|
| Vollautomatische BAnz-Submission | BAnz-Verlag hat keine externe API (siehe Sprint 0 Research) |
| Mobile-Native-Apps (iOS/Android) | PWA + Tablet reicht für Pilot |
| Konzern-Abschluss mit >5 Gesellschaften | Pilot: 1 Mutter + 1 Tochter; M5: komplexere Topologien |
| Blockchain-basierte Audit-Trails | GoBD-Audit-Trail reicht |

---

## Roadmap-Stand

| Milestone | Stand | Tag |
|---|---|---|
| M1 — Pilot-Ready | ✅ | `m1-pilot-ready` |
| M2 — BAnz-Submission | ✅ | `m2-pilot-ready` |
| M3 — Kanzlei-Tier | ✅ | `m3-kanzlei-ready` (in diesem Commit) |
| M4 — Production-Tier | ⏳ | startet nach M3-Sign-off |

---

**M3-Abschlussdatum**: 2026-09-25 (Sprint 5)
**M4-Startdatum**: nach Pilot-Phase-2-Sign-off
**GoBD-Audit-Ziel**: Q4 2026
**Go-Live-Target**: Q2 2027

**Stand**: 2026-09-25 · M3 abgeschlossen · M4-Vorbereitung startet