# VERIFIER-REPORT — bundesanzeiger-jahresabschluss

**Prüfgegenstand:** 13 behauptete Reparaturen am NestJS-Backend
**Datum:** 2026-09-28 / 29
**Methode:** unabhängige adversarial Prüfung. Jeder Fix wurde (a) auf
Wirkung und (b) auf Regressionen geprüft. Für die als "behauptet"
genannten Fixes wurden **Gegenproben** (Counterfactuals) gefahren: der
Fix wurde temporär zurückgenommen und das Fehlverhalten reproduziert.
Alle temporären Änderungen wurden zurückgerollt und per `diff` gegen die
Ausgangsdatei verifiziert.

**Einschränkung vorab:** Das Verzeichnis ist **kein Git-Repo**
(`git log`/`git status` liefern nichts). Ein echter Diff gegen den
Vor-Fix-Stand war deshalb nicht möglich. Die Vorher-Zustände wurden
stattdessen durch Counterfactuals rekonstruiert.

---

## 0. Gesamtergebnis

| # | Fix | Wirksam? | Regression? |
|---|-----|----------|-------------|
| 1 | `init_baseline`-Migration | **JA** | keine |
| 2 | `seed.ts` FK/Annotationen | **JA, aber nur auf leerer DB** | **JA (hoch)** |
| 3 | `tsconfig` `files:true` | **JA** | keine |
| 4 | `api-key.dto.ts` Klassenreihenfolge | **JA** | keine |
| 5 | `dns.module` AuditModule / `auth.module` JwtModule | **JA** | keine |
| 6 | `vitest.config.ts` unplugin-swc | **JA** | keine |
| 7 | `mandant.guard.ts` `req.query.mandantId` | **JA** | **keine (sicher)** |
| 8 | `health.controller.ts` `@Public()` | **JA** | keine |
| 9 | `redis-cache-provider.ts` lazy | **JA** | keine |
| 10 | PDF-Templates (bilanz + abschluss) | **JA** | **Latenz: Listener-Leak** |
| 11 | `csv-writer.ts` Quoting | **JA** | keine |
| 12 | `mandant.service.ts` Listen-Kontrakt | **JA** | keine |
| 13 | `run-local.sh` + s3-mock | **JA, mit Lücken** | WORM-Lücke im Mock |

**Bilanz: 12 von 13 Fixes halten. Kein Fix hat eine Sicherheitsregression
in Mandantentrennung/Auth eingebaut. Aber zwei Fixes haben echte
Nebenwirkungen eingebaut (Seed-Zerstörung, Listener-Leak), und die
Test-Harness hat eine Lücke, die den WORM-Schutz nicht wirklich prüft.**

---

## 1. Fix 1 — Baseline-Migration

### Check: migrate deploy auf komplett frischer DB
**Method:** `createdb verify_fresh`, dann `prisma migrate deploy` mit
eigenem `DATABASE_URL`, dann Drift-Diff.
**Evidence:**
```
Applying migration `2026_09_14_120000_init_baseline`
Applying migration `2026_09_25_m4_production_schema`
All migrations have been successfully applied.

Tabellen in verify_fresh: 28
_prisma_migrations: init_baseline|t , m4_production_schema|t

-- This is an empty migration.   (migrate diff --from-schema-datasource
                                 --to-schema-datamodel)
```
**Result: PASS** — 27 CREATE TABLE + `_prisma_migrations`, **null Drift**
gegen `schema.prisma`.

**Nebenbefund (Korrektheit der Doku, kein Defekt):** Der Header-Kommentar
der Datei sagt "27 CREATE TABLE + **69** CREATE INDEX". Tatsächlich sind es
**84** (`grep -cE "^CREATE (UNIQUE )?INDEX"`). Der Kommentar ist falsch,
die Migration selbst ist korrekt.

---

## 2. Fix 2 — seed.ts

### Check A: Seed läuft auf frischer DB durch
**Method:** `prisma db seed` gegen `verify_fresh`.
**Evidence:**
```
[seed] Kanzlei angelegt ... [seed] Mandanten angelegt: Demo GmbH, Beispiel GmbH, Test AG
[seed] User angelegt: admin@kanzlei.de, ... [seed] Bilanz angelegt ... [seed] GuV angelegt
[seed] Anhang angelegt ... [seed] IDW-Standardregeln angelegt: 5 Regeln
🌱 The seed command has been executed.
```
**Result: PASS**

### Check B: FK-Integrität GuVPosition/BilanzPosition
**Method:** SQL mit LEFT JOIN auf `bilanz`/`guv`.
**Evidence (frische DB `verify_fresh`):**
```
bilanz_position_total|48     bilanz_position_with_fk|48   bilanz_position_ORPHAN|0
guv_position_total|20       guv_position_with_fk|20     guv_position_ORPHAN|0
```
**Result: PASS** — die verschachtelten `create`-Blöcke schreiben korrekte
FKs; die `CreateWithout<Relation>Input`-Annotationen sind richtig.

### Check C (ADVERSARIAL): Ist der Seed idempotent / wiederholbar?
**Method:** `prisma db seed` ein zweites Mal gegen die bereits befüllte DB.
**Evidence:**
```
[seed] Fehler: PrismaClientKnownRequestError:
Invalid `prisma.mandant.deleteMany()` invocation in prisma/seed.ts:46:24
Foreign key constraint violated: `konsolidierungs_einheit_mutterMandantId_fkey (index)`
    at async main (.../prisma/seed.ts:46:3) {
  code: 'P2003', modelName: 'Mandant',
  field_name: 'konsolidierungs_einheit_mutterMandantId_fkey (index)' }
An error occurred while running the seed command
```
**Zustand der DB danach (Schaden):**
```
mandant|3   user|0   bilanz|0   guv|0   anhang|0
konsolidierungs_einheit|1   kanzlei|1
```
**Result: FAIL — Regression eingebaut.**

