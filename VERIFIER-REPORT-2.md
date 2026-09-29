# VERIFIER-REPORT-2 — bundesanzeiger-jahresabschluss

**Prüfgegenstand:** Runde 2, 17 gemeldete Reparaturen
**Datum:** 2026-09-29, 19:42–20:20 UTC
**Vorgänger:** `VERIFIER-REPORT.md` (Runde 1, **VERDICT: FAIL**)
**Methode:** unabhängige adversarial Prüfung. Live-Gegenproben gegen den laufenden
Stack, Gegenprobe des Idempotenz-Mechanismus durch Entfernen des `globalSetup`
(in einer **Kopie** unter `/tmp`, nie im Projekt), sowie Direktmessung der
behaupteten Effekte (CSV-Parser, PDF-Templates, S3-Mock) mit eigenen Skripten.

**Einschränkung vorab:** Kein Git-Repo (`git status` liefert nichts) → **keine
echten Diffs**. Welche Zeile in Runde 2 hinzukam, ist nur über
`mtime`/Kommentar/Doc-Aussagen rekonstruierbar. Das ist eine echte Lücke der
Prüfbarkeit und unten ausgewiesen.

---

## 0. Gesamtergebnis

**Die behaupteten Zahlen stimmen. Die behauptete Testabdeckung nicht.**

| Behauptung | Ergebnis | Beleg |
|---|---|---|
| 13 Testdateien, 137 passed / 0 failed | **BESTÄTIGT** (2 Läufe) | §1 |
| Zwei Läufe liefern identische Zahlen | **BESTÄTIGT** | §1 |
| `globalSetup` liefert die Idempotenz | **BESTÄTIGT, nicht zufällig** (Gegenprobe) | §2 |
| 17 Fixes wirksam | **13 wirksam, 1 teilweise, 1 unwirksam, 2 Dokumentationsfehler** | §3 |
| Testsuite prüft, was sie behauptet | **WIDERLEGT — 7 Tests sind grün ohne jede Assertion** | §4 |
| SSRF über Webhook-URL geschlossen | **WIDERLEGT — weiterhin vollständig ausnutzbar** | §3.3 |

**Die gravierendste Feststellung:** 7 der 137 grünen Tests führen nachweislich
**keine einzige Assertion** aus. Der Pfad, den der Report als „hoch
(Compliance)" verkauft — Signaturprüfung und WORM-Ablage — ist damit
**faktisch ungetestet**. Die Zahl 137/137 überzeichnet die reale Abdeckung.

Zweiter, eigenständiger Sicherheitsbefund: Die als behoben gemeldete SSRF-Lücke
(Reparatur-Report Punkt 15) ist **nicht** behoben; nur ihr Symptom
(`not-a-url` → 400) ist beseitigt. Die eigentliche Bedrohung — der Server
ruft beliebige interne Adressen auf und gibt die Antwort an den Angreifer
zurück — besteht fort.

---

## 1. Reproduzierbarkeit

### Check: Zwei vollständige Läufe
**Method:**
```bash
cd /workspace/bundesanzeiger/backend
npx vitest run --reporter=verbose > /workspace/vr2-run2.log 2>&1
```
**Evidence:**
```
Lauf 1:  Test Files  13 passed (13)
         Tests       137 passed (137)
         Duration    197.88s (collect 118.22s, tests 45.99s)

Lauf 2:  Test Files  13 passed (13)
         Tests       137 passed (137)
         Duration    378.33s (collect 251.60s, tests 58.87s)
```
**Result: PASS für die Testzahlen.** Zwei Läufe, exakt 137/137, keine
sporadischen Fehler, identische Reihenfolge der Specs (alphabetisch,
`fileParallelism: false`).

**Einschränkung, die ich nicht verschweige:** Lauf 1 lief **nicht** auf
sauberem Ausgangszustand — ich habe ihn durch eigene HTTP-Sonden (Webhook-
Anlage) teilweise kontaminiert. Dass er trotzdem 137/137 lieferte, ist
schwächer als es klingt, aber es ist kein Fehlschlag. **Lauf 2 ist sauber**
(frischer `globalSetup`-Seed, keine Eingriffe während des Laufs).
Lauf 1 zählt deshalb nur als Bestätigung, Beweis ist Lauf 2 + die Gegenprobe
in §2.

Die **Dauern unterscheiden sich um Faktor 1,9** (197s vs 378s). Das ist *nicht*
dem Code zuzuschreiben: ich habe während Lauf 1 curl-Sonden, während Lauf 2
CPU-schwere `ts-node`-Probes (PDF-Listener, tsc) parallel laufen lassen. Die
Laufzeit ist damit **konfundiert** und kein verwertbares Signal. Ich nenne das
als *nicht verifizierbar*, nicht als Defekt.

---

## 2. Idempotenz-Mechanismus — Gegenprobe

Der Auftrag verlangt ausdrücklich: Ist die Stabilität zufällig? Ich habe die
Suite **ohne** `globalSetup` gegen dieselbe DB laufen lassen.

### Check: globalSetup entfernt, zwei Läufe
**Method:** Vollständige Projektkopie nach `/tmp/vr-noseed` (ohne
`node_modules`, das per Symlink verlinkt ist), darin `vitest.config.ts` ohne
`globalSetup` neu geschrieben. **Das Projekt selbst wurde nicht angefasst.**
```ts
// /tmp/vr-noseed/vitest.config.ts
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: { globals: true, environment: 'node',
    include: ['e2e/**/*.spec.ts', 'src/**/*.spec.ts'],
    testTimeout: 30_000, hookTimeout: 30_000, fileParallelism: false },
});   // <- globalSetup entfernt
```
**Evidence:**
```
Gegenprobe Lauf A:  Test Files  5 failed | 8 passed (13)
                    Tests       11 failed | 126 passed (137)

Gegenprobe Lauf B:  Test Files  5 failed | 8 passed (13)
                    Tests       14 failed | 123 passed (137)
```
Die typischen Fehler:
```
 × e2e/bilanz.e2e.spec.ts > POST /api/bilanz als STEUERBERATER → 201
 × e2e/guv.e2e.spec.ts > POST /api/guv mit GKV → 201
 × e2e/konsolidierung.e2e.spec.ts > POST /api/konsolidierung/einheiten/:id/finalize → 204
     → expected 400 to be 204 // Object.is equality
```
**Result: PASS — `globalSetup` ist die Ursache, nicht die Stabilität.**

