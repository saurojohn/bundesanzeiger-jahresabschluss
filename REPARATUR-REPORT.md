# Reparatur-Report — bundesanzeiger-jahresabschluss

> Datum: 2026-09-28
> Umfang: „Code kann laufen und sich selbst belegen" (Deployment, qeS-Zertifikate und
> externe IDW-PS-880-Audit sind ausdrücklich **nicht** enthalten).
> Verifiziert durch: eigene Testläufe + unabhängiges Audit (siehe `VERIFIER-REPORT.md`).

---

## 1. Ausgangslage

Das Repository trug in `README.md` und `docs/MILESTONE-4.md` durchgehend grüne Häkchen
(`✅ Production-Ready`, alle Meilensteine M1–M4 abgeschlossen, „CI green" in etlichen
Commit-Messages). Die Tests waren **trotzdem nicht lauffähig**:

```
Test Files  13 failed (13)
Tests       8 failed | 128 skipped (136)
```

128 der 136 Tests wurden übersprungen, weil die Specs bereits in der **Collect-Phase**
abstarben. Ein grünes Häkchen ohne ausführbaren Testlauf ist kein Nachweis.

Zusätzlich fehlte jede Dev-Infrastruktur: kein lauffähiges Schema, kein lauffähiger
Seed, kein Start-Setup, kein S3/WORM-Ziel.

---

## 2. Behobene Fehler

Alle folgenden Punkte waren **echte Defekte**, keine Konfigurationsschönheit.

### 2.1 Datenschicht — nichts war jemals gebaut

| # | Ort | Befund | Wirkung |
|---|---|---|---|
| 1 | `prisma/migrations/` | Es existierte **nur** die M4-Migration. Sie enthält ausschließlich `ALTER TABLE kanzlei` / `ALTER TABLE audit_log` — diese Tabellen wurden nirgends erzeugt. | `prisma migrate deploy` auf einer frischen DB schlug **immer** fehl. Das System war auf keiner Umgebung deploybar. |

**Fix:** `2026_09_14_120000_init_baseline/migration.sql` ergänzt (902 Zeilen,
27 `CREATE TABLE`, 69 `CREATE INDEX`), erzeugt deterministisch via
`prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma`.
Läuft vor der M4-Migration, deren `ADD COLUMN IF NOT EXISTS` dadurch idempotent No-Op wird.

### 2.2 Seed — drei Fehler, Seed lief nie

| # | Ort | Befund |
|---|---|---|
| 2 | `prisma/seed.ts` | 68 Felder `bilanzId: ''` / `guvId: ''` in verschachteltem `positionen: { create: [...] }`. Prisma akzeptiert in verschachteltem `create` **kein** skalares FK → `Unknown argument 'bilanzId'`. |
| 3 | `prisma/seed.ts` | Typannotationen `Prisma.BilanzPositionCreateManyInput[]` / `GuVPositionCreateManyInput[]` verlangten das FK, das in (2) entfernt werden musste. Korrekt für verschachteltes `create` ist `…CreateWithoutBilanzInput` / `…CreateWithoutGuvInput`. |

**Ergebnis:** `prisma db seed` läuft durch und legt Kanzlei, 3 Mandanten, 5 User,
Bilanz/GuV/Anhang (GJ 2025) sowie 5 IDW-Prüfregeln an.

### 2.3 Build/Test-Toolchain — „grün" war eine Illusion

| # | Ort | Befund | Wirkung |
|---|---|---|---|
| 4 | `tsconfig.json` | Kein `ts-node.files`. `.d.ts` haben keinen Runtime-Output und werden von ts-node nicht geladen, von `tsc` dagegen schon. | `tsc --noEmit` = 0 Fehler, `npm run dev` = sofort `TS2339` (`apiKeyContext`). |
| 5 | `vitest.config.ts` | Vites Default-Transformer ist **esbuild**, das `emitDecoratorMetadata` nicht unterstützt. | Alle `@Injectable()` verloren ihre Konstruktor-Reflection → jeder Dependency wurde `undefined` injiziert. Ursache der 13 Collect-Abstürze. |
| 6 | `tsconfig.json` | `exclude` enthielt `e2e` und `prisma/seed.ts` — genau die Stellen, die kaputt waren. | Der in `AGENTS.md §3.3` vorgeschriebene Typecheck prüfte sie nie. |

**Fix:** `"ts-node": { "files": true }`; `unplugin-swc` als Vitest-Transformer (swc
emittiert die Decorator-Metadaten identisch zu `tsc`).

### 2.4 Laufzeitabstürze beim Start

| # | Ort | Befund |
|---|---|---|
| 7 | `api/dto/api-key.dto.ts` | `CreateApiKeyResponseDto` referenzierte `ApiKeyDto`, das **darunter** deklariert war. Mit `emitDecoratorMetadata` wird `design:type` zur Laufzeit ausgewertet → `ReferenceError: Cannot access 'ApiKeyDto' before initialization`. Der Server startete nicht. |
| 8 | `dns/dns.module.ts` | `DomainVerificationService` braucht `AuditService`, `AuditModule` war nicht importiert → `UnknownDependenciesException`. |
| 9 | `auth/auth.module.ts` | `ApiKeyService` braucht `JwtService`; `AuthModule` importierte `JwtModule`, exportierte es aber nicht → `UnknownDependenciesException`. |

### 2.5 Sicherheits- und Zugriffskorrektheit

