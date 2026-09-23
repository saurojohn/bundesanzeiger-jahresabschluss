# Backend — Setup & Operations

> Stand: Sprint 0.1 + Sprint 1.1 / 1.2 / 1.3

## Voraussetzungen

- Node.js 22 (bookworm-slim ist das Docker-Basimage)
- npm 11+
- Optional: Docker + Docker Compose (für den Postgres-Stack)

## Lokale Entwicklung

### 1. `.env` anlegen

Im Projekt-Root (`bundesanzeiger-jahresabschluss/`):

```bash
cp .env.example .env
# JWT_SECRET durch 256-bit-Wert ersetzen:
openssl rand -hex 32
```

### 2. Dependencies installieren

```bash
cd backend
npm install
```

### 3. Prisma Client generieren

```bash
cd backend
npx prisma generate
```

### 4. Quality Gates

```bash
cd backend
npm run lint           # eslint --max-warnings 0
npx tsc --noEmit       # TypeScript-Check
npm run build          # Full Build (tsc → dist/)
npx prisma format      # Schema formatieren
```

### 5. Postgres starten (Docker)

```bash
cd ..
docker compose up -d postgres
```

### 6. Schema migrieren + seeden

```bash
cd backend
# Generiert die initiale Migration und führt sie aus.
# Achtung: nur lokal OK. Pilot/Prod: prisma migrate deploy + prisma db seed.
npx prisma migrate dev --name init
npm run prisma:seed
```

### 7. Backend starten

```bash
cd backend
npm run dev            # ts-node src/main.ts
# oder für Produktion:
npm run build
npm start
```

Kill+Restart nach jeder Änderung (HMR ist bei NestJS unzuverlässig):

```bash
pkill -f "ts-node src/main.ts" || true
sleep 1
cd backend && npm run dev
```

### 8. E2E-Tests

```bash
cd backend
npm test               # vitest run — erfordert laufende DB + seed
```

## Demo-User

Nach `prisma db seed`:

| Email | Passwort | Rolle |
|---|---|---|
| `admin@kanzlei.de` | `Admin123!` | SYSTEM_ADMIN |
| `kanzlei-admin@kanzlei.de` | `Demo123!` | KANZLEI_ADMIN (alle 3 Mandanten) |
| `steuerberater@kanzlei.de` | `Demo123!` | STEUERBERATER (alle 3 Mandanten) |
| `wp@kanzlei.de` | `Demo123!` | WIRTSCHAFTSPRUEFER (Mandant 1+2) |
| `gf-demo@demo-gmbh.de` | `Demo123!` | GF (nur Mandant 1) |

TOTP ist initial deaktiviert.

## Architektur-Entscheidungen

### Mandant-Trennung

Jede Datenbank-Operation in `src/modules/<modul>/*.service.ts` MUSS über
ein `*Repository*.ts` laufen. Direkte `prisma.<model>.*`-Aufrufe in
modules/ sind per ESLint (`no-restricted-syntax`) verboten. Das verhindert
Mandanten-Leaks.

### Rollen-Modell

- **Global**: `SYSTEM_ADMIN`, `USER` (im JWT-Token, prüft `RolesGuard`)
- **Mandant-bezogen**: `GF`, `STEUERBERATER`, `WIRTSCHAFTSPRUEFER`,
  `KANZLEI_ADMIN` (in `UserMandantRole`)

SYSTEM_ADMIN umgeht alle Mandant-/Rollen-Checks.

### Audit-Trail

`AuditService.record()` wird sowohl manuell (in Auth/Mandant-Services
für vorher/nachher-States) als auch automatisch via `AuditInterceptor`
(für alle POST/PUT/PATCH/DELETE) aufgerufen. Letzterer ist eine
Convenience-Schicht für Endpoints ohne granularen Audit-Bedarf.

### TOTP

TOTP-Secrets werden AES-256-GCM-verschlüsselt persistiert. Master-Key
ist abgeleitet aus `JWT_SECRET` per scrypt. In M2 wird dieser Pfad
durch ein dediziertes KMS ersetzt.

## Production-Hinweise

- Backend Image: `backend/Dockerfile` (multi-stage).
- WORM-Storage (für Mandanten-PDFs/Submission-Payloads) folgt in Sprint 2.
- BAnz-Submission-Adapter folgen in Sprint 3.
