#!/usr/bin/env bash
#
# Restore-Test — Dump, Restore, Pruefung.
#
# BEFUND 2026-10-20 (Nachtrag 65, TODO-8.6): Der DR-Plan beschrieb einen
# monatlichen Restore-Test als **Handskript auf dem Produktionshost**
# (`/opt/banz/scripts/monthly-restore-test.sh`, Hetzner-CLI). Das ist weder
# automatisiert noch versioniert: es laeuft nicht von allein, und ein Fehler
# darin faellt erst im Ernstfall auf — also genau dann, wenn er teuer ist.
#
# Dieses Skript ist der **portable Teil**: Dump -> Restore -> Pruefung. Es
# laeuft ueberall, wo zwei PostgreSQL-Datenbanken erreichbar sind — in der
# CI monatlich, lokal jederzeit.
#
# ## Was es beweist — und was nicht
#
# **beweist:**
#   - die Prozedur laeuft (Dump, Restore, Pruefung sind fehlerfrei)
#   - das Schema ist vollstaendig (jede Migration ist angewendet)
#   - die Daten sind vollstaendig (Zeilenzahlen stimmen ueberein)
#   - die Audit-Hash-Kette ist im wiederhergestellten Bestand **intakt**
#   - der WORM-Aufbewahrungs-Audit laeuft gegen die wiederhergestellte DB
#
# **beweist NICHT:**
#   - dass das **Produktions**-Backup existiert oder brauchbar ist. Das prueft
#     der Produktionslauf (Hetzner-Snapshot) — dieser Job kann es nicht, weil
#     die CI kein Produktions-Backup hat. Die Aussage bleibt beim DR-Plan,
#     Abschnitt 4.
#
# ## Aufruf
#
#   SOURCE_DATABASE_URL=... TARGET_DATABASE_URL=... \
#   [APP_DATABASE_URL=...] [START_BACKEND=1] [API_PORT=3200] \
#   [INTEGRITY_EMAIL=... INTEGRITY_PASSWORD=...] \
#   bash backend/scripts/restore-test.sh
#
# `APP_DATABASE_URL` ist die Adresse, unter der die **Anwendung** die
# Datenbank erreicht. Sie darf von `TARGET_DATABASE_URL` abweichen — das ist
# der Fall bei einem Docker-Port-Mapping (der pg-Client laeuft im Container
# auf 5432, die Anwendung auf dem Host auf 55432). In der CI sind beide
# Adressen gleich.
#
# Damit das keine stille Falle wird, prueft Pruefung 3 zusaetzlich die Zahl
# der geprueften Eintraege gegen die Zahl der Zeilen in der Ziel-Datenbank.
# Ein Backend, das die *andere* Datenbank liest, faellt damit auf.
#
# `PG_CLIENT` erlaubt, den PostgreSQL-Client aus einem Container zu holen:
#
#   PG_CLIENT="docker exec -i banz-e2e-pg" bash backend/scripts/restore-test.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

GRUEN='\033[0;32m'
ROT='\033[0;31m'
GELB='\033[0;33m'
NC='\033[0m'

log_info() { echo -e "${GELB}>>>${NC} $*"; }
log_ok()   { echo -e "${GRUEN} OK${NC} $*"; }
log_fail() { echo -e "${ROT}FEHLER${NC} $*"; }

FEHLER=0

# Die Quelle ist die konfigurierte Datenbank; ein eigener Name erlaubt es,
# eine andere Quelle zu nehmen. `DATABASE_URL` ist der Normalfall — der
# erste CI-Lauf schlug genau hier fehl (der Workflow setzte `DATABASE_URL`,
# das Skript las `SOURCE_DATABASE_URL`).
SOURCE_DATABASE_URL="${SOURCE_DATABASE_URL:-${DATABASE_URL:-}}"

if [ -z "${SOURCE_DATABASE_URL}" ] || [ -z "${TARGET_DATABASE_URL:-}" ]; then
  log_fail "SOURCE_DATABASE_URL (oder DATABASE_URL) und TARGET_DATABASE_URL muessen gesetzt sein"
  exit 2
fi

if [ "${SOURCE_DATABASE_URL}" = "${TARGET_DATABASE_URL}" ]; then
  log_fail "Quelle und Ziel sind dieselbe Datenbank — das prueft nichts"
  exit 2
