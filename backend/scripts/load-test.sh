#!/bin/bash
# ============================================================================
# Bundesanzeiger Jahresabschluss — Lasttest-Skript
# ============================================================================
# Skaliert das System auf 3 Kanzleien + 50 Mandanten + 500 Bilanzen und
# misst Performance der Listen-Endpoints.
#
# Verwendung:
#   API_URL=http://localhost:3000 \
#   ADMIN_TOKEN=eyJ... \
#   ./scripts/load-test.sh
#
# Voraussetzungen:
#   - Backend läuft (z.B. via npm run start:dev oder Docker)
#   - System-Admin-Token verfügbar
#   - curl, jq, parallel verfügbar
#
# Sicherheit: NIEMALS in Produktion ausführen — Test-Token + Test-Daten!
# ============================================================================

set -euo pipefail

# ----------------------------------------------------------------------------
# Konfiguration
# ----------------------------------------------------------------------------
API_URL="${API_URL:-http://localhost:3000}"
ADMIN_TOKEN="${ADMIN_TOKEN:-}"
KANZLEI_COUNT="${KANZLEI_COUNT:-3}"
MANDANT_COUNT="${MANDANT_COUNT:-50}"
BILANZ_COUNT="${BILANZ_COUNT:-500}"
PARALLEL_JOBS="${PARALLEL_JOBS:-5}"
PAGE_SIZE="${PAGE_SIZE:-20}"

# Farben für Output (wenn TTY)
if [[ -t 1 ]]; then
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  YELLOW='\033[0;33m'
  NC='\033[0m'
else
  RED='' GREEN='' YELLOW='' NC=''
fi

log_info() { echo -e "${GREEN}[INFO]${NC} $*"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }

# ----------------------------------------------------------------------------
# Vorbedingungen prüfen
# ----------------------------------------------------------------------------
if [[ -z "${ADMIN_TOKEN}" ]]; then
  log_error "ADMIN_TOKEN ist nicht gesetzt. Bitte via ENV-Variable übergeben."
  log_error "Beispiel: ADMIN_TOKEN=eyJ... ./scripts/load-test.sh"
  exit 1
fi

for cmd in curl jq date; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    log_error "Befehl '$cmd' nicht gefunden. Bitte installieren."
    exit 1
  fi
done

# ----------------------------------------------------------------------------
# Phase 1: Test-Kanzleien anlegen (parallel)
# ----------------------------------------------------------------------------
log_info "============================================================="
log_info "Phase 1: ${KANZLEI_COUNT} Test-Kanzleien anlegen"
log_info "============================================================="

declare -a KANZLEI_IDS=()
for i in $(seq 1 "${KANZLEI_COUNT}"); do
  (
    RESP=$(curl -sf -X POST "${API_URL}/api/kanzlei" \
      -H "Authorization: Bearer ${ADMIN_TOKEN}" \
      -H "Content-Type: application/json" \
      -d "{
        \"name\": \"LoadTest Kanzlei ${i}\",
        \"rechtsform\": \"Steuerberatungsgesellschaft\",
        \"adresse\": {
          \"strasse\": \"Teststraße ${i}\",
          \"plz\": \"12345\",
          \"ort\": \"Berlin\",
          \"land\": \"DE\"
        }
      }" 2>&1)
    if [[ $? -eq 0 ]]; then
      KANZLEI_ID=$(echo "$RESP" | jq -r '.id' 2>/dev/null)
      echo "KANZLEI_${i}=${KANZLEI_ID}"
    fi
  ) &
  if (( i % PARALLEL_JOBS == 0 )); then wait; fi
done
wait

