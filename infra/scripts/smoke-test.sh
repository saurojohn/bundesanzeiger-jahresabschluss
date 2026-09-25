#!/usr/bin/env bash
# ============================================================================
# Production Smoke-Test (M4 Sprint 2)
# ============================================================================
# Wird nach jedem Production-Deploy ausgeführt um zu verifizieren dass:
#   1. HTTPS erreichbar + Cert gültig
#   2. /health OK (Liveness)
#   3. /health/ready OK (DB+Redis erreichbar)
#   4. Beide Pools (Blue+Green) healthy sind
#   5. Mandant-API antwortet (Auth-Flow)
#
# Aufruf:
#   bash infra/scripts/smoke-test.sh https://banz.example.com
#
# Exit-Codes:
#   0 — alle Tests grün
#   1 — Smoke-Test fehlgeschlagen (Details im Output)
# ============================================================================
set -euo pipefail

BASE_URL="${1:?Usage: $0 <BASE_URL>}"
PASS=0
FAIL=0
SKIP=0

# Farb-Output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_pass() { echo -e "${GREEN}[PASS]${NC} $1"; PASS=$((PASS + 1)); }
log_fail() { echo -e "${RED}[FAIL]${NC} $1"; FAIL=$((FAIL + 1)); }
log_skip() { echo -e "${YELLOW}[SKIP]${NC} $1"; SKIP=$((SKIP + 1)); }
log_info() { echo "  → $1"; }

echo "=== Production Smoke-Test gegen ${BASE_URL} ==="
echo ""

# ----- 1. HTTPS-Erreichbarkeit -----
echo ">>> [1/6] HTTPS-Erreichbarkeit..."
if curl -sf --max-time 10 "${BASE_URL}/health" >/dev/null; then
  log_pass "HTTPS-Endpoint erreichbar"
else
  log_fail "HTTPS-Endpoint nicht erreichbar"
  echo ""
  echo "=== Smoke-Test FEHLGESCHLAGEN: ${FAIL} Fehler, ${PASS} erfolgreich ==="
  exit 1
fi

# ----- 2. /health Liveness -----
echo ">>> [2/6] Liveness-Probe..."
HEALTH_RESPONSE=$(curl -sf --max-time 5 "${BASE_URL}/health")
HEALTH_STATUS=$(echo "${HEALTH_RESPONSE}" | grep -oE '"status":"[a-z]+"' | cut -d'"' -f4 || echo "unknown")
if [ "${HEALTH_STATUS}" = "ok" ]; then
  log_pass "/health antwortet mit status=ok"
  log_info "$(echo "${HEALTH_RESPONSE}" | head -c 200)"
else
  log_fail "/health antwortet mit status=${HEALTH_STATUS}"
  echo "    Response: ${HEALTH_RESPONSE}"
fi

# ----- 3. /health/ready Readiness (DB+Redis) -----
echo ">>> [3/6] Readiness-Probe (DB+Redis)..."
READY_RESPONSE=$(curl -sf --max-time 10 "${BASE_URL}/health/ready" || echo "{}")
READY_STATUS=$(echo "${READY_RESPONSE}" | grep -oE '"status":"[a-z]+"' | cut -d'"' -f4 || echo "unknown")
PRIMARY_STATUS=$(echo "${READY_RESPONSE}" | grep -oE '"primary":"[a-z]+"' | cut -d'"' -f4 || echo "unknown")
REPLICA_STATUS=$(echo "${READY_RESPONSE}" | grep -oE '"replica":"[a-z]+"' | cut -d'"' -f4 || echo "unknown")

if [ "${PRIMARY_STATUS}" = "up" ]; then
  log_pass "DB-Primary: up"
else
  log_fail "DB-Primary: ${PRIMARY_STATUS}"
fi

if [ "${REPLICA_STATUS}" = "up" ] || [ "${REPLICA_STATUS}" = "disabled" ]; then
  log_pass "DB-Replica: ${REPLICA_STATUS}"
else
  log_fail "DB-Replica: ${REPLICA_STATUS}"
fi

if [ "${READY_STATUS}" = "ok" ]; then
  log_pass "Readiness: ok"
else
  log_fail "Readiness: ${READY_STATUS}"
fi

# ----- 4. Beide Pools (Blue+Green) -----
echo ">>> [4/6] Blue+Green-Pool-Health (Docker-intern)..."
if command -v docker >/dev/null 2>&1; then
  for POOL in blue green; do
    CONTAINER="banz-backend-${POOL}"
    if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
      if docker exec "${CONTAINER}" sh -c "wget -q -O - http://localhost:3000/health/ready" 2>/dev/null | grep -q '"status":"ok"'; then
        log_pass "Pool ${POOL}: healthy"
      else
        log_fail "Pool ${POOL}: /health/ready antwortet nicht mit status=ok"
      fi
    else
      log_skip "Pool ${POOL}: Container '${CONTAINER}' läuft nicht lokal (externer Smoke-Test)"
    fi
  done
else
  log_skip "docker nicht verfügbar — Pool-Health nur via externem HTTP testbar"
fi

# ----- 5. OAuth2-Token-Endpoint -----
echo ">>> [5/6] OAuth2-Token-Endpoint (ohne Credentials — sollte 400/401 liefern, nicht 500)..."
OAUTH_STATUS=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 -X POST "${BASE_URL}/oauth/token" || echo "000")
if [ "${OAUTH_STATUS}" = "400" ] || [ "${OAUTH_STATUS}" = "401" ] || [ "${OAUTH_STATUS}" = "415" ]; then
  log_pass "OAuth2-Endpoint antwortet (HTTP ${OAUTH_STATUS} — Request-Validierung aktiv)"
else
  log_fail "OAuth2-Endpoint antwortet mit HTTP ${OAUTH_STATUS} (erwartet 400/401/415)"
fi

# ----- 6. OpenAPI-Docs erreichbar -----
echo ">>> [6/6] OpenAPI-Docs..."
OPENAPI_STATUS=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "${BASE_URL}/api/docs" || echo "000")
if [ "${OPENAPI_STATUS}" = "200" ]; then
  log_pass "OpenAPI-Docs erreichbar (HTTP 200)"
else
  log_fail "OpenAPI-Docs nicht erreichbar (HTTP ${OPENAPI_STATUS})"
fi

# ----- Zusammenfassung -----
echo ""
echo "=== Smoke-Test Ergebnis ==="
echo "  Pass: ${PASS}"
echo "  Fail: ${FAIL}"
echo "  Skip: ${SKIP}"
echo ""

if [ "${FAIL}" -gt 0 ]; then
  echo -e "${RED}FEHLGESCHLAGEN${NC} — ${FAIL} Test(s) fehlgeschlagen"
  exit 1
fi

echo -e "${GREEN}ERFOLGREICH${NC} — alle Smoke-Tests grün"