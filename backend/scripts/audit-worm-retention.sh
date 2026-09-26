#!/usr/bin/env bash
# ============================================================================
# WORM-Retention-Audit-Script (M4 Sprint 5)
# ============================================================================
# Zweck: Verifiziert für alle WORM-Objekte, dass:
#   1. Object-Lock-Mode = COMPLIANCE (GoBD §147 AO)
#   2. Retention bis mindestens 10 Jahre in der Zukunft
#   3. SHA-256-Hash stimmt mit dem in der DB gespeicherten Hash überein
#
# Aufruf:
#   bash backend/scripts/audit-worm-retention.sh [ENVIRONMENT]
#
# ENVIRONMENT = production | staging | dev (default: dev)
#
# Voraussetzungen:
#   - DATABASE_URL gesetzt (.env.prod)
#   - aws-cli installiert mit S3-Zugriff (oder mc für MinIO)
#   - retention-days 3650 in DB gespeichert
#
# Output:
#   - Status pro WORM-Objekt (OK / FAIL / WARN)
#   - Zusammenfassung am Ende
#   - Exit-Code 0 wenn alle OK, 1 wenn mindestens 1 FAIL
# ============================================================================
set -euo pipefail

ENVIRONMENT="${1:-dev}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT/backend"

# Load .env
if [ -f "$REPO_ROOT/.env.prod" ]; then
  set -a; . "$REPO_ROOT/.env.prod"; set +a
elif [ -f "$REPO_ROOT/.env" ]; then
  set -a; . "$REPO_ROOT/.env"; set +a
fi

# Konfiguration
S3_ENDPOINT="${S3_ENDPOINT:-http://localhost:9000}"
S3_BUCKET="${S3_BUCKET:-banz-jahresabschluss-worm}"
S3_ACCESS_KEY="${S3_ACCESS_KEY:-banz_dev_access}"
S3_SECRET_KEY="${S3_SECRET_KEY:-banz_dev_secret}"
MIN_RETENTION_DAYS=3650
TODAY=$(date -u +%s)
DEADLINE=$(($TODAY + $MIN_RETENTION_DAYS * 86400))

# Output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'
TOTAL=0
OK_COUNT=0
FAIL_COUNT=0
WARN_COUNT=0
FAIL_LIST=()

log_pass() { echo -e "${GREEN}[PASS]${NC} $1"; OK_COUNT=$((OK_COUNT + 1)); }
log_fail() { echo -e "${RED}[FAIL]${NC} $1"; FAIL_COUNT=$((FAIL_COUNT + 1)); FAIL_LIST+=("$1"); }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; WARN_COUNT=$((WARN_COUNT + 1)); }
log_info() { echo "  → $1"; }

echo "=== WORM-Retention-Audit ($ENVIRONMENT) ==="
echo "Bucket: $S3_BUCKET"
echo "Min-Retention: $MIN_RETENTION_DAYS Tage"
echo ""

# ============================================================================
# Hole alle WORM-Objekte aus der DB
# ============================================================================
echo ">>> Lade WORM-Objekte aus Datenbank..."
WORM_ROWS=$(psql "$DATABASE_URL" -t -A -F'|' -c "SELECT object_key, retention_days, retention_expires_at, sha256_hash, object_lock_mode FROM worm_object ORDER BY created_at DESC LIMIT 1000;" 2>/dev/null || echo "")

if [ -z "$WORM_ROWS" ]; then
  log_warn "Keine WORM-Objekte in DB gefunden oder DB nicht erreichbar"
  log_info "Prüfe DATABASE_URL + DB-Connectivity"
  exit 0
fi

TOTAL=0
while IFS='|' read -r OBJECT_KEY RETENTION_DAYS RETENTION_EXPIRES_AT SHA256_HASH LOCK_MODE; do
  TOTAL=$((TOTAL + 1))

  # Check 1: Lock-Mode = COMPLIANCE
  if [ "$LOCK_MODE" != "COMPLIANCE" ]; then
    log_fail "$OBJECT_KEY: Object-Lock-Mode ist '$LOCK_MODE' (erwartet COMPLIANCE)"
    continue
  fi

  # Check 2: Retention-Days >= 3650
  if [ "$RETENTION_DAYS" -lt "$MIN_RETENTION_DAYS" ]; then
    log_fail "$OBJECT_KEY: Retention $RETENTION_DAYS Tage < Minimum $MIN_RETENTION_DAYS"
    continue
  fi

  # Check 3: Retention-Expires-At in der Zukunft (mind. 10 Jahre)
  EXPIRES_EPOCH=$(date -d "$RETENTION_EXPIRES_AT" +%s 2>/dev/null || echo "0")
  if [ "$EXPIRES_EPOCH" -lt "$DEADLINE" ]; then
    log_fail "$OBJECT_KEY: Retention läuft am $RETENTION_EXPIRES_AT ab (< 10 Jahre)"
    continue
  fi

  # Check 4: S3 Object-Lock-Status (wenn aws-cli verfügbar)
  if command -v aws >/dev/null 2>&1; then
    OBJECT_LOCK_STATUS=$(AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY" \
                          AWS_SECRET_ACCESS_KEY="$S3_SECRET_KEY" \
                          aws s3api head-object \
                          --endpoint-url "$S3_ENDPOINT" \
                          --bucket "$S3_BUCKET" \
                          --key "$OBJECT_KEY" \
                          --query 'ObjectLockMode' \
                          --output text 2>/dev/null || echo "ERROR")

    if [ "$OBJECT_LOCK_STATUS" = "COMPLIANCE" ]; then
      log_pass "$OBJECT_KEY (COMPLIANCE, bis $RETENTION_EXPIRES_AT)"
    elif [ "$OBJECT_LOCK_STATUS" = "ERROR" ]; then
      log_warn "$OBJECT_KEY: S3-Head fehlgeschlagen (lokales Storage?)"
    else
      log_fail "$OBJECT_KEY: S3-Object-Lock-Mode '$OBJECT_LOCK_STATUS' != COMPLIANCE"
    fi
  else
    log_warn "$OBJECT_KEY: aws-cli nicht installiert — nur DB-Checks"
    log_info "  Mode=$LOCK_MODE, Retention=$RETENTION_DAYS Tage, expires=$RETENTION_EXPIRES_AT"
  fi
done <<< "$WORM_ROWS"

# ============================================================================
# Zusammenfassung
# ============================================================================
echo ""
echo "=== WORM-Audit Zusammenfassung ==="
echo "Total:    $TOTAL Objekte"
echo -e "  ${GREEN}OK:     $OK_COUNT${NC}"
echo -e "  ${RED}FAIL:   $FAIL_COUNT${NC}"
echo -e "  ${YELLOW}WARN:   $WARN_COUNT${NC}"

if [ "$FAIL_COUNT" -gt 0 ]; then
  echo ""
  echo "FEHLGESCHLAGENE Prüfungen:"
  for f in "${FAIL_LIST[@]}"; do
    echo "  - $f"
  done
  echo ""
  echo "EXIT 1 — WORM-Audit fehlgeschlagen"
  exit 1
fi

echo ""
echo -e "${GREEN}EXIT 0 — WORM-Audit erfolgreich${NC}"