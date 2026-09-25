# Milestone 4 — Production-Tier

> **Status**: 🚧 Sprint 0 abgeschlossen (Vorbereitung), Sprint 1–5 folgen.
> **Vision**: Production-Tier-System für Bundesanzeiger Jahresabschluss
> mit Multi-VM-Cloud-Deployment, Public-API, Subscription-Billing und
> vollständiger GoBD-Zertifizierungsreife.
>
> **Stack**: NestJS 11 + Prisma 5.22 + PostgreSQL 16 + Next.js 15 +
> Redis 7 + KeyV Cache + Cosign/Sigstore Code-Signing.
>
> **Pilot-Voraussetzung**: M3 ist Pilot-Ready (3 Kanzleien + 15 Mandanten),
> M4 hebt das System auf Production-Tier-Niveau.

---

## Roadmap-Übersicht

| Milestone | Status | Inhalt |
| --------- | ------ | ------ |
| **M1** | ✅ Pilot-Ready | Auth, RBAC, Mandant, Bilanz, GuV, Anhang, PDF, WORM, Audit-Log |
| **M2** | ✅ Pilot-Ready | E-Bilanz-XBRL, DATEV-Export, qeS-Signatur, Frontend |
| **M3** | ✅ Pilot-Ready | DATEV-Import, Konzernabschluss, Wirtschaftsprüfer, White-Label |
| **M4 Sprint 0** | ✅ Vorbereitung | Redis-Cache, Code-Signing, DNS-Wildcard-Cert-Setup |
| **M4 Sprint 1** | ⏳ geplant | Public-API (OAuth2 + OpenAPI 3.1) |
| **M4 Sprint 2** | ⏳ geplant | Cloud-Migration (Multi-VM) |
| **M4 Sprint 3** | ⏳ geplant | Subscription + White-Label-Production |
| **M4 Sprint 4** | ⏳ geplant | Mobile-Responsiveness |
| **M4 Sprint 5** | ⏳ geplant | GoBD-Zertifizierungs-Audit + M4-Release-Tag |

---

## Sprint-Plan im Detail

### Sprint 0 — Vorbereitung ✅

**Ziel**: Production-Infrastruktur vorbereiten, ohne bestehende
Funktionalität zu beeinträchtigen.

**Abgeschlossen**:
- ✅ Redis-7-Container im `docker-compose.yml` (Multi-VM-fähig)
- ✅ `CacheProvider`-Abstraktion (Strategy-Pattern)
- ✅ `CacheManagerService` mit automatischem Failover auf Memory-Fallback
- ✅ `keyv` + `@keyv/redis` + `ioredis` Dependencies
- ✅ Zero-Impact-Migration: bestehende `cache.memoize()`-Calls
  funktionieren unverändert (Backwards-Compat via DI-Alias)
