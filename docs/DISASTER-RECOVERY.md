# Disaster-Recovery-Plan (M4 Sprint 5)

> **Zweck**: Definierte Recovery-Prozeduren für alle kritischen
> Failure-Szenarien. GoBD §147 AO verlangt nachweisbare Recovery-Fähigkeit
> für 10 Jahre archivierte Daten.

**Letzte Aktualisierung**: 2026-09-25 (M4 Sprint 5)
**Owner**: DevOps + Steuerberater (Compliance-Beauftragter)
**Nächste Review**: nach M4-Production-Audit (externer GoBD-Auditor)

---

## 1. Übersicht — Was wird gesichert?

| Daten | Speicherort | Backup-Strategie | Retention | RPO | RTO |
|---|---|---|---|---|---|
| PostgreSQL Primary | Hetzner CX31 + Volume | Hetzner Volume-Snapshot täglich 03:00 UTC | 30 Tage Snapshots, 10 Jahre für Jahresabschlüsse | 24h | 1h |
| PostgreSQL Replica | Live-Replication (WAL) | Read-only, kein Backup nötig | 10 Jahre | ~0s | 30min (Promotion) |
| Redis (Sessions/Cache) | Hetzner CX31 Volume | AOF-Persistence + täglich Snapshot | 7 Tage | 24h | 1h |
| MinIO (WORM-Object-Storage) | Hetzner Volume | Cross-Region-Replikation (geplant Sprint 5+) | 10 Jahre (COMPLIANCE-Mode) | 24h | 2h |
| Audit-Log | PostgreSQL Tabelle + S3-WORM | Append-only, keine separate Backup nötig | 10 Jahre | 0 | 0 |
| Application-Code | GitHub (Tag-m4-production-ready) | Git ist Backup | unbegrenzt | 0 | 5min (git clone) |
| Secrets | Hetzner Cloud-Secrets + Vault | 3-2-1 Backup-Strategie | unbegrenzt | 0 | 30min |

**RPO** = Recovery Point Objective (maximaler Datenverlust)
**RTO** = Recovery Time Objective (maximale Ausfallzeit)

---

## 2. Backup-Strategie im Detail

### 2.1 PostgreSQL Primary (Production-DB)

**Tägliche Snapshots via Hetzner Cloud Console / API:**

```bash
# Snapshot erstellen
hcloud snapshot create --volume <volume-id> --description "banz-db-daily-$(date +%Y%m%d)"

# Snapshot-Liste (für Retention-Management)
hcloud snapshot list | grep banz-db-daily | sort

# Alte Snapshots löschen (>30 Tage)
SNAPSHOTS_OLD=$(hcloud snapshot list -o json | jq -r '.[] | select(.description | startswith("banz-db-daily")) | select(.created | . < (now - 30*86400 | todate)) | .id')
for s in $SNAPSHOTS_OLD; do
  hcloud snapshot delete $s
done
```

**Cronjob auf DB-VM** (`/etc/cron.d/banz-backup`):
```cron
# Tägliches PostgreSQL-Snapshot + Aufbewahrung 30 Tage
0 3 * * * deploy /opt/banz/scripts/db-snapshot.sh >> /var/log/banz-backup.log 2>&0

# Wöchentlicher WAL-Archive-Backup nach S3 (Point-in-Time-Recovery)
0 4 * * 0 deploy /opt/banz/scripts/wal-archive.sh >> /var/log/banz-wal.log 2>&0
```

### 2.2 WORM-Storage (10-Jahres-Retention, COMPLIANCE-Mode)

- **WORM-Object-Lock** = COMPLIANCE — weder Überschreiben noch Löschen möglich
- **Retention-Periode** = 3650 Tage (10 Jahre)
- **Object-Lock ist verifiziert**: siehe `backend/scripts/audit-worm-retention.sh`
- **Cross-Region-Replikation**: Phase 5+ (aktuell Single-Region nbg1)

### 2.3 Redis (Cache + Sessions)