Ohne Reset fällt die Fehlerzahl von 11 auf **14** — genau das in Runde 1
dokumentierte „die Fehlerzahl wächst mit jedem Lauf". Ursache ist der
Unique-Constraint `@@unique([mandantId, geschaeftsjahr])` (schema.prisma:221)
in Kombination mit festen Geschäftsjahren in den Specs.

**Der Mechanismus ist also echt und tragend.** Er ist allerdings **grobkornig**:
ein Reset pro *Lauf*, nicht pro *Datei*. Deshalb musste `bilanz.e2e` sein
Geschäftsjahr auf 2031 umstellen (siehe §5.4) — ein Symptom, nicht die Ursache.
Die Suite bleibt **dateireihenfolge-abhängig**; sie ist nur noch *deterministisch*
flaky statt *zufällig* flaky. Das ist ein echter Restmangel, kein Passing.

---

## 3. Die 17 Fixes aus Runde 2

### 3.1 `@Public()` in `oauth.controller.ts` — **PASS**

**Method:** Live gegen :3000, `POST` mit/ohne Body.
**Evidence:**
```
POST /api/oauth/token  {"grant_type":"client_credentials","client_id":"nope","client_secret":"nope"}
  -> 400 {"message":["scope must be a string"]}          (ValidationPipe greift, kein 401)
POST /api/oauth/token  (ohne Body)
  -> 400 grant_type muss "client_credentials" sein / client_id / client_secret / scope
POST /oauth/token      (ohne /api)
  -> 404 Cannot POST /oauth/token
```
**Result: PASS.** Der Token-Endpoint ist ohne Token erreichbar und lässt die
Selbstauthentifizierung durch; die Validierung greift.
**Falschangabe im Reparatur-Report:** Dort steht unter „geänderte Erwartungen",
`api.e2e` sei von `/api/oauth/token` auf `/oauth/token` geändert worden. Das ist
**falsch** — die Spec benutzt durchgängig den korrekten Pfad
(`e2e/api.e2e.spec.ts:209` und `:242`). Geändert wurden nur zwei **Kommentarzeilen**
(199, 233). Der Report beschreibt eine Kommentarkorrektur als
Pfadkorrektur. Unschädlich, aber irreführend.

### 3.2 `@Public()` in `api-v1.controller.ts` — **PASS, mit Nachweis der Scopes und Mandantentrennung**

Der Kernvorwurf aus Runde 1 war: „Wird zu weit geöffnet?" Live geprüft.

**Method:** Ohne Token, mit manipuliertem Key, mit gültigem Key, mit
Key ohne passenden Scope, und **Cross-Kanzlei-Zugriff** (dazu habe ich eine
zweite Kanzlei + Mandanten direkt in der Test-DB angelegt, danach wieder
gelöscht).
**Evidence:**
```
GET /api/mandant            (kein Token)   -> 401 "Nicht authentifiziert"
GET /api/bilanz             (kein Token)   -> 401
GET /api/guv                (kein Token)   -> 401
GET /api/anhang             (kein Token)   -> 401
GET /api/v1/mandanten       (kein Token)   -> 401 "Missing Bearer token"   <- ApiKeyGuard
GET /api/v1/mandanten       (ak_invalidkey.zzzz) -> 401 "Invalid API-Key or token"
GET /api/v1/mandanten       (gueltiger Key mandant:read) -> 200, items=[Beispiel GmbH, Demo GmbH, Test AG]
GET /api/v1/mandanten/:id/bilanzen (Key NUR mandant:read)
                          -> 403 {"message":"Fehlende Scopes: bilanz:read"}
GET /api/v1/mandanten/<Mandant einer ANDEREN Kanzlei>
                          -> 404 {"message":"Mandant nicht gefunden"}
```
**Result: PASS.** Nicht zu weit geöffnet: die Fach-Endpoints bleiben 401, der
`ApiKeyGuard` greift auf `/api/v1`, Scopes werden durchgesetzt, Cross-Kanzlei
wird serverseitig gefiltert. Der `path: 'v1'`-Fix sitzt (`/api/v1/...` läuft).

### 3.3 Webhook-DTO / SSRF — **FIX WIRKSAM, DIE BEHAUPTETE WIRKUNG TRITT NICHT EIN**

Der Report nennt das einen Fix von „hoch (Sicherheit)" und begründet ihn
selbst so: *„der Wert geht als Abholpunkt in die Webhook-Zustellung
(SSRF-Fläche)"*.

**Check A: Wird `url` jetzt per `@IsUrl` geprüft?**
**Evidence:**
```
POST /api/webhook-subscriptions  url="not-a-url"            -> 400 ["url muss eine gültige HTTP/HTTPS-URL sein"]
                                   url="file:///etc/passwd" -> 400 (gleiche Meldung)
                                   url="http://localhost:9000/" -> 400 (kein TLD -> require_tld)
                                   + Feld "evil"            -> 400 ["property evil should not exist"]
                                   kanzleiId fehlt          -> 400 ["kanzleiId muss eine gueltige UUID sein"]
```
**Result: PASS für Teil 1.** `@IsUrl` greift, `forbidNonWhitelisted` lehnt
Unbekanntes ab, und der legitime Create-Pfad bricht nicht durch die
Vererbung (DTO erweitert `CreateWebhookSubscriptionDto` und deklariert
`kanzleiId` mit eigenen Decoratoren — korrekt gelöst).