- ✅ Code-Signing mit `cosign` (Image + SBOM + SLSA-Provenance)
- ✅ DNS-Wildcard-Cert-Setup-Dokumentation (Let's Encrypt DNS-01)
- ✅ 8 e2e-Tests für Cache-Provider (Memory + Redis-Fallback)

**Akzeptanzkriterien**:
- `npx tsc --noEmit` → 0 Errors
- `npx eslint src --max-warnings 0` → 0 Warnings
- `npm run build` → OK
- Cache-Tests decken Memory- + Redis-Provider ab
- Bestehende Pilot-Kanzleien funktionieren ohne Daten-Migration weiter

### Sprint 1 — Public-API ⏳

**Ziel**: Externe API für Kanzlei-Software-Integration (DATEV-Direkt-
Anbindung, ERP-Systeme, Mobile-Apps).

**Geplante Features**:
- OAuth2-Server (`/oauth/token`, `/oauth/introspect`)
- OpenAPI 3.1 Spec (automatisch generiert aus NestJS-Decorators)
- API-Versionierung: `/api/v1/...`, `/api/v2/...` (für Breaking Changes)
- Rate-Limiting pro API-Key (separate `Throttler`-Buckets)
- Webhook-System für `submission.status-changed`-Events

**Akzeptanzkriterien**:
- OpenAPI-Spec ist im Frontend-Wizard integriert
- OAuth2-Client-Credentials-Flow funktioniert
- API-Keys sind Kanzlei-scoped (Mandant-Trennung bleibt)
- Rate-Limits konfigurierbar pro Kanzlei

### Sprint 2 — Cloud-Migration ⏳

**Ziel**: Deployment auf Multi-VM-Cloud (Hetzner Cloud oder AWS).

**Geplante Features**:
- Container-Orchestrierung mit Docker Compose / Kubernetes
- Sticky-Session-freies Backend (Redis für alle State)
- PostgreSQL-Read-Replicas für Dashboard-Queries
- S3-kompatibler Storage (Hetzner S3 oder AWS S3)
- Blue-Green-Deployment via Cosign-Signaturen

**Akzeptanzkriterien**:
- 2+ Backend-VMs können parallel laufen (Round-Robin)
- Kein Single-Point-of-Failure
- Cold-Start < 30 Sekunden

### Sprint 3 — Subscription + White-Label-Production ⏳

**Ziel**: Bezahlmodell + vollständige Custom-Domain-Unterstützung.

**Geplante Features**:
- Stripe-Integration (`POST /api/v1/subscriptions`)
- Subscription-Tiers: Pilot (kostenlos), Standard, Premium
- Wildcard-Cert-Rollout (siehe `backend/docs/dns-wildcard-cert-setup.md`)
- CNAME-Setup-Wizard im Frontend (Kanzlei konfiguriert eigene Domain)
- White-Label-Backend-Branding (Logo, Farben, Domain)

**Akzeptanzkriterien**:
- Stripe-Webhooks verarbeiten Subscription-Events
- Kanzlei kann eigene Domain live schalten (mit Auto-Renewal-Cert)
- Subscription-Status steuert Feature-Flags

### Sprint 4 — Mobile-Responsiveness ⏳

**Ziel**: Frontend auf Tablet + Smartphone nutzbar.

**Geplante Features**:
- Responsive Layout (Tailwind Breakpoints)
- Touch-Optimierung für Bilanz-Eingabe (Stepper)
- Offline-Draft-Speicherung (IndexedDB)
- PWA-Installation

**Akzeptanzkriterien**:
- WCAG 2.1 AA-Konformität
- Lighthouse-Score > 90 (Mobile + Desktop)
- Bilanz-Eingabe auf Tablet < 60 Sekunden pro Position

### Sprint 5 — GoBD-Zertifizierung + M4-Release ⏳

**Ziel**: Externe GoBD-Zertifizierung + Production-Release-Tag.

**Geplante Features**:
- GoBD-Prüfbericht (externer Auditor)
- WORM-Storage-Audit (10 Jahre Retention nachgewiesen)
- Audit-Trail-Integrität (Hash-Chain)
- Backup-Strategie dokumentiert + getestet
- M4-Release-Tag `m4-production-ready`

**Akzeptanzkriterien**:
- Zertifizierungs-Audit bestanden
- Disaster-Recovery-Plan im RUNBOOK
- Tag `m4-production-ready` existiert + verifiziert

---

## Architektur-Übersicht (M4)

```
┌──────────────────┐
│  Custom-Domain   │ ← *.kanzlei-domain.de (Wildcard-Cert)
│  Kanzlei-Webseite│
└────────┬─────────┘
         │ HTTPS (Certbot/Let's Encrypt)
         ▼
┌──────────────────┐
│  NGINX (LB)      │ ← OCSP-Stapling, HSTS
└────────┬─────────┘
         │
         ▼
┌────────────────────────────────────┐
│  Backend-VM-1     Backend-VM-2 ... │ ← NestJS, Multi-VM
└──────┬──────────────────────┬──────┘
       │                      │
       ▼                      ▼
┌─────────────┐      ┌─────────────────┐
│ PostgreSQL  │      │  Redis (Cache)  │
│ (Primary +  │      │  Multi-VM-shared│
│  Replicas)  │      └─────────────────┘
└─────────────┘
       │
       ▼
┌──────────────────┐
│ S3 WORM-Storage  │ ← 10 Jahre Retention
└──────────────────┘

Externe Services:
- Stripe     (Subscription-Billing, Sprint 3)
- Bundesanzeiger-Verlag (Submission via eBilanz-Online + DATEV, nicht direkt)
- GoBD-Auditor (extern, Sprint 5)
```

---

## Public-API-Vorschau (Sprint 1)

```http
POST /oauth/token
Content-Type: application/x-www-form-urlencoded
grant_type=client_credentials&client_id=...&client_secret=...

→ { "access_token": "...", "expires_in": 3600, "token_type": "Bearer" }

GET /api/v1/mandanten
Authorization: Bearer <token>

→ { "items": [...], "nextCursor": "...", "total": 15, "hasMore": false }

GET /api/v1/bilanzen?mandantId=...&jahr=2025

POST /api/v1/banz-submissions
{ "mandantId": "...", "geschaeftsjahr": 2025 }

→ { "id": "...", "status": "QUEUED", "wormObjectKey": "..." }

Webhook: submission.status-changed
→ POST https://kanzlei-domain.de/webhook/banz
   { "submissionId": "...", "status": "PUBLISHED", "publishedAt": "..." }
```

Vollständige Spec in `docs/PUBLIC-API-DESIGN.md`.

---

## Akzeptanzkriterien pro Sprint

Jeder Sprint muss vor Merge erfüllen:
1. ✅ Alle neuen Features haben e2e-Tests
2. ✅ `npx tsc --noEmit` → 0 Errors
3. ✅ `npx eslint src --max-warnings 0` → 0 Warnings
4. ✅ `npm run build` → OK
5. ✅ Pilot-Kanzleien sind nicht beeinträchtigt (Smoke-Test grün)
6. ✅ Dokumentation im USER-GUIDE + RUNBOOK aktualisiert
7. ✅ Bei API-Änderungen: OpenAPI-Spec regeneriert
8. ✅ Bei Schema-Änderungen: Prisma-Migration idempotent

---

## Nächste Schritte (Sprint 1 Start)

1. Public-API-Spec finalisieren (siehe `docs/PUBLIC-API-DESIGN.md`)
2. OAuth2-Server-Bibliothek wählen (NestJS Passport-OAuth2 vs. custom)
3. API-Key-Management im Branding-Module integrieren
4. Webhook-Subscription-System entwerfen

---

## Referenzen

- `backend/scripts/release.sh` — Cosign-basiertes Release-Script
- `backend/scripts/verify-signature.sh` — Release-Verifikation
- `backend/docs/dns-wildcard-cert-setup.md` — Wildcard-Cert-Setup
- `docs/PUBLIC-API-DESIGN.md` — API-Architektur-Skizze
- `RUNBOOK.md` — Operational Runbook (Pilot + M4-Updates)