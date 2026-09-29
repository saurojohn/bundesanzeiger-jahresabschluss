#!/usr/bin/env bash
# =============================================================================
# run-local.sh — lokale Testumgebung für bundesanzeiger-jahresabschluss
# =============================================================================
#
# Diese Umgebung ersetzt die bislang fehlende Dev-Infrastruktur. Sie startet
# exakt die drei Dienste, die der e2e-Testlauf braucht:
#
#   1. PostgreSQL 15  (Rolle banz / DB bundesanzeiger, Migrationen + Seed)
#   2. S3-Mock       (WORM/Object-Lock — MinIO ist archiviert, s. s3-mock/)
#   3. NestJS-Backend auf :3000 (die e2e-Specs sprechen HTTP dagegen)
#
# Warum das Skript nötig war: Die e2e-Specs rufen http://localhost:3000 per
# `fetch` ab und brauchen eine migrierte + geseedete Datenbank. Vor diesem
# Setup existierte weder eine funktionierende Initial-Migration noch ein
# lauffähiger Seed — die Specs konnten also gar nicht grün werden.
#
# Aufruf:
#   ./run-local.sh            # alles starten
#   ./run-local.sh --test     # starten + vitest ausführen
# =============================================================================
set -euo pipefail

# Absoluten Pfad sichern, BEVOR irgendwo hin gewechselt wird — sonst sind
# alle folgenden relativen Pfade (./backend, ./frontend) nach dem cd kaputt.
PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_ROOT/backend"

PG_BIN=/usr/lib/postgresql/15/bin
export PATH="$PATH:$PG_BIN"

DB_NAME=bundesanzeiger
DB_USER=banz
DB_PASS=banz_dev_pw

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()  { printf '    \033[32m%s\033[0m\n' "$*"; }
die() { printf '    \033[31m%s\033[0m\n' "$*" >&2; exit 1; }

# --- 1. PostgreSQL ------------------------------------------------------------
say "PostgreSQL"
if pg_isready -h localhost -q 2>/dev/null; then
  ok "läuft bereits"
else
  pg_ctlcluster 15 main start 2>/dev/null || die "pg_ctlcluster start fehlgeschlagen (Root-Rechte?)"
  sleep 3
  pg_isready -h localhost -q || die "Postgres antwortet nicht"
  ok "gestartet"
fi

su postgres -c "psql -tAc \"SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'\"" 2>/dev/null | grep -q 1 \
  || su postgres -c "psql -tAc \"CREATE ROLE ${DB_USER} WITH LOGIN SUPERUSER PASSWORD '${DB_PASS}'\"" >/dev/null 2>&1
su postgres -c "psql -tAc \"SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'\"" 2>/dev/null | grep -q 1 \
  || su postgres -c "createdb -O ${DB_USER} ${DB_NAME}" >/dev/null 2>&1
ok "DB '${DB_NAME}' + Rolle '${DB_USER}' bereit"

# --- 2. S3-Mock (WORM/Object Lock) -------------------------------------------
say "S3-Mock (WORM/Object-Lock)"
if curl -s -m 3 -o /dev/null http://127.0.0.1:9000/ 2>/dev/null; then
  ok "läuft bereits"
else
  [ -f ../s3-mock/server.js ] || die "s3-mock/server.js fehlt"
  nohup node ../s3-mock/server.js > /tmp/s3-mock.log 2>&1 &
  sleep 3
  curl -s -m 3 -o /dev/null http://127.0.0.1:9000/ || die "S3-Mock antwortet nicht (siehe /tmp/s3-mock.log)"
  ok "gestartet auf :9000"
fi

# --- 3. Migration + Seed ------------------------------------------------------
say "Prisma Migration"
npx prisma migrate deploy >/tmp/migrate.log 2>&1 || die "migrate deploy fehlgeschlagen (siehe /tmp/migrate.log)"
ok "Migrationen angewendet"