fi

PG_CLIENT="${PG_CLIENT:-}"
run_pg() {
  if [ -n "${PG_CLIENT}" ]; then
    ${PG_CLIENT} "$@"
  else
    "$@"
  fi
}

# Prisma-Parameter aus der URL entfernen.
#
# `DATABASE_URL` traegt bei Prisma typischerweise `?schema=public`. Das ist
# ein **Prisma**-Parameter — PostgreSQL und seine Werkzeuge kennen ihn nicht:
#
#   pg_dump: error: invalid URI query parameter: "schema"
#
# `sslmode` und `application_name` bleiben erhalten — die versteht libpq.
pg_url() {
  echo "$1" | sed -E 's/[?&]schema=[^&]*//; s/[?&]$//'
}

echo "=== Restore-Test ==="
echo "Quelle: ${SOURCE_DATABASE_URL%%\?*}"
echo "Ziel:   ${TARGET_DATABASE_URL%%\?*}"
echo ""

# ----------------------------------------------------------------------------
# 1) Dump und Restore
# ----------------------------------------------------------------------------
log_info "Dump der Quelle …"
DUMP_FILE="$(mktemp /tmp/banz-restore-dump-XXXXXX.sql)"
BACKEND_PID=""
beende_backend() {
  if [ -n "${BACKEND_PID}" ] && kill -0 "${BACKEND_PID}" 2>/dev/null; then
    kill "${BACKEND_PID}" 2>/dev/null || true
    wait "${BACKEND_PID}" 2>/dev/null || true
  fi
}
trap 'rm -f "${DUMP_FILE}"; beende_backend' EXIT

run_pg pg_dump --no-owner --no-privileges --clean --if-exists "$(pg_url "${SOURCE_DATABASE_URL}")" > "${DUMP_FILE}"
log_ok "Dump erstellt ($(wc -c < "${DUMP_FILE}" | tr -d ' ') Bytes)"

log_info "Restore in das Ziel …"
run_pg psql "$(pg_url "${TARGET_DATABASE_URL}")" --quiet --set ON_ERROR_STOP=1 < "${DUMP_FILE}" > /dev/null
log_ok "Restore abgeschlossen"

# ----------------------------------------------------------------------------
# 2) Sind alle Migrationen angewendet?
#
# EIN ZIEL-SCHEMA, DAS EINEN MIGRATIONSSCHRITT VERPASST, IST BEI EINER
# WIEDERHERSTELLUNG DER SCHLIMMSTE FALL: Die Anwendung startet, liest ein
# aelteres Schema und schreibt in Spalten, die es noch nicht gibt.
# ----------------------------------------------------------------------------
log_info "Pruefung 1: vollstaendiges Schema (Migrationen) …"
MIGRATIONEN_DATEIEN="$(cd "${BACKEND_DIR}/prisma/migrations" && ls -1 | grep -v '^migration_lock.toml$' | sort)"
MIGRATIONEN_DB="$(run_pg psql "$(pg_url "${TARGET_DATABASE_URL}")" -t -A -c "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name;" 2>/dev/null | sort)"
FEHLENDE_MIGRATIONEN="$(comm -23 <(echo "${MIGRATIONEN_DATEIEN}") <(echo "${MIGRATIONEN_DB}") | tr '\n' ' ')"
if [ -n "${FEHLENDE_MIGRATIONEN}" ]; then
  log_fail "im wiederhergestellten Schema fehlen Migrationen: ${FEHLENDE_MIGRATIONEN}"
  FEHLER=$((FEHLER + 1))
else
  log_ok "alle Migrationen angewendet"
fi

# ----------------------------------------------------------------------------
# 3) Sind die Daten vollstaendig?
#
# Der Vergleich laeuft ueber das information_schema — nicht ueber eine
# handgepflegte Tabellenliste. Eine Liste veraltet, sobald jemand ein neues
# Modell einfuegt; das Schema fragt sich selbst.
# ----------------------------------------------------------------------------
log_info "Pruefung 2: Zeilenzahlen stimmen ueberein …"
TABELLEN="$(run_pg psql "$(pg_url "${SOURCE_DATABASE_URL}")" -t -A -c "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name;" 2>/dev/null)"
if [ -z "${TABELLEN}" ]; then
  log_fail "die Quelldatenbank enthaelt keine Tabellen — es gibt nichts zu vergleichen"
  FEHLER=$((FEHLER + 1))