Der Reset-Block (`seed.ts:31-47`) ist eine unvollständige Liste von
`deleteMany()`. Es fehlen u.a.:

| Tabelle | im Reset? |
|---|---|
| `api_key` | **fehlt** |
| `webhook_subscription` | **fehlt** |
| `jahresabschluss` | **fehlt** |
| `banz_submission` | **fehlt** |
| `konsolidierungs_einheit` | **fehlt** |
| `konsolidierung_buchung` | **fehlt** |

Zusätzlich: weil die `deleteMany()` **nicht transaktional** sind, ist die
DB nach dem Fehler **zerissen** (User weg, Mandanten noch da). Das ist
schlimmer als ein sauberer Abbruch.

**Konsequenz:** Fix 2 ist **nur auf einer leeren DB korrekt**. Sobald die
e2e-Specs einmal gelaufen sind (sie schreiben genau in diese Tabellen),
bricht jeder weitere `prisma db seed`-Aufruf ab — und `run-local.sh`
behauptet im Kommentar, es mache "Migrationen + Seed", führt den Seed aber
nie aus (siehe Fix 13).

---

## 3. Fix 3 — tsconfig `ts-node.files: true`

### Check: Start ohne `files: true`
**Method:** `"files": true` aus `tsconfig.json` entfernt, `npx ts-node
src/main.ts` gestartet, danach zurückgerollt.
**Evidence:**
```
TSError: ⨯ Unable to compile TypeScript:
src/modules/api/guards/api-key.guard.ts(119,13): error TS2339:
  Property 'apiKeyContext' does not exist on type
  'Request<ParamsDictionary, any, any, ParsedQs, Record<string, any>>'.
  diagnosticCodes: [ 2339 ]
```
**Result: PASS** — exakt der behauptete TS2339 auf der
Express-Augmentation. Start scheitert, `tsc --noEmit` wäre grün
gewesen. Zurückgerollt, `diff` identisch.

---

## 4. Fix 4 — api-key.dto.ts TDZ

### Check: Klassenreihenfolge
**Method:** Datei gelesen, Deklarationsreihenfolge festgestellt.
**Evidence:**
```
order: CreateApiKeyDto (L24) -> ApiKeyDto (L78) -> CreateApiKeyResponseDto (L127) -> ApiKeyUsageDto (L160)
```
`CreateApiKeyResponseDto.apiKey!: ApiKeyDto` referenziert also eine
bereits deklarierte Klasse — kein TDZ mehr.
**Result: PASS**

**Einschränkung:** Ich konnte das ursprüngliche TDZ-Verhalten nicht
reproduzieren, weil kein Vorher-Stand vorlag. Die Behauptung "vorher war
ApiKeyDto weiter unten deklariert" ist plausibel, aber **nicht
unabhängig verifiziert**.

---

## 5. Fix 5 — Nest DI

### Check A (Counterfactual): dns.module ohne AuditModule
**Evidence:**
```
ERROR [ExceptionHandler] UnknownDependenciesException [Error]: Nest can't resolve
dependencies of the DomainVerificationService (DnsProviderService, KanzleiRepository,
?, PrismaService). Please make sure that the argument AuditService at index [2]
is available in the DnsModule module.
```
**Result: PASS** — exakt die behauptete Exception. Zurückgerollt, `diff` identisch.

### Check B (Counterfactual): auth.module ohne `JwtModule` in exports
**Evidence:**
```
ERROR [ExceptionHandler] UnknownDependenciesException [Error]: Nest can't resolve
dependencies of the ApiKeyService (PublicApiRepository, AuditService, ?, ConfigService).
Please make sure that the argument JwtService at index [2] is available in the ApiModule module.
```
**Result: PASS** — exakt die behauptete Exception. Zurückgerollt, `diff` identisch.

---

## 6. Fix 6 — vitest unplugin-swc

### Check (Counterfactual): swc-Plugin auskommentiert
**Method:** `plugins: []`, dann `vitest run e2e/auth e2e/bilanz`.
**Evidence:**
```
Test Files  2 failed (2)
     Tests  20 skipped (20)
TypeError: Cannot read properties of undefined (reading 'get')
TypeError: Cannot read properties of undefined (reading 'close')
```
**Result: PASS** — 20/20 **übersprungen**, exakt der behauptete
`Cannot read properties of undefined (reading 'get')`. Zurückgerollt.

**Bemerkung zur Genauigkeit der Behauptung:** Es ist nicht "13 Dateien
starben in der collect-Phase", sondern die Tests werden *skipped* — die
Dateien scheitern in `beforeAll`. Das erklärt auch, warum die behauptete
Fehlerursache nicht als harter Fehler sichtbar war.

---

## 7. Fix 7 — mandant.guard.ts (sicherheitskritisch)