- **AOF-Persistence**: `appendonly yes` (siehe docker-compose.prod.yml)
- **Tägliches Snapshot**: S3-Cold-Storage
- **Restore-Tests**: monatlich (siehe § 5)

---

## 3. Recovery-Szenarien

### 3.1 Szenario A: Einzelne App-VM ausgefallen

**Symptom**: `banz-app-1` reagiert nicht, NGINX-Health-Check schlägt fehl,
Traffic wird automatisch auf `banz-app-2` umgeleitet (Blue-Green-Switch
in Sprint 2 Phase C).

**Recovery**:
1. NGINX markiert `banz-app-1` als down (Health-Check `fail_timeout=30s`)
2. Alle Requests gehen automatisch zu `banz-app-2`
3. **App-VM ersetzen**:
   ```bash
   hcloud server create --name banz-app-1-new \
     --type cx22 --image ubuntu-24.04 \
     --location nbg1 --ssh-key banz-deploy \
     --user-data-from-file infra/hetzner/cloud-init.yml
   ```
4. Cloud-init installiert Docker + cosign automatisch
5. Code + .env.prod syncen:
   ```bash
   ssh root@<new-app-ip>
   git clone https://github.com/shledergmbh/bundesanzeiger-jahresabschluss.git
   cd bundesanzeiger-jahresabschluss
   cp /opt/banz/.env.prod .  # Snapshot der Production-Env
   docker compose -f infra/docker-compose.prod.yml --env-file .env.prod up -d backend-blue
   ```

**RTO**: 10 Minuten
**RPO**: 0 (alle Daten sind in Postgres/MinIO)

### 3.2 Szenario B: DB-Primary ausgefallen

**Symptom**: Postgres-Primary nicht erreichbar, Replica hängt im Recovery-Mode.

**Recovery (Manuelle Replica-Promotion)**:
1. Auf `banz-db` (Replica-VM) verbinden:
   ```bash
   ssh root@<replica-ip>
   docker exec banz-postgres-replica pg_ctl promote -D /var/lib/postgresql/data
   ```
2. **.env.prod updaten** auf beiden App-VMs:
   ```
   DATABASE_URL=postgresql://...@banz-db-replica:5432/...
   DATABASE_READ_REPLICA_URL=postgresql://...@banz-new-primary:5432/...
   ```
3. **Backend neu starten**:
   ```bash
   docker compose -f infra/docker-compose.prod.yml restart backend-blue backend-green
   ```
4. **Primary-VM ersetzen** via Hetzner Volume-Restore:
   ```bash
   # Neuen VM aus dem letzten täglichen Snapshot erstellen
   hcloud server create --name banz-db-new \
     --type cx31 --image ubuntu-24.04 \
     --volume banz-db-data-restore  # Snapshot-Volume
   ```

**RTO**: 30 Minuten
**RPO**: 0 (Replikation ist synchron via WAL)

### 3.3 Szenario C: Komplett-Verlust (Hetzner-Region-Ausfall)

**Symptom**: Alle Hetzner-Services in nbg1 nicht erreichbar.

**Recovery**:
1. **DNS auf Backup-Region umschalten** (Cloudflare DNS, failover < 60s):
   ```
   banz.example.com → DR-Region-IP (Phase 5+ implementiert)
   ```
2. **DR-VMs in fsn1 starten** (Hetzner-Standby-VMs oder via Terraform):
   ```bash
   hcloud server create --name banz-dr-app --location fsn1 ...
   ```
3. **PostgreSQL-Restore** aus letztem S3-Snapshot:
   ```bash
   aws s3 cp s3://banz-backups/postgres-daily-latest.sql.gz .
   gunzip -c postgres-daily-latest.sql.gz | psql $DATABASE_URL
   ```
4. **WORM-Storage** aus Cross-Region-S3-Bucket mounten (Phase 5+)

**RTO**: 2 Stunden
**RPO**: 24 Stunden (letzter täglicher Snapshot)

### 3.4 Szenario D: Versehentlicher Code-Deploy

**Symptom**: Backend-Code hat Bug in Production, sofortiges Rollback nötig.