else
  ABWEICHUNGEN=""
  while IFS= read -r tabelle; do
    [ -z "${tabelle}" ] && continue
    QUELLE="$(run_pg psql "$(pg_url "${SOURCE_DATABASE_URL}")" -t -A -c "SELECT count(*) FROM \"${tabelle}\";" 2>/dev/null | tr -d ' ')"
    ZIEL="$(run_pg psql "$(pg_url "${TARGET_DATABASE_URL}")" -t -A -c "SELECT count(*) FROM \"${tabelle}\";" 2>/dev/null | tr -d ' ')"
    if [ "${QUELLE}" != "${ZIEL}" ]; then
      ABWEICHUNGEN="${ABWEICHUNGEN} ${tabelle}(${QUELLE}->${ZIEL})"
    fi
  done <<< "${TABELLEN}"
  if [ -n "${ABWEICHUNGEN}" ]; then
    log_fail "Zeilenzahlen weichen ab:${ABWEICHUNGEN}"
    FEHLER=$((FEHLER + 1))
  else
    log_ok "alle Zeilenzahlen stimmen ($(echo "${TABELLEN}" | wc -l | tr -d ' ') Tabellen)"
  fi
fi

# ----------------------------------------------------------------------------
# 4) Das Backend gegen die **wiederhergestellte** Datenbank
#
# Die Hash-Kette wird mit dem Produktivcode geprueft (`GET
# /api/audit/integrity`), nicht mit einer Nachbildung in SQL. Eine
# Nachbildung prueft die Nachbildung (Nachtrag 54: „Wer eine Funktion zum
# Vergleich nachbaut, misst die Nachbildung"). Das Backend muss dazu gegen
# die Ziel-Datenbank laufen — ein Aufruf gegen die *Quell*-Datenbank
# wuerde die falsche Frage stellen.
# ----------------------------------------------------------------------------
API_PORT="${API_PORT:-3200}"
API_BASE="${API_BASE:-http://localhost:${API_PORT}}"

if [ "${START_BACKEND:-0}" = "1" ]; then
  log_info "Backend gegen die Ziel-Datenbank starten (Port ${API_PORT}) …"
  (
    cd "${BACKEND_DIR}" || exit 1
    DATABASE_URL="${APP_DATABASE_URL:-${TARGET_DATABASE_URL}}" PORT="${API_PORT}" npx ts-node -r tsconfig-paths/register src/main.ts > /tmp/banz-restore-backend.log 2>&1
  ) &
  BACKEND_PID=$!

  BEREIT=false
  for _ in $(seq 1 90); do
    if curl -sf "${API_BASE}/health" > /dev/null 2>&1; then
      BEREIT=true
      break
    fi
    sleep 1
  done
  if [ "${BEREIT}" != "true" ]; then
    log_fail "das Backend wurde nicht bereit (siehe /tmp/banz-restore-backend.log)"
    tail -20 /tmp/banz-restore-backend.log || true
    FEHLER=$((FEHLER + 1))
  else
    log_ok "das Backend laeuft gegen die Ziel-Datenbank"
  fi

  if [ -n "${INTEGRITY_EMAIL:-}" ]; then
    log_info "Token fuer die Integritaetspruefung holen …"
    LOGIN_ANTWORT="$(curl -sS --max-time 30 -X POST "${API_BASE}/api/auth/login" -H 'content-type: application/json' -d "{\"email\":\"${INTEGRITY_EMAIL}\",\"password\":\"${INTEGRITY_PASSWORD}\"}" 2>/dev/null || true)"
    INTEGRITY_TOKEN="$(echo "${LOGIN_ANTWORT}" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{process.stdout.write(JSON.parse(d).accessToken||'')}catch{process.stdout.write('')}})")"
    if [ -z "${INTEGRITY_TOKEN}" ]; then
      log_fail "der Login fuer die Integritaetspruefung ist fehlgeschlagen"
      FEHLER=$((FEHLER + 1))
    else
      log_ok "Token geholt"
    fi
  fi
fi

