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
#
# ── Bekannte Einschränkung auf macOS (Stand 2026-10-01) ────────────────────
# `pg_ctlcluster` ist Debian-only; auf dem Mac wird der Docker-Weg genommen.
# Der Docker-Pfad läuft bis einschließlich der Migration und meldet dann
# "P1000: Authentication failed" — obwohl DERSELBE `prisma migrate deploy` mit
# derselben URL unmittelbar außerhalb des Skripts fehlerfrei durchläuft (Node
# sieht die identische URL, gleiches cwd, gleiches npx, gleiche Binaries).
# Ursache nicht eingrenzbar; auf Linux ist der Weg verifiziert. Workaround auf
# dem Mac, bis das geklärt ist:
#
#   docker run -d --name banz-e2e-pg \
#     -e POSTGRES_DB=banz_jahresabschluss -e POSTGRES_USER=banz \
#     -e POSTGRES_PASSWORD=banz_dev_pwd -p 55432:5432 postgres:16-alpine
#   cd backend
#   export DATABASE_URL="postgresql://banz:banz_dev_pwd@localhost:55432/banz_jahresabschluss?schema=public"
#   npx prisma migrate deploy && npx prisma db seed
#
#   Danach weiter mit: npx vitest run   (siehe Datei "Konfiguration" weiter oben
#   für die übrigen Variablen, die die Suite braucht)
# =============================================================================
set -euo pipefail

# Absoluten Pfad sichern, BEVOR irgendwo hin gewechselt wird — sonst sind
# alle folgenden relativen Pfade (./backend, ./frontend) nach dem cd kaputt.
PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_ROOT/backend"

# Debian-Installationspfad für die lokale Variante. Wird nur benutzt, wenn
# `pg_ctlcluster` wirklich vorhanden ist — sonst zeigt das Verzeichnis auf
# einen nicht vorhandenen Pfad und der PATH-Eintrag ist wirkungslos. Auf
# Systemen mit einer EIGENEN Postgres-Installation (macOS/Homebrew) darf der
# Pfad NICHT davor gesetzt werden: dann benutzt `psql`/`pg_isready` eine andere
# Client-Version mit abweichender Auth-Konfiguration als der Server, den der
# Container auf Port 55432 erwartet.
if command -v pg_ctlcluster >/dev/null 2>&1 && [ -d /usr/lib/postgresql/15/bin ]; then
  PG_BIN=/usr/lib/postgresql/15/bin
  export PATH="$PATH:$PG_BIN"
fi

DB_NAME=bundesanzeiger
DB_USER=banz
DB_PASS=banz_dev_pw

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()  { printf '    \033[32m%s\033[0m\n' "$*"; }
die() { printf '    \033[31m%s\033[0m\n' "$*" >&2; exit 1; }

# --- 0. Konfiguration (VOR allem anderen) -------------------------------------
# Das Skript liest bewusst KEINE .env. Ohne diese Variablen startet das Backend
# nicht ("S3_BUCKET nicht konfiguriert") bzw. die Testsuite bricht in beforeAll
# ab ("JWT_SECRET nicht konfiguriert") — und die betroffenen Tests werden dann
# still übersprungen, was einen grünen Lauf vortäuscht. Dieselben Werte wie in
# .github/workflows/ci.yml; alles hier ist ausschließlich lokal/Test.
export JWT_SECRET="${JWT_SECRET:-local-only-not-a-real-secret-0000000000000000000000}"
export S3_ENDPOINT="${S3_ENDPOINT:-http://127.0.0.1:9000}"
export S3_REGION="${S3_REGION:-eu-central-1}"
export S3_ACCESS_KEY="${S3_ACCESS_KEY:-localaccesskey}"
export S3_SECRET_KEY="${S3_SECRET_KEY:-localsecretkey}"
export S3_BUCKET="${S3_BUCKET:-banz-worm}"
export S3_OBJECT_LOCK_MODE="${S3_OBJECT_LOCK_MODE:-COMPLIANCE}"
export S3_OBJECT_LOCK_RETENTION_DAYS="${S3_OBJECT_LOCK_RETENTION_DAYS:-3650}"
export S3_PRESIGN_EXPONENT="${S3_PRESIGN_EXPONENT:-1}"
export CACHE_PROVIDER="${CACHE_PROVIDER:-memory}"
# Muss zu dem Port passen, auf dem der Frontend-Server läuft — sonst lehnt der
# CORS-Callback jeden Browser-Request ab und antwortet mit 500.
export FRONTEND_URL="${FRONTEND_URL:-http://localhost:3001}"