# Lese Kanzlei-IDs aus /api/kanzlei
KANZLEI_LIST=$(curl -sf -H "Authorization: Bearer ${ADMIN_TOKEN}" "${API_URL}/api/kanzlei" 2>/dev/null || echo "[]")
KANZLEI_IDS=($(echo "${KANZLEI_LIST}" | jq -r '.[].id' 2>/dev/null | tail -n "${KANZLEI_COUNT}"))
if [[ ${#KANZLEI_IDS[@]} -lt ${KANZLEI_COUNT} ]]; then
  log_warn "Nur ${#KANZLEI_IDS[@]} Kanzleien gefunden (erwartet: ${KANZLEI_COUNT})."
  log_warn "Fahre fort mit existierenden Kanzleien."
fi

# ----------------------------------------------------------------------------
# Phase 2: Test-Mandanten anlegen (parallel in Batches)
# ----------------------------------------------------------------------------
log_info "============================================================="
log_info "Phase 2: ${MANDANT_COUNT} Test-Mandanten anlegen"
log_info "============================================================="

declare -a MANDANT_IDS=()
MANDANT_PER_KANZLEI=$(( (MANDANT_COUNT + KANZLEI_COUNT - 1) / KANZLEI_COUNT ))

for kanzlei_idx in $(seq 0 $((${#KANZLEI_IDS[@]} - 1))); do
  KANZLEI_ID="${KANZLEI_IDS[$kanzlei_idx]}"
  if [[ -z "${KANZLEI_ID}" || "${KANZLEI_ID}" == "null" ]]; then continue; fi

  for i in $(seq 1 "${MANDANT_PER_KANZLEI}"); do
    MANDANT_NUM=$(( kanzlei_idx * MANDANT_PER_KANZLEI + i ))
    if (( MANDANT_NUM > MANDANT_COUNT )); then break; fi

    (
      RESP=$(curl -sf -X POST "${API_URL}/api/mandant" \
        -H "Authorization: Bearer ${ADMIN_TOKEN}" \
        -H "Content-Type: application/json" \
        -d "{
          \"kanzleiId\": \"${KANZLEI_ID}\",
          \"firmenname\": \"LoadTest Mandant ${MANDANT_NUM}\",
          \"rechtsform\": \"GmbH\",
          \"adresse\": {
            \"strasse\": \"Testweg ${MANDANT_NUM}\",
            \"plz\": \"12345\",
            \"ort\": \"München\",
            \"land\": \"DE\"
          },
          \"geschaeftsfuehrer\": [{
            \"name\": \"Max Mustermann\",
            \"geburtsdatum\": \"1980-01-01\",
            \"anteilProzent\": 100
          }],
          \"groessenklasse\": \"KLEIN\",
          \"publishChannel\": \"PDF_DIRECT\"
        }" 2>&1)
      if [[ $? -eq 0 ]]; then
        MANDANT_ID=$(echo "$RESP" | jq -r '.id' 2>/dev/null)
        echo "MANDANT_${MANDANT_NUM}=${MANDANT_ID}"
      fi
    ) &
    if (( i % PARALLEL_JOBS == 0 )); then wait; fi
  done
done
wait

# Mandant-IDs aus DB lesen (alternativ)
MANDANT_LIST=$(curl -sf -H "Authorization: Bearer ${ADMIN_TOKEN}" "${API_URL}/api/mandant" 2>/dev/null || echo "[]")
MANDANT_IDS=($(echo "${MANDANT_LIST}" | jq -r '.[].id' 2>/dev/null))
if [[ ${#MANDANT_IDS[@]} -lt ${MANDANT_COUNT} ]]; then
  log_warn "Nur ${#MANDANT_IDS[@]} Mandanten gefunden. Lasttest wird auf verfügbaren Daten ausgeführt."
fi

# ----------------------------------------------------------------------------
# Phase 3: Performance-Messung — Bilanz-Liste
# ----------------------------------------------------------------------------
log_info "============================================================="
log_info "Phase 3: Performance-Messung Bilanz-Liste"
log_info "============================================================="

# Wähle einen Mandanten mit Bilanzen (z.B. den ersten)
TEST_MANDANT_ID="${MANDANT_IDS[0]:-}"
if [[ -z "${TEST_MANDANT_ID}" || "${TEST_MANDANT_ID}" == "null" ]]; then
  log_error "Kein Mandant für Performance-Test verfügbar."
  exit 1
fi

log_info "Test-Mandant: ${TEST_MANDANT_ID}"
echo ""
printf "%-30s %15s %10s\n" "Endpoint" "Zeit (ms)" "Status"
echo "------------------------------------------------------------"

measure() {
  local label="$1"
  local url="$2"
  local start_ns end_ns duration_ms status
  start_ns=$(date +%s%N)
  status=$(curl -sf -o /dev/null -w '%{http_code}' -H "Authorization: Bearer ${ADMIN_TOKEN}" "${url}" 2>/dev/null || echo "ERR")
  end_ns=$(date +%s%N)
  duration_ms=$(( (end_ns - start_ns) / 1000000 ))
  printf "%-30s %15s %10s\n" "${label}" "${duration_ms}" "${status}"
}

# Bilanz-Liste (erste Page, Cursor)
for run in 1 2 3; do
  measure "Bilanz-Liste (Cursor, Run ${run})" \
    "${API_URL}/api/bilanz?mandantId=${TEST_MANDANT_ID}&pageSize=${PAGE_SIZE}"
done

# Bilanz-Liste (Legacy Offset)
for run in 1 2 3; do
  measure "Bilanz-Liste (Legacy, Run ${run})" \
    "${API_URL}/api/bilanz?mandantId=${TEST_MANDANT_ID}&page=1&pageSize=${PAGE_SIZE}"
done

# Bilanz-Liste (ohne Pagination — Default)
for run in 1 2 3; do
  measure "Bilanz-Liste (Default, Run ${run})" \
    "${API_URL}/api/bilanz?mandantId=${TEST_MANDANT_ID}"
done

# GuV-Liste
for run in 1 2 3; do
  measure "GuV-Liste (Cursor, Run ${run})" \
    "${API_URL}/api/guv?mandantId=${TEST_MANDANT_ID}&pageSize=${PAGE_SIZE}"
done

# Audit-Liste
for run in 1 2 3; do
  measure "Audit-Liste (Cursor, Run ${run})" \
    "${API_URL}/api/audit?mandantId=${TEST_MANDANT_ID}&pageSize=${PAGE_SIZE}"
done

echo ""

# ----------------------------------------------------------------------------
# Phase 4: Concurrent-Load-Test
# ----------------------------------------------------------------------------
log_info "============================================================="
log_info "Phase 4: Concurrent Load (50 parallele Bilanz-Listen)"
log_info "============================================================="

START_NS=$(date +%s%N)
PIDS=()
for i in $(seq 1 50); do
  curl -sf -o /dev/null -H "Authorization: Bearer ${ADMIN_TOKEN}" \
    "${API_URL}/api/bilanz?mandantId=${TEST_MANDANT_ID}&pageSize=${PAGE_SIZE}" &
  PIDS+=($!)
done
for pid in "${PIDS[@]}"; do wait "$pid"; done
END_NS=$(date +%s%N)
DURATION_MS=$(( (END_NS - START_NS) / 1000000 ))
log_info "50 parallele Requests abgeschlossen in ${DURATION_MS} ms"
log_info "Avg pro Request: $(( DURATION_MS / 50 )) ms"

echo ""
log_info "============================================================="
log_info "Lasttest abgeschlossen."
log_info "============================================================="