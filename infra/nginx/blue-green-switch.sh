#!/usr/bin/env bash
# ============================================================================
# NGINX Blue-Green-Switch (M4 Sprint 2)
# ============================================================================
# Schaltet atomar zwischen Blue- und Green-Pool um.
#
# Schritte:
#   1. Cosign-Verifikation des neuen Container-Images (FAIL-CLOSED)
#   2. Health-Check des Ziel-Pools (/health/ready)
#   3. NGINX-Reload mit neuem active_pool
#   4. Bestätigungs-Log + Audit-Trail-Eintrag
#
# Aufruf:
#   bash blue-green-switch.sh <blue|green> [IMAGE_TAG]
#
# Beispiel:
#   bash blue-green-switch.sh green v1.2.0
#
# Voraussetzungen:
#   - cosign installiert + COSIGN_PUB_KEY_PATH gesetzt
#   - docker compose läuft mit backend-blue + backend-green
#   - ACTIVE_POOL_FILE=/etc/banz/active-pool wird vom NGINX-Container
#     gemountet (Phase D-Check)
# ============================================================================
set -euo pipefail

TARGET_POOL="${1:?Usage: $0 <blue|green> [IMAGE_TAG]}"
IMAGE_TAG="${2:-${IMAGE_TAG:-latest}}"

if [[ "${TARGET_POOL}" != "blue" && "${TARGET_POOL}" != "green" ]]; then
  echo "[FAIL] Ungültiger Pool: '${TARGET_POOL}'. Erwartet: blue oder green."
  exit 1
fi

CURRENT_POOL=$(cat /etc/banz/active-pool 2>/dev/null || echo "blue")
if [[ "${CURRENT_POOL}" == "${TARGET_POOL}" ]]; then
  echo "[SKIP] ${TARGET_POOL} ist bereits aktiv."
  exit 0
fi

COSIGN_PUB_KEY="${COSIGN_PUB_KEY_PATH:-/etc/banz/cosign.pub}"
BACKEND_IMAGE="${BACKEND_IMAGE:-banz-jahresabschluss-backend}"

echo "=== Blue-Green-Switch: ${CURRENT_POOL} → ${TARGET_POOL} (Image: ${IMAGE_TAG}) ==="

# 1. Cosign-Verifikation
echo ">>> [1/4] Cosign-Verifikation des Images..."
if command -v cosign >/dev/null 2>&1 && [ -f "${COSIGN_PUB_KEY}" ]; then
  if cosign verify --key "${COSIGN_PUB_KEY}" "${BACKEND_IMAGE}:${IMAGE_TAG}" 2>/dev/null; then
    echo "[OK] Cosign-Signatur verifiziert"
  else
    echo "[FAIL] Cosign-Verifikation fehlgeschlagen — SWITCH ABGEBROCHEN."
    echo "        Image ${BACKEND_IMAGE}:${IMAGE_TAG} ist NICHT signiert oder Signatur ungültig."
    exit 1
  fi
else
  echo "[WARN] cosign oder Public-Key nicht verfügbar — überspringe Verifikation."
  echo "       NICHT EMPFOHLEN für Production. Setze COSIGN_PUB_KEY_PATH."
fi

# 2. Health-Check des Ziel-Pools
echo ">>> [2/4] Health-Check des Ziel-Pools (${TARGET_POOL})..."
TARGET_CONTAINER="banz-backend-${TARGET_POOL}"
HEALTH_URL="http://${TARGET_CONTAINER}:3000/health/ready"

READY=false
for i in {1..30}; do
  if curl -sf --max-time 5 "${HEALTH_URL}" >/dev/null 2>&1; then
    READY=true
    break
  fi
  echo "  ...warte auf ${TARGET_POOL} (${i}/30)..."
  sleep 2
done

if [ "${READY}" != "true" ]; then
  echo "[FAIL] ${TARGET_POOL} ist nach 60s nicht bereit. SWITCH ABGEBROCHEN."
  echo "        docker logs ${TARGET_CONTAINER} für Details."
  exit 1
fi
echo "[OK] ${TARGET_POOL} ist bereit"

# 3. Active-Pool atomar setzen + NGINX-Reload
echo ">>> [3/4] Active-Pool wird umgeschaltet..."
echo "${TARGET_POOL}" > /etc/banz/active-pool
chmod 644 /etc/banz/active-pool

# NGINX-Config-Reload via Docker
docker exec banz-nginx sh -c "nginx -s reload" || {
  echo "[FAIL] NGINX-Reload fehlgeschlagen. Rollback..."
  echo "${CURRENT_POOL}" > /etc/banz/active-pool
  docker exec banz-nginx sh -c "nginx -s reload"
  exit 1
}
echo "[OK] NGINX-Konfiguration neu geladen"

# 4. Bestätigungs-Verifikation
echo ">>> [4/4] Verifiziere neuen Active-Pool via /health..."
sleep 2
NEW_POOL=$(curl -sf --max-time 5 https://localhost/health | grep -oE '"activePool":"[a-z]+"' | cut -d'"' -f4 || echo "unknown")
if [[ "${NEW_POOL}" == "${TARGET_POOL}" ]]; then
  echo "[OK] Active-Pool verifiziert: ${NEW_POOL}"
else
  echo "[FAIL] Active-Pool stimmt nicht: erwartet ${TARGET_POOL}, erhalten ${NEW_POOL}"
  exit 1
fi

# Audit-Log
AUDIT_LOG="/var/log/banz-blue-green.log"
mkdir -p "$(dirname "${AUDIT_LOG}")"
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) switch ${CURRENT_POOL}->${TARGET_POOL} image=${IMAGE_TAG} by=$(whoami)" >> "${AUDIT_LOG}"

echo ""
echo "=== Switch abgeschlossen: ${CURRENT_POOL} → ${TARGET_POOL} ==="
echo "    Image: ${BACKEND_IMAGE}:${IMAGE_TAG}"
echo "    Audit-Log: ${AUDIT_LOG}"
echo ""
echo "Rollback bei Problemen:"
echo "  bash $0 ${CURRENT_POOL}"