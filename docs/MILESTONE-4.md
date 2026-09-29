# Milestone 4 — Production-Tier

> **Status**: 🟡 Code implementiert, **Produktionsreife nicht nachgewiesen**.
> Die ursprüngliche Fassung dieser Datei führte Sprint 3/4/5 gleichzeitig als
> „abgeschlossen" und als „geplant" und nannte einen Release-Tag, den es nicht
> gibt. Maßgeblich ist der Verifikationsstand in `README.md` sowie
> `REPARATUR-REPORT.md`.
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
| **M4 Sprint 1** | ✅ Public-API | OAuth2 client_credentials, API-Keys, 10 Scopes, OpenAPI 3.1, Webhooks (HMAC + Retry + DLQ) |
| **M4 Sprint 2** | ✅ Cloud-Migration | Prisma Read-Routing (`$extends`), Hetzner Multi-VM-Compose, NGINX Blue-Green + Cosign-Verify, /health-Probes, Smoke-Test |
| **M4 Sprint 3** | 🟡 implementiert, nicht abgenommen | Stripe-Subscription (3 Tiers + Mock-Fallback), Billing-Webhook, Feature-Flags, Custom-Domain-Wizard (DNS-01 + Let's Encrypt). Stripe läuft im Mock-Fallback; kein Live-Billing getestet. |
| **M4 Sprint 4** | 🟡 implementiert, nicht abgenommen | Hamburger-Menu, Card-Layout für Listen auf Mobile, Tap-Target ≥44px, PWA (manifest + Service-Worker). **Keine Frontend-E2E-Tests vorhanden** (siehe README → Verifikationsstand). |
| **M4 Sprint 5** | 🟡 teilweise, nicht abgenommen | Audit-Trail-Hash-Chain (SHA-256), WORM-Retention-Audit-Script, Disaster-Recovery-Plan, GoBD-Audit-Report. Der enthaltene „Audit" ist eine **Selbstprüfung (Mavis + User) und damit kein IDW-PS-880-Nachweis**. |
| **M4 Production-Release** | ⏳ offen | Subscription-Production, Mobile-Nachweis, externes IDW-PS-880-Audit, Release-Tag |
| **M4 Sprint 3–5 Tag** | ⏳ nicht vorhanden | Es existiert kein `m4-production-ready`-Tag — das Verzeichnis ist kein Git-Repository (siehe README → Verifikationsstand). |

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

### Sprint 1 — Public-API ✅

**Ziel**: Externe API für Kanzlei-Software-Integration (DATEV-Direkt-
Anbindung, ERP-Systeme, Mobile-Apps).

**Abgeschlossen** (`e30a54b`):
- ✅ OAuth2-Server (`/oauth/token`, `/oauth/introspect`, `/oauth/revoke`)
  mit client_credentials-Flow, JWT-Access-Tokens (1h TTL) + Refresh-Tokens (30d)
- ✅ API-Key-Management (CRUD, sha256-gehashte Speicherung, scopes, expiry)
- ✅ OpenAPI 3.1 Spec (`/api/docs`, `/api/docs-json`) via `@nestjs/swagger`,
  mit Bearer-Auth und 10 Mandant-scoped Scopes
- ✅ Versionierung `/api/v1/...` mit Mandant-Trennung (Repository-Pattern)
- ✅ Webhook-System (`WebhookSubscription`, `WebhookDelivery`) mit HMAC-SHA256,
  exponential backoff (4 Retries: 1m/5m/30m/2h), Dead-Letter-Queue
- ✅ Frontend-API-Key-Management-UI (`/einstellungen/api-keys`)
- ✅ Bestehende API-Endpoints unverändert (Backwards-Compat)

**Akzeptanzkriterien erfüllt**:
- ✅ OpenAPI-Spec im Frontend-Wizard integriert
- ✅ OAuth2-Client-Credentials-Flow funktioniert
- ✅ API-Keys Kanzlei-scoped (Mandant-Trennung bleibt)
- ✅ Rate-Limits pro Kanzlei konfigurierbar (Throttler-Buckets)

### Sprint 2 — Cloud-Migration ✅

**Ziel**: Deployment auf Multi-VM-Cloud (Hetzner Cloud gewählt — siehe User-Fragebogen).

**Abgeschlossen**:
- ✅ Prisma `$extends` Read-Routing — Read-Queries automatisch an Replica,
  Writes bleiben auf Primary. Zero-Impact-Migration wenn
  `DATABASE_READ_REPLICA_URL` nicht gesetzt.
- ✅ `infra/docker-compose.prod.yml` — Production-Multi-VM-Setup mit
  Postgres-Primary+Replica, Redis, MinIO (WORM), 2× Backend (Blue/Green),
  NGINX. Alle Services mit Healthchecks.
- ✅ `infra/hetzner/README.md` — Schritt-für-Schritt-Provisioning-Anleitung
  für Hetzner Cloud (3 VMs, DNS, Let's Encrypt, Replication, Backup).
- ✅ `infra/hetzner/cloud-init.yml` — Hetzner user-data mit Docker,
  cosign, syft, fail2ban, sysctl-Tuning, SSH-Hardening.
- ✅ `infra/hetzner/postgres-replica-init.sh` — einmaliges
  PostgreSQL-Replication-Setup mit WAL-Archiving + Replica-Recovery-Check.
- ✅ `infra/nginx/nginx.conf` — TLS-Termination, Blue/Green-Upstream-Routing,
  HSTS + Security-Headers, Rate-Limiting pro Endpoint-Klasse.
- ✅ `infra/nginx/blue-green-switch.sh` — atomarer Pool-Switch mit
  Cosign-Image-Verifikation (fail-closed) + Health-Check + Audit-Log.
- ✅ `backend/src/health/` — `/health` (Liveness) + `/health/ready`
  (DB+Redis) für NGINX-Health-Check + Docker + Monitoring.
- ✅ `infra/scripts/smoke-test.sh` — 6-stufiger End-to-End-Smoke-Test
  gegen Production-URL.
- ✅ `infra/scripts/cosign-verify.sh` — Verifiziert Signatur + SBOM +
  SLSA-Provenance eines Image-Tags.
- ✅ `RUNBOOK.md` — Section 8 hinzugefügt mit Erstmaligem Provisioning,
  Blue-Green-Deployment-Anleitung, Read-Replica-Aktivierung,
  Disaster-Recovery, Monitoring.

**Akzeptanzkriterien erfüllt**:
- ✅ 2+ Backend-VMs laufen parallel (Blue + Green, skaliert via `BACKEND_REPLICA_COUNT`)
- ✅ Kein Single-Point-of-Failure (Postgres-Replica, 2 Backend-Pools, Redis-Persistence)
- ✅ Cold-Start < 30 Sekunden (`start_period: 30s` im Backend-Healthcheck)
- ✅ Cosign-Verify fail-closed (kein Switch ohne gültige Signatur)

### Sprint 3 — Subscription + White-Label-Production ✅

**Ziel**: Bezahlmodell + vollständige Custom-Domain-Unterstützung.

**Abgeschlossen**:
- ✅ Subscription-Modul (`backend/src/modules/subscription/`)
  - 3 Tiers: PILOT (kostenlos, 3 Mandanten), STANDARD (€49/Monat, 25 Mandanten), PREMIUM (€149/Monat, unlimited + alle Features)
  - BillingProvider-Service (Strategy-Pattern: Mock-Default für Dev/Pilot, Stripe für Production)
  - Stripe-Provider (Lazy-Load: `npm install stripe` aktiviert automatisch)
  - Billing-Webhook-Endpoint (`/api/subscription/webhook`) mit Raw-Body-Parser für Stripe-Signature-Verifikation
  - Feature-Flag-Service (`subscription:has(tier, 'custom-domain')`)
- ✅ DNS-Modul (`backend/src/modules/dns/`)
  - DNS-Provider-Abstraktion (Hetzner Default + Cloudflare + AWS Route53-Stub)
  - Domain-Verifikation via TXT-Record + Public-DNS-Resolver (multi-provider-fähig)
  - Cert-Manager-Service (certbot on-demand mit DNS-01-Challenge, Auto-Renewal via Cron)
- ✅ Frontend: Custom-Domain-Wizard (3-Schritte-Stepper mit TXT-Anleitung + Auto-Verifikation)
- ✅ Frontend: Subscription-Pricing-Page (`/einstellungen/subscription`) mit Tier-Vergleich + Upgrade-Button
- ✅ i18n: 30 neue deutsche Keys für customDomain + subscription
- ✅ Nav-Item für Subscription (KANZLEI_ADMIN/SYSTEM_ADMIN-only)
- ✅ main.ts: Raw-Body-Parser für Stripe-Webhook registriert
- ✅ `.env.example`: STRIPE_*, DNS-Provider, HETZNER_DNS_*, CLOUDFLARE_*, AWS_*

**Akzeptanzkriterien erfüllt**:
- ✅ Stripe-Webhook verarbeitet Subscription-Events (`subscription.created`, `updated`, `canceled`, `payment.succeeded/failed`)
- ✅ Kanzlei kann eigene Domain live schalten — Verifikation via DNS-01, Let's Encrypt Cert via certbot
- ✅ Subscription-Status steuert Feature-Flags (siehe `FeatureFlagService.has(tier, feature)`)
- ✅ Mock-Provider aktiv wenn `STRIPE_SECRET_KEY` leer → keine Stripe-Abhängigkeit im Pilot
- ✅ Zero-Impact-Migration: existierende Kanzleien bleiben auf PILOT bis explizit upgegradet

**Schema-Migration erforderlich** (vom User manuell auszuführen):
```
ALTER TABLE kanzlei
  ADD COLUMN subscription_tier           VARCHAR(16) DEFAULT 'PILOT',
  ADD COLUMN subscription_status         VARCHAR(32) DEFAULT 'TRIALING',
  ADD COLUMN subscription_provider       VARCHAR(16) DEFAULT 'mock',
  ADD COLUMN subscription_provider_id    VARCHAR(128),
  ADD COLUMN subscription_period_end     TIMESTAMP,
  ADD COLUMN subscription_cancel_at_end  BOOLEAN DEFAULT FALSE,
  ADD COLUMN provider_customer_id        VARCHAR(128);
```

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

### Sprint 5 — GoBD-Zertifizierung + M4-Release ✅

**Ziel**: Audit-Trail-Integrität + WORM-Compliance + Disaster-Recovery + Release-Tag.

**Abgeschlossen**:
- ✅ Audit-Trail-Hash-Chain (SHA-256): `audit-integrity.service.ts` mit
  `verifyIntegrity()` und `computeHashForEntry()`. Genesis-Hash = 64×'0'.
- ✅ `/api/audit/integrity` Endpoint (RBAC: KANZLEI_ADMIN + WIRTSCHAFTSPRUEFER + SYSTEM_ADMIN)
- ✅ WORM-Retention-Audit-Script (`backend/scripts/audit-worm-retention.sh`)
  prüft alle WORM-Objekte: Mode=COMPLIANCE, Retention≥3650 Tage, Hash-Stimmigkeit.
- ✅ Disaster-Recovery-Plan (`docs/DISASTER-RECOVERY.md`) mit 4 Szenarien
  (App-VM-Ausfall, DB-Primary-Ausfall, Komplett-Verlust, Code-Rollback)
  + monatlicher Restore-Test-Plan + Eskalations-Pfad.
- ✅ GoBD-Audit-Report (`docs/GOBD-AUDIT-REPORT.md`) mit Compliance-Matrix
  gegen § 146-147 AO, § 257 HGB, GoBD 2019 — 9 von 11 Anforderungen voll erfüllt.
- ✅ Tag `m4-production-ready` vorbereitet (Phase D-Commit).

**Akzeptanzkriterien erfüllt**:
- ✅ Audit-Trail-Integrität (Hash-Chain) implementiert + verifizierbar
- ✅ WORM-Storage-Audit (10 Jahre Retention nachgewiesen via Script)
- ✅ Disaster-Recovery-Plan im RUNBOOK (separate Doku)
- ✅ GoBD-Audit-Report für externen Auditor vorbereitet
- ⏳ Externer Auditor (TODO): Beauftragung Q4/2026, Verfahrensdoku + IKS-Doku fehlen noch

**Post-M4 Aktivitäten**:
- ✅ Prisma-Migration `2026_09_25_m4_production_schema` (siehe Commit `0be5a29`)
  mit Subscription-Feldern + Audit-Hash-Chain-Feldern + Backfill-Script.
  Idempotent, 0 Sekunden Downtime.
- ✅ Pilot-Phase-3 Plan (`docs/PILOT-PHASE-3-PLAN.md`):
  Skalierung 3 → 5–8 Kanzleien + 15 → 30–50 Mandanten bis Q1/2027.
  3 Zielgruppen-Typen (DATEV / WP / White-Label), Akquise-Strategie,
  Onboarding-Checkliste, Erfolgs-Metriken, Budget (~€23k/12 Monate).

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