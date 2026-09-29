# AGENTS.md — Agent Operations Manual

> **Audience**: Mavis (mavis) und Sub-Agenten, die an diesem Projekt arbeiten.
> **Sprache**: Deutsch (UI / PDF / Audit) · **Code-Sprache**: English (Variablen / Commits)
> **Sync mit de-invoice**: Stack und Konventionen sind konsistent. Disziplinen aus
> `de-invoice/nestjs-prisma-gotchas.md`, `nextjs-frontend-gotchas.md`, `pdfkit-debugging.md`
> gelten hier ebenfalls.

## 1. Repository-Layout

| Pfad | Inhalt |
|---|---|
| `backend/src/modules/<modul>/` | NestJS-Module (auth, mandant, bilanz, guv, anhang, banz, datev, konsolidierung, pdf, signatur, audit) |
| `backend/prisma/schema.prisma` | Single source of truth — alle Models |
| `frontend/src/app/(mandant)/` | Mandanten-spezifische Routen (Bilanz, GuV, Anhang) |
| `frontend/src/app/(kanzlei)/` | Kanzlei-Routen (Mandantenliste, User-Verwaltung) |
| `frontend/src/messages/de-DE.json` | **Alle** UI-Strings, ausschließlich Deutsch |
| `docs/` | Rechtsrahmen, BAnz-Schemas, RBAC, GoBD-Architektur |
| `infra/` | Docker-Compose, Hetzner-Deployment |
| `scripts/banz-test-fixtures/` | BAnz-XML/XBRL Test-Daten |

## 2. Hard Rules (nicht verhandelbar)

### 2.1 Sprache
- **Frontend UI**: 100% Deutsch. Kein Englisch, kein gemischtes UI. `next-intl` Locale = `de-DE`.
- **PDF-Texte**: 100% Deutsch. Header, Positionen, Fußzeilen — alles deutsch.
- **Variablen, Kommentare, Commit-Messages**: English (PascalCase, camelCase, kebab-case wie im bestehenden Stack).
- **Audit-Logs**: Deutsch (Menschen lesen die), aber strukturierte Felder (action, entityId) English.

### 2.2 Compliance first
- **Kein Mock in Produktion**: Audit-Trail, Signatur, WORM-Storage — niemals deaktivieren.
- **Mandantentrennung**: Jede Query, jeder Endpoint geht durch Mandant-Filter. ESLint-Regel verbietet direkten Prisma-Zugriff ohne `mandantId`-Check.
- **GoBD-Speicherung**: Bilanz, GuV, Anhang, PDFs, XML/XBRL → 10 Jahre unveränderlich. WORM-Storage (S3 Object Lock) ab Tag 1.
- **Keine Drittland-Übertragung** ohne Auftragsverarbeitungsvertrag (DSGVO Art. 28).

### 2.3 Stack-Konsistenz mit de-invoice
| Schicht | Hier | In de-invoice |
|---|---|---|
| Backend Framework | NestJS 11 | NestJS 11 ✓ |
| ORM | Prisma 5.22 | Prisma 5.22 ✓ |
| Node | 22-bookworm-slim | 22-bookworm-slim ✓ |
| DB | PostgreSQL 16 | PostgreSQL 16 ✓ |
| PDF | PDFKit 0.18 | PDFKit 0.18 ✓ |
| XML | xmlbuilder2 | xmlbuilder2 ✓ |
| Frontend | Next.js 15 | Next.js 15 ✓ |

**Rationale**: Wenn wir später Cross-Projekte-Migrationen oder geteilte Sub-Module brauchen,
sind die Versionen identisch. Lock-Datei-Pinning ist Pflicht.

## 3. Engineering Disciplines

### 3.1 Backend (.ts → hot-reload)
Analog de-invoice: **Immer kill+restart ts-node nach Backend-Änderung**.
HMR verhält sich bei NestJS unzuverlässig (Module-Re-Registrierung). Workflow:
```bash
pkill -f "ts-node src/main.ts" || true
sleep 1
cd backend && npm run dev
```
**Niemals** auf automatisches Reload verlassen.

### 3.2 PDF / Layout Bug Debugging
**Niemals** direkt das Service-Layer aufrufen. Immer den **HTTP-Pfad** (Controller → Service → PDFKit-Stream)
gehen, weil dort die Mandant-Isolation, Audit-Trail und Header-Middleware aktiv sind.
Beispiel: `curl -H "Authorization: Bearer $JWT" http://localhost:3000/api/bilanz/{id}/pdf -o /tmp/test.pdf`