### Check A: Funktionalität
**Method:** Live-Calls mit Token eines Users, der **nur** Demo GmbH hat
(`gf-demo`), gegen Beispiel GmbH.
**Evidence:**
```
P1 eigener Mandant via query  -> 200
P2 FREMDER Mandant via query   -> 403 {"message":"Kein Zugriff auf diesen Mandanten"}
P3 FREMDER via Header          -> 403 {"message":"Kein Zugriff auf diesen Mandanten"}
P4 kein mandantId              -> 403 {"message":"mandantId erforderlich"}
P5 Header=fremd, Query=eigen   -> 403   (Header-Vorrang ERHALTEN)
guv fremd -> 403 ; anhang fremd -> 403
```
**Result: PASS** inkl. Header-Präzedenz.

### Check B (ADVERSARIAL): Datenleck trotz gültigem Zugriff?
**Method:** Antwort der Mandant-A-Liste auf Fremd-UUIDs geprüft.
**Evidence:**
```
count 1
mandantIds in response: {'0fb8ae1f-...' (= Mandant A)}
MANDANT_B leaked: False
```
**Result: PASS** — der Guard setzt `activeMandantId`, der Service filtert.
Keine Mandantentrennung ausgehebelt.

**Fazit zum sicherheitskritischsten Fix: hält vollständig.** Keine
Regression.

---

## 8. Fix 8 — health `@Public()`

### Check: Auth-Trennung Health vs. Fach-Endpoints
**Evidence:**
```
GET /health              -> 200 {"status":"ok","uptime":652,...}
GET /api/bilanz (kein T) -> 401
GET /api/guv    (kein T) -> 401
GET /api/mandant(kein T) -> 401
POST /api/auth/login     -> 200
```
**Result: PASS** für `/health`.

