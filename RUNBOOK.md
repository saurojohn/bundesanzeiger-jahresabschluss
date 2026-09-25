# RUNBOOK — Bundesanzeiger Jahresabschluss

> **Zweck**: Schritt-für-Schritt-Anleitung zum Aufsetzen und Betreiben der Anwendung
> für Pilot-Kanzleien. Jeder Schritt ist reproduzierbar und idempotent.

**Zielgruppe**: DevOps-Engineer / technischer Kanzlei-Administrator

**Voraussetzungen**:
- Ubuntu 24.04 LTS (oder macOS 14+ für Dev)
- Docker Engine 24+ mit Compose V2
- 4 GB RAM, 20 GB Disk (Pilot-Mandanten-Setup)
- Domain oder Subdomain mit Let's Encrypt (für Produktion)
- BAnz-Portal-Sandbox-Account (für M2-Vorbereitung)

---

## 1. Schnellstart (Dev)

```bash
# Repository klonen
git clone <repo-url> bundesanzeiger-jahresabschluss
cd bundesanzeiger-jahresabschluss

# Environment-Variablen aus Template erstellen
cp .env.example .env
# WICHTIG: JWT_SECRET durch 256-bit-Schlüssel ersetzen:
openssl rand -hex 32
# → In .env JWT_SECRET=<wert> setzen

# Stack starten (Postgres + Redis + MinIO + Backend + Frontend)
docker compose -f infra/docker-compose.yml up -d

# Warten bis Postgres healthy
docker compose -f infra/docker-compose.yml ps postgres

# Backend: Prisma Migration + Seed
docker compose -f infra/docker-compose.yml exec backend npx prisma migrate deploy
docker compose -f infra/docker-compose.yml exec backend npm run prisma:seed

# Healthcheck
curl http://localhost:3000/api/health
curl http://localhost:3001/de-DE/login
```

**Login-URL**: http://localhost:3001/de-DE/login

**Demo-Credentials** (siehe `backend/prisma/seed.ts`):

| E-Mail | Passwort | Rolle |
|---|---|---|
| `admin@kanzlei.de` | `Admin123!` | SYSTEM_ADMIN |
| `kanzlei-admin@kanzlei.de` | `Demo123!` | KANZLEI_ADMIN |
| `steuerberater@kanzlei.de` | `Demo123!` | STEUERBERATER |
| `wp@kanzlei.de` | `Demo123!` | WIRTSCHAFTSPRUEFER |
| `gf-demo@demo-gmbh.de` | `Demo123!` | GF |

---

## 2. MinIO mit Object Lock aktivieren

**Warum**: GoBD § 147 AO verlangt 10 Jahre unveränderliche Aufbewahrung.
S3 Object Lock `COMPLIANCE` Mode ist die technische Umsetzung.

```bash
# MinIO mit Object-Lock-Support starten
docker run -d \
  --name banz-minio \
  -e MINIO_OBJECT_LOCK_ENABLED=true \
  -p 9000:9000 \
  -p 9001:9001 \
  -v minio-data:/data \
  minio/minio:latest \
  server /data --console-address ":9001"

# MinIO Console: http://localhost:9001
# Login: banz_dev_access / banz_dev_secret (aus .env.example)

# Bucket mit Object Lock anlegen
docker exec banz-minio mc alias set local http://localhost:9000 banz_dev_access banz_dev_secret
docker exec banz-minio mc mb --with-lock local/banz-jahresabschluss-worm
docker exec banz-minio mc retention set --default COMPLIANCE --duration 3650d local/banz-jahresabschluss-worm
```

**Verifizierung**: Versuche eine Datei vor Retention-Abliße zu löschen → 403 Forbidden.

---

## 3. Datenbank-Backup (Pilot)

```bash
# Vollbackup
docker compose -f infra/docker-compose.yml exec postgres pg_dump -U banz banz_jahresabschluss > /backup/banz-$(date +%Y%m%d).sql

# Wiederherstellen
cat /backup/banz-20260923.sql | docker compose -f infra/docker-compose.yml exec -T postgres psql -U banz banz_jahresabschluss
```

**Backup-Strategie**:
- Tägliches Vollbackup (cron)
- WORM-Storage-Backup separat (s3-mirror auf Hetzner Storage Box)
- 30-Tage-Aufbewahrung lokal, 10-Jahre-Aufbewahrung im WORM-Storage