### 3.3 TypeScript-Validierung
Next.js dev ist `transpile-only` — TypeScript-Fehler werden **nicht** im Browser sichtbar.
Vor jedem Commit:

* Frontend: `cd frontend && npm run typecheck`
* Backend:  `cd backend && npm run typecheck`

**Wichtig (2026-09-28):** `tsc --noEmit` allein ist im Backend ein **Vakuum** —
`tsconfig.json` exclude:t `e2e/`, `prisma/seed.ts` und die Tools, d. h. genau der
Code, der überwiegend defekt war, wurde nie geprüft. `npm run typecheck` führt
deshalb zwei Durchläufe aus: den Build-Scope (`tsc --noEmit`) **und** den
Gesamtbaum über `tsconfig.test.json` (src + e2e + prisma + Scripts).
`tsconfig.json` selbst bleibt bewusst unverändert, weil `rootDir: ./src` und
`outDir` nicht mitwachsen dürfen — sonst läge `dist/main.js` unter `dist/src/main.js`
und `npm start` bräche.

### 3.4 Mandant-ID in jeder Query
Jede Datenbank-Operation MUSS durch den Mandant-Interceptor (NestJS Guard).
```typescript
// RICHTIG
const bilanz = await this.prisma.bilanz.findFirst({
  where: { id, mandantId: user.mandantId }  // explizit gefiltert
});

// FALSCH
const bilanz = await this.prisma.bilanz.findUnique({ where: { id } });
```
**ESLint-Regel** (Phase 1): `no-restricted-syntax` für `findUnique`/`findFirst` ohne `mandantId`-Argument.

### 3.5 Audit-Trail Pflicht
Jede Mutation (POST/PUT/PATCH/DELETE) erzeugt einen `AuditLog`-Eintrag mit:
- `userId`, `mandantId`, `timestamp`, `action` (CREATE|UPDATE|DELETE|SIGN|SUBMIT),
- `entityType`, `entityId`, `previousState` (JSON), `newState` (JSON),
- `ipAddress`, `userAgent`.

Helper: `AuditTrailService.record(user, entity, action, prev, next)`.

### 3.6 Signatur
**Alle** eingereichten Jahresabschlüsse werden **vor** der BAnz-Submission qualifiziert signiert:
- `@signpdf/signer-p12` mit Hardware-Token oder Kartenleser
- PDF/A-3 Container für Langzeit-Archivierung
- Zeitstempel von einem vertrauenswürdigen TSA (z.B. DigiStamp)

## 4. BAnz Submission Channels

| Channel | Trigger | Wann |
|---|---|---|
| **BAnz XML/XBRL** | Standard-Jahresabschluss | M2 (Monat 4-6) |
| **PDF direkt** | Kleinstkapitalgesellschaft (§ 326 HGB) | M1 (Monat 1-3) |
| **E-Bilanz TAXONOMIE** | Konzernabschluss (§ 11 PublG) | M3 (Monat 7-9) |

Adapter-Pattern: `BanzChannelService` mit Strategy-Pattern.
```typescript
interface IBanzChannel {
  channel: 'XML_XBRL' | 'PDF_DIRECT' | 'EBILANZ_TAXONOMIE';
  validate(abschluss: Abschluss): ValidationResult;
  render(abschluss: Abschluss): Buffer;
  submit(abschluss, signatur: Signature): SubmissionResult;
}
```

## 5. RBAC Matrix

| Rolle | Mandant-CRUD | Bilanz/GuV | BAnz-Submit | Signatur | Audit-Read |
|---|---|---|---|---|---|
| `GF` | R | R | R (vor Sign) | ✗ | R (eigene) |
| `Steuerberater` | R | CRU | ✗ | ✗ | R |
| `Wirtschaftsprüfer` | R | R | R (Prüfung) | ✓ (Prüfsignatur) | R |
| `Kanzlei-Admin` | CRU (eigene) | R (alle) | ✗ | ✗ | R |
| `System-Admin` | – | – | – | – | R (alle) |

`C` = Create, `R` = Read, `U` = Update, `D` = Delete
Guard-Pattern: `@Roles('Steuerberater', 'GF')` Decorators an Controller-Methoden.

## 6. Test-Strategie