### Finding (produktiver Defekt, nicht von diesem Fix verursacht)
**Method:** Readiness-Probe getestet.
**Evidence:**
```
GET /health/ready    -> 404 {"error":"Not Found","statusCode":404}
GET /api/health/ready-> 200 {"status":"ok","checks":{"primary":"up","replica":"disabled"}}
```
**Result: FAIL (bestehender Bug, vom Fix #8 *nicht* behoben).**

`main.ts:54` verwendet `app.setGlobalPrefix('api', { exclude: ['health'] })`.
Nest matcht `exclude` **exakt**, nicht als Präfix — deshalb ist nur
`/health` ausgenommen, `/health/ready` fällt unter den `/api`-Prefix.
Das Nest-Log bestätigt es:
```
HealthController {/api/health}
Mapped {/health, GET} route
Mapped {/api/health/ready, GET} route     <-- falsch
```

**Konsequenz:** Der `@Public()`-Fix hat `/health` gerettet, aber die in
`RUNBOOK`/NGINX dokumentierte **Readiness-Probe für den Blue-Green-Switch
liefert weiterhin 404**. Wenn die Infra so konfiguriert ist, switcht der
Load-Balancer nie. Fix: `exclude: ['health', 'health/{*splat}']`
(Nest 11) oder `exclude: [{path: 'health', method: RequestMethod.ALL}]`.

---

## 9. Fix 9 — redis-cache-provider lazy

### Check: keine Redis-Verbindung im Memory-Modus
**Method:** `ss -tnp | grep 6379`, `/proc/<pid>/fd` gezählt, Log geprüft,
Prozess über Kaltstart beobachtet.
**Evidence:**
```
ss -tnp | grep 6379  ->  KEINE Verbindung auf 6379
Log: [RedisCacheProvider] CACHE_PROVIDER !== "redis" — RedisCacheProvider
     bleibt inaktiv (kein Connect)
Log: [CacheManagerService] Cache-Provider: Memory (Single-VM-Modus)
Log: [CacheModule] Cache bereit: primary=memory, fallback=none
Backend uptime nach Kaltstart: >60s stabil, /health 200
```
**Result: PASS** — kein Reconnect-Sturm, Prozess stabil.

---

## 10. Fix 10 — PDF-Templates

### Check A: Bilanz / GuV / Anhang live generiert
**Method:** `POST /api/pdf/{typ}/:id/generate` als STEUERBERATER, dann
Download + `pdfinfo` + `pdftotext`.
**Evidence:**
```
bilanz : 201, 4144 B, 1 Seite,  magic %PDF-1.3
guv    : 201, 9439 B, 6 Seiten, magic %PDF-1.3
anhang : 201, 3494 B, 1 Seite,  magic %PDF-1.3
elapsed jeweils < 1s
Antwort: {"wormObjectKey":"mandant/.../bilanz/2025/<uuid>.pdf",
          "sha256Hash":"ec23c156...","retentionExpiresAt":"2036-09-25T..."}
```
**Result: PASS**

### Check B: `abschluss.template.ts` (kein Test deckt es ab)
**Method:** Template direkt mit Harness gerendert (Fixture mit
bilanz/guv/anhang + `abschnitte`).
**Evidence:**
```
result: OK   elapsed_ms: 108   bytes: 5909   is_pdf: true
pdfinfo -> Pages: 4
pdftotext S.1: "Jahresabschluss / Demo GmbH / Geschäftsjahr 2025 /
   Bilanz (§ 266 HGB) ... WORM-Hinweis: § 147 AO 10 Jahre ..."
pdftotext S.4: Anhang-Methoden + Footer
```
**Result: PASS** — beide Templates rendern, Footer auf jeder Seite
korrekt innerhalb des beschreibbaren Bereichs.

**Zwischenbefund (mein Fehler, korrigiert):** Mein erster Harness
rief `doc.end()` nicht auf und lief in ein 20s-Timeout. Das war **mein**
Harnessfehler, nicht der des Codes — der JSDoc sagt ausdrücklich
"Der Aufrufer ist für das Schließen (`doc.end()`) verantwortlich".
Nach Korrektur: 4 Seiten in 108 ms.

### Finding (Latenz, vom Fix nicht behoben)
`abschluss.template.ts:68` registriert `drawHeaderFooter` **als**
`pageAdded`-Listener, und `drawHeaderFooter` registriert **intern**
selbst zwei weitere `pageAdded`-Listener (`:327`, `:331`). Pro Seite
kommen also 2 Listener hinzu, ohne dass alte entfernt werden.

**Evidence (Harness mit 120 Bilanzpositionen):**
```
listener_nach_erstellung: 311
(node:13603) MaxListenersExceededWarning: Possible EventEmitter memory leak
  detected. 11 pageAdded listeners added to [PDFDocument]. MaxListeners is 10.
listener_am_ende: 311
elapsed_ms: 7819
```
**Result: FAIL (Latenz).** Die Endlos-Schleife ist weg, aber es gibt
stattdessen ein **ungebundenes Listener-Wachstum** mit Node-Warnung und
deutlichem Performance-Overhead (7,8 s für 4 Seiten). Kein
Datenverlust, aber die Behauptung "es kann jetzt ein PDF erzeugt werden"
ist richtig, "der Fix ist sauber" wäre es nicht.

Zusätzlich: `abschluss.template.ts:291` wirft
`TypeError: parts.anhang.abschnitte is not iterable`, wenn `abschnitte`
fehlt — keine Absicherung gegen unvollständige Entities.

---

## 11. Fix 11 — DATEV CSV-Writer

### Check A: Formatkonformität
**Method:** Writer + Parser ausgeführt, Bytes inspiziert.
**Evidence:**
```
Z1: "\"Formatname\";\"Version\";\"Berater\";\"Mandant\";\"WJ-Beginn\";..."
Z4: "\"1000\";\"S\";\"1600\";\"1200\";\"01.01.2025\";\"Rechnung 4711 \"\"Müller & Sohn\"\" GmbH\""

BOM vorhanden?            false   (korrekt)
valides UTF-8?            true
nur CRLF (kein LF)?       true
endet auf CRLF?           true
Trennzeichen ";"          12 Trenner
Header komplett gequotet? true
```
**Result: PASS**

### Check B: Round-Trip gegen den eigenen Import-Parser
**Evidence:**
```
formatName: "EXTF_Buchungsstapel"   version: 12   beraternummer: "123456789"
buchungen gelesen: 4
[0] umsatz=1000  SH=S  text="Rechnung 4711 \"Müller & Sohn\" GmbH"  konto="1600"
[1] umsatz=-250.5 SH=H  text="Miete; Januar"                        konto="4600"
[2] umsatz=99.99 SH=H  text="Text mit ; und , und \"Zitat\""        konto="6800"
[3] umsatz=0     SH=S  text="Leere Betraege"                        konto="9999"

Buchungszahl == 4:                    true
Buchung 0 umsatz == 1000:             true
Buchung 0 SH == S:                    true
Buchung 0 Text mit Quotes korrekt:    true
Buchung 2 Sonderzeichen korrekt:      true
```
**Result: PASS** — verlustfreier Round-Trip inkl. eingebetteter
Anführungszeichen, Semikolons, Kommas, Negativbeträgen und `null`.

Zwischenbefund: Der Parser verwirft Zeilen **still** in `warnings`
(`"Gegenkonto fehlt"`) statt zu fehlschlagen. Das hat mich zunächst
fehlgeleitet und ist selbst ein Robustheitsproblem.

---

## 12. Fix 12 — Mandant-Listen-Kontrakt

### Check: Array vs. Paged, rollenunabhängig
**Evidence:**
```
ohne pageSize  (STEUERBERATER) -> list  ['Beispiel GmbH','Demo GmbH','Test AG']
ohne pageSize  (GF)            -> list  [1 Mandant: Demo GmbH]     <-- nur eigener
ohne pageSize  (KANZLEI_ADMIN) -> list  3
ohne pageSize  (SYSTEM_ADMIN)  -> list  3
mit pageSize=2                 -> dict keys ['hasMore','items','nextCursor','total']
                                  items: 2  total: 3  hasMore: True  nextCursor: Njk3...
```
**Result: PASS** — die Backwards-Compat-Ausnahme gilt jetzt
rollenunabhängig, wie behauptet. GF sieht korrekt nur seinen Mandanten.

---

## 13. Fix 13 — run-local.sh + s3-mock

### Check A: Echter Kaltstart (alles gestoppt)
**Method:** Postgres gestoppt, Backend + s3-mock gekillt, dann
`./run-local.sh`.
**Evidence:**
```
==> PostgreSQL          laeuft bereits / DB + Rolle bereit
==> S3-Mock             gestartet auf :9000
==> Prisma Migration    Migrationen angewendet
==> Backend (:3000)     gestartet
{"status":"ok","uptime":4,"activePool":"unknown",...}
Backend-Log: Nest application successfully started
```
**Result: PASS** — funktioniert von kalt.

### Check B: Object-Lock im Mock
**Evidence:**
```
PUT ohne Lock                  -> 200
DELETE ohne Lock               -> 204
PUT mit COMPLIANCE-Lock        -> 200
HEAD                           -> x-amz-object-lock-mode: COMPLIANCE
DELETE auf gelocktes Objekt    -> 403  <Error><Code>AccessDenied
GET funktioniert weiterhin      -> locked-content
DELETE bei legalHold=ON        -> 403
```
**Result: PASS** für den Lock-Teil.

### Check C (ADVERSARIAL): Hält der Mock echte WORM-Semantik?

**C1 — COMPLIANCE-Objekt überschreibbar:**
```
PUT1 (COMPLIANCE, Retain 2036) "orig"        -> 200
PUT2 (ohne Lock-Header)        "UEBERSCHRIEBEN" -> 200
Inhalt danach: UEBERSCHRIEBEN
HEAD -> x-amz-object-lock-mode: WEG nach Re-PUT
```
**Result: FAIL.** Echtes S3 lehnt ein Re-PUT auf ein COMPLIANCE-gelocktes
Objekt ab und überschreibt den Lock nie. Der Mock tut beides. Ein
GoBD-relevanter Verstoß wäre für den Mock unsichtbar.

**C2 — Der WORM-Überschreibschutz im Produktcode ist unter dem Mock TOT:**
`storage.service.ts:144` liest `head.Metadata?.['sha256']`, um einen
Re-Upload mit abweichendem Hash zu erkennen. Der Mock speichert
`x-amz-meta-*` überhaupt nicht.

**Evidence (echter AWS-SDK-Client gegen den Mock):**
```
PUT mit Metadata.sha256=deadbeefcafe: ok
HeadObject.Metadata = {}
Metadata["sha256"] ist: UNDEFINED
BEWERTUNG: WORM-Guard ist TOT — Hash nie erkannt,
           jeder Re-Uplement ueberschreibt
```
**Result: FAIL.** Damit ist die Behauptung "damit der WORM/Object-Lock-Pfad
end-to-end prüfbar" **nur für den Delete-Pfad** zutreffend. Der
Übersreibschutz (`ConflictException`, `storage.service.ts:162`) ist unter
diesem Mock **nicht ausführbar** — er kann nie greifen. Wer WORM-Compliance
gegen diese Umgebung testet, testet faktisch nichts.

**Weitere Mock-Schwächen (unkritisch, aber erwähnenswert):**
- Keine SigV4-Prüfung (dokumentiert und für Tests ok)
- `DELETE` ignoriert abgelaufene Retain-Daten: PUT mit
  Retain-Datum 2020-01-01 liefert weiterhin 403 (echtes S3 würde 204 geben)
- Zustand nur im RAM, übersteht keinen Neustart (dokumentiert)

**Weiterer Befund an `run-local.sh`:** Der Header (Z. 9) und
Schritt 3 (Z. 66-67) sagen "Migrationen + Seed" bzw. "Prisma Migration +
Seed", aber ausgeführt wird **nur** `npx prisma migrate deploy`
(Z. 68). Ein Seed findet nie statt. Wer `run-local.sh` nach einem
Seed-Abbruch aufruft, bekommt eine migrierte, aber **leere/leer
gerissene** DB.

---

# A. Die verbleibenden Fehlschläge

## Wichtigste Erkenntnis vorab: die Testsuite ist **nicht idempotent**

Ich habe den Gesamtlauf **zweimal** hintereinander auf derselben DB laufen
lassen:

| Lauf | passed | failed | skipped |
|------|--------|--------|---------|
| Lauf 1 (`verify1.log`) | 104 | 22 | 0 |
| Lauf 2 (`verify4.log`) | **112** | **14** | 0 |

8 Fehlschläge verschwinden beim zweiten Lauf. Ursache: die Specs benutzen
**feste Geschäftsjahre** (`geschaeftsjahr: 2024/2025`) gegen Tabellen mit
Unique-Constraint `bilanz_mandantId_geschaeftsjahr_key`
(`migration.sql:580`). Der erste Lauf legt GJ 2024 an, der zweite
kollidiert:

```
POST /api/bilanz (GJ 2024, Beispiel GmbH)
-> 400 {"message":"Für diesen Mandanten existiert bereits eine Bilanz
         für das Geschäftsjahr 2024."}
```

**Das ist weder Produkt- noch Testfehler im engeren Sinn, sondern ein
Harness-Defekt: `run-local.sh` seet nicht, und die Specs räumen nicht auf.
Ein „grüner" Lauf ist damit nicht reproduzierbar — die 104/22-Zahl ist
ein Artefakt des DB-Zustands, nicht des Codes.**

> Nebenbefund: Ein dritter Lauf in einem *gestörten* Zustand
> (`verify3.log`) ergab 110 **skipped**, 1 passed, 1 failed — die Specs
> fangen Fehlkonfiguration stillschweigend per `return` ab (siehe C).

## Gruppierung nach Ursache

### Ursache 1 — PRODUKTFEHLER: fehlendes `@HttpCode` (3 Tests)
`POST .../validate` ohne `@HttpCode(HttpStatus.OK)` liefert Nest-default
**201**, Tests + Vertragsdoku erwarten **200**.

Betroffen: `bilanz.e2e` (`POST /api/bilanz/:id/validate`), `guv.e2e`
(`POST /api/guv/:id/validate`), `signatur.e2e`
(`POST /api/signatur/validate`).

**Evidence:**
```
bilanz.e2e   > POST /api/bilanz/:id/validate  -> expected 201 to be 200
guv.e2e      > POST /api/guv/:id/validate     -> expected 201 to be 200
signatur.e2e > POST /api/signatur/validate   -> expected 403 to be 200
```
Live gegengeprüft: `POST /api/signatur/validate` (korrekt mit
`?mandantId=`) → **201**, Body korrekt
(`{"valid":false,"signatureCount":0,...}`). Der `403` im Test entsteht
zusätzlich, weil der Test **kein `mandantId`** mitschickt — der Test ist
also doppelt falsch (fehlender Query-Param **und** falscher Statuscode).

**Bewertung: Produktfehler** (fehlende Annotation), Test hat zusätzlich
einen eigenen Fehler.

### Ursache 2 — PRODUKTFEHLER: Saldovortrag-Doppelzählung (4 Tests)
`csv-parser.ts:223 accumulate()` wendet das **gleiche** `sollHaben`-Flag
sowohl auf `konto` als auch auf `gegenkonto` an
(`calculateSaldovortrag` ruft `accumulate(map, zeile.konto, zeile)` und
`accumulate(map, zeile.gegenkonto, zeile)`).

**Evidence (Harness, gegen die Erwartung des Tests):**
```
IST:  1800: soll=1000 haben=1000 saldo=0
      4400: soll=1000 haben=1000 saldo=0     <-- falsch
SOLL: 1800: soll=1000 haben=1000 saldo=0
      4400: soll=0    haben=1000 saldo=-1000
Assertions: 4400.soll==0 -> false ; 4400.saldo==-1000 -> false
```
Live bestätigt über `POST /api/datev-import/preview`: Konto `4400`
kommt mit `haben: 1000` zurück, der Test erwartet `haben: 0`.

**Auswirkung:** Bei einem Soll/Haben-Paar fallen **beide** Konten auf
Saldo 0. Jeder importierte Saldovortrag ist damit fachlich falsch und
würde in eine Bilanzübernommen. **Das ist der schwerwiegendste
Produktfehler in der Liste** — betrifft `datev-import` (4 von 5
Fehlschlägen) und die Korrektheit des Imports insgesamt.

Der 5. datev-import-Fehlschlag (`execute → 201`, "expected 0 to be
greater than 0") ist eine Folge: es werden 0 verwertbare Buchungen
importiert.

### Ursache 3 — TESTFEHLER: mandantId als kanzleiId (4 Tests, api.e2e)
`api.e2e.spec.ts:424`:
```ts
kanzleiId: me.mandanten[0]!.id,     // <- Mandant-UUID, nicht Kanzlei-UUID
mandantId: me.mandanten[0]!.id,
```
`/api/auth/me` liefert **kein** `kanzleiId` (Top-Level-Keys:
`email, globalRole, id, mandanten, nachname, totpEnabled, vorname`).

**Evidence:**
```
MandantId als kanzleiId senden -> 500 {"statusCode":500,"message":"Internal server error"}
korrekte kanzleiId            -> 201 {"apiKey":{...},"plaintextSecret":"V_9pR4..."}
```
**Bewertung: eindeutig Testfehler.** Das Produktverhalten ist korrekt
(FK-Verletzung auf eine nicht existierende Kanzlei). Betrifft
`POST /api/api-keys` (201) und beide `POST /api/webhook-subscriptions`
(201/400) — alle drei mit 500 statt des erwarteten Codes.

`POST /api/v1/* mit ungültigem Bearer → 401` (erwartet 401, bekam 404) ist
ein **dritter** eigenständiger Testfehler: der Pfad existiert unter
`/oauth/token` bzw. mit anderem Prefix nicht so, wie der Test ruft.

### Ursache 4 — TESTFEHLER / Contract-Drift (3 Tests)
- `bilanz.e2e` (2x), `guv.e2e` (2x), `konsolidierung.e2e` (3x) in Lauf 1:
  "expected 400 to be 201" — der Unique-Constraint-Kollisionsfehler
  (siehe oben). In Lauf 2 grün.
- `pagination.e2e` (`pageSize=200 → 400`): live geprüft, Server liefert
  **200**. Der Test erwartet eine `max`-Validierung, die es im
  Controller nicht gibt. **Contract-Drift, kein Produktfehler** — aber
  der Test schreibt eine Schutzmaßnahme vor, die nicht implementiert ist
  (ungebremster `pageSize` = DoS-Vektor gegen die DB).

## Ehrliche Restbilanz

Von 22 Fehlschlägen (Lauf 1) bzw. 14 (Lauf 2):

| Kategorie | Anzahl (Lauf 1) | Anzahl (Lauf 2) |
|---|---|---|
| **Produktfehler** | **7** (4 Saldovortrag + 3 `@HttpCode`) | **7** |
| **Testfehler** | **7** (4 api.e2e + 3 Contract-Drift) | **7** |
| **Harness/Idempotenz** | **8** (verdoppeln sich mit jedem Lauf) | 0 |

> Die Zahlen 104/22 sind also **nicht aussagekräftig**. Stabil reproduzierbar
> sind nur die **14** Fehlschläge des zweiten Laufs, davon 7 echte
> Produktfehler.

---

# B. Audit der e2e-Teständerungen

### B1 — Passwörter auf `Admin123!` / `Demo123!` angeglichen
**Evidence (seed.ts:152-153):**
```ts
const adminPwd = await bcrypt.hash('Admin123!', 12);
const demoPwd  = await bcrypt.hash('Demo123!', 12);
```
**Bewertung: LEGITIM, richtige Richtung.** Die Tests wurden an die
Seed-Realität angepasst, nicht umgekehrt. `Admin123!` ist
SYSTEM_ADMIN, `Demo123!` alle anderen. Live gegengeprüft: alle fünf
Seed-Logins funktionieren. Kein Hinweis auf Test-Hijacking.

### B2 — `mandantId` von body nach query (ebilanz, datev)
**Evidence (ebilanz.controller.ts:59-61):**
```ts
@Post('generate')
async generate(@Body() dto: GenerateEbilanzDto, @Query('mandantId') mandantId: string)
```
**Bewertung: LEGITIM.** Passt exakt zur Controller-Signatur
`@Query('mandantId')`. Derselbe Guard (`@RequireMandant() +
@UseGuards(MandantGuard)`) gilt unverändert.

**Security-Gegenprobe live (GF-Token, fremder Mandant):**
```
POST /api/ebilanz/generate?mandantId=<fremd> -> 403
POST /api/ebilanz/generate?mandantId=<eigen> -> 403   (Rolle fehlt, korrekt)
```
Cross-Mandant-Test in der Spec (`:216`, erwartet 404) ist **erhalten
geblieben**. Kein Security-Regress.

### B3 — `buffer.toString('latin1')` → `pdf-parse` in pdf.e2e
**Begründung im Spec-Kommentar ist technisch korrelt:** PDFKit
komprimiert Content-Streams (FlateDecode), der Text ist im
latin1-Byte-Stream also nicht auffindbar; der alte Treffer kam nur aus
den unkomprimierten `/Title`-Metadaten.

**Evidence (echtes PDF via pdf-parse):**
```
[0] "Bundesanzeiger"               -> JA
[0] "Bundesanzeiger Jahresabschluss" -> JA
[0] "Demo GmbH" / "2025" / "WORM-Hinweis" / "§ 147 AO" -> alle JA
```
**Bewertung: LEGITIM und eine echte Verbesserung** — der Test prüft jetzt
den echten Textlayer statt Metadaten.

**Einschränkung (Test-Schwächung, minimal):** Die Assertion wurde von
`toContain('Bundesanzeiger Jahresabschluss')` auf `toContain('Bundesanzeiger')`
gekürzt. Das war **nicht nötig** — der längere String ist im extrahierten
Text nachweisbar vorhanden. Kein Verschleierungsversuch, aber eine
 unnötige Abschwächung.

### Gesamturteil B
**Kein Test wurde "gekapert", um grün zu werden.** Die drei geprüften
Änderungen sind alle fachlich begründet und in die richtige Richtung
gegangen (Seed-Wahrheit, Controller-Signatur, echter Textlayer). Kein
`.skip`/`.only`/`.todo` wurde eingebaut (siehe C). Die verbleibenden
Fehlschläge sind in den meisten Fällen **Testfehler, die die Änderungen
nicht verursacht haben** — sie bestehen unabhängig davon.

---

# C. Testintegrität: leere Tests und umgangene Assertions

**Keine `.skip` / `.only` / `.todo` im Repo:**
```
$ grep -rnE "\.(skip|todo|only)\(" e2e/ src/ --include=*.spec.ts
(keine Treffer)
```

**Aber: 11 `if (!fixture) return;`-Guards in `api.e2e.spec.ts`.**
Beispiel (`:78-89`):
```ts
it('POST /api/api-keys ohne Auth → 401', async () => {
  if (!fixture) return;          // <-- beendet den Test OHNE Assertion
  const res = await fetch(...);
  expect(res.status).toBe(401);  // wird nie erreicht
});
```

**Das ist ein ernstes Testintegritätsproblem** (wenn auch **nicht** von
diesen Fixen eingebaut — der `api.e2e.spec.ts`-Header dokumentiert das
Skip-Verhalten selbst): 15 Tests können **grün werden, ohne eine einzige
Assertion auszuführen**. Genau das ist in `verify3.log` passiert: 110
"passed/skipped" bei tatsächlich defekter Umgebung.

**Assertion-Realität (Lauf 1):**
```
api.e2e          expect=31  it=15
auth.e2e         expect=20  it=10
bilanz.e2e       expect=31  it=10
cache.e2e        expect=17  it=8
datev-import.e2e expect=33  it=10
datev.e2e        expect=48  it=11
ebilanz.e2e      expect=27  it=12
guv.e2e          expect=30  it=8
konsolidierung   expect=20  it=10
pagination.e2e   expect=25  it=8
pdf.e2e          expect=21  it=10
signatur.e2e     expect=29  it=12
wp.e2e           expect=37  it=12
```
Kein Test ist leer, und die Dichte ist plausibel (2-4 `expect` pro Test).
**Aber** Assertions in `beforeAll`-Blöcken und bedingte `return`s
verfälschen das Bild. Empfehlung: `if (!fixture) throw new Error(...)`
statt `return`.

---

# D. Typecheck und Lint

```
$ npx tsc --noEmit
(keine Ausgabe, Exit 0)                                   -> PASS

$ npm run lint   (eslint src --max-warnings 0)
(keine Ausgabe, Exit 0)                                   -> PASS
```
**Result: PASS** — beide sauber.

---

# E. Regressionssuche (gesichert skeptisch)

| Bereich | Ergebnis |
|---|---|
| **Mandantentrennung** | **intakt** — 5 Guards bestanden, kein Datenleck, Header-Präzedenz erhalten |
| **Auth** | **intakt** — `/api/*` ohne Token 401, `/health` bewusst offen; `tryLoginAs` liefert immer `null` (Testbug) |
| **Signatur-Validierung** | **intakt** — `validate` korrekt 201 mit `valid:false, signatureCount:0`; Manipulation wird erkannt |
| **WORM-Compliance** | **ABGETRENNT** — s3-mock erzwingt Lock nicht beim Überschreiben, `Metadata['sha256']` fehlt ⇒ Produkt-Guard ist unter dieser Umgebung **nicht testbar** |
| **CSV-Round-Trip** | verlustfrei |
| **PDF-Output** | echte, lesbare, mehrseitige PDFs mit SHA-256 + 10-Jahretention |
| **Redis** | kein Connect im Memory-Modus |
| **Seed-Wiederholbarkeit** | **zerstörend** (siehe Fix 2) |
| **`abschluss.template`** | **Listener-Leak + Crash bei fehlenden `abschnitte`** (siehe Fix 10) |
| **`/health/ready`** | **404** — Readiness-Probe kaputt (siehe Fix 8) |
| **PDF-Footer-SHA256** | `SHA-256: PENDING-PLACEHOL...` im Dokument. Self-referential, **dokumentiert beabsichtigt** (`pdf.service.ts:375-393`) — kein Fix, aber fachlich schwach: der Footer kann den echten Hash prinzipiell nicht enthalten. |

---

# F. Was ich nicht verifizieren konnte

1. **Kein Git-Diff** — Vorher-Zustände nur per Counterfactual rekonstruiert.
   Fix 4 (TDZ) konnte ich nicht reproduzieren, nur die heutige Ordnung prüfen.
2. **Fix 1 Vorher-Zustand** — die Behauptung "davor nur die M4-Migration"
   konnte ich mangels Altstand nicht bestätigen; die M4-Migration tut aber
   tatsächlich nur `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` und kann
   keine Tabellen anlegen. Plausibel.
3. **"13 Dateien starben in collect-Phase"** — im Counterfactual war es
   `beforeAll`-Fehlschlag mit *skipped* Tests, nicht Collect-Phase.
4. **NGINX-/Docker-Healthcheck-Realität** — ich habe nur die HTTP-Ebene
   geprüft, keine echte Infra-Config.
5. **`/api/v1/*` mit ungültigem Bearer → 404** — Ursache nicht im Detail
   verfolgt; die beiden 500-Ursachen sind aber eindeutig bewiesen.

---

# G. Empfohlene Reihenfolge

**Sofort (Produktfehler, fachliche/security-Relevanz):**
1. `csv-parser.ts accumulate()` — Gegenkonto mit **umgekehrtem** S/H-Flag
   buchen. Betrifft die Richtigkeit jedes DATEV-Imports.
2. `@HttpCode(HttpStatus.OK)` auf `POST /api/{bilanz,guv}/:id/validate` und
   `POST /api/signatur/validate` (Vertragsdoku sagt 200).
3. `setGlobalPrefix('api', { exclude: ['health', 'health/{*splat}'] })`.

**Test-/Harness-Integrität (ohne das ist kein Lauf reproduzierbar):**
4. `run-local.sh`: Seed tatsächlich ausführen + **transaktionalen** Reset
   mit vollständiger `deleteMany`-Liste; alternativ `TRUNCATE ... CASCADE`.
5. Specs: keine festen Geschäftsjahre, sondern `beforeAll`-unique Jahre
   oder `afterAll`-Cleanup. Sonst wächst die Fehlerzahl mit jedem Lauf.
6. `api.e2e.spec.ts`: echte `kanzleiId` beschaffen; `if (!fixture) return`
   → `throw`.
7. `s3-mock`: `x-amz-meta-*` speichern/zurückgeben **und** Re-PUT auf
   gelockte Objekte mit 423/409 ablehnen.

**Latenz (kein Blocker):**
8. `abschluss.template.ts`: `pageAdded`-Registrierung aus
   `drawHeaderFooter` herausziehen; `abschnitte` mit `?? []` absichern.
9. `pagination`: `pageSize`-Maximum im Controller erzwingen (oder Test
   anpassen).

---

# Schlussfolgerung

Die 13 Fixes sind **technisch competent und überwiegend echt**. Die vier
Gegenproben, die ich gefahren habe (Fix 3, 5a, 5b, 6), haben jeweils
**exakt** die behauptete Fehlermeldung reproduziert — das ist ein starkes
Indiz, dass die Diagnosen nicht nachträglich erfunden wurden. Die
sicherheitskritische Sorge ist ausgeräumt: **Mandantentrennung, Auth und
Signaturpfad halten.**

Zwei Einschränkungen sind aber deutlich:

- **Der Zustand ist nicht ehrlich.** 104/22 ist ein Artefakt eines
  nicht-idempotenten Harnesses; der zweite Lauf ergibt 112/14. Und der
  Seed **zerstört** die DB, wenn er auf eine befüllte DB trifft. Wer
  `./run-local.sh` nach einem Testlauf aufruft, bekommt eine kaputte
  Umgebung.
- **7 der verbleibenden Fehlschläge sind echte Produktfehler**, darunter
  eine fachlich gravierende Saldovortrag-Fehlberechnung, die jeden
  DATEV-Import unbrauchbar macht. Zusätzlich sind zwei bestehende Defekte
  belegt, die die Fixes nicht adressiert haben: `/health/ready` = 404 und
  der unter dem S3-Mock tote WORM-Überschreibschutz.

**Ich empfehle, die Test-Harness-Reparaturen (Punkt 4-7) vor weiteren
Feature-Arbeiten zu ziehen** — solange die Suite nicht reproduzierbar
ist, ist jede grüne Zahl eine Illusion.

VERDICT: FAIL