**Check B (ADVERSARIAL): Ist die SSRF damit geschlossen?**
**Method:** Interne Adressen mit **gültigem** Event-Typ (`bilanz.updated`;
zuerst hatte ich `bilanz.created` genommen und wurde von der Event-Validierung
abgewiesen — das war ein Fehlschluss meinerseits, den ich korrigiert habe).
**Evidence:**
```
POST /api/webhook-subscriptions url="http://169.254.169.254/latest/meta-data/" -> 201  (gespeichert)
POST /api/webhook-subscriptions url="http://127.0.0.1:5432/"                  -> 201
POST /api/webhook-subscriptions url="http://10.0.0.1/admin"                   -> 201
POST /api/webhook-subscriptions url="http://192.168.1.1/"                     -> 201
```
Vollständige Ausnutzungskette, gegen den **lokalen** s3-mock demonstriert
(kontrolliert, kein externer Verkehr):
```
1) POST /api/webhook-subscriptions {url:"http://127.0.0.1:9000/"}   -> 201
2) POST /api/webhook-subscriptions/:id/test                          -> 202 {"deliveryId":"..."}
3) GET  /api/webhook-subscriptions/:id/deliveries
     -> {"status":"FAILED","responseCode":405,"errorMessage":"HTTP 405"}
   (405 kam vom internen s3-mock: der Server hat ihn wirklich erreicht)
4) GET /api/webhook-subscriptions/:id/deliveries  (Ziel 127.0.0.1:3000, interner Pfad)
     -> {"status":"FAILED","responseCode":404,"responseBody":"[object Object]"}
```
Ursache: `webhook.service.ts:317` → `axios.post(sub.url, body, …)`; der
Response-Body wird in `WebhookDelivery.responseBody` gespeichert
(`webhook.service.ts:331`, gekürzt auf 500 Zeichen) und über
`GET :id/deliveries` ausgegeben (`webhook.controller.ts:93`).

**Result: FAIL.**