---

## 4. Pilot-Kanzlei-Onboarding

### 4.1 Mandanten anlegen

Als `kanzlei-admin@kanzlei.de` einloggen → **Mandanten** → **Neuen Mandanten anlegen**.

Felder gemäß HGB-Pflichtangaben:
- **Firmenname**, **Rechtsform** (GmbH/GmbH & Co. KG/AG)
- **Handelsregister** (HRB 123456)
- **USt-IdNr.** (DE123456789)
- **Adresse**, **Gründungsdatum**
- **Bilanzsumme Vorjahr** (€) → Größenklasse wird automatisch berechnet
- **Umsatz Vorjahr** (€) → Größenklasse-Bestätigung
- **Mitarbeiteranzahl**
- **Veröffentlichungskanal** (PDF_DIRECT für Kleinst, XML_XBRL für mittlere, EBILANZ_TAXONOMIE für Groß/Konzern)

### 4.2 User anlegen

Als `kanzlei-admin@kanzlei.de` einloggen → **Benutzer** → **Neuen Benutzer anlegen**.

E-Mail-Invite wird versendet. User klickt auf Link → setzt Passwort → TOTP-Setup (für STEUERBERATER/WP/KANZLEI_ADMIN Pflicht, für GF optional).

### 4.3 Rollen zuweisen

Pro Mandant eine Rolle zuweisen:
- **GF**: nur eigener Mandant
- **STEUERBERATER**: alle Mandanten der Kanzlei (typisch)
- **WIRTSCHAFTSPRUEFER**: bei Bedarf pro Mandant
- **KANZLEI_ADMIN**: alle Mandanten der Kanzlei

### 4.4 Erste Bilanz erfassen

Als `steuerberater@kanzlei.de` einloggen → Mandant wählen → **Bilanz** → **Neue Bilanz erstellen**.

1. Geschäftsjahr eingeben (z. B. 2025)
2. Aktiva-Positionen aus HGB-Schema befüllen
3. Passiva-Positionen aus HGB-Schema befüllen
4. Live-Saldo prüfen (grüner Indikator = saldostimmend)
5. Speichern

### 4.5 GuV erfassen

→ **GuV** → **Neue GuV erstellen** → GKV oder UKV wählen → Positionen befüllen → Live-Ergebnis prüfen.

### 4.6 Anhang erfassen

→ **Anhang** → **Neuen Anhang erstellen** → 5 §284-Standardabschnitte befüllen.

### 4.7 PDF generieren + WORM-archivieren

→ **Bilanz** (oder GuV/Anhang) → **PDF erzeugen** → PDF wird in WORM-Storage abgelegt.

Hinweis-Badge "WORM-archiviert (10 Jahre, § 147 AO)" erscheint.

### 4.8 Audit-Trail prüfen

→ **Audit-Log** → Filter setzen (Action: GENERATE_PDF, Mandant: ...) → alle Mutationen nachvollziehbar.

---

## 5. Häufige Probleme

### 5.1 "JWT signature does not match"

**Ursache**: JWT_SECRET in `.env` geändert nach Token-Ausstellung.
**Lösung**: Alle User müssen sich neu einloggen.

### 5.2 "WORM bucket not found"

**Ursache**: MinIO wurde ohne `--with-lock` geflag oder `S3_BUCKET` in `.env` stimmt nicht.
**Lösung**: MinIO neu starten mit Object-Lock-Support (siehe Abschnitt 2).

### 5.3 "Cross-Mandant-Zugriff verweigert"

**Ursache**: GF eines Mandanten versucht anderen Mandanten zu lesen.
**Erwartetes Verhalten**: 403 Forbidden + AuditLog-Eintrag.
**Lösung**: User hat die falsche Rolle. Kanzlei-Admin muss Rolle zuweisen.

### 5.4 PDF wird nicht generiert

**Ursache**: MinIO nicht erreichbar oder Bilanz unsaldostimmend.
**Diagnose**:
```bash
docker compose -f infra/docker-compose.yml logs backend | grep -i "worm\|pdf\|s3"
```

### 5.5 "Prisma migration failed"

