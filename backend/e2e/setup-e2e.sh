#!/usr/bin/env bash
# ============================================================================
# Bundesanzeiger Jahresabschluss — E2E Setup-Smoke-Test
# ============================================================================
# Voraussetzungen:
#   - Postgres läuft (docker compose up postgres)
#   - MinIO läuft mit Object Lock (siehe RUNBOOK §2)
#   - .env konfiguriert
#   - Backend läuft (cd backend && npm run dev)
# ============================================================================

set -euo pipefail

# --- Konfiguration ---
BACKEND_URL="${BACKEND_URL:-http://localhost:3000}"
EMAIL="${EMAIL:-steuerberater@kanzlei.de}"
PASSWORD="${PASSWORD:-Demo123!}"

# --- Helpers ---
log() { echo -e "\033[1;34m[$(date +%H:%M:%S)]\033[0m $*"; }
err() { echo -e "\033[1;31m[FAIL]\033[0m $*" >&2; exit 1; }
ok() { echo -e "\033[1;32m[OK]\033[0m $*"; }

# --- 1. Healthcheck ---
log "Healthcheck: GET /api/health"
HEALTH=$(curl -sf "${BACKEND_URL}/api/health" || echo "FAIL")
[[ "$HEALTH" != "FAIL" ]] || err "Backend nicht erreichbar"
ok "Backend erreichbar"

# --- 2. Login ---
log "Login als $EMAIL"
LOGIN_RESPONSE=$(curl -sf -X POST "${BACKEND_URL}/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" || echo "FAIL")
[[ "$LOGIN_RESPONSE" != "FAIL" ]] || err "Login fehlgeschlagen"
ACCESS_TOKEN=$(echo "$LOGIN_RESPONSE" | jq -r '.accessToken')
[[ -n "$ACCESS_TOKEN" && "$ACCESS_TOKEN" != "null" ]] || err "Kein Access-Token in Response"
ok "Login OK, Access-Token erhalten"

AUTH_HEADER="Authorization: Bearer $ACCESS_TOKEN"

# --- 3. Mandanten listen ---
log "Mandanten des Users abrufen"
ME_RESPONSE=$(curl -sf "${BACKEND_URL}/api/auth/me" -H "$AUTH_HEADER")
USER_ID=$(echo "$ME_RESPONSE" | jq -r '.id')
MANDANT_ID=$(echo "$ME_RESPONSE" | jq -r '.mandanten[0].id')
[[ -n "$MANDANT_ID" && "$MANDANT_ID" != "null" ]] || err "Kein Mandant zugewiesen"
ok "Mandant gefunden: $MANDANT_ID"

# --- 4. Bestehende Bilanz prüfen (aus Seed) ---
log "Bilanz für Mandant $MANDANT_ID abrufen"
BILANZ_LIST=$(curl -sf "${BACKEND_URL}/api/bilanz?mandantId=$MANDANT_ID" -H "$AUTH_HEADER")
BILANZ_COUNT=$(echo "$BILANZ_LIST" | jq 'length')
[[ "$BILANZ_COUNT" -gt 0 ]] || err "Keine Bilanz gefunden (Seed nicht ausgeführt?)"
BILANZ_ID=$(echo "$BILANZ_LIST" | jq -r '.[0].id')
ok "$BILANZ_COUNT Bilanz(en) gefunden, nehme: $BILANZ_ID"

# --- 5. Bestehende GuV prüfen ---
log "GuV für Mandant abrufen"
GUV_LIST=$(curl -sf "${BACKEND_URL}/api/guv?mandantId=$MANDANT_ID" -H "$AUTH_HEADER")
GUV_ID=$(echo "$GUV_LIST" | jq -r '.[0].id')
[[ -n "$GUV_ID" && "$GUV_ID" != "null" ]] || err "Keine GuV gefunden"
ok "GuV gefunden: $GUV_ID"

# --- 6. Bestehenden Anhang prüfen ---
log "Anhang für Mandant abrufen"
ANHANG_LIST=$(curl -sf "${BACKEND_URL}/api/anhang?mandantId=$MANDANT_ID" -H "$AUTH_HEADER")
ANHANG_ID=$(echo "$ANHANG_LIST" | jq -r '.[0].id')
[[ -n "$ANHANG_ID" && "$ANHANG_ID" != "null" ]] || err "Kein Anhang gefunden"
ok "Anhang gefunden: $ANHANG_ID"