# Seed ist optional: er LEERT die DB (TRUNCATE ... CASCADE) und legt die
# Demo-Daten neu an. Ohne ihn bleibt der Zustand eines vorherigen Testlaufs
# erhalten — noetig, wenn man die e2e-Suite mehrfach hintereinander laufen
# laesst. Mit --seed wird auf eine frische Ausgangslage zurueckgesetzt.
if [ "${SEED:-1}" = "1" ] && [ "${1:-}" != "--no-seed" ]; then
  say "Prisma Seed"
  npx prisma db seed >/tmp/seed.log 2>&1 || die "db seed fehlgeschlagen (siehe /tmp/seed.log)"
  ok "Demo-Daten angelegt (DB wurde vorher geleert)"
else
  ok "Seed uebersprungen (SEED=0 bzw. --no-seed) — DB-Zustand bleibt erhalten"
fi

# --- 4. Backend ---------------------------------------------------------------
say "Backend (:3000)"
if curl -s -m 3 -o /dev/null http://localhost:3000/health 2>/dev/null; then
  ok "läuft bereits"
else
  nohup npx ts-node src/main.ts > /tmp/backend.log 2>&1 &
  for _ in $(seq 1 30); do
    sleep 5
    if curl -s -m 3 -o /dev/null http://localhost:3000/health 2>/dev/null; then break; fi
  done
  curl -s -m 5 -o /dev/null http://localhost:3000/health || die "Backend nicht erreichbar (siehe /tmp/backend.log)"
  ok "gestartet"
fi

curl -s http://localhost:3000/health && echo


# --- 5. Frontend (optional) ---------------------------------------------------
# Nur mit --frontend. Ohne dieses Flag bleibt das Skript beim Backend-Stack,
# damit der e2e-Backend-Lauf nicht unnoetig den Next-Build braucht.
if [ "${1:-}" = "--frontend" ] || [ "${WITH_FRONTEND:-0}" = "1" ]; then
  say "Frontend (:3001)"
  cd "$PROJECT_ROOT/frontend"
  if curl -s -m 3 -o /dev/null "http://localhost:3001/${LOCALE:-de-DE}/login" 2>/dev/null; then
    ok "laeuft bereits"
  else
    [ -d node_modules ] || { npm install --no-audit --no-fund || die "npm install fehlgeschlagen"; }
    [ -d .next ] || { npm run build || die "next build fehlgeschlagen"; }
    nohup npx next start -p 3001 > /tmp/frontend.log 2>&1 &
    for _ in $(seq 1 40); do
      sleep 3
      curl -s -m 3 -o /dev/null "http://localhost:3001/${LOCALE:-de-DE}/login" && break
    done
    curl -s -m 5 -o /dev/null "http://localhost:3001/${LOCALE:-de-DE}/login" \
      || die "Frontend nicht erreichbar (siehe /tmp/frontend.log)"
    ok "gestartet (Production-Build)"
  fi
  cd "$PROJECT_ROOT/backend"
fi

# --- 5. Optional: Tests -------------------------------------------------------
if [ "${1:-}" = "--test" ]; then
  say "Vitest (e2e)"
  npx vitest run
fi

say "Fertig"
cat <<'EOF'
    Health:      curl -s localhost:3000/health
    Frontend:    http://localhost:3001/de-DE/login   (nur mit --frontend)
    Backend-Log: /tmp/backend.log
    S3-Log:      /tmp/s3-mock.log
    Frontend-Log:/tmp/frontend.log

    Backend-Tests: cd backend && npx vitest run          (137/137)
    Frontend-Tests: cd frontend && npx playwright test   (10/10, Frontend muss laufen)

    WICHTIG: Der Seed LEERT die DB. Nach einem e2e-Lauf also mit
    `./run-local.sh --no-seed` neu starten, sonst wird der Vorlauf
    weggeworfen. Umgekehrt braucht ein Lauf auf nicht-seedeter DB einen
    expliziten `./run-local.sh` (mit Seed) als Vorbereitung.
EOF