# --- 1. PostgreSQL ------------------------------------------------------------
say "PostgreSQL"

# Auf macOS gibt es `pg_ctlcluster` nicht (Debian-only) und selbst auf Debian
# braucht es Root. Docker ist der portable Weg und läuft auf beiden Plattformen.
PG_CONTAINER="${PG_CONTAINER:-banz-e2e-pg}"
PG_PORT="${PG_PORT:-55432}"
PG_DB="${PG_DB:-banz_jahresabschluss}"
# Eine bereits gesetzte DATABASE_URL hat Vorrang — sonst überschreibt der
# Docker-Zweig unten stillschweigend eine bewusst gesetzte URL (stille Falle,
# weil der Wert im Log nicht mehr der ist, den der Aufrufer gesetzt hat).
PG_DB_NAME="$PG_DB"
if [ -z "${DATABASE_URL:-}" ]; then
  DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@localhost:${PG_PORT}/${PG_DB_NAME}?schema=public"
fi

if pg_isready -h localhost -q 2>/dev/null; then
  ok "läuft bereits (lokaler Cluster)"
elif command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  if docker ps --format '{{.Names}}' | grep -qx "$PG_CONTAINER"; then
    ok "läuft bereits (Container)"
  else
    docker rm -f "$PG_CONTAINER" >/dev/null 2>&1 || true
    docker run -d --name "$PG_CONTAINER" \
      -e POSTGRES_DB=banz_jahresabschluss -e POSTGRES_USER="$DB_USER" -e POSTGRES_PASSWORD="$DB_PASS" \
      -p "$PG_PORT":5432 postgres:16-alpine >/dev/null \
      || die "Postgres-Container konnte nicht gestartet werden"
    for _ in $(seq 1 30); do
      sleep 2
      docker exec "$PG_CONTAINER" pg_isready -U "$DB_USER" >/dev/null 2>&1 && break
    done
    docker exec "$PG_CONTAINER" pg_isready -U "$DB_USER" >/dev/null 2>&1 \
      || die "Postgres-Container antwortet nicht"
  fi
  ok "gestartet (Container, Port ${PG_PORT})"
elif command -v pg_ctlcluster >/dev/null 2>&1; then
  pg_ctlcluster 15 main start 2>/dev/null || die "pg_ctlcluster start fehlgeschlagen (Root-Rechte?)"
  sleep 3
  pg_isready -h localhost -q || die "Postgres antwortet nicht"
  # Lokaler Cluster hört auf 5432 — nur hier wird die vorab gesetzte URL
  # auf den Standardport umgeschrieben.
  export DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@localhost:5432/${PG_DB_NAME}?schema=public"
  ok "gestartet (lokaler Cluster)"
else
  die "Kein Postgres gefunden. Docker starten oder Postgres lokal bereitstellen —
  in jedem Fall muss DATABASE_URL auf eine migrierte DB zeigen."
fi

# Rolle/Datenbank anlegen. Beim Docker-Container erledigt der POSTGRES_*-Block das
# schon, `su` existiert dort nicht. Beim lokalen Cluster braucht es `su postgres`.
if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$PG_CONTAINER"; then
  ok "DB/Role im Container bereit"
else
  su postgres -c "psql -tAc \"SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'\"" 2>/dev/null | grep -q 1 \
    || su postgres -c "psql -tAc \"CREATE ROLE ${DB_USER} WITH LOGIN SUPERUSER PASSWORD '${DB_PASS}'\"" >/dev/null 2>&1
  su postgres -c "psql -tAc \"SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'\"" 2>/dev/null | grep -q 1 \
    || su postgres -c "createdb -O ${DB_USER} ${DB_NAME}" >/dev/null 2>&1
  ok "DB '${DB_NAME}' + Rolle '${DB_USER}' bereit"