# ----------------------------------------------------------------------------
# 5) Ist die Audit-Hash-Kette im wiederhergestellten Bestand intakt?
# ----------------------------------------------------------------------------
if [ -n "${INTEGRITY_TOKEN:-}" ]; then
  log_info "Pruefung 3: Audit-Hash-Kette im wiederhergestellten Bestand …"
  KANZLEI_ID="${KANZLEI_ID:-}"
  ANTWORT="$(curl -sS --max-time 30 "${API_BASE}/api/audit/integrity${KANZLEI_ID:+?kanzleiId=${KANZLEI_ID}}" -H "Authorization: Bearer ${INTEGRITY_TOKEN}" 2>&1 || true)"
  if echo "${ANTWORT}" | grep -q '"status":"OK"'; then
    log_ok "die Kette ist intakt — ${ANTWORT}"
  else
    log_fail "die Kette ist NICHT intakt: ${ANTWORT}"
    FEHLER=$((FEHLER + 1))
  fi

  # **Gegenprobe:** Hat das Backend wirklich die Ziel-Datenbank gelesen?
  #
  # `entriesChecked` muss zur Zahl der Audit-Zeilen in der Ziel-Datenbank
  # passen. Ohne diese Pruefung koennte ein Backend, das die
  # Quell-Datenbank liest, ein gruenes Ergebnis liefern — der Test wuerde
  # genau die Datenbank pruefen, die er nicht pruefen soll.
  GEPRUEFT="$(echo "${ANTWORT}" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);process.stdout.write(String(j.entriesChecked??''))}catch{process.stdout.write('')}})")"
  if [ -n "${GEPRUEFT}" ]; then
    SOLL="$(run_pg psql "$(pg_url "${TARGET_DATABASE_URL}")" -t -A -c "SELECT count(*) FROM audit_log;" 2>/dev/null | tr -d ' ')"
    if [ "${GEPRUEFT}" = "${SOLL}" ]; then
      log_ok "das Backend hat die Ziel-Datenbank gelesen (${GEPRUEFT} Eintraege)"
    else
      log_fail "das Backend las ${GEPRUEFT} Eintraege, die Ziel-Datenbank hat ${SOLL} — es spricht mit der falschen Datenbank"
      FEHLER=$((FEHLER + 1))
    fi
  fi
else
  log_info "Pruefung 3 uebersprungen (kein INTEGRITY_TOKEN) — die Hash-Kette wurde NICHT geprueft"
fi

# ----------------------------------------------------------------------------
# 6) Laeuft der WORM-Aufbewahrungs-Audit gegen die wiederhergestellte DB?
# ----------------------------------------------------------------------------
if [ -f "${BACKEND_DIR}/scripts/audit-worm-retention.sh" ]; then
  log_info "Pruefung 4: WORM-Aufbewahrungs-Audit gegen die wiederhergestellte DB …"
  if DATABASE_URL="${TARGET_DATABASE_URL}" bash "${BACKEND_DIR}/scripts/audit-worm-retention.sh" "${ENVIRONMENT:-dev}" > /tmp/banz-restore-worm.log 2>&1; then
    log_ok "der WORM-Audit ist gruen (Details in /tmp/banz-restore-worm.log)"
  else
    log_fail "der WORM-Audit meldet einen Befund (Details in /tmp/banz-restore-worm.log)"
    tail -20 /tmp/banz-restore-worm.log || true
    FEHLER=$((FEHLER + 1))
  fi
else
  log_info "Pruefung 4 uebersprungen (audit-worm-retention.sh nicht gefunden)"
fi

# ----------------------------------------------------------------------------
echo ""
echo "=== Restore-Test Zusammenfassung ==="
if [ "${FEHLER}" -eq 0 ]; then
  echo -e "${GRUEN}ERGEBNIS: OK — die Prozedur laeuft, das Schema ist vollstaendig, die Daten sind vollstaendig.${NC}"
  echo ""
  echo "Hinweis: Dieser Lauf beweist die PROZEDUR. Ob das Produktions-Backup"
  echo "existiert und brauchbar ist, prueft der Produktionslauf (DR-Plan, Abschnitt 4)."
  exit 0
else
  echo -e "${ROT}ERGEBNIS: FEHLGESCHLAGEN — ${FEHLER} Pruefung(en) rot${NC}"
  exit 1
fi
