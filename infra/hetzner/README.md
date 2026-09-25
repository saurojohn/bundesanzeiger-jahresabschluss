# Hetzner Cloud Provisioning (M4 Sprint 2)

> **Zweck**: Schritt-für-Schritt-Anleitung zur Bereitstellung der
> Bundesanzeiger-Jahresabschluss-Production-Infrastruktur auf Hetzner Cloud.

## Voraussetzungen

- Hetzner Cloud Console Account mit aktiver Zahlungsmethode
- Lokaler `hcloud` CLI (oder Hetzner Cloud Console Web-UI)
- Eigene Domain (`banz.example.com`) mit DNS-Editor-Zugriff
- Let's-Encrypt-fähige DNS-API (Hetzner DNS, Cloudflare, deSEC, etc.) für Wildcard-Cert
- SSH-Key-Pair (`ssh-keygen -t ed25519 -C "banz-deploy"`)

## Architektur-Übersicht

```
┌─────────────────────────────────────────────────────────────┐
│  Internet (HTTPS, Port 443)                                 │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
        ┌───────────────────────────────────┐
        │  Hetzner Cloud Load Balancer      │  ← LB11 (€5/Monat)
        │  TLS-Termination, ACME            │
        └────────────┬──────────────────────┘
                     │
        ┌────────────┴────────────┐
        ▼                         ▼
  ┌──────────────┐         ┌──────────────┐
  │ banz-app-1   │         │ banz-app-2   │  ← CX22 (je €5/Monat)
  │ (Blue)       │         │ (Green)      │     NGINX + Backend-Docker
  │ NGINX :443   │         │ NGINX :443   │
  │ Backend:3000 │         │ Backend:3000 │
  └──────┬───────┘         └──────┬───────┘
         │                        │
         └────────┬───────────────┘
                  │
                  ▼
        ┌───────────────────────────────────┐
        │  banz-db                          │  ← CX31 (€15/Monat)
        │  postgres-primary (Daten)         │     100GB Volume
        │  postgres-replica (Read-Routing)  │
        │  redis                            │
        │  minio (S3-WORM)                  │
        └───────────────────────────────────┘

Gesamtkosten: ~€35/Monat (Pilot-Phase-2)
```

## Provisioning-Schritte

### 1. Hetzner Cloud Projekt erstellen

```bash
# Hetzner Cloud Console → New Project
# Name: "Bundesanzeiger Jahresabschluss"
# API-Token generieren → export HETZNER_TOKEN=...
export HETZNER_TOKEN="<your-token>"

# Projekt-ID ermitteln
hcloud project list
```

### 2. SSH-Key hochladen

```bash
hcloud ssh-key create --name banz-deploy --public-key-from-file ~/.ssh/banz-deploy.pub
```

### 3. VMs erstellen

```bash
# App-VMs (Blue/Green identisch konfiguriert)
hcloud server create \
  --name banz-app-1 \
  --type cx22 \
  --image ubuntu-24.04 \
  --location nbg1 \
  --ssh-key banz-deploy \
  --user-data-from-file infra/hetzner/cloud-init.yml

hcloud server create \
  --name banz-app-2 \
  --type cx22 \
  --image ubuntu-24.04 \
  --location nbg1 \
  --ssh-key banz-deploy \
  --user-data-from-file infra/hetzner/cloud-init.yml

# DB-VM
hcloud server create \
  --name banz-db \
  --type cx31 \
  --image ubuntu-24.04 \
  --location nbg1 \
  --ssh-key banz-deploy \
  --user-data-from-file infra/hetzner/cloud-init.yml \
  --volume banz-db-data:100
```

### 4. DNS konfigurieren

```
# A-Records (App-IPs):
banz.example.com       → <app-1-ip>
*.banz.example.com     → <app-1-ip>

# Optional: Round-Robin via zweitem A-Record
banz.example.com       → <app-2-ip>
*.banz.example.com     → <app-2-ip>

# Hetzner Load Balancer (empfohlen):
lb.banz.example.com    → <lb-ip>
banz.example.com       → CNAME lb.banz.example.com
*.banz.example.com     → CNAME lb.banz.example.com
```

### 5. Cloud-init abgeschlossen? SSH zu jeder VM

```bash
ssh root@<app-1-ip>
# Cloud-init-Logs prüfen
cloud-init status --wait
# Docker muss installiert sein
docker --version   # → Docker version 24.x
cosign version     # → cosign v2.x
```

### 6. Code deployen

```bash
# Auf jeder App-VM
ssh root@<app-1-ip>
git clone https://github.com/shledergmbh/bundesanzeiger-jahresabschluss.git
cd bundesanzeiger-jahresabschluss
cp infra/hetzner/.env.prod.example .env.prod
# .env.prod mit echten Secrets füllen (JWT_SECRET, S3_ACCESS_KEY, ...)
```

