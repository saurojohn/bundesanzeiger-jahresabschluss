#!/usr/bin/env bash
# ============================================================================
# PostgreSQL-Replication-Init (M4 Sprint 2)
# ============================================================================
# Einmalig ausführen auf banz-db um Primary+Replica-Setup zu erstellen.
#
# Voraussetzungen:
#   - docker compose -f infra/docker-compose.prod.yml up -d postgres-primary
#     bereits gelaufen (Replikation-User wird beim ersten Start erstellt)
#   - REPLICA_USER + REPLICA_PASSWORD in .env.prod gesetzt
#
# Aufruf: bash infra/hetzner/postgres-replica-init.sh
# ============================================================================
set -euo pipefail

PRIMARY_CONTAINER="${PRIMARY_CONTAINER:-banz-postgres-primary}"
REPLICA_CONTAINER="${REPLICA_CONTAINER:-banz-postgres-replica}"
PG_USER="${POSTGRES_USER:-banz}"
REPL_USER="${POSTGRES_REPLICATION_USER:-replicator}"

echo "=== PostgreSQL-Replication-Setup ==="

# 1. Prüfen ob Primary läuft
if ! docker ps --format '{{.Names}}' | grep -q "^${PRIMARY_CONTAINER}$"; then
  echo "[FAIL] Primary-Container '${PRIMARY_CONTAINER}' läuft nicht."
  echo "        Starte mit: docker compose -f infra/docker-compose.prod.yml up -d postgres-primary"
  exit 1
fi
echo "[OK] Primary-Container läuft"

# 2. WAL-Archiving + Replikation-Settings auf Primary setzen
echo ">>> WAL-Archiving auf Primary konfigurieren..."
docker exec "${PRIMARY_CONTAINER}" psql -U "${PG_USER}" -d "${POSTGRES_DB:-banz_jahresabschluss}" <<EOF
ALTER SYSTEM SET wal_level = 'replica';
ALTER SYSTEM SET max_wal_senders = 5;
ALTER SYSTEM SET wal_keep_size = '1GB';
ALTER SYSTEM SET archive_mode = 'on';
ALTER SYSTEM SET archive_command = '/bin/true';
SELECT pg_reload_conf();
EOF
echo "[OK] Primary-Konfiguration gesetzt (Neustart erforderlich für archive_mode)"

# 3. Primary neu starten damit archive_mode aktiv wird
echo ">>> Primary wird neu gestartet..."
docker restart "${PRIMARY_CONTAINER}"
sleep 5
until docker exec "${PRIMARY_CONTAINER}" pg_isready -U "${PG_USER}" >/dev/null 2>&1; do
  echo "  ...warte auf Primary..."
  sleep 2
done
echo "[OK] Primary wieder erreichbar"

# 4. Replica-Container starten (führt pg_basebackup automatisch aus)
echo ">>> Replica-Container wird gestartet..."
docker compose -f infra/docker-compose.prod.yml up -d postgres-replica
echo "[OK] Replica-Container gestartet"

# 5. Warten bis Replica bereit ist
echo ">>> Warte auf Replica-Initialisierung..."
for i in {1..30}; do
  if docker exec "${REPLICA_CONTAINER}" pg_isready -U "${PG_USER}" >/dev/null 2>&1; then
    echo "[OK] Replica erreichbar nach ${i} Versuchen"
    break
  fi
  echo "  ...warte auf Replica (${i}/30)..."
  sleep 3
done

if ! docker exec "${REPLICA_CONTAINER}" pg_isready -U "${PG_USER}" >/dev/null 2>&1; then
  echo "[FAIL] Replica wurde nicht bereit nach 90s. Logs prüfen:"
  echo "        docker logs ${REPLICA_CONTAINER}"
  exit 1
fi

# 6. Verifizieren dass Replica tatsächlich im Recovery-Mode ist
echo ">>> Verifiziere Recovery-Mode..."
RECOVERY=$(docker exec "${REPLICA_CONTAINER}" psql -U "${PG_USER}" -d "${POSTGRES_DB:-banz_jahresabschluss}" -tAc "SELECT pg_is_in_recovery();")
if [ "${RECOVERY}" = "t" ]; then
  echo "[OK] Replica ist im Recovery-Mode (pg_is_in_recovery = t)"
else
  echo "[FAIL] Replica ist NICHT im Recovery-Mode (pg_is_in_recovery = ${RECOVERY})"
  echo "        Manuell prüfen: docker exec ${REPLICA_CONTAINER} psql -U ${PG_USER} -c 'SELECT pg_is_in_recovery();'"
  exit 1
fi

# 7. Verifizieren Replikation-Lag (sollte nahe 0 sein)
echo ">>> Replikation-Lag wird geprüft..."
LAG=$(docker exec "${REPLICA_CONTAINER}" psql -U "${PG_USER}" -d "${POSTGRES_DB:-banz_jahresabschluss}" -tAc "SELECT EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp()))::int;")
echo "[OK] Aktueller Lag: ${LAG} Sekunden"

echo ""
echo "=== PostgreSQL-Replication-Setup abgeschlossen ==="
echo ""
echo "Primary: ${PRIMARY_CONTAINER} (Schreibzugriff)"
echo "Replica: ${REPLICA_CONTAINER} (Read-only, automatisch via DATABASE_READ_REPLICA_URL)"
echo ""
echo "Nächste Schritte:"
echo "  1. docker compose -f infra/docker-compose.prod.yml up -d"
echo "  2. curl http://localhost:3000/health"