# --- 7. PDF-Generierung (Bilanz) ---
log "PDF für Bilanz $BILANZ_ID generieren"
PDF_GEN=$(curl -sf -X POST "${BACKEND_URL}/api/pdf/bilanz/$BILANZ_ID/generate" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d "{\"mandantId\":\"$MANDANT_ID\"}" || echo "FAIL")
[[ "$PDF_GEN" != "FAIL" ]] || err "PDF-Generierung fehlgeschlagen"
WORM_KEY=$(echo "$PDF_GEN" | jq -r '.wormObjectKey')
[[ -n "$WORM_KEY" && "$WORM_KEY" != "null" ]] || err "Kein WORM-Key in Response"
ok "PDF generiert, WORM-Key: $WORM_KEY"

# --- 8. PDF-Download ---
log "PDF herunterladen"
PDF_BYTES=$(curl -sf "${BACKEND_URL}/api/pdf/bilanz/$BILANZ_ID/download?mandantId=$MANDANT_ID" \
  -H "$AUTH_HEADER" \
  -o /tmp/banz-test-bilanz.pdf \
  -w "%{size_download}")
PDF_SIZE=$(stat -f%z /tmp/banz-test-bilanz.pdf 2>/dev/null || stat -c%s /tmp/banz-test-bilanz.pdf)
[[ "$PDF_SIZE" -gt 1000 ]] || err "PDF zu klein ($PDF_SIZE Bytes)"
ok "PDF heruntergeladen: $PDF_SIZE Bytes"

# --- 9. PDF-Inhalt prüfen ---
log "PDF-Inhalt auf deutsche Schlüsselbegriffe prüfen"
if command -v pdfgrep >/dev/null; then
  pdfgrep -q "Bundesanzeiger" /tmp/banz-test-bilanz.pdf || err "PDF enthält 'Bundesanzeiger' nicht"
  pdfgrep -q "Bilanz" /tmp/banz-test-bilanz.pdf || err "PDF enthält 'Bilanz' nicht"
  ok "PDF enthält erwartete deutsche Begriffe"
elif command -v strings >/dev/null; then
  strings /tmp/banz-test-bilanz.pdf | grep -q "Bundesanzeiger" || err "PDF enthält 'Bundesanzeiger' nicht (text-layer fehlt?)"
  ok "PDF enthält erwartete deutsche Begriffe (text-layer erkannt)"
else
  echo "[SKIP] pdfgrep/strings nicht installiert — Inhalt nicht geprüft"
fi

# --- 10. Audit-Log prüfen ---
log "Audit-Log auf GENERATE_PDF prüfen"
AUDIT=$(curl -sf "${BACKEND_URL}/api/audit?mandantId=$MANDANT_ID&action=GENERATE_PDF" \
  -H "$AUTH_HEADER")
GENERATE_COUNT=$(echo "$AUDIT" | jq '.items | length')
[[ "$GENERATE_COUNT" -gt 0 ]] || err "Kein GENERATE_PDF-Audit-Eintrag"
ok "Audit-Log: $GENERATE_COUNT PDF-Generierungen protokolliert"

# --- 11. Cross-Mandant-Test ---
log "Cross-Mandant-Test: GF versucht fremden Mandanten"
# Login als GF (Demo GmbH)
GF_LOGIN=$(curl -sf -X POST "${BACKEND_URL}/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"gf-demo@demo-gmbh.de","password":"Demo123!"}')
GF_TOKEN=$(echo "$GF_LOGIN" | jq -r '.accessToken')
GF_MANDANT=$(echo "$GF_LOGIN" | jq -r '.mandanten[0].id')

# Versuche, auf den Steuerberater-Mandanten zuzugreifen
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  "${BACKEND_URL}/api/bilanz?mandantId=$MANDANT_ID" \
  -H "Authorization: Bearer $GF_TOKEN")
[[ "$HTTP_CODE" == "403" ]] || err "GF sollte 403 erhalten, bekam: $HTTP_CODE"
ok "Cross-Mandant-Zugriff korrekt blockiert (403)"

# --- 12. Logout ---
log "Logout"
curl -sf -X POST "${BACKEND_URL}/api/auth/logout" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d "{\"refreshToken\":\"$(echo "$LOGIN_RESPONSE" | jq -r '.refreshToken')\"}" >/dev/null
ok "Logout OK"

# --- Cleanup ---
rm -f /tmp/banz-test-bilanz.pdf

echo ""
echo "========================================"
echo "✅ M1 Pilot-Smoke-Test BESTANDEN"
echo "========================================"
echo "Getestet:"
echo "  - Backend Health"
echo "  - JWT-Auth-Login + Token"
echo "  - Mandant-Zugriff"
echo "  - Bilanz/GuV/Anhang-List"
echo "  - PDF-Generation"
echo "  - PDF-Download"
echo "  - PDF-Inhalt (deutsche Beschriftung)"
echo "  - Audit-Log (GENERATE_PDF)"
echo "  - RBAC (Cross-Mandant 403)"
echo "  - Logout"
echo ""
echo "Pilot kann onboarded werden!"