| # | Ort | Befund | Wirkung |
|---|---|---|---|
| 10 | `auth/guards/mandant.guard.ts` | Der Guard las `mandantId` aus `params`, Header `x-mandant-id` und `body` — **nicht** aus `req.query`. Alle Listen-Endpunkte deklarieren aber `@Query('mandantId')`. | `GET /api/bilanz`, `/api/guv`, `/api/anhang` lieferten für **jede Rolle außer SYSTEM_ADMIN** `403 "mandantId erforderlich"` — unabhängig davon, was der Client sendete. Die Kernabruf-Pfade waren faktisch tot. |
| 11 | `mandant/services/mandant.service.ts` | Die Backwards-Compat-Ausnahme („ohne Pagination flaches Array") galt nur für `SYSTEM_ADMIN`. Alle anderen erhielten immer `{items,total,…}`. | Regression aus dem M3-Cursor-Pagination-Rollout: der im Controller-JSDoc zugesagte Array-Vertrag galt nicht mehr. |

**Fix (10):** `req.query` ergänzt, mit **bewusster Präzedenz** `params → header → query → body`.
Der Header bleibt bewusst vor dem Query, damit ein Client per Query-Parameter keinen
per Header gesetzten Mandanten überschreiben kann. Die Mandantentrennung selbst ist
unverändert und weiterhin aktiv.

**Fix (11):** Ausnahme auf alle Rollen ausgeweitet.

| # | Ort | Befund | Wirkung |
|---|---|---|---|
| 12 | `health/health.controller.ts` | `HealthController` war nicht mit `@Public()` annotiert, der globale `JwtAuthGuard` blockierte ihn. | `GET /health` → **401**. NGINX-`health_check`, Docker-Healthcheck und externes Monitoring hätten dauerhaft „tot" gemeldet. |
| 13 | `common/cache/redis-cache-provider.ts` | Der Konstruktor baute **immer** `new KeyvRedis(REDIS_URL)` — unabhängig von `CACHE_PROVIDER`. Da der Provider `@Optional()` trotzdem im DI-Container stand, lief im Memory-Modus dauerhaft ein ioredis-Reconnect-Sturm gegen `localhost:6379`, bis der Prozess einbrach. | Der Server starb reproduzierbar nach wenigen Minuten. |

### 2.6 PDF — es konnte nie ein PDF erzeugt werden

`bilanz.template.ts` und `abschluss.template.ts` (identisch kopiert) platzierten den
Footer bei

```ts
const y = doc.page.height - PDF_LAYOUT.margins.bottom + 20;   // +20 → außerhalb
```

Der beschreibbare Bereich endet bei `page.height - margins.bottom`. PDFKit reagierte
mit einem automatischen `addPage()`; das löste den `pageAdded`-Listener aus, der
`drawFooter()` erneut aufrief — der wieder außerhalb stand und erneut eine Seite
anforderte. Ergebnis: **endlose Seitenschleife** bis
`RangeError: Maximum call stack size exceeded`. Nicht ein einziges Bilanz- oder
Abschluss-PDF war erzeugbar; alle nachfolgenden Tests schlugen mit
„Kein PDF für BILANZ … vorhanden" fehl.

**Fix:** Footer-Start um 48 pt nach oben (`-48`), Reserve für die vier Zeilen à 12 pt.
Zusätzlich `ellipsis`/`height` an den Tabellen-`text()`-Aufrufen, die mit
`lineBreak: false` + zu schmaler Breite dasselbe Fehlverhalten auslösen konnten.

### 2.7 DATEV-Export nicht normkonform

`datev/utils/csv-writer.ts` quotete Felder **nur**, wenn sie selbst ein Trenn- oder
Sonderzeichen enthielten. Der Header wurde daher als

```
Formatname;Version;Berater;Mandant;…
```

geschrieben statt DATEV-EXTF-konform als `"Formatname";"Version";"Berater";"Mandant";…`.
Die eigene Import-Seite (`datev-import/utils/csv-parser.ts`) liest Quotes korrekt, der
Round-Trip war also inkonsistent, und die Exporte wären bei DATEV/Addison/lexware
nicht sauber einlesbar.

**Fix:** jedes Feld wird gequotet, leere Felder als `""`.

### 2.8 Test-Harness, das es nicht gab

* `run-local.sh` (neu) — startet Postgres, S3-Mock und Backend, führt Migration und
  Seed aus, wartet auf `/health`.
* `s3-mock/server.js` (neu) — minimaler S3-kompatibler Server für den WORM-Pfad.
  **MinIO ist als Open-Source-Server archiviert** (`dl.min.io` liefert `410 Gone`),
  ein echter Object-Lock-Testlauf war damit nicht möglich. Der Mock implementiert
  Head/Put/Get/Delete inkl. **echter** Lock-Semantik: `DELETE` auf ein Objekt mit
  aktivem COMPLIANCE-Lock antwortet `403 AccessDenied`.
* `pdf-parse` ergänzt — `buffer.toString('latin1')` liest nur den rohen Bytestream und
  findet im FlateDecode-komprimierten Content-Stream nichts. Die vier PDF-Texttests
  „bestanden" vorher nur, weil der Titel zufällig auch in den unkomprimierten
  Info-Metadaten stand. `AGENTS.md §6` schreibt `pdf-parse` ohnehin vor.

### 2.9 Testverträge korrigiert (Tests, nicht Produktcode)

| Datei | Änderung | Begründung |
|---|---|---|
| `e2e/api.e2e.spec.ts`, `e2e/wp.e2e.spec.ts` | Passwörter auf die Seed-Werte `Admin123!` / `Demo123!` angeglichen (14 Stellen) | Tests nutzten `admin123` / `demo1234`; Seed ist die Quelle der Wahrheit. |
| `e2e/ebilanz.e2e.spec.ts`, `e2e/datev.e2e.spec.ts` | `mandantId` von `body` nach Query-String verschoben (19 Stellen) | Die Controller deklarieren `@Query('mandantId')`; der Body-Ort wurde von der `ValidationPipe` (`forbidNonWhitelisted`) mit `400 property mandantId should not exist` abgelehnt. MandantGuard- und RBAC-Wirkung bleibt erhalten. |
| `e2e/datev.e2e.spec.ts` | Erwartung `"Beratungserlöse"` → `"Erlöse aus Beratung"` | `Beratungserlöse` ist weder offizielles SKR03- noch SKR04-Konto. Die projektinterne Tabelle `datev/mappings/skr04-*.ts` ist die Single Source of Truth für Export und Import. **Offen:** Kontobezeichnungen sollten gegen die offizielle SKR04-Liste abgeglichen werden. |

---

## 3. Ergebnis

| | vorher | nachher |
|---|---|---|
| Testdateien | 13 von 13 tot | 5 von 13 grün |
| Tests | 0 ausführbar (8 fail / 128 skip) | **104 grün / 22 rot** (von 126) |
| `prisma migrate deploy` (frische DB) | schlägt fehl | läuft durch |
| `prisma db seed` | schlägt fehl | läuft durch |
| Backend-Start | `ReferenceError` | `Nest application successfully started` |
| `GET /health` | 401 | 200 (ohne Token) |
| PDF-Erzeugung | endloser Stack-Overflow | PDF mit Text-Layer, SHA-256 und 10-Jahres-Retention |
| Redis-Verbindungen im Memory-Modus | Dauer-Reconnect, Prozess stirbt | 0 |

Der Backend-Prozess läuft unter `run-local.sh` stabil; ein kompletter `vitest`-Lauf
wurde wiederholt reproduziert.

---

## 4. Was **nicht** behoben ist

22 Fehlschläge, nach Ursache gruppiert:

| Bereich | Anzahl | Charakter |
|---|---|---|
| `datev-import` | 5 | fachliche Logik (Saldovortrag, Skip-/Mapping-Zählung) |
| `konsolidierung` | 4 | fachliche Logik |
| `guv` | 4 | fachliche Logik |
| `api` (Public-API/OAuth2) | 4 | fachliche Logik |
| `bilanz` | 3 | fachliche Logik |
| `pdf` | 2 | Restsymptome nach dem Template-Fix |
| `signatur` | 1 | siehe unten |
| `pagination` | 1 | Vertragsdetail |

Diese sind **keine** Umgebungs- oder Toolchain-Probleme mehr, sondern fachliches Verhalten
der Module. Sie brauchen jeweils eigene Analyse.

### 4.1 Offener Compliance-Befund (nicht durch Tests abgedeckt)

`signatur/services/signatur.service.ts` (~Zeile 300 ff.):

```ts
const certificateExpired = false;   // hart kodiert
const timestampValid = false;        // hart kodiert
const valid =
  signatureCount > 0 &&
  documentIntegrity &&
  !certificateExpired &&            // konstant true
  errors.length === 0;               // timestampValid NICHT geprüft
```

`timestampValid` geht **nicht** in die Gültigkeitsentscheidung ein, die
Zertifikatsgültigkeit wird nicht geprüft, und ohne `expectedSignerEmail` wird jedem
Whitelist-Issuer vertraut. `AGENTS.md §3.6` verlangt, dass **jeder** eingereichte
Jahresabschluss vor der BAnz-Submission qualifiziert signiert wird, und `§11` führt
„BAnz-Submission ohne Signatur" als Rechtlichkeitsverstoß.

Der Mock-Modus ist im Code kommentiert und war als已知 offener Punkt für M3 vermerkt —
der Test dazu ist deshalb grün. **Produktiv geändert wurde das nicht**, weil eine
falsch-positive Signaturprüfung auf einem Compliance-Produkt schlimmer ist als eine
offen als Mock markierte. Diese Stelle ist vor jedem Realbetrieb zu schließen.

---

## 5. Weiterhin nicht Bestandteil dieser Arbeit

* Deployment (Hetzner-VPS-IP + SSH-Key fehlen weiterhin)
* qeS-Signaturzertifikate (TSA-Token, echte Zertifikatskette)
* IDW-PS-880-Audit durch eine unabhängige Stelle — `SECURITY-AUDIT.md` nennt als
  Auditor „Mavis + User", also **keine** unabhängige Prüfung im Sinne der Norm
* Löschung von `claude-telegram-bridge` (totes Repository, ein Initial-Commit, 5/2026)

---

## 6. Statusangaben in der Dokumentation

`README.md` und `docs/MILESTONE-4.md` führen weiterhin grüne Häkchen, die den
tatsächlichen Stand nicht abbilden (u. a. Sprint 3/4/5 in `MILESTONE-4.md` **gleichzeitig**
als „abgeschlossen" und als „geplant" geführt). Diese Angaben wurden bewusst **nicht**
automatisch umgeschrieben, weil eine nachträgliche Statuskorrektur ohne fachliche
Abnahme des Erstellers irreführend wäre. Sie sind als erster zu korrigieren, sobald die
22 verbleibenden Fehlschläge abgearbeitet sind.

---

# Nachtrag — Runde 2 (nach unabhängigem Audit)

Ein adversarisches Audit (`VERIFIER-REPORT.md`, **Verdikt: FAIL**) hat die Runde-1-Arbeit
geprueft, indem es jeden Fix zuruecknahm, den Fehler reproduzierte und danach aktiv nach
Regressionen suchte. Der Befund war berechtigt: **die Zahlen aus Runde 1 waren nicht
belastbar.** Sie ergaben:

> Lauf 1: 104 passed / 22 failed
> Lauf 2: 112 passed / 14 failed

8 Fehlschlaege verschwanden beim zweiten Lauf allein dadurch, dass die Specs feste
Geschaeftsjahre gegen einen Unique-Constraint verwenden. Eine gruene Zahl, die vom
DB-Zustand abhaengt, ist schlimmer als eine rote — sie sieht nach Fortschritt aus.

## A. Befunde des Audits und ihre Behebung

| # | Befund | Schwere | Behebung |
|---|---|---|---|
| 1 | `prisma db seed` **zerstoert die DB** beim zweiten Lauf: Reset-Liste unvollstaendig + nicht transaktional (`user|0 bilanz|0 mandant|3` nach dem Abbruch) | hoch | Reset ist jetzt ein einziges `TRUNCATE ... CASCADE` ueber alle Tabellen (automatisch per `pg_tables` discovered, `_prisma_migrations` ausgenommen) — atomar und unabhaengig von kuenftigen Tabellen |
| 2 | Testsuite **nicht idempotent** | hoch | `e2e/global-setup.ts` (in `vitest.config.ts` als `globalSetup`) setzt die DB vor **jedem** Lauf zurueck |
| 3 | **`csv-parser.ts` Saldovortrag doppelt gezählt** — Gegenkonto wurde mit demselben S/H-Flag gebucht wie das Konto; jedes Konto fiel auf Saldo 0. **Jeder importierte Saldovortrag war fachlich falsch** | hoch (fachlich) | `accumulate()` bekommt `invertSeite`; das Gegenkonto landet auf der Gegenseite. Regressionsschutz als eigener e2e-Test ergaenzt |
| 4 | **`/health/ready` = 404** — `setGlobalPrefix('api', { exclude: ['health'] })` schliesst exakt `/health` aus, nicht den Unterpfad. Die im RUNBOOK dokumentierte NGINX-Readiness-Probe war tot, der Blue-Green-Switch haette nie ausgeloest | hoch (Betrieb) | `exclude: ['health', 'health/{*splat}']` |
| 5 | `RedisCacheProvider` **speicherte keine `x-amz-meta-*`**; der WORM-Ueberschreibschutz in `storage.service.ts` (Hash-Vergleich gegen `head.Metadata['sha256']`) war unter dem Mock **tote Logik** — nie ausfuehrbar | hoch (Compliance) | Mock speichert/returns User-Metadaten. Zusaetzlich lehnt er jetzt Re-PUT auf COMPLIANCE-gelockte Objekte mit 403 ab (vorher ueberschreibbar) und beachtet abgelaufene Retention |
| 6 | `@HttpCode` fehlte an 9 POST-Endpunkten — Validierungs-/Berechnungsoperationen antworteten 201 statt 200 | mittel | 9x ergaenzt (bilanz/guv/signatur validate, pdf generate x4, konsolidierung calculate) |
| 7 | **`pageSize` still geklemmt** statt abgelehnt: `Math.min(pageSize, 100)` — die Grenze war weder sichtbar noch testbar (ungebremstes `pageSize` = DoS-Flaeche) | mittel | `BoundedIntPipe` (`transform`-basiert; `ParseIntPipe.exceptionFactory` greift nur bei Parse-Fehlern). 5 Controller umgestellt |
| 8 | `abschluss.template.ts`: `pageAdded`-Registrierung pro Seite (311 Listener bei 120 Positionen, `MaxListenersExceededWarning`, 7,8 s statt 108 ms) | mittel | `WeakSet`-Guard — pro Dokument genau einmal registriert |
| 9 | `abschluss.template.ts` crasht bei fehlenden `abschnitte` | niedrig | `?? []` |
| 10 | 10x `if (!fixture) return;` in `api.e2e` — Tests wurden **gruen, ohne eine einzige Assertion** auszufuehren | hoch (Testintegritaet) | durch `throw` ersetzt |
| 11 | `api.e2e` sandte eine **Mandant-UUID als `kanzleiId`** (500 statt 201/400) | mittel | kanzleiId wird jetzt aus `/api/mandant` gelesen |
| 12 | `@Controller({ path: 'api/v1' })` unter globalem Prefix `api` -> reale Route `/api/**api**/v1/...`; **jede** Public-API-Antwortete 404 | hoch | `path: 'v1'` |
| 13 | `POST /api/oauth/token` ohne `@Public()` — der globale `JwtAuthGuard` beantwortete 401, **bevor** die client_credentials-Authentifizierung lief. Der Token-Endpoint war unbenutzbar | hoch | `@Public()` |
| 14 | `ApiV1Controller` ohne `@Public()` — dito. **Die gesamte Public-API (M4 Sprint 1) war unbenutzbar** | hoch | `@Public()` |
| 15 | Webhook-`create` mit `@Body() dto: CreateWebhookSubscriptionDto & { kanzleiId: string }` — Kreuz-Typen werden zu `Object` emittiert, Nest erkennt **kein DTO**, die Validierung wurde **vollstaendig uebersprungen**. `url: 'not-a-url'` wurde mit 201 akzeptiert; der Wert geht als Abholpunkt in die Webhook-Zustellung (SSRF-Flaeche) | hoch (Sicherheit) | echte Klasse `CreateWebhookSubscriptionBodyDto` (mit `@IsString`/`@IsUUID` — sonst `forbidNonWhitelisted` den neuen Feld ablehnt) |
| 16 | `pdf.e2e` brach schon beim Import ab: `pdf-parse@1.1.1` fuehrt bei `isDebugMode` seinen Demo-Code aus und liest `./test/data/05-versions-space.pdf` (ENOENT) | mittel | Deep-Import `pdf-parse/lib/pdf-parse.js` |
| 17 | `run-local.sh` versprach im Kommentar "Migrationen + Seed", fuehrte aber **nur** `migrate deploy` aus | mittel | Seed laeuft jetzt (opt-in via `--no-seed` / `SEED=0`) |

### Selbstverstrickung, die das Audit aufgedeckt hat

Der Audit beanstandete zurecht eine **eigene**.noetige Abschwaechung: in `pdf.e2e` hatte ich
`toContain('Bundesanzeiger Jahresabschluss')` auf `toContain('Bundesanzeiger')` verkuerzt.
Zurueckgenommen — der volle String ist im extrahierten Textlayer nachweisbar.

Ausserdem war der Kommentar der neuen Migration falsch (69 statt 84 `CREATE INDEX`); korrigiert.

## B. Testerwartungen, die fachlich falsch waren

Nicht jede rote Testzeile war ein Produktfehler. In drei Faellen war die **Erwartung** falsch
und wurde mit Begruendung korrigiert:

* `datev-import` Saldovortrag: `buildMiniCsv()` bucht innerhalb desselben Kontenpaares
  (netto 0). Erwartet wurde `haben=0` fuer 4400 — das unterstellte, das Gegenkonto werde gar
  nicht erfasst. Genau das war der Fehler. Korrigiert auf `soll=1000/haben=1000/saldo=0`.
* `datev.e2e` Konto 4400: erwartet `"Beratungserlöse"` — weder offizielles SKR03- noch
  SKR04-Konto. Projektinterne Tabelle ist die Quelle der Wahrheit; Erwartung angepasst und
  als fachlich zu pruefen markiert.
* `api.e2e` OAuth-Pfade: `/oauth/token` statt `/api/oauth/token`.

Zusaetzlich waren vier `datev-import`-Fixtures unbrauchbar, weil sie **gegenlaeufige Zeilen
auf demselben Kontenpaar** enthielten. Saldo 0 -> der Importer ueberspringt die Position
vor dem Mapping ("kein Buchungseffekt"). Dadurch testeten sie weder `userMappingOverrides`
noch die Skip-Warnung — beide Funktionen waren funktionsfaehig, nur ungeprueft.

## C. Ergebnis Runde 2

| | Runde 1 | Runde 1 (2. Lauf) | Runde 2 |
|---|---|---|---|
| Durchlaeufe | 104 / 22 | 112 / 14 | **137 / 137** |
| Reproduzierbar | **nein** | nein | **ja** (zwei Läufe identisch) |
| `tsc --noEmit` | 0 | 0 | 0 |
| `npm run lint` | 0 | 0 | 0 |

`./run-local.sh` startet Postgres, S3-Mock und Backend, migriert und seedet.
`npx vitest run` ist beliebig oft wiederholbar, ohne dass sich das Ergebnis aendert.

## D. Was weiterhin offen ist

1. **`signatur.service.ts` (~Z. 300)** — `certificateExpired = false`, `timestampValid = false`
   hart kodiert, und `timestampValid` geht **nicht** in `valid` ein. Bewusst **nicht** geaendert:
   eine falsch-positive Signaturpruefung ist auf einem Compliance-Produkt schlimmer als ein
   offen als Mock markierter Zustand. Muss vor jedem Realbetrieb geschlossen werden.
2. **IDW-PS-880-Audit** durch eine unabhängige Stelle. `SECURITY-AUDIT.md` nennt als Auditor
   "Mavis + User" — das ist keine unabhaengige Pruefung im Sinne der Norm.
3. **SKR04-Kontobezeichnungen** in `datev/mappings/skr04-*.ts` sind projektintern und nicht
   1:1 die offiziellen DATEV-Bezeichnungen; fuer den rechtssicheren Export abzugleichen.
4. **`README.md` / `docs/MILESTONE-4.md`** fuehren weiter gruene Haekchen, die den Stand nicht
   abbilden (u. a. Sprint 3/4/5 dort gleichzeitig "abgeschlossen" und "geplant"). Bewusst
   nicht automatisch umgeschrieben — eine Statuskorrektur gehoert zur fachlichen Abnahme.
5. **PDF-Ausschnitt in Bilanz-Tabellen**: `bezeichnung` wird per `ellipsis` gekuerzt
   ("Selbst geschaffene…"). Verhindert den Stack-Overflow, ist aber fuer die
   Pflichtveroeffentlichung zu kurz — Layout gehoert fachlich nachgezogen.
6. **9 POST-Endpunkte ohne Statuscode-Tests** (`signatur/sign-*`, `inspect-p12`,
   `wp/.../regeln/run`) — ihr HTTP-Vertrag ist weder in Specs noch in der Doku festgeschrieben.
7. **Deployment, qeS-Zertifikate, Stripe, BAnz-Portal-Zugang** — weiterhin nicht Teil dieser
   Arbeit.

---

# Nachtrag — Runde 3 (Frontend)

Der Verifikationsstand nannte als offene Lücke: „Frontend-E2E: 0 Tests". Bei der
Prüfung dieses Punkts zeigte sich, dass das Problem eine Ebene tiefer lag.

## 1. Das Frontend war nie lauffähig

`cd frontend && npm install` schlug fehl:

```
npm error code ETARGET
npm error notarget No matching version found for @types/react@19.0.0-rc.1.
```

Diese Version **existiert auf npm nicht** (verfügbar sind `19.0.0` … `19.0.5`).
Folge: Das Frontend ließ sich nicht installieren, nicht bauen, nicht starten und
natürlich nicht testen. Die Aussage in `README.md` („Frontend 100 % Deutsch",
`M2 ✅ Frontend fertig`) war nicht überprüfbar — sie war falsch.

Korrigiert auf `@types/react`/`@types/react-dom` `19.0.0`. (`react` selbst bleibt
auf `19.0.0-rc-66855b96-20241106`, weil das exakt die Peer-Dependency von
`next@15.0.3` ist.)

## 2. Nach dem Installieren: 87 TypeScript-Fehler

### 2.1 Syntaxfehler (87 Fehler, eine Ursache)

`src/components/guv/GuvListView.tsx`: ein `<div>` wurde geöffnet, aber nie
geschlossen. Der TypeScript-Compiler meldete daraus 87 Folgefehler in derselben
Datei. Ein fehlendes `</div>` — die Datei konnte nicht einmal geparst werden.

### 2.2 Fünf echte Logikfehler in den M4-Komponenten

| Datei | Fehler | Wirkung |
|---|---|---|
| `subscription/SubscriptionView.tsx` | **`apiFetch` als `Response` behandelt**: `if (res.ok) { await res.json() }` — `apiFetch` gibt aber den **bereits geparsten JSON-Body** zurück (`src/lib/api.ts`). `ok` ist auf JSON immer `undefined`, `json()` existiert nicht. | Der gesamte Subscription-Lade-, Checkout-, Activate- und Cancel-Pfad konnte nie durchlaufen. |
| `subscription/SubscriptionView.tsx` | `firstKanzlei` per `const` **innerhalb** eines `if`-Blocks deklariert und außerhalb gelesen | ReferenceError nach dem ersten erfolgreichen Response |
| `dns/CustomDomainWizard.tsx` | dasselbe `Response`-Missverständnis (5 Aufrufe) | Domain-Wizard unbenutzbar |
| `bilanz/BilanzListView.tsx`, `guv/GuvListView.tsx` | `onEdit` / `onDelete` **existieren in der Komponente nicht** (keine Props, keine Funktion) | Edit-/Delete-Buttons waren toter Code |
| 11 Aufrufe in beiden Dateien | `apiFetch('/api/auth/me')` — `apiFetch` setzt selbst `BASE_API = '/api'` davor, `next.config.ts` rewritet `/api/*` aufs Backend | Alle landeten unter **`/api/api/…`** → 404 |

Die letzten beiden Punkte sind besonders bemerkenswert: die Dateien **kompilierten
nicht**, wurden also nie ausgeführt. Dass die Delete-Buttons „funktionierten",
konnte niemand beobachtet haben — es gab keine Delete-Implementierung.

### 2.3 Weitere Korrekturen

* `handleDelete` für Bilanz und GuV implementiert (DELETE-Endpoint, DRAFT-Prüfung
  liegt im Backend, Bestätigungsdialog, Liste neu laden).
* CSS-Custom-Properties in `BrandingEditor` sauber typisiert statt per
  `@ts-expect-error` unterdrückt (die Direktive war ungenutzt und wäre bei jeder
  Typänderung stillschweigend zum Fehler geworden).
* `GuvListView`: `schemaData` null-sicher.

**Ergebnis: `tsc --noEmit` 87 → 0 Fehler, `npm run build` erfolgreich (14 Seiten).**

## 3. Playwright-E2E ergänzt

`frontend/playwright.config.ts` und `frontend/e2e/smoke.spec.ts` waren im
`package.json` angelegt (`@playwright/test` in devDependencies, `test:e2e`-Skript),
existierten aber nicht.

Die 10 Tests fahren den **Production-Build** (`next start`) gegen das echte
Backend — also die Kette Browser → Next.js-Rewrite → NestJS → PostgreSQL.
Abgedeckt: Login auf Deutsch, gültige/ungültige Anmeldung, Token in
`localStorage`, Session-Schutz der Fachseiten, Rendering von Bilanz/GuV/Anhang/
Audit/Jahresabschluss, und ein Regressionstest, der explizit prüft, dass **keine**
Anfrage unter `/api/api/…` geht.

**10 / 10 grün.**

## 4. Sicherheitshinweis

`npm install` warnt:

```
npm warn deprecated next@15.0.3: This version has a security vulnerability.
Please upgrade to a patched version. See https://nextjs.org/blog/CVE-2025-66478
```

**CVE-2025-66478** — vor einem Produktivbetrieb muss auf eine gepatchte 15.x
aktualisiert werden. Nicht in dieser Runde angefasst, weil ein Major-Update
inkompatible Änderungen in Next 15 mit sich bringt und einer der Punkte ist, der
eine bewusste Entscheidung mit fachlicher Abnahme braucht.

---

# Nachtrag — Runde 4 (Audit-Runde 2 nachgearbeitet)

`VERIFIER-REPORT-2.md` (Verdikt: **FAIL**) hat Runde 2 adversarial geprüft. Die drei
tragenden Befunde waren berechtigt.

## A. SSRF war nur das Symptom — jetzt behoben

Der Bericht hat die vollständige Ausnutzungskette demonstriert: `POST
/api/webhook-subscriptions` mit `url=http://127.0.0.1:9000/` → 201, dann
`POST /:id/test` → Zustellung, dann `GET /:id/deliveries` → Statuscode **und
Antwortkörper** des internen Dienstes. `@IsUrl` ist eine Syntaxprüfung; sie
akzeptierte 169.254.169.254 (Cloud-Metadaten), 127.0.0.1 und alle RFC1918-Netze.

Umgesetzt in `src/common/security/ssrf-guard.ts` (neu), zwei Schichten:

1. **Beim Speichern** — `parseAndAssertPublicUrl` + `@IsPublicHttpUrl` als
   class-Validator-Decorator (blockiert Literal-Private-IPs)
2. **Unmittelbar vor dem Request** — `assertResolvesToPublicAddress` löst per
   `dns.promises.lookup({all:true})` auf und prüft **alle** A-Records. Das ist
   der Schritt, der DNS-Rebinding fängt; eine reine Speicherzeitprüfung greift
   dort nicht.

Zusätzlich: `WebhookDelivery.responseBody` wird **nicht mehr persistiert**. Es
gibt nur noch Statuscode und Fehlerklasse zurück — was das Ziel antwortet,
gehört in das Log des Empfängers.

Gegenprobe (live, gegen den laufenden Server):

| URL | vorher | nachher |
|---|---|---|
| `http://169.254.169.254/latest/meta-data/` | 201 | **400** |
| `http://127.0.0.1:5432/` | 201 | **400** |
| `http://10.0.0.1/admin` | 201 | **400** |
| `http://192.168.1.1/` | 201 | **400** |

## B. Sieben Tests ohne eine einzige Assertion

`signatur.e2e` fiel auf `dummy-p12-bytes` zurück (Datei fehlte, `catch {}`),
nahm daraufhin überall `expect([400, 500]).toContain(...)` an — ein Test namens
„→ 200" wurde grün, **während er das Gegenteil belegte**. Dazu 15 `return;`-Ausstiege.

* `scripts-gen-test-p12.ts` (neu) erzeugt ein selbstsigniertes Test-Token
  (npx ts-node scripts-gen-test-p12.ts) — ausdrücklich **keine** qeS.
* Der `catch`-Fallback ist entfernt: fehlt das Zertifikat, wirft der Test.
* Alle 15 stillen `return;` in `signatur.e2e` und `pdf.e2e` sind durch echte
  Assertions bzw. `expect(...)`-Fehlschläge ersetzt.
* Die In-Memory-Mocks für `@aws-sdk/client-s3` wurden **entfernt**: die Specs
  sprechen HTTP gegen den laufenden Server, das Mock-Objekt füllte sich nie.
  WORM läuft jetzt über `s3-mock/server.js` mit echter Lock-Semantik.

## C. Gefundene Produktdefekte in der Signaturkette

Der erste echte Signaturdurchlauf deckte drei Fehler auf:

1. **`checkDocumentIntegrity` hatte eine falsche Formel.**
   `covered = start + len1 + (total - (start2 + len2))` verglich die Länge des
   ersten signierten Abschnitts (~5 KB) mit der Dateigröße (~22 KB) und lieferte
   bei **jeder** echten Signatur `false`. Jedes signierte PDF wurde als
   manipuliert abgewiesen → `valid: false` → eine BAnz-Einreichung wäre
   durchgegangen nie.

2. **`@HttpCode` fehlte an fünf Signatur-Endpunkten** — sie antworteten 201 statt 200.

3. **TSA unerreichbar** brach die Signatur mit 500 ab. Lokal ist jetzt der
   Mock-TSA aktiv (`TSA_URL` leer); die Antwort weist das sichtbar aus
   (`timestampAuthority: MOCK-TSA-BANZ-PILOT`), und `validate` meldet
   korrekt `timestampValid: false`.

Verifikation:

| Eingabe | vorher | nachher |
|---|---|---|
| gültig signiertes PDF | `valid: false` | **`valid: true`**, `documentIntegrity: true` |
| PDF + 27 Bytes Trailer | `valid: false` | `valid: false`, `documentIntegrity: false` (korrekt erkannt) |

## D. Was weiterhin **nicht** funktioniert (neu)

**Manipulation innerhalb des signierten Bereichs wird nicht erkannt.**
`checkDocumentIntegrity` validiert die `/ByteRange`-Struktur (Beginn bei 0,
zweiter Abschnitt bis Dateiende). Das erkennt nachträglich angehängte Bytes,
aber keine Änderung im signierten Text.

Für die vollständige Prüfung braucht es eine PKCS#7-CMS-Verifikation gegen das
Zertifikat (messageDigest-Vergleich). `@signpdf/verify-p12` existiert auf npm
**nicht** mehr; eine eigene ASN.1-Verifikation ist eigenständig zu bauen. Der
Test dafür ist mit `it.fails(...)` **ausdrücklich als bekannter Gap markiert**
— er wird weder als bestanden noch als stillschweigend übersprungen gemeldet.

**Das ist für einen GoBD-Betrieb vor GA zu schließen.**

## E. Weiterhin gültige Selbstkritik aus dem Bericht

* `tsc --noEmit` bleibt für `e2e/` und `prisma/seed.ts` vakuum (`exclude`).
  Erzwungene Einbeziehung zeigt echte Typfehler — **noch nicht behoben**.
* `pdf.e2e`/`signatur.e2e` umgingen den S3-Mock (jetzt behoben, siehe B).
* Die Zählung „9× `@HttpCode`" in diesem Report war ungenau; es waren 8
  benannte Stellen plus nachträglich weitere.

## F. Stand

| | Wert |
|---|---|
| Backend `tsc` / `eslint` | 0 / 0 |
| Backend e2e | **138 / 138** |
| Frontend `tsc` / `build` | 0 / erfolgreich |
| Frontend e2e (Playwright) | **10 / 10** |
| Offen | PKCS#7-Verifikation, tsconfig-`exclude`, `next@15.0.3` (CVE-2025-66478), IDW-PS-880-Audit, qeS-Token, Deployment |

---

# Nachtrag — Runde 5 (die offene `tsconfig`-Schuld)

Verifier hatte festgestellt: *"`tsc --noEmit = 0` ist Vakuum: `e2e` und
`prisma/seed.ts` stehen weiterhin in `exclude` (der Runde-1-Befund wurde nie
behoben)."* Das war seit Runde 1 bekannt und liegen geblieben. Jetzt behoben.

## 1. Zwei Konfigurationen statt einer

`tsconfig.json` lässt sich nicht einfach erweitern: `rootDir: "./src"` und
`outDir` dürfen nicht mitwachsen, sonst läge das Build-Artefakt unter
`dist/src/main.js` und `npm start` (`node dist/main.js`) bräche.

Deshalb neu: **`tsconfig.test.json`** — reine Typprüfung über den gesamten Baum
(`src` + `e2e` + `prisma` + Tools), `noEmit`, ohne `rootDir`-/`outDir`-Zwang.
`tsconfig.json` bleibt unverändert.

`npm run typecheck` führt jetzt **beide** Läufe aus:

```json
"typecheck":      "tsc --noEmit && tsc -p tsconfig.test.json",
"typecheck:full": "tsc -p tsconfig.test.json",
"typecheck:src":  "tsc --noEmit"
```

`AGENTS.md §3.3` ist entsprechend korrigiert — die Vorschrift „vor jedem Commit
`npx tsc --noEmit`" hat den Problemraum gar nicht abgedeckt.

## 2. Was sofort sichtbar wurde

Der erste Lauf über den Gesamtbaum brachte **6 echte Typfehler** — davon 3 von mir
verursacht, als ich zur Entfernung der In-Memory-S3-Mocks zu aggressiv
geschnitten hatte:

| Ort | Fehler | Ursache |
|---|---|---|
| `e2e/pdf.e2e.spec.ts` | `Cannot find name 'PdfGenResponse'` | von mir beim Mock-Entfernen gelöscht |
| `e2e/signatur.e2e.spec.ts` | `Cannot find name 'ValidationResponse'` (2×) | dito |
| `e2e/pdf.e2e.spec.ts` | `TS7016` keine Deklaration für `pdf-parse/lib/pdf-parse.js` | Deep-Import hat kein `.d.ts` |
| `e2e/bilanz.e2e.spec.ts` | `Property 'hinweise' does not exist on 'BilanzEntity'` | Test-Interface unvollständig — Feld existiert im Prisma-Modell |
| `e2e/wp.e2e.spec.ts` | `Property 'completedAt' does not exist on 'WPPruefungDto'` | dito |

Alle behoben (Interfaces ergänzt, `src/types/pdf-parse.d.ts` neu). Die letzten
zwei waren **keine Produktfehler**, sondern unvollständige Test-Schnittstellen —
aber ohne diese Konfiguration hätte man sie nie gesehen.

## 3. Stand

| Gate | vorher | nachher |
|---|---|---|
| `tsc --noEmit` (nur `src`) | 0 | 0 |
| Typprüfung **gesamt** (src + e2e + prisma + tools) | **nicht ausführbar** | **0** |
| `eslint src --max-warnings 0` | 0 | 0 |
| Backend e2e | 138/138 | 138/138 |
| Frontend tsc / Playwright | 0 / 10/10 | 0 / 10/10 |

Der Build-Pfad wurde bewusst nicht angefasst — `npm run build` und `npm start`
verhalten sich unverändert.

---

# Nachtrag — Runde 6 (CI)

Es gab keine CI. Bei ~40 behobenen Defekten war die häufigste Ursache „als fertig
markiert, aber nie ausgeführt" — Migration ohne_initial, Tests die nie starteten,
ein typecheck der die betroffenen Dateien nicht einschloss. Eine Pipeline ist damit
die wirksamste Gegenmaßnahme.

## Was `.github/workflows/ci.yml` macht

**Job `backend`** (Postgres 16 als Service):
S3-Mock starten → `npm ci` → `prisma generate` → `migrate deploy` → `db seed`
→ Test-P12 erzeugen → `npm run typecheck` (**Gesamtbaum**) → `npm run lint`
→ `npm run build` → Backend starten → `npx vitest run` → Logs als Artefakt.

**Job `frontend`** (`needs: backend`):
`npm ci` → `tsc --noEmit` → `build` → Playwright-Browser → `npx playwright test`.

## Lokal nachgestellt — nicht nur geschrieben

Eine Workflow-Datei, die nie gelaufen ist, ist dasselbe Problem wie ein
„✅ Production-Ready" ohne Tests. Die Pipeline wurde deshalb **unter CI-Bedingungen
lokal durchgespielt**: eigener Postgres, S3-Mock, **keine `.env`-Datei**,
ausschließlich Umgebungsvariablen.

Ergebnis:

| Schritt | ohne `.env` |
|---|---|
| Backend-Start (`GET /health`) | ✅ 200 |
| `npm run typecheck` (Gesamtbaum) | ✅ 0 |
| `npm run lint` | ✅ 0 |
| `npm run build` | ✅ `dist/` erzeugt |
| `npx ts-node scripts-gen-test-p12.ts` | ✅ 2406 B |
| `npx vitest run` | ✅ **138 / 138** |
| Frontend `tsc` / `build` / Playwright | ✅ 0 / ✓ / **10 / 10** |

Der Weg dorthin hat einen echten Fund zutage gefördert: der erste Entwurf enthielt
den Step-Namen `Typecheck (Gesamtbaum: src + e2e + prisma + Tools)` — der Doppelpunkt
macht daraus ungültiges YAML. Ein `tsconfig`-Fehler wäre aufgefallen, ein
YAML-Fehler im CI hätte das erste Auslösen verhindert, ohne dass jemand es merkt.

## Anmerkung zur Auslieferung

Das Verzeichnis ist **kein Git-Repository** (es liegt als Tarball vor), die Workflow-
Datei konnte daher nicht gepusht werden. Sie ist unter `.github/workflows/ci.yml`
bereit und muss einmal committed werden, damit sie greift.

---

# Nachtrag — Runde 7 (PKCS#7-Integritätsprüfung)

Der letzte offene Fachpunkt aus Runde 4: eine Manipulation **innerhalb** des
signierten Bereichs wurde nicht erkannt. Der Test dafür war mit `it.fails(...)`
als bekannter Gap markiert.

## Umsetzung

`backend/src/modules/signatur/utils/pdf-signature-verify.ts` (neu) prüft den
`messageDigest` aus dem PKCS#7-SignerInfo gegen den SHA-256 der beiden vom
`/ByteRange` bezeichneten Byte-Bereiche (ISO 32000-1 §12.8.1).

Ohne externe Abhängigkeit: `@signpdf/verify-p12` existiert auf npm nicht, und eine
vollständige CMS-Verifikation (Zertifikatskette, Signaturwert gegen den
öffentlichen Schlüssel) wäre ein eigenes Projekt. Geprüft wird der messageDigest —
die Aussage, die `valid` tragen soll: **der Inhalt ist unverändert**.

Navigation (RFC 5652), die jeweils drei Fehler in der Entwicklung gekostet hat:

1. Nach einem SEQUENCE beginnt der Inhalt bei `valueStart`, **nicht** bei
   `valueEnd` — ein Sprung auf `valueEnd` landet in den 0x00-Füllbytes und liefert
   Tag 0x00.
2. `[0] EXPLICIT` folgt derselben Regel: SignedData beginnt bei `valueStart`.
3. Im `SignerInfo` fehlt zwischen `issuerAndSerialNumber` und `signedAttrs` das
   `digestAlgorithm` — ohne es landet man in falschen Attributen.

Weiterhin im Code vermerkt: `der` darf **nicht** auf `seq.valueEnd` zugeschnitten
werden, weil dann der nächste Navigationsschritt aus der Puffergrenze läuft.

`checkDocumentIntegrity()` ruft jetzt diese Prüfung auf; ein Strukturcheck
(`start2 + length2` ≈ Dateilänge, Toleranz **2 Byte**) deckt zusätzlich Bytes ab,
die **außerhalb** der signierten Bereiche angehängt oder abgeschnitten wurden.
Eine weite Toleranz wäre selbst ein Bypass — 16 Byte konnten unentdeckt
angehängt werden.

## Nachweis (echte Signatur, 9 Positionen + Anhang + Abschneiden)

```
Original                  : VERIFIZIERT ✓
Byte    50 gekippt        : erkannt
Byte   100 gekippt        : erkannt
Byte   800 gekippt        : erkannt
Byte  1500 gekippt        : erkannt
Byte  2000 gekippt        : erkannt
Byte  5000 gekippt        : erkannt
Byte 10000 gekippt        : erkannt
Byte 18500 gekippt        : erkannt
Byte 19000 gekippt        : erkannt
angehaengt                : erkannt
50 Bytes abgeschnitten    : erkannt
Bilanz: 11 erkannt, 0 verfehlt
```

Der Test ist von `it.fails(...)` auf eine reguläre Assertion umgestellt und ist
nun Teil der grünen 138.

## Was weiterhin offen ist (ehrlich)

* **Kryptografische Verifikation fehlt.** Geprüft wird, dass der Inhalt zum
  messageDigest passt — nicht, dass die Signaturmathematik gegen den öffentlichen
  Schlüssel des Zertifikats stimmt. Ein Angreifer mit dem **Private Key** könnte
  einen konsistenten messageDigest erzeugen. Die Integritätsaussage gegen
  nachträgliche Manipulation ist damit abgedeckt (der praktisch relevante Fall
  für GoBD), die Urheberschaftsprüfung nicht.
* `certificateExpired = false` und `timestampValid = false` bleiben hart kodiert
  (siehe §D.1 Runde 2) — bewusst offen gelassen.
* Die Warnung „vollständige EU-TL-Validierung folgt in M3" ist weiterhin aktiv;
  `M3` ist als abgeschlossen markiert.

---

---

# Nachtrag — Runde 8 (Korrektur zu Runde 7: der Integritätscheck ist umgehbar)

## Selbstkorrektur

Runde 7 meldete: „✅ Signatur-Integrität implementiert, 11/11 Manipulationsversuche
erkannt." **Diese Aussage war zu weit gefasst.** Sie beruhte ausschließlich auf
Versehen (Tippfehler, versetzte Bytes). Gegen einen Angreifer mit Absicht hält
die Prüfung nicht.

## Der绕行 (Bypass), live demonstriert

```
Original                                  -> VERIFIZIERT
Byte 800 gekippt                          -> erkannt        (Versehen)
Byte 800 gekippt + messageDigest NEU BERECHNET -> BESTANDEN   (Absicht!)
```

Der `messageDigest` ist **keine Signatur**, sondern nur ein Hash des Inhalts.
Jeder kann ihn neu berechnen und in den PKCS#7-Container zurückschreiben. Die
tatsächliche Signatur ist `SignerInfo.encryptedDigest` — die Signatur des Signierenden
über seinen `signedAttrs` mit dem privaten Schlüssel. Solange nur der
messageDigest geprüft wird, kann jeder beliebige Inhalt als „signiert" durchgehen.

Damit schützt die Runde-7-Prüfung gegen **Versehen**, nicht gegen **Manipulation**.
Für GoBD ist das der Unterschied zwischen einem brauchbaren und einem wertlosen
Schutz.

## Konsequenz

`verifyPdfSignatureIntegrity()` ist als **Vorfilter** zu verstehen, nicht als
Integritätsnachweis. `checkDocumentIntegrity()` darf auf dieser Basis allein kein
`valid: true` liefern, sobald echte Beweiskraft gemeint ist.

Als nächstes ist die Verifikation von `encryptedDigest` gegen den öffentlichen
Schlüssel des mitgelieferten Zertifikats umzusetzen (RSA/ECDSA über
`signatureAlgorithm`). `node-forge` ist als Projektabhängigkeit vorhanden und kann
die Verifikation; `@signpdf/verify-p12` existiert auf npm nicht.

Bis dahin gilt: **`valid: true` bedeutet derzeit „Inhalt passt zum messageDigest",
nicht „Inhalt ist von einem vertrauenswürdigen Signierer unterschrieben".**

---

# Nachtrag — Runde 9 (echte Kryptografie-Verifikation)

Runde 8 hatte den Bypass gezeigt. Jetzt wird `encryptedDigest` gegen den
öffentlichen Schlüssel des mitgelieferten Zertifikats geprüft.

`backend/src/modules/signatur/utils/pdf-signature-verify.ts` wurde umgeschrieben
auf drei Stufen, die **alle** bestehen müssen:

1. **Struktur** — `/ByteRange` konsistent, Dateiende abgedeckt (Toleranz 2 Byte)
2. **Inhalt** — `messageDigest` == SHA-256 der ByteRange-Bereiche
3. **Kryptografie** — `encryptedDigest` verifiziert gegen den Zertifikatsschlüssel

Stufe 3 nutzt das native `node:crypto`; `node-forge` (bereits Projektabhängigkeit)
liefert nur ASN.1-/Zertifikats-Parser. PKCS#1-v1.5 über `signedAttrs` mit dem
Implizit-Tag 0xA0 → 0x31 (RFC 5652 §5.4) wird korrekt berücksichtigt.

## Nachweis

```
Original                     : VERIFIZIERT (kryptografisch = true)
  Signierer                  : CN=Bundesanzeiger Test-Signer, …
  gültig bis                 : 2027-09-29

— Versehen —
  9 Positionen Byte gekippt : alle erkannt
  angehängt                   : erkannt
  50 B abgeschnitten          : erkannt

— Absicht —
  Inhalt + messageDigest neu : ABGEWIESEN   (war in Runde 7/8 BESTANDEN)

  Bilanz: 21 erkannt, 0 verfehlt
```

Damit ist der Runde-8-Bypass geschlossen: wer den Inhalt ändert, kann den
messageDigest zwar neu berechnen, aber nicht die RSA-Signatur über `signedAttrs`
neu erzeugen.

## Was damit **nicht** geprüft wird

* **Vertrauenswürdigkeit des Zertifikats** — Zertifikatskette, EU Trusted List,
  Sperrlisten. `issuerTrusted` ist im Code weiterhin „nur Whitelist-Check aktiv".
* **Gültigkeitszeitraum** — `certificateExpired` bleibt hart kodiert `false`
  (Runde 2, §D.1). Das Zertifikat wird jetzt *mitgelesen* (`notAfter` in der
  Rückgabe), aber nicht bewertet.
* **Zeitstempel** — `timestampValid` bleibt `false` (Mock-TSA).

Ein selbstsigniertes Testzertifikat gilt damit als „kryptografisch gültig
signiert" — die Prüfung sagt: der Inhalt wurde vom Inhaber dieses Schlüssels
nicht nachträglich verändert. Sie sagt **nicht**: der Inhaber ist vertrauenswürdig.
Für den GoBD-Betrieb ist genau das der zweite, offene Schritt.

---

# Nachtrag — Runde 10 (Zertifikats-Vertrauen statt Behauptung)

Runde 2 (§D.1) hatte zwei Stellen markiert, die seit Monaten **behaupteten** statt
zu prüfen:

```ts
const certificateExpired = false;   // "pragmatisch: Vertrauen auf @signpdf-Akzeptanz"
issuerTrusted = true;               // "wir vertrauen JEDEM bekannten Issuer"
```

Der Kommentar „M3 erweitert auf EU Trusted List" war hinfällig: M3 war als
abgeschlossen geführt, die Erweiterung war nie implementiert.

## Was jetzt geprüft wird

`assessCertificateTrust()` in `signatur/utils/pdf-signature-verify.ts`:

| Prüfung | vorher | jetzt |
|---|---|---|
| Gültigkeitszeitraum | Konstante `false` | `notBefore`/`notAfter` gegen jetzt |
| `KeyUsage` | nicht geprüft | `digitalSignature` oder `nonRepudiation` erforderlich |
| `BasicConstraints` | nicht geprüft | ein `cA`-Zertifikat darf nicht signieren |
| Aussteller | **jeder** galt als vertrauenswürdig | `SIGNATURE_TRUSTED_ISSUERS` (leer = fail-closed) |
| Selbstsigniert | nicht unterschieden | **nicht** vertrauenswürdig (außer `SIGNATURE_ALLOW_SELF_SIGNED=true`) |
| Signierer-Identität | Heuristik über AcroForm-Felder | Subject-Alt-Name-E-Mail, mit Umlaut-Normalisierung |
| `signedBy` | aus PDF-Dictionary geraten | aus dem Zertifikat gelesen |

`valid` verlangt jetzt zusätzlich `issuerTrusted` — eine Signatur ohne
vertrauenswürdigen Aussteller ist keine gültige Signatur im Sinne einer
Pflichtveröffentlichung.

## Fail-closed als Standard

* `SIGNATURE_TRUSTED_ISSUERS` **leer** → es wird **nichts** als vertrauenswürdig
  anerkannt (vorher: alles).
* Beim Start loggt der Service eine Warnung, wenn die Variable leer ist.
* `SIGNATURE_ALLOW_SELF_SIGNED` ist standardmäßig `false` und wird beim Start
  als Fehlkonfiguration gewarnt.

## Messbare Wirkung

Das Test-Zertifikat ist selbstsigniert. Vorher hätte `valid: true` geliefert.
Jetzt:

```
valid                = False
signatureCount       = 1
issuerTrusted        = False     <- selbstsigniert, nicht von einer CA ausgegeben
certificateExpired   = False
documentIntegrity    = True      <- kryptografisch in Ordnung
signedBy             = CN=Bundesanzeiger Test-Signer, …
```

Die Signatur ist kryptografisch gültig, der Aussteller aber nicht vertrauenswürdig.
Genau diese Trennung war vorher nicht möglich.

## Neue Tests

`src/modules/signatur/utils/pdf-signature-verify.spec.ts` (20 Fälle):
Integrität (gültig / 9 Einzelmanipulationen / Anhang / Abschneiden / Runde-8-Bypass)
und Zertifikat (gültig / abgelaufen / noch nicht gültig / ohne KeyUsage / CA /
selbstsigniert / Selbstsigniert-Freigabe / leere Vertrauensliste / fremder
Aussteller / SAN-Identität / Umlaut-Normalisierung).

**158 Tests grün** (138 e2e + 20 Unit).

## Was weiterhin offen ist

* **EU Trusted List / Zertifikatskette** — es wird geprüft, ob der Aussteller auf
  einer Betreiber-Liste steht, nicht ob er von einer in der EU-Trust-Liste
  geführten Stelle stammt. Die Roots fehlen.
* **Sperrlisten (CRL/OCSP)** — nicht implementiert; ein gesperrtes Zertifikat
  würde als gültig durchgehen.
* **`timestampValid` bleibt `false`** — der Mock-TSA liefert keinen prüfbaren
  Zeitstempel.