| Layer | Tool | Was |
|---|---|---|
| Backend Unit | Vitest | Services, Validatoren, RBAC-Guard |
| Backend Integration | Vitest + Test-DB | Endpoints mit echtem Prisma gegen Test-DB |
| Backend E2E | shell-Skripte + curl | Voller Flow: Auth → Bilanz → PDF |
| Frontend E2E | Playwright | Login → Formular → Submit → PDF-Download |
| XML/XBRL | xmllint + BAnz-Schemas | Validierung gegen Schema-Definitionen |
| PDF | pdf-parse + Visuelle Inspektion | Text-Layer-Extraktion, Layout-Check |

**Pflicht**: Jeder neue Endpoint hat einen e2e-Test **vor** dem ersten Commit.

## 7. Datenmodell (Überblick)

```
Mandant (1) ──── (n) User ──── (n) AuditLog
   │                  │
   │                  │
   ├──── (n) Bilanz ─┴──── (n) BilanzPosition
   ├──── (n) GuV ────────── (n) GuVPosition
   ├──── (n) Anhang ─────── (n) AnhangAbschnitt
   │
   └──── (1) Jahresabschluss ──┬── (n) AbschlussPosition
                                ├── (n) Signature
                                └── (n) Submission ──── BAnzChannel
```

Vollständiges ER-Diagramm in `docs/datenmodell.md` (Phase 1 Sprint 2).

## 8. Git-Workflow

- Branch-Naming: `feat/<milestone>-<feature>`, `fix/<milestone>-<bug>`, `chore/<task>`
- Conventional Commits (feat, fix, chore, docs, test, refactor, perf, ci, build)
- PR-Target: `main` (kein `develop`-Branch — Pilot-Projekt, kleine Teams)
- **Sperre**: Keine Direct-Push auf `main` für `/backend/src/**` (CI-Typecheck-Pflicht).

## 9. Deployment

- **Dev**: Docker Compose (Postgres + Redis + Backend + Frontend)
- **Pilot (M1)**: Hetzner VPS (CX22), single VM, docker-compose.prod.yml
- **Produktion (M4)**: Hetzner Cloud (CCX) + Object Storage (S3 Object Lock für WORM)
- **Migration**: GitHub Actions → SSH → docker compose pull && up

## 10. Secrets & Env-Variablen

| Variable | Zweck | Quelle |
|---|---|---|
| `DATABASE_URL` | Postgres | Hetzner Managed oder lokaler Container |
| `JWT_SECRET` | 256-bit | `openssl rand -hex 32` |
| `BUNDESANZEIGER_PORTAL_USER` | BAnz-Submission | Bundesanzeiger Verlag Account |
| `BUNDESANZEIGER_PORTAL_PWD` | BAnz-Submission | dito |
| `SIGN_P12_PATH` / `SIGN_P12_PWD` | Qualifizierte Signatur | Kartenleser-Token |
| `S3_ENDPOINT` / `S3_ACCESS_KEY` | WORM-Storage | Hetzner S3 / MinIO |
| `SMTP_*` | E-Mail-Versand | SMTP-Provider |

**Regel**: Niemals in Git committen. `.env` in `.gitignore`, `.env.example` als Template.

## 11. Was zu vermeiden ist

| Anti-Pattern | Warum |
|---|---|
| `findUnique` ohne `mandantId`-Filter | Mandanten-Leak |
| Direkter Service-Call für PDF-Debug | Audit-Trail verpasst |
| HMR für Backend-Änderungen | NestJS reload-Probleme |
| Mock-Daten in Audit-Trail | Compliance-Verstoß |
| Englische UI-Strings | User-Anforderung (siehe User-Memory) |
| Datei-Speicherung ohne WORM | GoBD-Verstoß (10 Jahre Aufbewahrung) |
| BAnz-Submission ohne Signatur | Rechtlich ungültig |

## 12. Referenzen

- [de-invoice/AGENTS.md](../de-invoice/AGENTS.md) — Engineering-Konventionen
- [docs/rechtsrahmen.md](docs/rechtsrahmen.md) — HGB/PublG/GoBD-Mappings (Phase 1 Sprint 1)
- [docs/banz-schemata.md](docs/banz-schemata.md) — BAnz XML/XBRL Schemas (Phase 2)
- [docs/gobd-architektur.md](docs/gobd-architektur.md) — GoBD-Architektur (Phase 1 Sprint 3)