**Recovery (Blue-Green-Atomic-Switch)**:
```bash
# Auf einem App-Host
ssh deploy@<app-ip>
bash infra/nginx/blue-green-switch.sh blue
```

**RTO**: 1 Minute (Blue-Pool ist bereits Canary-getestet)
**RPO**: 0 (kein Datenverlust möglich, nur Code-Revert)

---

## 4. Restore-Tests

**Monatlicher Test-Plan** (1. Sonntag im Monat, 02:00 UTC):

```bash
#!/usr/bin/env bash
# /opt/banz/scripts/monthly-restore-test.sh
set -euo pipefail

echo "=== Monatlicher Restore-Test ==="

# 1. Letzter PostgreSQL-Snapshot auswählen
SNAPSHOT=$(hcloud snapshot list -o json | jq -r '.[] | select(.description | startswith("banz-db-daily")) | max_by(.created) | .id')
echo "Snapshot: $SNAPSHOT"

# 2. Snapshot-Volume erstellen
hcloud volume create --name banz-restore-test-$RANDOM --size 100 --location nbg1

# 3. Test-VM erstellen
TEST_VM=$(hcloud server create --name banz-restore-test-$RANDOM \
  --type cx11 --image ubuntu-24.04 --location nbg1 \
  --ssh-key banz-deploy --start-after-create | jq -r '.server.id')

# 4. Snapshot in Test-VM restoren
echo "Restore läuft..."

# 5. PostgreSQL starten + Migrations prüfen
# ...

# 6. Audit-Hash-Chain verifizieren
curl http://test-vm-ip:3000/api/audit/integrity?kanzleiId=... \
  -H "Authorization: Bearer $TEST_TOKEN"

# 7. WORM-Retention-Audit
bash backend/scripts/audit-worm-retention.sh test

# 8. Cleanup
hcloud server delete $TEST_VM
```

**Erfolgskriterium**: Alle Tests grün → Sign-off in `/var/log/banz-restore-test.log`.

---

## 5. Eskalations-Pfad

| Severity | Beschreibung | Eskalation |
|---|---|---|
| SEV-1 | Datenverlust, GoBD-Compliance-Verletzung | sofort Ops-Lead + Compliance-Beauftragter |
| SEV-2 | Service >1h down, kein Datenverlust | Ops-Lead innerhalb 1h |
| SEV-3 | Service <1h down | Standard-Ticket innerhalb 4h |

**On-Call-Rotation**: 3 Ops-Engineers, wöchentliche Rotation via PagerDuty.

---

## 6. Audit-Trail

- Alle Recovery-Aktionen werden via `auditService.record()` protokolliert
- `action: 'DISASTER_RECOVERY'`, `entityType: 'System'`
- Hash-Chain-Verifikation nach jedem Recovery (M4 Sprint 5)
- Monatlicher Audit-Report an Compliance-Beauftragten

---

## 7. Bekannte Limitierungen

| Limitierung | Auswirkung | Mitigation |
|---|---|---|
| Single-Region nbg1 | Region-Ausfall = 2h RTO | Sprint 5+ fsn1-DR |
| Manuelle Replica-Promotion | 30min RTO bei Primary-Ausfall | Sprint 5+ `repmgr`/`Patroni` |
| Keine Cross-Region WORM-Replikation | Datenverlust bei Region-Ausfall | Sprint 5+ S3 Cross-Region Replication |
| Kein automatisierter Restore-Test | Risiko dass Backup nicht restaurierbar | Monatlicher manueller Test (§ 4) |

---

## 8. Referenzen

- `backend/scripts/audit-worm-retention.sh` — WORM-Compliance-Audit
- `RUNBOOK.md` § 7 — Notfall-Wiederherstellung (M1-Bestand)
- `RUNBOOK.md` § 8 — Hetzner Multi-VM (M4 Sprint 2)
- `infra/hetzner/README.md` — Provisioning-Guide
- `infra/scripts/smoke-test.sh` — Post-Deploy-Verifikation
- ISO 22301 (Business Continuity Management) — Referenz-Standard