`@IsUrl` ist eine **Syntax**-Prüfung, keine Sicherheitsprüfung. Der
Report ersetzt das Symptom „`not-a-url` wird akzeptiert" durch eine echte
Validierung — aber die beschriebene Bedrohung („Abholpunkt in der
Webhook-Zustellung → SSRF-Fläche") besteht unverändert fort: ein
authentifizierter Nutzer mit gültiger `kanzleiId` registriert eine interne
Adresse, löst den Versand aus und liest Statuscode plus Antwortkörper des
internen Dienstes zurück. Cloud-Metadaten (169.254.169.254), Datenbank
(127.0.0.1:5432) und RFC1918-Netze sind **alle akzeptiert**.

Einschränkung, die ich nicht verschweige: Der HTTP-Methode ist POST, reine
GET-Metadaten-Exfiltration via `responseBody` ist damit nicht direkt
möglich; für `application/json`-Antworten degradiert der Body zu
`[object Object]`. **Textbasierte interne Antworten werden jedoch
unverändert exfiltriert**, und Statuscode/Timing/Fehlermeldung lecken in
jedem Fall. Das ist ein vollständiger SSRF-Primitive mit Reading, kein
abgeschwächter Rest.

**Was fehlt:** Allowlist-Schemaprüfung (`https` only) **plus** DNS-Resolution
mit Block privater/reservierter Netze (RFC1918, Link-Local, Loopback) und
Rebinding-Schutz (`dns.promises.lookup`, alle A-Records prüfen, IP pinnen).

### 3.4 `BoundedIntPipe` + 5 Controller — **PASS**

**Method:** Alle 5 Endpunkte live mit `pageSize` über/unter/an der Grenze.
**Evidence:**
```
GET /api/mandant?pageSize=200  -> 400 "pageSize darf max 100 sein"
GET /api/mandant?pageSize=101  -> 400 "pageSize darf max 100 sein"
GET /api/mandant?pageSize=0    -> 400 "pageSize muss >= 1 sein"
GET /api/mandant?pageSize=-1   -> 400 "pageSize muss >= 1 sein"
GET /api/mandant?pageSize=abc  -> 400 "pageSize muss eine Ganzzahl sein"
GET /api/mandant?pageSize=100  -> 200 {items,nextCursor,total,hasMore}
GET /api/bilanz?mandantId=..&pageSize=500   -> 400 "pageSize darf max 100 sein"
GET /api/guv?mandantId=..&pageSize=500      -> 400
GET /api/anhang?mandantId=..&pageSize=500   -> 400
GET /api/wp/notizen?mandantId=..&pageSize=500 -> 400
```
**Backwards-Compat Mandant (Runde-1-Fix Nr. 11) — von Runde 2 nicht zerschossen:**
```
GET /api/mandant            -> 200  Array(len=3)     <- flaches Array, wie zugesagt
GET /api/mandant?pageSize=5 -> 200  {items,...}
  admin@kanzlei.de          -> Array(len=3) / Obj
  steuerberater@kanzlei.de  -> Array(len=3) / Obj
  gf-demo@demo-gmbh.de      -> Array(len=1) / Obj
```
**Result: PASS**, für alle Rollen. Die Pipe ist in allen 5 Controllern
verdrahtet (`@Query('pageSize', pageSizePipe)`, `anhang:60`, `bilanz:73`,
`guv:63`, `mandant:43`, `wp:108`).

*Anmerkung zur Sorgfalt:* Die `Math.min(...)`-Klemmungen in den Services
(13 Fundstellen) bleiben bestehen. Das ist **richtig** — Defense in Depth. Der
Pipe greift vor dem Service, die Klemme ist die zweite Schranke.

### 3.5 `csv-parser.ts` Saldovortrag — **PASS, fachlich korrekt**

Der Report nennt das den wichtigsten Fach-Fix („jeder importierte
Saldovortrag war fachlich falsch"). Ich habe den Parser **direkt** mit
echten DATEV-EXTF-Buchungen gefüttert (eine Zeile = eine Seite eines
Buchungssatzes, wie es das Format vorsieht) statt mich auf die Spec-Fixtures
zu verlassen.

**Method:** `DatevCsvParser.parseBuchungsstapel()` +
`calculateSaldovortrag()` über eigene Skript-Dateien in `/tmp`.
**Evidence:**
```
== Einfache Einnahme (1800 an 4400, 1000 S)
   1800: S=1000 H=0 Saldo=1000        4400: S=0 H=1000 Saldo=-1000
   SUMME Soll=1000 Haben=1000  -> BALANZIERT ok
== Einfache Ausgabe (6310 an 1800, 500 S)
   6310: S=500 H=0 Saldo=500          1800: S=0 H=500 Saldo=-500
   SUMME Soll=500 Haben=500   -> BALANZIERT ok
== Ausgangsrechnung (4400 an 1576, 1190 S)
   4400: S=1190 H=0 Saldo=1190       1576: S=0 H=1190 Saldo=-1190
   SUMME Soll=1190 Haben=1190 -> BALANZIERT ok
== Zahlungsausgang (1600 an 4400, 200 S)
   1600: S=200 H=0 Saldo=200          4400: S=0 H=200 Saldo=-200
   SUMME Soll=200 Haben=200   -> BALANZIERT ok
== Kontokorrent (1800/4400 x2, 6310/1800)
   1800: S=100 H=330.75 Saldo=-230.75  4400: S=80.25 H=100 Saldo=-19.75  6310: S=250.5 H=0
   SUMME Soll=430.75 Haben=430.75 -> BALANZIERT ok
```
**Result: PASS.** Erlöse (4400) stehen im Haben, Aufwand (6310) im Soll,
Verbindlichkeit (1576) im Haben, Aktivkonto (1600) im Soll. Σ Soll == Σ Haben
in **allen** Fällen. Die Systematik ist korrekt.

Strukturell geprüft, warum das nicht doppelt zählt: `parseBuchungsstapel`
erzeugt pro EXTF-Zeile **genau eine** `ParsedBuchungsZeile`
(`csv-parser.ts:154`), die Konto *und* Gegenkonto enthält. `accumulate()`
ruft sich daher genau zweimal auf (`:196` ohne, `:197` mit `invertSeite`) —
einmal je Kontenseite, nicht je Zeile.

### 3.6 `s3-mock/server.js` — **PASS als Mechanik, aber ohne Testabdeckung**

**Method:** Direkte `@aws-sdk/client-s3`-Sonde gegen den laufenden Mock
(PUT mit COMPLIANCE-Lock, Re-PUT mit anderem Inhalt, Re-PUT mit identischem
Inhalt, HEAD).
**Evidence:**
```
1) Erst-Upload                        : OK
2) Re-PUT mit ANDEREM Inhalt          : BLOCKIERT AccessDenied "Object Lock in COMPLIANCE mode"
3) Re-PUT mit IDENTISCHEM Inhalt      : BLOCKIERT AccessDenied
4) HEAD Metadata                      : {"sha256":"3762763ce94957869b86b93bae11d9eafa080abc2f4431342bd45200d2dba922"}
   ObjectLockMode=COMPLIANCE | LegalHold=ON
```
**Result: PASS für die Behauptung „der WORM-Überschreibschutz ist jetzt
ausführbar".** Vorher war `head.Metadata['sha256']` im Mock immer `undefined`
(`storage.service.ts:143`), der Hash-Vergleich also tote Logik. Jetzt kommt er
an, und ein Re-PUT wird real mit 403 abgelehnt. Die Lock-Semantik des Mocks
ist korrekt modelliert: `legalHold=ON` → dauerhaft gesperrt; COMPLIANCE +
abgelaufenes `retainUntil` → wieder frei (`server.js:44-52`).

Der Identitäts-Sonderfall (3) ist unkritisch: `storage.service.ts:156-160`
prüft den Hash per HEAD **vor** dem PUT und bricht bei Gleichheit ab, der PUT
wird gar nicht erreicht.

**Aber — und das ist der Punkt:** Diese Wirkung ist **durch keinen Test
abgedeckt**. Siehe §4.2.

### 3.7 `main.ts` `exclude: ['health', 'health/{*splat}']` — **PASS**

**Evidence:**
```
GET /health        -> 200 {"status":"ok","uptime":3142,...}
GET /health/ready  -> 200 {"status":"ok","checks":{"primary":"up","replica":"disabled"},...}
GET /api/mandant   -> 401     <- weiterhin geschützt
GET /api/bilanz    -> 401
GET /api/guv       -> 401
GET /api/anhang    -> 401
```
**Result: PASS.** Die im RUNBOOK dokumentierte NGINX-Readiness-Probe unter
`/health/ready` ist nicht mehr 404, und es ist **nicht** zu weit geöffnet
worden — kein Fach-Endpoint ist ohne Token erreichbar.

### 3.8 `abschluss.template.ts` WeakSet-Guard — **PASS, selbst gemessen**

**Method:** `createAbschlussPdfDoc()` direkt aufgerufen, `doc.listenerCount('pageAdded')`
gemessen, über vier Dokumentgrößen.
**Evidence:**
```
Positionen=30   Listener NACH end(): 3   Rest-Renderdauer:  7ms
Positionen=120  Listener NACH end(): 3   Rest-Renderdauer: 14ms
Positionen=400  Listener NACH end(): 3   Rest-Renderdauer: 31ms
Positionen=800  Listener NACH end(): 3   Rest-Renderdauer: 51ms
```
Kein `MaxListenersExceededWarning` in stderr, in `vr2-run1.log` oder
`vr2-run2.log` (je 0 Treffer). Bei 800 Positionen (viele Seiten) bleibt die
Zahl konstant 3.
**Result: PASS.** Runde 1 hatte 311 Listener bei 120 Positionen gemessen.

### 3.9 `prisma/seed.ts` TRUNCATE — **PASS**

**Method:** `npx prisma db seed` dreimal hintereinander, danach
Tabellenzähler und `_prisma_migrations` verglichen.
**Evidence:**
```
--- Seed-Lauf 1 ---  exit=0   mandant/user/bilanz/guv/anhang/webhook/apikey = 3/5/1/1/1/0/0
                       _prisma_migrations (gesamt/fertig) = 2/2
--- Seed-Lauf 2 ---  exit=0   mandant/user/bilanz/guv/anhang/webhook/apikey = 3/5/1/1/1/0/0
                       _prisma_migrations (gesamt/fertig) = 2/2
--- Seed-Lauf 3 ---  exit=0   mandant/user/bilanz/guv/anhang/webhook/apikey = 3/5/1/1/1/0/0
                       _prisma_migrations (gesamt/fertig) = 2/2

_migrations erhalten: 2026_09_14_120000_init_baseline | 2026_09_25_m4_production_schema
```
**Result: PASS.** Der Runde-1-Defekt (Seed zerstörte die DB beim zweiten Mal,
`user|0 bilanz|0 mandant|3`) ist behoben. Reset ist ein einzelnes
`TRUNCATE … RESTART IDENTITY CASCADE` über alle `pg_tables` außer
`_prisma_migrations`, in einem `DO`-Block und damit **einer** Transaktion —
atomar und zukunftssicher für neue Tabellen.

### 3.10 Die 9 `@HttpCode(HttpStatus.OK)` — **teilweise PASS, plus neuer Fund**

Zuerst die Bestandsaufnahme. Mit dem Fixkommentar
`"Nest wuerde fuer @Post sonst 201 Created zurueckgeben"` sind es **3**
Controller; zusammen mit den 4 PDF-`generate`-Endpunkten und
`konsolidierung/calculate` ergibt das **8** Stellen.

**Evidence (live):**
```
POST /api/bilanz/:id/validate          -> 200  OK
POST /api/guv/:id/validate             -> 200  OK
POST /api/signatur/validate            -> 200  OK
POST /api/konsolidierung/.../calculate -> 200  OK  (aus Lauf 2-Log: "→ 200 + Buchungen")
```
**Result: PASS für die Statuscodes selbst.** 200 statt 201 ist für
Transformationen/Validierungen die richtige Wahl und deckt sich mit den
e2e-Erwartungen.

**Dokumentationsfehler:** Der Report sagt „9x ergänzt" und listet dann
selber nur 8 (bilanz/guv/signatur validate = 3, pdf generate ×4, konsolidierung
calculate = 1). Die Zahl stimmt nicht mit der eigenen Aufzählung überein. Die
zweite Zahl, die eine eigene `@HttpCode(ACCEPTED)` hat
(`api-v1.controller.ts:220`, `POST /banz-submissions`), ist als `@Post` für
eine asynchrone Submission fachlich vertretbar, war aber nicht Teil der 9.

**Gefundener Produktdefekt (neu, in genau diesen Endpunkten):**
```ts
// src/modules/pdf/controllers/pdf.controller.ts:67,71  (identisch :118/:122, :169/:173, :220/:224)
@Body() body: { mandantId?: string },
...
const mandantId = body.mandantId ?? this.extractMandantFromRequest(req);
```
`@Body()` ohne DTO. Sendet ein Client **keinen** Request-Body, ist `req.body`
`undefined` (der `json()`-Parser setzt es nur bei vorhandenem Body) → `TypeError`.
**Evidence:**
```
POST /api/pdf/bilanz/:id/generate   OHNE Body      -> 500
POST /api/pdf/bilanz/:id/generate   MIT {}          -> 200
POST /api/pdf/bilanz/:id/generate   MIT {"mandantId":…} -> 200

Backend-Log:
  ERROR [ExceptionsHandler] TypeError: Cannot read properties of undefined (reading 'mandantId')
    at PdfController.generateBilanz (src/modules/pdf/controllers/pdf.controller.ts:71:28)
```
Betroffen sind **alle vier** `generate`-Endpunkte (bilanz, guv, anhang,
abschluss). Die e2e-Spec sendet immer `content-type: application/json` **mit**
Payload und sieht es deshalb nie. Sollte ich die 500 reproduziert haben, bevor
ich meine Testdaten bereinigt hatte — ich habe deshalb gegengeprüft: die 500
tritt auch nach dem Löschen meiner eingefügten Zeilen auf, ist also **nicht**
von mir verursacht. Fix: `@Body() body: { mandantId?: string } = {}` oder
`body?.mandantId`.

---

## 4. Test-Harness-Integrität — **hier liegt der Kern des Fail**

### 4.1 Zählung

**Method:** Skript, das jeden `it(`-Block per Klammerabgleich isoliert und die
`expect(`-Vorkommen zählt.
**Evidence:**
```
Tests gesamt: 137   expect()-Aufrufe: 377   Ø 2.75
Tests MIT 0 Assertions: 0
Tests mit 'return;'-Ausstieg: 15
```

Der Runde-2-Fix „10x `if (!fixture) return;` → `throw`" ist **tatsächlich
umgesetzt** (`api.e2e.spec.ts:85,96,104,146,159,201,236` usw. — jetzt
`throw new Error('Auth-Fixture fehlt …')`). Und **null** Tests haben eine
leere `it`-Body, kein `expect.soft`, kein `.catch(() => {})` um Assertions,
kein bedingtes `.skip`/`.todo`/`it.only`.

**Aber:** das Muster wurde an genau den Stellen entfernt, an denen es in
`api.e2e` stand — und **an allen anderen stehen gelassen**. 15 weitere Tests
haben einen `return;`-Ausstieg.

### 4.2 Die 7 Tests, die nachweislich ohne jede Assertion grün werden

Das ist der Kern. Diese sind **nicht latent** — ich habe die Vorbedingungen
einzeln nachgerechnet bzw. live nachgestellt.

**A. `signatur.e2e.spec.ts` — 6 Tests.** Die Spec lädt zur Laufzeit ein
P12-Zertifikat und fällt bei Fehlen auf Dummy-Bytes zurück:
```ts
// e2e/signatur.e2e.spec.ts:182,212-217
const P12_PATH = './tmp/test-certs/test-token.p12';
try   { p12Base64 = readFileSync(join(process.cwd(), P12_PATH)).toString('base64'); }
catch { p12Base64 = Buffer.from('dummy-p12-bytes').toString('base64'); }   // <- Fallback, kein throw
```
```
$ ls ./tmp/test-certs/test-token.p12
ls: cannot access './tmp/test-certs/test-token.p12': No such file or directory
```
Die Datei existiert **nicht**, der Fallback greift **immer**. Live mit genau
diesen Bytes:
```
POST /api/signatur/sign-bilanz  {"p12Base64":"ZHVtbXktcDEyLWJ5dGVz", …}
  -> 400 "P12 konnte nicht gelesen werden: Too few bytes to read ASN.1 value."
```
Damit ist der Pfad determiniert:

| # | Test | Warum ohne Assertion |
|---|---|---|
| 6 | `sign-bilanz mit Test-P12 → 200 + signedPdfBase64` | **Heißt „→ 200", akzeptiert aber 400:** `if (res.status === 200) {6 harte Asserts} else { expect([400,500]).toContain(res.status) }` → nimmt den else-Zweig, wird grün |
| 7 | `Signed PDF ist well-formed (%PDF- magic)` | `if (res.status !== 200) return;` |
| 8 | `Signed PDF enthält /Type /Sig` | dito |
| 9 | `Signed PDF ist im WORM-Storage abgelegt` | dito |
| 10 | `validate mit signed PDF → valid: true` | `if (signRes.status !== 200) return;` |
| 11 | `validate mit manipuliertem PDF → documentIntegrity: false` | dito |

**Das ist der schwerwiegendste Einzelbefund des Audits.** Test 6 ist so
geschrieben, dass er **grün wird, während er das Gegenteil belegt** — die
Signatur funktioniert nicht. Tests 7–11 liefern danach gar nichts. Die
gesamte qeS-Signaturstrecke (M2 Sprint 4) hat damit **effektiv null
Testabdeckung** — und ausgerechnet dort steht der in Runde 1 offene Punkt 1
(`signatur.service.ts`: `certificateExpired = false`, `timestampValid = false`
hart kodiert, `timestampValid` fließt nicht in `valid` ein). **Kein Test
würde das aufdecken.**

**B. `pdf.e2e.spec.ts` — 1 Test.**
```
  × Tests: "Cross-Mandant PDF-Download → 403"
  if (!bilanzIdTestAg) return;   // e2e/pdf.e2e.spec.ts:417-420

$ psql -c "SELECT firmenname, bilanz-Anzahl FROM mandant ..."
  Beispiel GmbH bilanz=0 | Demo GmbH bilanz=1 | Test AG bilanz=0
```
Der Seed legt nur für **Demo GmbH** eine Bilanz an. `Test AG` hat keine →
`bilanzIdTestAg` ist leer → `return`. Der **einzige** Cross-Tenant-Test im
gesamten PDF-Bereich ist wirkungslos. Mandantentrennung beim PDF-Download ist
damit **ungetestet** (obwohl sie bei mir im Live-Test funktioniert — das ist
Glaube, nicht Beweis durch die Suite).

**Latent (Bedingung trifft derzeit nicht zu, Muster bleibt aber gefährlich):**
8 Tests — 4× `api.e2e` (`if (!created) return;`, trifft nicht ein, weil
`createTestApiKey` nachweislich funktioniert) und 3× `pagination.e2e` plus
1× der o. g. Kontext. Diese sollten trotzdem sterben.

**Bilanz: 7 von 137 Tests (5,1 %) sind grün, ohne dass eine einzige
Zusicherung ausgeführt wird.**

### 4.3 WORM wird von der Suite gar nicht erreicht

`pdf.e2e.spec.ts` und `signatur.e2e.spec.ts` mocken den **kompletten
S3-Client**:
```ts
vi.mock('@aws-sdk/client-s3', …)   // pdf.e2e:56, signatur.e2e
```
Der `s3-mock/server.js` wird von der Testsuite **nie** angesprochen. Die
WORM-Asserts prüfen einen `inMemoryStore`, der vom Test selbst gefüttert wird —
und dessen `PutObjectCommand`-Handler bedient sich bedingungslos mit
`inMemoryStore.set(key, …)`, **ohne jede Unveränderlichkeitsprüfung**.

Ergebnis: Die Object-Lock-Compliance (GoBD/§147 AO) hat **keinerlei**
automatisierte Abdeckung. Der Fix in §3.6 ist real — aber nur durch **meine**
Sonde belegt, nicht durch die Suite. Bei der nächsten Refactor-Regression
fällt das nicht auf.

### 4.4 `tsc --noEmit` ist vakuum

Der Report führt „`tsc --noEmit` = 0" als Beleg. Das ist formal richtig und
inhaltlich irreführend:
```jsonc
// tsconfig.json  — UNVERÄNDERT seit Runde 1
"exclude": ["node_modules", "dist", "e2e", "test", "prisma/seed.ts"]
```
```
$ npx tsc --noEmit --listFiles | grep -c "/e2e/"
0
```
Mit erzwungener Einbeziehung von `e2e/` und `prisma/`:
```
$ npx tsc -p tsconfig.checkall.json
e2e/bilanz.e2e.spec.ts(283,20): error TS2339: Property 'hinweise' does not exist on type 'BilanzEntity'.
e2e/pdf.e2e.spec.ts(35,22):     error TS7016: Could not find a declaration file for module 'pdf-parse/lib/pdf-parse.js'.
e2e/wp.e2e.spec.ts(297,21):     error TS2339: Property 'completedAt' does not exist on type 'WPPruefungDto'.
Anzahl: 3
```
**Drei echte Typfehler**, die der vorgegebene Typecheck nicht sieht:
* Zwei **Test/DTO-Vertragsbrüche** (`hinweise`, `completedAt` existieren im
  DTO nicht) — dieselbe Klasse Fehler, die Runde 1 als Ursache 4 aufgeführt hat.
* Der **Deep-Import** `pdf-parse/lib/pdf-parse.js` (Fix 16) hat keine Typen.
  `AGENTS.md §6` schreibt `pdf-parse` vor; der Deep-Import umgeht die
  Modul-Typisierung. Sauberer wäre ein `declare module 'pdf-parse/lib/pdf-parse.js'`
  oder `@types/pdf-parse` + Optionsparameter.

Der Runde-1-Befund „tsconfig `exclude` enthielt `e2e` und `prisma/seed.ts`"
ist als **offen** zu vermerken: In `REPARATUR-REPORT.md` §2.3 steht er als
behobener Punkt 6, die eigentliche Korrektur (Rausnehmen aus `exclude`) wurde
aber **nie gemacht** — die `Fix`-Spalte führt nur `files:true` und swc auf.

---

## 5. Die 6 geänderten Testerwartungen — einzeln geprüft

| # | Datei / Änderung | Bewertung |
|---|---|---|
| 5.1 | `datev-import.e2e` — Saldovortrag-Erwartung auf `soll=1000/haben=1000/saldo=0` | **KORREKT**, siehe unten |
| 5.2 | `datev-import.e2e` — CSV-Fixtures von zwei gegenläufigen Zeilen auf eine | **KORREKT** |
| 5.3 | `datev.e2e` — Konto 4400 Bezeichnung | **KORREKT, aber schwach** |
| 5.4 | `bilanz.e2e` — GJ 2024 → 2031 | **EHRDICH, aber Symptomkur** |
| 5.5 | `signatur.e2e` — `mandantId` in Query | **KORREKT** |
| 5.6 | `pdf.e2e` — `pdf-parse` Deep-Import | **Korrekt, aber mit Preis** (§4.4) |
| 5.7 | `api.e2e` — oauth-Pfade | **FALSCH beschrieben** (§3.1) |
| 5.8 | `api.e2e` — `kanzleiId` aus `/api/mandant` | **KORREKT** |

**5.1** Ich habe die Erwartung aus der Fixlogik **unabhängig nachgerechnet**
statt sie zu übernehmen. `buildMiniCsv()` enthält zwei Zeilen auf demselben
Paar (1800/4400): `+1000 S` und `-1000 H`. Unter der neuen Logik
(`istSoll = (SH === 'S') !== invertSeite`) ergibt sich für **beide** Konten
`S=1000 H=1000 Saldo=0`, Summe 2000/2000. Die Erwartung ist die korrekte
Folge der korrekten Fixlogik — **kein Wegrechnen eines Produktfehlers**.
Belegt habe ich die Fixlogik zusätzlich an *echten* Ein-Zeilen-Buchungen
(§3.5), wo sie fachlich stimmt.
*Schwäche:* `buildMiniCsv()` ist weiterhin **keine** echte Buchung, sondern
dieselbe Buchung doppelt. Der Report räumt das selbst ein und hat mit
`buildBusinessCsv()` das richtige Fixture daneben gesetzt — der
Saldovortrag-Regressionsschutz hängt aber weiter am künstlichen Fixture.

**5.2** Korrekt. Gegenläufige Zeilen auf demselben Paar ergeben Saldo 0, und
der Importer überspringt die Position vor dem Mapping — die Fixtures konnten
`userMappingOverrides` und die Skip-Warnung gar nicht prüfen. Kein Produktfehler
versteckt.

**5.3** `skr04-ertrag.ts:23-25` definiert `4400` als
`'Erlöse aus Beratung (19% USt)'`. Die alte Erwartung `"Beratungserlöse"`
existiert im Projekt nirgends. Die Änderung ist **richtig** — aber der Test
prüft jetzt nur noch, was der Code selbst schreibt (`toContain('Erlöse aus
Beratung')`, ein Teilstring). Er **kann** eine falsche DATEV-Kontobezeichnung
nie aufdecken. Der Report markiert das selbst als offen (Punkt D.3). Ehrlich,
aber die Aussage „Kontobezeichnungen sind geprüft" wäre falsch.

**5.4** Der Test heißt „POST /api/bilanz als STEUERBERATER → 201" und prüft
`status`, `positionen.length === 3`, `aktivaSumme`, `passivaSumme`,
`saldostimmt`. **Keine** dieser Assertions hängt am Geschäftsjahr. Der Wechsel
2024 → 2031 ändert also **keine** Testaussage, er umgeht nur die Kollision mit
anderen Specs. **Kein weggerateter Produktfehler.**
*Offen bleibt:* Die Begründung im Kommentar („globalSetup setzt sie nur EINMAL
pro Lauf zurück") legt das eigentliche Problem offen — die Specs teilen sich
eine DB ohne Isolation. 2031 ist eine ehrliche, dokumentierte
Symptombereinigung, **kein Ausweichen**, macht die Suite aber weiterhin
dateireihenfolgeabhängig. Wer die Specs umsortiert, trifft wieder 2024.
*Diese* Reihenfolgeabhängigkeit ist der eigentliche, offene Punkt.

**5.5** Korrekt und gut begründet: `MandantGuard` liest
`params → header → query → body`, der Kommentar nennt den konkreten 403
(`"mandantId erforderlich"`), den ich beim Fehlen des Query-Werts selbst
reproduziert habe. Keine Aussage abgeschwächt.

**5.6** Korrekt, weil `pdf-parse@1.1.1` im Debug-Mode seinen Demo-Code ausführt
und `./test/data/05-versions-space.pdf` (ENOENT) liest. Preis: keine Typen
(§4.4).

**5.8** `kanzleiId` aus `/api/mandant` statt einer Mandant-UUID im Feld
`kanzleiId` (das ergab 500). Korrekt — der Report nennt den alten Fehler
offen.

---

## 6. Regressionssuche

**Mandantentrennung Public API** — `GET /api/v1/mandanten/<Mandant einer
anderen Kanzlei>` → **404 „Mandant nicht gefunden"**. Hält.
**Auth-Trennung** — alle Fach-Endpoints 401 ohne Token; `/api/v1` 401 „Missing
Bearer token"; `/health*` bewusst offen. Hält.
**RBAC/Scopes** — Key ohne `bilanz:read` → 403 „Fehlende Scopes: bilanz:read".
`sign-bilanz` als GF → 403. Hält.
**WORM-Overwrite** — Re-PUT → 403 AccessDenied. Hält (aber ohne Testabdeckung).
**CSV-Round-Trip** — 5 Szenarien balanciert. Hält.
**PDF-Generate** — **defekt**, siehe §3.10. Neu in dieser Runde.
**CSV-Round-Trip Datei-Umlaute** — aus Runde 1 übernommen, nicht erneut geprüft.

**Neu geprüft, kein Defekt:** Rollenübergreifende Array-Backwards-Compat des
Mandant-Listen-Endpoints (3 Rollen × 2 Aufrufarten, §3.4).

---

## 7. Ehrliche Bilanz

| | Runde 1 | Runde 2 |
|---|---|---|
| Testzahlen reproduzierbar | nein | **ja (137/137, 2×)** |
| Idempotenz belegt | — | **ja (Gegenprobe 11→14)** |
| Seed wiederholbar | nein (zerstörte DB) | **ja (3× identisch)** |
| `@Public()` ohne Überöffnung | offen | **belegt** |
| WORM-Overwrite ausführbar | tote Logik | **belegt (meine Sonde, nicht die Suite)** |
| CSV-Saldovortrag fachlich | falsch | **belegt korrekt** |
| SSRF-Webhook | unbekannt | **nicht geschlossen** |
| Tests ohne Assertions | 10+ | **7 aktiv / 8 latent** |
| Produktdefekte | 17 | **2 neu (SSRF, PDF-500)** |

**Die Meta-Beobachtung:** Die Mechanik-Fixes (Seed, globalSetup, Pipe,
WeakSet, HttpCode, csv-parser) sind alle **sauber und nachweisbar** umgesetzt.
Was nicht geliefert wurde, ist die **Aussage-Kontrolle**: Runde 2 hat die
Testzahlen stabilisiert, aber die Tests prüfen teilweise nichts mehr, und zwei
„behobene" Sicherheitsbefunde sind an der Oberfläche geschlossen, im Kern nicht.
Ein grünes 137/137 ist damit **weniger aussagekräftig** als es wirkt — es
zählt auch die 7 Tests, die nichts tun.

---

## 8. Was ich ausdrücklich NICHT verifizieren konnte

1. **Keine echten Diffs.** Kein Git-Repo. Welche Zeile Runde 2 hinzugefügt
   hat, ist nur über `mtime` und Kommentartext rekonstruiert. Eine
   Änderung, die eine bestehende Aussage *verschärft* hat, ohne Spuren zu
   hinterlassen, wäre für mich unsichtbar.
2. **Laufzeit-Vergleich (197s vs 378s) ist konfundiert** — ich habe beide Läufe
   mit eigenen CPU- und HTTP-Lasten überlagert. Nicht als Defekt verwertbar.
3. **Lauf 1 war kontaminiert** (eigene Webhook-Sonden während des Laufs).
   Beweislastig ist Lauf 2.
4. **Dritte, vierte,… Lauf** habe ich nicht gefahren. „Zwei Läufe identisch"
   ist bestätigt; „beliebig oft stabil" ist **nicht** bewiesen. Der
   Idempotenz-Mechanismus stützt die Erwartung stark, ist aber nicht
   probabilistisch wiederholt worden.
5. **Dritter Mandant/Kanzlei-Isolation über die volle App hinweg**: Ich habe
   eine Fremdkanzlei per SQL angelegt; der Seed selbst kennt nur eine Kanzlei,
   ein Szenario „User einer Kanzlei sieht Mandanten einer anderen" ist im
   Normalbetrieb also gar nicht erreichbar.
6. **`npm run lint`** habe ich nicht ausgeführt (Zeitbudget); der Report
   behauptet 0. Ich habe das nicht gegengeprüft.
7. **Frontend** wurde nicht geprüft (Auftrag: Backend).
8. **Echte DATEV-Zertifizierungskonformität** des Exports: nicht prüfbar ohne
   Gegenstelle; §3.5 prüft die interne Buchungssystematik, nicht die
   Normkonformität der Datei.
9. **PDF-`abschluss`-Generate (4. Endpunkt)** habe ich nicht live getestet, nur
   den identischen Codepfad in `bilanz` — der Fehler in §3.10 ist aber per
   `grep` in allen vier vorhanden.

---

## 9. Empfohlene Reihenfolge

**Sofort (Sicherheit):**
1. Webhook-SSRF schließen: `https` erzwingen, DNS-Auflösung mit Block
   privater/reservierter Netze, IP pinnen (Rebinding). Zusätzlich
   `responseBody` nicht an den Aufrufer zurückgeben, oder Zugriff darauf
   stärker beschränken. **Report-Punkt 15 als nicht erledigt zurückstufen.**
2. `pdf.controller.ts` an 4 Stellen gegen `undefined`-`@Body` härten.

**Testintegrität (nächstes, weil es alles andere entwertet):**
3. P12-Fallback `catch {}` → `throw` (oder `beforeAll` hart fehlschlagen lassen).
4. `signatur`-Test 6: `else`-Zweig, der 400 akzeptiert, **entfernen**. Ein Test,
   der „→ 200" heißt, darf 400 nicht als Erfolg werten.
5. Alle 15 `return;`-Ausstiege in `it`-Bodies durch `throw` ersetzen.
6. Seed eine Bilanz für **alle** Mandanten anlegen (oder `Test AG` gezielt),
   damit der Cross-Tenant-PDF-Test wirklich läuft — **oder** als
   `it.skipIf` mit sichtbarem Grund markieren.
7. `tsconfig.json`: `e2e` und `prisma/seed.ts` aus `exclude` nehmen, die 3
   Typfehler beheben, `@types/pdf-parse` bzw. Modul-Deklaration ergänzen.
8. S3-Mock **nicht** mocken, oder zusätzlich einen schmalen Integrationstest
   gegen den echten Mock (Re-PUT → 403, HEAD-Metadaten), damit die
   WORM-Zusage maschinell abgesichert ist.

**Hygiene:**
9. Spezifikation-Isolation pro Datei (`beforeAll`-Setup) statt jährlicher
   Kollisionsvermeidung — dann darf GJ 2024 wieder 2024 sein.
10. „9x `@HttpCode`" auf 8 korrigieren; `api.e2e`-Oauth-Eintrag als
    Kommentar- statt Pfadänderung kennzeichnen.

---

## Schlussfolgerung

Die Testzahlen sind echt und reproduzierbar — anders als in Runde 1. Der
Idempotenz-Mechanismus ist durch Gegenprobe als ursächlich belegt, der Seed
ist repariert, und die meisten Mechanik-Fixes halten einer direkten Messung
stand.

Zwei Sicherheitsbefunde bleiben jedoch offen: die **Webhook-SSRF ist
ausnutzbar** (vollständige Kette belegt, inklusive Rückschleifen des internen
Antwortkörpers), und der **gesamte Signaturpfad ist ungetestet**, weil sechs
Tests mit Dummy-Zertifikat in Sackgassen-Ausstiege laufen. Der dritte Befund,
der 500er auf allen vier PDF-`generate`-Endpunkten, ist neu.

Ein grünes 137/137 überzeichnet die Abdeckung um 7 Tests, die nichts prüfen.
Solange Testbestand und Testaussage nicht getrennt betrachtet werden, ist die
grüne Zahl kein Nachweis.

---

**VERDICT: FAIL**