fi

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
npx prisma migrate deploy >/tmp/migrate.log 2>&1 || {
  die "migrate deploy fehlgeschlagen (siehe /tmp/migrate.log). DATABASE_URL war:
  ${DATABASE_URL:-<nicht gesetzt>}
  Prüfe: läuft Postgres auf dem erwarteten Port, stimmen Rolle/Passwort?"
}
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

# --- 3b. Test-Artefakte (P12 + CRL) ------------------------------------------
# Die Signatur-Specs laden `./tmp/test-certs/test-token.p12` und
# `./tmp/test-crl/*.pem`. Fehlen sie, brechen die betroffenen Dateien schon in
# `beforeAll` ab und ihre Tests werden still übersprungen — der Lauf sieht dann
# grüner aus, als wäre nichts geprüft worden. Deshalb hier erzeugen, nicht erst
# beim ersten Fehlschlag.
say "Test-Artefakte (P12 + CRL)"
if [ ! -f tmp/test-certs/test-token.p12 ] || [ "${REGEN_TEST_ARTIFACTS:-0}" = "1" ]; then
  npx ts-node scripts-gen-test-p12.ts >/tmp/gen-p12.log 2>&1 \
    || die "Test-P12 konnte nicht erzeugt werden (siehe /tmp/gen-p12.log)"
  ok "Test-P12 erzeugt (Passwort: Test1234!)"
else
  ok "Test-P12 vorhanden"
fi

if [ ! -f tmp/test-crl/crl-fake.pem ] || [ "${REGEN_TEST_ARTIFACTS:-0}" = "1" ]; then
  bash scripts-gen-test-crl.sh >/tmp/gen-crl.log 2>&1 \
    || die "Test-CRL konnte nicht erzeugt werden (siehe /tmp/gen-crl.log)"
  ok "Test-CRL erzeugt"
else
  ok "Test-CRL vorhanden"
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
#
# WICHTIG (macOS/BSD): `output: 'standalone'` in frontend/next.config.ts
# erzeugt einen self-contained Server unter `.next/standalone/frontend/`.
# `next start` funktioniert zwar, liefert die statischen Assets aber nur
# korrekt, wenn der Production-Server nach folgendem Muster gestartet wird:
#
#   SA=frontend/.next/standalone/frontend
#   cp -r frontend/.next/static $SA/.next/static
#   cp -r frontend/public      $SA/public
#   (cd $SA && PORT=3001 node server.js)
#
# Ohne die Asset-Kopien antworten die Seiten mit HTTP 200, aber alle
# JS/CSS liefern 404 — das Formular fällt dann auf einen nativen GET
# zurück und legt das Passwort in der URL ab. Siehe README →
# Verifikationsstand.
if [ "${1:-}" = "--frontend" ] || [ "${WITH_FRONTEND:-0}" = "1" ]; then
  say "Frontend (:3001)"
  cd "$PROJECT_ROOT/frontend"
  if curl -s -m 3 -o /dev/null "http://localhost:3001/${LOCALE:-de-DE}/login" 2>/dev/null; then
    ok "laeuft bereits"
  else
    [ -d node_modules ] || { npm install --no-audit --no-fund || die "npm install fehlgeschlagen"; }
    [ -d .next ] || { npm run build || die "next build fehlgeschlagen"; }
    SA=".next/standalone/frontend"
    if [ -f "$SA/server.js" ]; then
      mkdir -p "$SA/.next"
      [ -d "$SA/.next/static" ] || cp -R .next/static "$SA/.next/static"
      [ -d "$SA/public" ]       || cp -R public "$SA/public"
      ( cd "$SA" && PORT=3001 HOSTNAME=127.0.0.1 node server.js > /tmp/frontend.log 2>&1 & )
    else
      nohup npx next start -p 3001 > /tmp/frontend.log 2>&1 &
    fi
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