**Ursache**: Schema-Drift zwischen DB und Code.
**Lösung**:
```bash
# Im Backend-Container:
npx prisma migrate deploy
# Bei Schema-Drift: prisma migrate dev mit manueller Auflösung
```

---

## 6. Monitoring (Pilot)

### 6.1 Health-Endpoints

```bash
# Backend Liveness
curl http://localhost:3000/health

# Backend Readiness (DB+Redis erreichbar?)
curl http://localhost:3000/health/ready

# Postgres Health
docker compose -f infra/docker-compose.yml exec postgres pg_isready -U banz

# MinIO Health
curl -f http://localhost:9000/minio/health/live

# Redis Health
docker compose -f infra/docker-compose.yml exec redis redis-cli ping
```

### 6.2 Log-Aggregation

Pilot: stdout + Docker-Logs sammeln via `docker compose logs -f --tail 100`.

Produktion (M2): Loki + Grafana oder Hetzner Cloud Logging.

### 6.3 Audit-Trail-Export

Für IDW-PS-880-Prüfung:
```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/api/audit?mandantId=$MANDANT_ID&from=2026-01-01&to=2026-12-31&pageSize=500" \
  | jq '.items[]' > audit-2026.json
```

---

## 7. Notfall-Wiederherstellung

### 7.1 Komplett-Verlust

1. Hetzner Storage Box neuestes Backup einspielen
2. `docker compose up -d`
3. `npx prisma migrate deploy`
4. `npm run prisma:seed` (nur wenn Pilot-Daten weg)
5. WORM-Storage: S3-Backup wiederherstellen

**RTO**: 2 Stunden (mit Backup)
**RPO**: 24 Stunden (tägliches Backup)

### 7.2 Versehentliche Löschung in DB

**Wichtig**: Bilanz/GuV/Anhang haben keinen Hard-Delete im aktuellen Sprint (nur `status = 'ARCHIVED'`).
WORM-Objekte sind Object-Locked → können nicht gelöscht werden.

---

## 8. Upgrade auf M2

Wenn M1-Pilot abgeschlossen ist:

```bash
# Neue Features (BAnz XML/XBRL):
- POST /api/banz/submission/prepare (XML/XBRL Generierung)
- POST /api/banz/submission/submit (BAnz-Portal-Submission)
- GET /api/banz/submission/:id/status
- POST /api/banz/submission/:id/sign (qualifizierte Signatur)

# Breaking Changes:
- KEINE (alle M1-Endpoints bleiben stabil)

# Neue Env-Variablen:
BUNDESANZEIGER_PORTAL_BASE_URL=https://www.bundesanzeiger.de
BUNDESANZEIGER_PORTAL_USER=...
BUNDESANZEIGER_PORTAL_PWD=...
SIGN_P12_PATH=/secure/path/to/token.p12
SIGN_P12_PWD=...
```

---

## 9. Support-Kontakt

**Pilot-Kanzlei-Support**:
- E-Mail: support@banz-jahresabschluss.example
- Tel: +49 (xxx) xxxxxxx
- Mo-Fr 9:00-17:00 CET

**Dringend (Sicherheit)**:
- security@banz-jahresabschluss.example (PGP-Key auf Anfrage)

---

## 10. Anhang: Versionen

| Komponente | Version |
|---|---|
| Node.js | 22-bookworm-slim |
| NestJS | 11.x |
| Prisma | 5.22.0 |
| PostgreSQL | 16-alpine |
| Redis | 7-alpine |
| MinIO | latest (mit Object-Lock-Support) |
| Next.js | 15.0.3 |
| React | 19.0.0-rc |
| PDFKit | 0.15.x |

---

**Letzte Aktualisierung**: 2026-09-25 (M4 Sprint 2 hinzugefügt)
**Reviewer**: DevOps + Pilot-Kanzlei
**Nächste Review**: Nach M4-Pilot-Abschluss (geplant Sprint 5)

---

## 8. M4 Sprint 2 — Hetzner Multi-VM Production-Deployment

> Production-Setup auf Hetzner Cloud mit 2 App-VMs (Blue/Green) + DB-VM
> (Postgres Primary+Replica, Redis, MinIO). NGINX als Reverse-Proxy mit
> atomarem Blue-Green-Switch nach Cosign-Signatur-Verifikation.

### 8.1 Erstmaliges Provisioning