### 7. PostgreSQL-Replication einrichten (einmalig)

```bash
# Auf banz-db
cd bundesanzeiger-jahresabschluss
bash infra/hetzner/postgres-replica-init.sh
```

### 8. Backend starten

```bash
# Auf banz-app-1 UND banz-app-2 (identisch)
cd /opt/bundesanzeiger-jahresabschluss
docker compose -f infra/docker-compose.prod.yml --env-file .env.prod up -d
```

### 9. NGINX einrichten (Phase C)

```bash
# NGINX-Config wird per Volume-Mount eingebunden
# Siehe infra/nginx/nginx.conf + infra/nginx/blue-green-switch.sh
```

### 10. Let's Encrypt Wildcard-Cert

Siehe `backend/docs/dns-wildcard-cert-setup.md` für DNS-01-Challenge-Setup.

```bash
# Auf App-VM
certbot certonly --dns-hetzner \
  --dns-hetzner-credentials ~/.secrets/hetzner.ini \
  -d banz.example.com \
  -d "*.banz.example.com" \
  --agree-tos -m ops@banz.example.com
```

### 11. Smoke-Test (Phase D)

```bash
# Auf Deploy-Maschine
bash infra/scripts/smoke-test.sh https://banz.example.com
```

## Backup-Strategie

| Daten | Methode | Retention |
|---|---|---|
| PostgreSQL Primary | Hetzner Volume-Snapshots täglich 03:00 UTC | 30 Tage |
| PostgreSQL Replica | Read-only, keine Backups nötig | — |
| Redis (Session-State) | Persistente Append-Only-File + täglich Snapshot | 7 Tage |
| MinIO WORM | S3-Object-Lock COMPLIANCE-Mode | **10 Jahre** (GoBD §147 AO) |
| Audit-Log | PostgreSQL + Append-only via Trigger | 10 Jahre |

Hetzner Snapshots werden via `hcloud snapshot create --volume <id>` ausgelöst.
Automatisierung via Cron auf der DB-VM:

```cron
# /etc/cron.d/banz-backup
0 3 * * * deploy /opt/banz/scripts/hetzner-snapshot.sh >> /var/log/banz-backup.log 2>&1
```

## Kosten-Übersicht

| Komponente | Stück | €/Monat |
|---|---|---|
| banz-app-1 (CX22) | 2 | 5.39 |
| banz-app-2 (CX22) | 2 | 5.39 |
| banz-db (CX31) | 1 | 14.69 |
| banz-db-data (100GB Volume) | 1 | 5.00 |
| Load Balancer LB11 | 1 | 5.00 |
| Snapshots (1TB/mo) | ca. | 1.00 |
| Traffic (5TB inkl.) | — | 0.00 |
| **Gesamt** | | **~€36/Monat** |

## Skalierung

- **Horizontal**: `BACKEND_REPLICA_COUNT` in `.env.prod` erhöhen + Compose neu starten
- **Vertikal**: VM-Typ hochstufen via `hcloud server change-type` (kein Downtime via Live-Migration)
- **Read-Traffic**: zusätzliche `postgres-replica`-Instanzen via `docker compose up --scale postgres-replica=N`

## Wartung

- **OS-Updates**: `unattended-upgrades` aktiv (siehe Cloud-init)
- **Docker-Updates**: manuell via `apt-get install docker-ce` (1× pro Quartal)
- **Cosign-Updates**: manuell, Binary-Download (Phase D-Check)
- **DB-Migrations**: `docker exec banz-backend-blue npx prisma migrate deploy`

## Disaster Recovery

Bei Komplett-Ausfall einer App-VM:
1. Hetzner Cloud Console → neue VM erstellen mit gleichem Cloud-init
2. Code + .env.prod syncen
3. `docker compose up -d` starten
4. NGINX-Health-Check schaltet automatisch wieder zu (Phase C)

Bei DB-Ausfall:
1. Snapshot der Primary-Volume → neue VM erstellen
2. Replica promoted als neue Primary (manuell: `pg_promote()`)
3. App-VM .env.prod → `DATABASE_URL` und `DATABASE_READ_REPLICA_URL` aktualisieren

## Bekannte Limitierungen

- **Single-Region** (nbg1): kein geo-redundantes Setup. Für Geo-Redundanz fsn1 hinzufügen.
- **Keine automatische Replica-Promotion**: Bei Primary-Ausfall muss manuell promotet werden.
  Phase 3+ Todo: `repmgr` oder `Patroni` für automatisches Failover.
- **Keine CDN-Integration**: Statische Frontend-Assets werden direkt vom Next.js-Server ausgeliefert.
  Phase 4+ Todo: Cloudflare-CDN davor schalten.