Siehe vollständige Schritt-für-Schritt-Anleitung in
[`infra/hetzner/README.md`](infra/hetzner/README.md).

Kurzfassung:

```bash
# 1. Hetzner Cloud Console: Projekt + SSH-Key + 3 VMs erstellen
# 2. Cloud-init läuft automatisch (Docker + cosign + SSH-Hardening)
# 3. Auf banz-db: PostgreSQL-Replication initialisieren
ssh root@<db-ip>
cd /opt/bundesanzeiger-jahresabschluss
bash infra/hetzner/postgres-replica-init.sh

# 4. Auf beiden App-VMs: Production-Stack starten
ssh root@<app-1-ip>
cd /opt/bundesanzeiger-jahresabschluss
docker compose -f infra/docker-compose.prod.yml --env-file .env.prod up -d

# 5. Smoke-Test
bash infra/scripts/smoke-test.sh https://banz.example.com
```

### 8.2 Blue-Green-Deployment (Zero-Downtime)

```bash
# Auf einem der App-Hosts (oder Deploy-Jump-Host)
ssh deploy@<app-1-ip>

# 1. Neues Image pullen + Green-Pool updaten
docker compose -f infra/docker-compose.prod.yml pull backend-green
docker compose -f infra/docker-compose.prod.yml up -d backend-green

# 2. Auf Green umschalten (mit Cosign-Verifikation + Health-Check)
sudo bash infra/nginx/blue-green-switch.sh green v1.2.0
# → Verifiziert cosign signatur → prüft /health/ready → NGINX-Reload

# 3. Bei Problemen: Rollback zu Blue
sudo bash infra/nginx/blue-green-switch.sh blue
```

### 8.3 Read-Replica aktivieren

Zero-Impact: `.env.prod` ergänzen, Service neu starten.

```bash
# .env.prod editieren:
DATABASE_READ_REPLICA_URL=postgresql://banz:...@postgres-replica:5432/banz_jahresabschluss?schema=public
DATABASE_POOL_MAX_REPLICA=30

# Backend neu starten
docker compose -f infra/docker-compose.prod.yml restart backend-blue backend-green

# Verifizieren: Replica-Status sichtbar in /health/ready
curl https://banz.example.com/health/ready | jq '.checks'
# → { "primary": "up", "replica": "up" }
```

Wenn `DATABASE_READ_REPLICA_URL` LEER ist, verhält sich der Service
exakt wie vor Sprint 2 — alle Queries gehen auf Primary.

### 8.4 Disaster Recovery

| Szenario | Wiederherstellung | RTO |
|---|---|---|
| App-VM ausgefallen | Hetzner: neue VM aus Snapshot | 10 Min |
| DB-VM Primary ausgefallen | Replica promoten (`pg_promote()`), `.env.prod` updaten | 30 Min |
| Komplett-Verlust | Hetzner Snapshot einspielen + Cloud-init neu | 2h |
| Versehentlicher Code-Deploy | `blue-green-switch.sh blue` (Rollback) | 1 Min |

### 8.5 Monitoring & Alerts

Externe Uptime-Monitoring-Tools (UptimeRobot, Betterstack, etc.) sollten
folgende Endpoints prüfen:

- `https://green.example.com/health` — alle 30s
- `https://green.example.com/health/ready` — alle 60s
- `https://green.example.com/api/docs` — alle 5 Min

Alerts bei:
- HTTP 5xx > 0 in 5 Min
- /health/ready status != "ok"
- Cert-Ablauf < 14 Tage (UptimeRobot prüft automatisch)

### 8.6 Bekannte Limitierungen

- **Single-Region** (nbg1): kein geo-redundantes Setup
- **Manuelle Replica-Promotion**: Phase 3+ plant `repmgr`/`Patroni` für Auto-Failover
- **Keine CDN-Integration**: Phase 4+ plant Cloudflare vor NGINX
- **Cosign-Verifikation per Key** (statt Keyless/OIDC): Phase 3+ plant OIDC-Signing mit GitHub-Actions

### 8.7 Kosten-Übersicht

~€36/Monat (siehe `infra/hetzner/README.md` § Kosten-Übersicht).
Skaliert horizontal mit `BACKEND_REPLICA_COUNT` ohne zusätzliche Kosten
für die App-VMs selbst (nur Docker-Ressourcen).