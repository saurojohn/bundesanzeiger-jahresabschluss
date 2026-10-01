# AUDIT-ATOMICITY-REVIEW

**Bewertung der Transaktions-Refaktorierung der Audit-Kette**
Bundesanzeiger Jahresabschluss — NestJS 11 / Prisma 5.22 / PostgreSQL 15
Datum: 2026-09-30 · Verifier: unabhängige Prüfung · **keine Code-Änderung**

---

## 0. Kurzfassung für die Entscheidung

Die Fragestellung ging von zwei Annahmen aus, die beide nicht zutreffen:

| Annahme | Befund |
|---|---|
| „`AuditInterceptor` ist registriert und auditiert blockierend" | **Falsch.** Der Interceptor ist an keiner Stelle gebunden und läuft nie. Die Umstellung auf `recordStrict()` ist wirkungslos. |
| „Audit-Fehler ⇒ HTTP 500 bei bereits geschriebenen Daten" | **Falsch.** Heute gibt es gar keinen blockierenden Audit-Pfad. Ein Audit-Ausfall liefert **HTTP 200 mit vollem Erfolgs-Body**, während der Geschäftsvorgang persistiert ist. |

**Konsequenz:** Die geplante Transaktions-Refaktorierung (Audit + Fachdaten in eine
`$transaction`) setzt eine Funktionalität voraus, die es nicht gibt. Sie ist damit
**nicht die vorrangige Baustelle** — sie ist nachrangig gegenüber zwei Defekten, die
jeweils *größer* sind als das Atomicity-Problem:

1. Der Interceptor ist toter Code (GoBD-Vollständigkeit nicht gegeben, nur nicht bemerkt).
2. Die Hash-Chain (Manipulationserkennung) speichert seit Einführung **keinen einzigen Hash**.

Beide Defekte sind billiger zu beheben als eine 47-Stellen-Transaktions-Umstellung —
und sie betreffen die Beweiskraft, nicht nur die Vollständigkeit.

**Empfehlung: Option (c) für die Transaktions-Umstellung, mit sofortigem Vorziehen
der zwei Defekte aus Pkt. 0.** Details in Abschnitt 6.

---

## 1. Reichweite mit Zahlen

### 1.1 Gesamtzahl der Aufrufstellen

| Kategorie | Anzahl |
|---|---|
| Manuelle `auditService.record(...)` | **47** |
| — davon `void …record(…)` (fire-and-forget) | 46 |
| — davon `await …record(…)` (signatur.service.ts:623) | 1 |
| `recordStrict()` im `AuditInterceptor` (nie ausgeführt) | 1 |
| **Summe `record*`-Aufrufe im Repo** | **48** |

Die Aufteilung „47 manuell + 1 Interceptor" stimmt die Zahl 48 der Fragestellung
zufällig, aber die Aufteilung ist eine andere als angenommen: der Interceptor
trägt **null** der 48 bei.

### 1.2 Verteilung nach `action`

| action | Anzahl | Schreibend? |
|---|---:|---|
| `UPDATE` | 17 | ja |
| `CREATE` | 12 | ja |
| `DELETE` | 7 | ja |
| `READ` | 3 | **2 nein, 1 ja (falsch etikettiert)** |
| `LOGIN` | 3 | ja (schreibt `user_session`) |
| `EXPORT` | 2 | nein |
| `SIGN` | 1 | ja (schreibt `signature`) |
| `LOGOUT` | 1 | ja (beendet `user_session`) |
| `IMPORT` | 1 | **ja (schreibt Bilanz + GuV)** |
| **Summe** | **47** | |

### 1.3 Die eigentliche Frage: wie viele sind fachlich relevant?

Aufschlüsselung nach Geschäftsrelevanz — **nicht** nach `action`-Label:

| Klasse | Anzahl | Begründung / Fundstelle |
|---|---:|---|
| **A. Schreibvorgang auf Fachdaten** | **36** | CREATE 12, UPDATE 17, DELETE 7 |
| **B. Mehrstufiger Schreibvorgang** | **1** | `datev-import.service.ts:264` — schreibt Bilanz **und** GuV in *zwei* getrennten `$transaction`, erzeugt **einen** Audit-Eintrag. Höchstes Atomaritätsrisiko der Einzelstellen. |
| **C. Kryptographische Signatur** | **1** | `signatur.service.ts:623` — schreibt `signature` (PKCS#7, qeS) |
| **D. Authentifizierung** | **4** | `auth.service.ts` LOGIN ×3, LOGOUT ×1 — schreiben `user_session` |
| **E. Falsch etikettierter Schreibvorgang** | **1** | `wp/idw-pruefung.service.ts:90` — `action: 'READ'`, ruft aber `wpRepository.upsertPruefungsResult()` auf und **persistiert** Prüfergebnisse |
| **F. Tatsächlich nur lesend** | **4** | Branding-Logo-Download (`READ`), WORM-Download (`READ`), DATEV-Export (`EXPORT`), eBilanz-XBRL-Export (`EXPORT`) |

**Antwort auf Frage 1: 43 der 47 Aufrufstellen (91 %) sind fachlich bzw. für die
Nachvollziehbarkeit relevant.** Nur **4** sind echte Lesevorgänge ohne
Datenwirkung. Die Vermutung „vielleicht nur die Hälfte" trifft nicht zu — sie
trifft umgekehrt auch nicht zu: es sind etwas *mehr* als die Hälfte, weil Import,
Signatur, Auth und die falsch etikettierte Prüfung als „lesend" durchgehen würden.

Klasse F ist zugleich die Menge, die man ohne fachliches Risiko löschen könnte —
aber selbst dort ist der Weggang des Eintrags ein Informationsverlust
(WORM-Download ist ein § 146-AO-naher Zugriffsvorgang).

### 1.4 Erreichbarkeit durch einen *funktionierenden* Interceptor

| Erreichbarkeit | Anzahl | Betroffene Stellen |
|---|---:|---|
| **Nie erreichbar** | **6** | 4× Auth (explizit in `AUDIT_SKIP_PATHS`) + 2× Webhook-Delivery (abgekoppelt) |
| Würde bei gebundenem Interceptor abgedeckt | 41 | alle übrigen |
| **Durch einen gebundenen Interceptor *heute* abgedeckt** | **0** | weil er nicht läuft |

Zu den 6 nicht erreichbaren Stellen im Detail:

- **auth.service.ts:91, 133, 207, 250** — `AUDIT_SKIP_PATHS` enthält
  `/api/auth/login`, `/api/auth/refresh`, `/api/auth/logout`. Diese Einträge sind
  die *einzige* Quelle für Login-/Logout-Nachweise. Sie dürfen nicht entfallen.
- **webhook.service.ts:387, 421** — `deliver()` wird über `void this.deliver(delivery.id)`
  abgekoppelt gestartet (Zeilen 219 und 260), läuft also **nach** dem Absenden der
  HTTP-Response und außerhalb jeder Request-Kontextkette. Ein Interceptor kann
  diesen Pfad prinzipiell nicht erreichen.

Es gibt **keine** Scheduler-Jobs: `grep -rn "@Cron(|@Interval(|@Timeout(|@Every("`
liefert null Treffer. `ScheduleModule.forRoot()` ist importiert, wird aber von
nichts genutzt. Damit gibt es außer den 6 genannten Stellen keine Nicht-HTTP-Pfade.

---

## 2. Ist-Zustand der Kette — zwei Defekte, die schwerer wiegen als Atomicity

### 2.1 Defekt 1: Der `AuditInterceptor` läuft nicht (Schweregrad: hoch)

**Vier unabhängige Nachweise:**

**(a) Statisch — kein Bindungstoken.**
```
$ grep -rn "APP_INTERCEPTOR" --include=*.ts src          → keine Treffer
$ grep -rn "useGlobalInterceptors" src/main.ts           → keine Treffer
$ grep -rn "UseInterceptors" --include=*.ts src          → keine Treffer
```
`audit.module.ts:15` listet `AuditInterceptor` in `providers:`. In NestJS hat das
**keine**Interceptor-Wirkung — ein Provider wird nur dann aktiv, wenn etwas ihn
injiziert. Es wird hier nichts injiziert.

**(b) Datenfingerprint.** `parseEntity()` leitet `entityType` aus dem
URL-Segment ab, also immer klein/kebab (`bilanz`, `api-keys`, `webhook-subscription`).
Die manuellen Aufrufe verwenden dagegen PascalCase (`Bilanz`, `APIKey`).
```
select "entityType", count(*) from audit_log
 where lower("entityType") = "entityType" group by 1;
 entityType | count
------------+-------
(0 rows)
```
Über den gesamten Bestand (163 Einträge zu Prüfzeitpunkt) existiert **kein einziger**
Interceptor-Eintrag. Alle 14 distinkten `entityType`-Werte stammen aus Service-Aufrufen.

**(c) Laufzeit-Spy gegen die echte Nest-App.** Echte `AppModule` gebootet,
`AuditService.recordStrict` mit einem Zähler umhüllt, zwei echte mutierende
Requests gefeuert:
```
PROBE 1 (guarded POST /api/wp/notizen) status = 401
PROBE 2 (public  POST /api/auth/login) status = 401
>>> recordStrict() invocations = 0   <-- INTERCEPTOR NOT BOUND
>>> record()       invocations = 1   (aus dem manuellen AuthService-Aufruf)
```

**(d) Verhalten bei echtem Audit-Ausfall.** Per temporärem DB-Trigger wurde ein
totaler Audit-Ausfall simuliert und ein echter Schreibvorgang ausgeführt:
```
PATCH /api/mandant/2be425aa-…   →  HTTP 200, vollständiger Erfolgs-Body
mandant.rechtsform in der DB   →  persistiert (COMMITTED)
auditWriteFailures             →  122 → 123   (3 Retries, dann verworfen)
```
Der Aufrufer bekommt **Erfolg**. Wäre der Interceptor gebunden, hätte derselbe
Request mit `500` und dem Text „Änderung wurde durchgeführt, die
Nachvollziehbarkeit konnte jedoch nicht gesichert werden" geantwortet.

**Konsequenz für die Fragestellung:** Der heutige Zustand ist *schlechter* als
beschrieben. Es gibt nicht „einen 500-Fall mit halbfertigem Zustand", sondern
**einen Erfolgsfall ohne Nachweis**. Das ist der schlechteste der drei Fälle,
weil er unentdeckt bleibt.

**Testabdeckung:** `recordStrict` und `AuditInterceptor` kommen in **keiner** der
17 Testdateien vor (`grep -rln "recordStrict\|AuditInterceptor" e2e/ src/` → leer).
Die 232 grünen Tests sagen über die Audit-Kette nichts aus.

> **Hinweis zu widersprüchlicher Projektdokumentation:** `REPARATUR-REPORT.md:888ff`
> (Runde 11) korrigiert Runde 2 und belegt mit „2 Einträge, beide OHNE manuellen
> `record()`-Aufruf" die Aktivierung. Dieser Beleg kann nicht stimmen: ein
> Interceptor-Eintrag hätte `entityType='bilanz'` (klein) erzeugt, die beobachteten
> Einträge tragen `entityType='Bilanz'` (PascalCase) und stammen damit aus dem
> manuellen Aufruf. Ebenso ist der Kommentar in `audit.module.ts:11-15`
> („Jetzt als Provider registriert") in der Sache irreführend.

### 2.2 Defekt 2: Die Hash-Chain speichert keine Hashes (Schweregrad: hoch)

`audit-integrity.service.ts:82-92` schreibt:
```ts
await this.prisma.auditLog.update({
  where: { id: auditLogId },
  data: { /* …leer… */ } as never,
}).catch(err => { this.logger.warn('entryHash-Update fehlgeschlagen (Schema-Migration pending?)') })
```
`data` ist leer und der Fehler wird geschluckt. Die Spalten `entryHash`/`prevHash`
existieren im Schema und in der DB, werden aber nie befüllt:
```
select count(*), count("entryHash"), count("prevHash") from audit_log;
 count | count | count
-------+-------+-------
   163 |     0 |     0
```
Der Integritätsendpunkt bestätigt das:
```
GET /api/audit/integrity?kanzleiId=7db36095-…
{"status":"PARTIAL","entriesChecked":0,"oldestUnhashedEntry":"b5ce1110-…"}
```
`verifyIntegrity()` bricht beim ersten unhashierten Eintrag ab und liefert
konstant `PARTIAL` mit `entriesChecked: 0`. Bei leerer Auswahl liefert es
`"status":"OK"` — also **OK, weil nichts geprüft wurde**. Die
Manipulationserkennung nach IDW PS 880 existiert faktisch nicht.

**Warum das die Atomicity-Frage überlagert:** Eine Transaktions-Umstellung macht
den Audit-Trail *vollständiger*, aber nicht *beweissicherer*. Der Chain-Anker
(`prevHash`) wird zudem sequentiell gelesen — der heutige `computeHashForEntry`
liest per `findFirst({ where: { createdAt: { lt: … } } })` den Vorgänger. Diese
Leseoperation ist genau die Sorte, die eine Transaktions-Umstellung mit
Read-Routing gefährdet (Abschnitt 4.3).

---

## 3. Ist das überhaupt das richtige Problem? (Antwort auf Frage 2)

**Ja, aber nicht zuerst.** Die Fragestellung trifft richtig, dass die 47 manuellen
Aufrufe weitgehend Duplikate eines funktionierenden Interceptors wären. Da der
Interceptor aber nicht läuft, ist die Duplikatfrage derzeit gegenstandslos: es gibt
aktuell **keine** Doppelschreibung und **keinen** Fallback.

Die Reihenfolge muss deshalb sein:

1. **Interceptor binden** (eine Zeile: `{ provide: APP_INTERCEPTOR, useClass: AuditInterceptor }`).
   Danach existiert überhaupt erst eine Grundgesichertheit, über die man reden kann.
2. **Dann** über Duplikate entscheiden.

Zur Duplikatfrage inhaltlich, falls Schritt 1 erfolgt:

- **41 der 47 Stellen wären echte Duplikate** — mit einer Nuance: kein exaktes
  Duplikat. Der Interceptor erzeugt `entityType` aus dem URL (`bilanz`), der Service
  aus dem Domain-Namen (`Bilanz`). Es entstünden **zwei** Zeilen pro Vorgang mit
  unterschiedlicher Semantik: eine generische Zugriffszeile und eine fachliche
  Domänenzeile. Das ist vertretbar, aber es verdoppelt das Volumen.
- **Die Nutzlast unterschiedet sich erheblich.** Der Interceptor schreibt
  `toJsonValue(responseBody)` — den **kompletten HTTP-Response-Body**. Die
  manuellen Aufrufe schreiben einen kuratierten `toAuditDto`-Snapshot.
  Gemessen: `PATCH /api/mandant/:id` → Response 702 B, manueller Audit-Eintrag 751 B
  (also vergleichbar); der größte existierende manuelle Eintrag (Bilanz-UPDATE)
  liegt bei 11 406 B. Bei Endpunkten mit großen Antworten (Bilanz mit
  Positionen, Anhang-Listen, Signatur-Bytes) wäre der Interceptor-Eintrag der
  teurere. Das ist im Zielbild zu begrenzen (Payload-Cap).
- **6 Stellen dürfen keinesfalls entfallen** (Abschnitt 1.4): 4× Auth, 2× Webhook-Delivery.
- **`await` ist kein Schutz.** `signatur.service.ts:623` ist die einzige
  `await`-Stelle, aber `record()` fängt ihren Fehler intern ab und kehrt normal
  zurück. `await record()` erzwingt Reihenfolge, keine Garantie.

**Empfehlung zu Frage 2: Die 47 Stellen nicht pauschal löschen.** Die 4
Auth-Stellen und 2 Webhook-Stellen sind tragend. Bei den übrigen 41 ist „löschen"
erst nach Interceptor-Bindung und *nach* Klärung der Payload-Dopplung vertretbar.

---

## 4. Prisma-Transaktionsfähigkeit (Antwort auf Frage 3)

### 4.1 Wo heute überhaupt eine Transaktion existiert

`$transaction` kommt im gesamten Backend an **7 Stellen** vor, alle in Repositories:

| Repository | Zeilen | Methode |
|---|---:|---|
| `bilanz.repository.ts` | 200, 231 | `createWithPositionen`, `updateWithPositionen` |
| `guv.repository.ts` | 201, 231 | `createWithPositionen`, `updateWithPositionen` |
| `anhang.repository.ts` | 174, 200 | Create/Update mit Abschnitten |
| `konsolidierung.repository.ts` | 177 | Konsolidierungs-Apply |

Das heißt: von 36 fachlich relevanten Schreibvorgängen laufen **nur 7** in einer
Transaktion. Die übrigen ~29 sind Einzelstatements mit Auto-Commit. Für diese gibt
es derzeit nichts, an das ein Audit-Write sich anhängen könnte — es müsste eine
Transaktion neu eröffnet werden.

### 4.2 Die strukturelle Hürde: Schichtung + ESLint

`eslint.config.mjs:63-80` verbietet in `src/modules/**` (außer `*Repository*.ts`)
jeden direkten Prisma-Zugriff:
> `Direkter Prisma-Aufruf in modules/ ist verboten. Lagere ihn in eine *Repository.ts-Datei aus.`

Services erreichen Prisma ausschließlich über Repositories. Ein Service kann also
**nicht** selbst `$transaction` öffnen. Zwei mögliche Umbauformen:

- **(A) Repository erweitert** — bestehende Transaktionsmethode erhält einen optionalen
  `audit`-Parameter und schreibt `tx.auditLog.create(...)` im selben Callback.
  Kleinster Eingriff, aber nur für die 7 bestehenden Methoden anwendbar.
- **(B) Service öffnet die Transaktion** und reicht `tx` an das Repository durch —
  setzt eine Aufweichung der ESLint-Regel oder eine `tx`-Variante jedes Repositories
  voraus. Deutlich größerer Eingriff.

**(A) ist der einzige Weg ohne Regeländerung** und damit der realistische.

### 4.3 Read-Replica-Routing: zwei Befunde, einer davon gravierend

**Befund 1 (aktueller Zustand): Das Read-Routing ist vollständig wirkungslos.**

`prisma.service.ts:70-74`:
```ts
const self = this as unknown as { $extends: (ext: unknown) => unknown };
self.$extends(this.buildReadRoutingExtender());
```
`$extends` **gibt einen neuen Client zurück**. Der Rückgabewert wird verworfen.
Die Extension ist damit nie installiert. Nachgewiesen mit einer echten,
leeren Replica-Datenbank:

```
GROUND TRUTH  primary.audit_log = 29 | replica.audit_log = 0
EXTENDED client auditLog.count = 29 | findMany len = 29
```
Der „erweiterte" Client liest von der Primary. Ein Replica mit 0 Zeilen liefert 0 —
hier 29. **Alle Read-Operationen laufen auf der Primary.** Der Docstring
(`prisma.service.ts:5-31`) beschreibt ein Verhalten, das nicht existiert.
`/health/ready` meldet correspondingly `replica: "disabled"`, weil
`DATABASE_READ_REPLICA_URL` in `.env` nicht gesetzt ist — der Fehler fällt also
durchaus nicht auf, *weil* die Replica ohnehin abgeschaltet ist.

**Befund 2 (latent, gravierend): Mit korrektem Routing bricht jede Transaktion.**

Mit einer korrekt verdrahteten Extension (Rückgabewert verwendet) und derselben
leeren Replica gemessen:

```
[FIXED ext] outside-tx auditLog.count = 0            (Replica — Routing wirkt)
[FIXED ext] inside-tx  read-your-write = {"readBackFound":false,"txAuditCount":0}
```
**Innerhalb von `$transaction` werden Lesetools auf die Replica geroutet.**
Zeilen, die dieselbe Transaktion gerade geschrieben hat, sind dort unsichtbar.
Das trifft exakt die Muster, die im Repo bereits existieren:
`bilanz.repository.ts:231ff` macht `tx.bilanz.findFirst(...)` als
**Existenz- und Mandant-Autorisierungsprüfung** und wirft bei `null` einen Fehler.
Mit aktivem Routing würde jeder Bilanz-Update mit „Bilanz nicht gefunden oder kein
Zugriff" abbrechen — ein Totalausfall, kein stiller Fehler.

Testabdeckung dafür: **null**. `grep -rln "replica" --include=*.spec.ts src` → 0 Treffer.

**Fazit Frage 3:** Prisma kann in derselben Transaktion schreiben — die
Transaktionsfähigkeit ist nicht das Problem. Das Problem sind (i) der Retry-Mechanismus
(Abschnitt 5.1), (ii) die Schichtung/ESLint-Hürde (4.2) und (iii) die latente
Routing-Landmine (4.3), die jede bestehende Transaktion im Repo zerstören würde,
sobald jemand `$extends` korrekt verdrahtet.

### 4.4 `findByMandantPaginated` — der bestehende Ansatz

Drei Repositories (anhang, bilanz, guv) implementieren `findByMandantPaginated`
(z. B. `bilanz.repository.ts:112-154`):

- Cursor-Paginierung über `updatedAt DESC, id ASC`, `take: pageSize + 1`
  (+1 für `hasMore`-Erkennung), Cursor als base64 über `CursorCodec`.
- **Zwei Queries statt N+1:** die Hauptliste, danach ein `wormObject.findMany` mit
  `entityId: { in: [...] }`, in JS zu einer Map zusammengeführt.
- Läuft auf dem **Root-`prismaService`**, nicht auf einem `tx`-Handle — für reine
  Lesevorgiffe also korrekt.

Für die Atomicity-Frage relevant ist weniger dieser Ansatz selbst als die
Tatsache, dass `AuditService.findAll` (`audit.service.ts:225ff`) ebenfalls über den
Root-Client liest und per `Promise.all([findMany, count])` zwei Round-Trips fährt.
`countForMandant`/`countForKanzlei` cachen (TTL 30 s) über
`this.prisma.auditLog.count(...)`. Würde das Routing je aktiv, käme die
**Audit-Zählung für GoBD-Zwecke aus einer nachlaufenden Replica** — ein
Nachweisproblem eigener Art. (Heute nicht akut, weil das Routing tot ist.)

---

## 5. Zielbild und Risiken (Antwort auf Fragen 4 und 5)

### 5.1 Das Zielbild — kleinstmöglicher Umbau (Struktur, kein Code)

**Kernentscheidung: Der Audit-Write wandert *in die bestehende* Transaktion, es wird
keine neue Transaktionsinfrastruktur gebaut.**

Datenstruktur — ein schmaler, transaktionsfähiger Audit-Write:

```
AuditWritePayload   = RecordAuditParams          (unverändert, plus jahresabschlussId etc.)
AuditTxWriter        = schmaler Writer, NUR der INSERT
                       - nimmt tx (Prisma.TransactionClient) + payload
                       - KEIN Retry
                       - KEIN Cache-Invalidate (nach Commit, via void)
                       - KEIN Hash-Chain (nach Commit, via void)
```

Wo die Transaktion aufspannt — nur dort, wo sie heute schon existiert:

```
Service.createBilanz(dto)
  └─ BilanzRepository.createWithPositionen(input, audit?: AuditWritePayload)
       └─ prisma.$transaction(async (tx) => {
            tx.bilanz.create(...)            // Fachdaten
            tx.bilanzPosition.createMany(...) // Fachdaten
            tx.auditLog.create(audit)         // Audit, gleiche Transaktion
          })                                  // Committ oder nichts
```

Fehlerpropagierung:
- Der Audit-INSERT wirft (kein Catch). Ein Fehler → Transaktion bricht ab →
  **Fachdaten werden nicht geschrieben.** Das ist exakt das gewünschte Verhalten
  und löst das Atomicity-Problem.
- `record()`/`recordStrict()` bleiben als **Post-Commit-Ausstiegsflughafen**
  bestehen für alles außerhalb der Transaktion (Auth, Webhook-Delivery, Cache- und
  Hash-Nachlauf).

Wie der Interceptor mitläuft:
- Er bleibt **außerhalb** der Transaktion. Er ist eine Zugriffs-/Zugriffskontrollebene,
  keine Domänenatomarität. Er wird zusätzlich gebunden (Defekt 1) — als
  „wer/was/wann/welche Route"-Zeile, mit **Payload-Cap** (z. B. `newState` auf
  4 kB kürzen, sonst wird der Response-Body zum Audit-Gewicht).
- Keine Doppelbuchung desselben Sachverhalts, indem der Interceptor Fach-`entityType`
  aus der URL **normalisiert** (kebab → PascalCase) und Service-seitige Einträge
  für transaktional abgedeckte Vorgänge **entfallen**.

Reihenfolge, die ich empfehle:
1. `AuditInterceptor` binden (Defekt 1) — 1 Zeile.
2. Hash-Chain reparieren (Defekt 2) — `data: { entryHash, prevHash }` — 1 Zeile
   plus Sequentialisierung.
3. **Transaktions-Audit** zuerst nur für die 7 Methoden, die bereits eine
   Transaktion haben (Variante A). Das ist ein überschaubarer, ehrlicher Schritt.
4. Erst danach über die ~29 Einzelstatement-Schreibvorgänge entscheiden.

### 5.2 Risiken — ehrlich bewertet

**R1 — Der Retry-Mechanismus ist in einer Transaktion strukturell unmöglich. (HOCH)**
`writeWithRetry` versucht 3× mit Backoff. Gemessen in einer echten Transaktion:
```
attempt 1 :: Unique constraint failed on the fields: (`id`)
attempt 2 :: code: "25P02", message: "current transaction is aborted,
             commands ignored until end of transaction block"
attempt 3 :: code: "25P02", …
```
Postgres setzt nach einem Fehler die Transaktion in den Abort-Zustand; jeder
weitere Befehl scheitert. **Jede Retry-Logik im Transaktionspfad muss entfallen.**
Das ist ein echter Zielkonflikt: Atomarität und Ausfallsicherheit gegen transiente
Fehler schließen sich hier aus. Der Verlust der Resilience ist vertretbar, *wenn*
stattdessen der Aufrufer einen sauberen Fehler bekommt und der Vorgang gar nicht
erst stattgefunden hat — aber es muss bewusst entschieden und dokumentiert werden.

**R2 — Die latente Read-Routing-Landmine. (HOCH, aber heute latent)**
Siehe 4.3. Solange `DATABASE_READ_REPLICA_URL` nicht gesetzt ist, fällt nichts auf.
Sobald jemand in Produktion die Replica konfiguriert — **und vorher oder
gleichzeitig `$extends` korrekt verdrahtet** — brechen alle 7 bestehenden
Transaktionen im Repo (Existenz-/Autorisierungsprüfungen sehen nichts). Eine
Transaktions-Refaktorierung *verstärkt* dieses Risiko, weil sie die Transaktionsnutzung
ausbaut. Ohne Testabdeckung (aktuell null) bliebe es unbemerkt.

**R3 — Hash-Chain-Sequentialisierung. (MITTEL, nach Defekt 2 relevant)**
`computeHashForEntry` liest den Vorgänger über `createdAt: { lt: … }`. Unter
Parallelität lesen zwei gleichzeitige Audit-Writes denselben Vorgänger → die Kette
**gabelt sich**, und `verifyIntegrity()` meldet `BROKEN`. Das ist heute irrelevant,
weil gar keine Hashes geschrieben werden (Defekt 2) — wird aber schlagend, sobald
Defekt 2 behoben ist. Die Lösung ist ein `SELECT … FOR UPDATE` auf dem letzten
Eintrag oder ein `pg_advisory_xact_lock`, was **alle** Audit-Writes serialisiert.
Transaktionsdauer und Durchsatz wären dann durch den langsamsten Audit-Write
bestimmt.

**R4 — Transaktionsdauer / N+1. (MITTEL)**
`datev-import` schreibt Bilanz **und** GuV mit jeweils `createWithPositionen`
(inkl. Positions-Replace) — zwei Transaktionen. Fasst man beide plus Audit in eine,
wird die Transaktion länger; das `deleteMany`+`createMany` der Positionen hält
Lockzeiten. Bei den 29 Einzelstatement-Pfaden käme ein zusätzlicher
BEGIN/COMMIT-Round-Trip pro Vorgang hinzu — spürbar, aber nicht katastrophal.

**R5 — Deadlocks. (NIEDRIG bis MITTEL)**
Das Muster „Fachdatensatz lesen → Fachdatensatz schreiben → Audit schreiben“ ist
 konsistent (gleiche Reihenfolge überall). Ein Deadlock entstünde eher, wenn
Transaktionen zusätzlich über den Hash-Chain-Anker (R3) konkurrieren. Ohne
Chain-Lock ist das Risiko gering.

**R6 — Verhalten unter Parallelität heute. (HOCH, nicht neu)**
Die heutige Lage ist nicht „transaktional inkonsistent", sie ist **nicht
nachvollziehbar**: der Audit-Write läuft parallel zum Response, fire-and-forget,
Fehler gehen in einen prozesslokalen Zähler, der bei Neustart auf 0 zurückgesetzt
wird und nirgends persistiert ist. Ein Ausfall über einen Neustart hinweg ist
spurlos verschwunden. Nachgewiesen: der Zähler stieg während meiner Tests auf 124
und war nach einem Backend-Neustart wieder 0.

**R7 — Der Preis eines fehlerhaften Refaktors. (HOCH)**
Das ist die eigentliche Abwägung. Die 232 grünen Tests decken **keine** der
47 Aufrufstellen ab (`recordStrict`/`AuditInterceptor`: 0 Treffer in e2e/ und src/).
Eine Transaktions-Umstellung berührt 7 Repository-Methoden, verändert die
Fehlerpropagierung in 36 Pfaden und hat **kein Sicherheitsnetz**. Ein Refaktor ohne
neue Tests kann die Testsuite unverändert grün halten und trotzdem jede der 36
Stellen brechen — der „grün"-Status wäre dann wertlos.

### 5.3 Was ist schlimmer: die Lücke oder ein fehlerhafter Refaktor?

**Ein fehlerhafter Refaktor ist schlimmer — unter einer Bedingung.**

Die heutige Lücke ist *laut und reparierbar*: Fachdaten werden geschrieben, der
Audit-Eintrag fehlt, das ist an der Datenlage erkennbar, und die Lücke ist auf
ein einzelnes Fenster begrenzt.

Ein fehlerhafter Refaktor ist *lautlos und schlimmer*, weil er die Kette
scheinbar schließt (`atomicity: true` im Code, `PARTIAL`/`OK` im
Integrity-Endpoint), während er faktisch 36 Pfade in eine andere
Fehlerbehandlung überführt. Der Zustand „Fachdaten ohne Nachweis" wird dann
zudem als „gelöst" dokumentiert.

Die Bedingung: **kein Refaktor ohne Testabdeckung.** Für jede der 7
Transaktionsmethoden braucht es mindestens einen Test, der einen Audit-Fehler
erzwingt und den Rollback des Fachvorgangs belegt. Solange die 232 Tests keinen
einzigen Audit-Fehlerpfad prüfen, ist die Bilanz offen.

---

## 6. Optionen und Empfehlung (Antwort auf Frage 6)

### (a) Jetzt umbauen — Audit + Fachdaten in eine Transaktion

| Dafür | Dagegen |
|---|---|
| Schließt das Atomicity-Problem tatsächlich | 36 Pfade, davon 29 ohne vorhandene Transaktion |
| 7 Methoden sind technisch bereits vorbereitet | Retry muss entfallen (R1) |
| `datev-import` (2 Transaktionen, 1 Eintrag) wäre endlich korrekt | R2 kann jeden Transaktionspfad zerstören |
| | Null Testabdeckung (R7) |
| | Setzt den Interceptor als Grundlage voraus, der nicht existiert |

**Bewertung: nicht jetzt.** Zu teuer relativ zum Effekt, und es würde die falsche
Reihenfolge wählen. Als **Schritt 3+** nach den Defekten aus Abschnitt 0 aber richtig.

### (b) Interceptor als alleinige Quelle + 47 Stellen aufräumen

| Dafür | Dagegen |
|---|---|
| Kleinster Eingriff mit dem größten Effekt (1 Zeile Bindung) | Der Interceptor ist heute **nicht** korrekt: voller Response-Body als `newState`, URL-abgeleiteter `entityType`, `entityId` nur aus Pfad oder flachem Response-`id` |
| Einheitliche, von der Fachlogik unabhängige Abdeckung | **6 der 47 Stellen wären ungedeckt** (4 Auth, 2 Webhook-Delivery) |
| Entfernt die Pflicht, an 47 Stellen zu denken | Löschung allein bringt **keinen** Nutzen und verliert kuratierte `newState`-Snapshots |
| | Doppelschreibung, solange nicht normalisiert/kappt |
| | `signatur`, `datev-import`, `konsolidierung` haben fachliche Zusatzinformation, die der Interceptor nicht kennt |

**Bewertung: als reine Aufräumaktion falsch, als erster Schritt richtig.**
Das Aufräumen muss **nach** der Bindung und **nach** einer Belegungsprüfung
erfolgen, welche der 6 Ausnahmen tatsächlich tragend sind.

### (c) Bewusst offen lassen, mit dokumentiertem Restrisiko

| Dafür | Dagegen |
|---|---|
| Null Regressionsrisiko für die 232 Tests | Das Restrisiko ist derzeit **nicht** dokumentiert, sondern übersehen — es wird als „behoben" geführt (`REPARATUR-REPORT.md` Runde 11) |
| Fokussiert die Team-Kapazität | `AGENTS.md §3.5` („Jede Mutation erzeugt einen AuditLog-Eintrag") ist eine unbelegte Behauptung |
| | `verifyIntegrity()` liefert `PARTIAL`/`OK`-vakuös |

**Bewertung: als Grundhaltung für die *Transaktions*-Frage richtig**, aber nicht
als Begründung, die Defekte aus Abschnitt 0 mitzudecken.

### Empfehlung

**Für die Transaktions-Refaktorierung: (c) — bewusst offen, dokumentiert.**

Begründung in einem Satz: Die Transaktions-Umstellung adressiert ein Problem, dessen
Vorbedingung („der Interceptor deckt HTTP-Mutationen bereits ab") nicht erfüllt ist,
und sie kostet Eingriffe in 36 Pfade ohne Testabdeckung, während sie an einer
harten Prisma-Grenze scheitert (Retry vs. Transaktion) und eine latente
Routing-Landmine auslöst.

**Was stattdessen zuerst fehlt — und zwar in dieser Reihenfolge:**

1. **`AuditInterceptor` binden.** `{ provide: APP_INTERCEPTOR, useClass: AuditInterceptor }`
   in `app.module.ts`. Danach mit einem Test belegen, dass ein `POST` ohne
   manuellen `record()`-Aufruf einen Eintrag erzeugt. **Ohne diesen Schritt ist jede
   weitere Audit-Diskussion gegenstandslos.**
2. **Hash-Chain reparieren.** `data: { entryHash, prevHash }` statt `data: {} as never`;
   `.catch()` entfernen. Danach `GET /api/audit/integrity` muss `OK` mit
   `entriesChecked > 0` liefern. Zusätzlich `verifyIntegrity()` darf **kein `OK`
   bei 0 geprüften Einträgen** mehr melden.
3. **Rezidiv-Schutz für die tote `$extends`-Verdrahtung.** Entweder `$extends` korrekt
   verdrahten **oder** die Replica-Route aus dem Docstring entfernen — der heutige
   Zustand behauptet in `prisma.service.ts:5-31` ein Verhalten, das nicht existiert.
   Vor jedem Ausbau der Transaktionsnutzung zwingend.
4. **Testabdeckung für die Audit-Kette.** Mindestens je ein Test pro Kategorie:
   (a) mutierender Request ohne manuellen `record()` erzeugt einen Eintrag,
   (b) erzwungener Audit-Fehler ⇒ kein Fachdatensatz persistiert,
   (c) Login/Logout erzeugt Einträge trotz `AUDIT_SKIP_PATHS`,
   (d) `verifyIntegrity()` meldet bei 0 Einträgen nicht `OK`.
5. **Erst danach** die Transaktions-Umstellung, beginnend mit den 7 Methoden, die
   bereits eine Transaktion haben (Variante A aus 5.1), jeweils mit einem
   Rollback-Test.

Das ist eine andere Reihenfolge als die Aufgabenstellung nahelegt, aber sie ist
diejenige, die die Beweiskraft des Audit-Trails zuerst repariert. Eine
reihenfolgetreue Umsetzung würde 36 Pfade umbauen und weiterhin einen
nicht laufenden Interceptor und eine leere Hash-Chain haben.

---

## 7. Was ich NICHT verifizieren konnte

1. **Produktions-Read-Replica.** Ich habe eine leere zweite Postgres-Datenbank als
   Replica-Stub verwendet (`replica_stub`, vollständiges Schema per `prisma db push`).
   Eine echte Streaming-Replica hat andere Lag-Charakteristiken. Die Aussage
   „Routing ist tot" und „Routing bricht Transaktionen" ist gegen eine leere DB
   bewiesen; das *Verhalten unter realer Replikationsverzögerung* ist es nicht.
2. **Kein Last-/Parallelitätstest.** Es liefen keine Lasttests, keine Deadlock-Szenerien,
   keine Messung der Transaktionsdauer oder des Audit-Throughputs. Die Aussagen zu
   R3/R4/R5 sind aus Codeanalyse und dem `25P02`-Nachweis abgeleitet, nicht gemessen.
3. **`$extends`-Verhalten bei Prisma-Versionen.** Alle Messungen liefen gegen die
   im Repo gepinnte `5.22.0`. Ob neuere Prisma-Versionen die Extension auf
   `tx`-Clients anwenden, habe ich nicht geprüft.
4. **Stripe-/Billing-Webhook-Pfad.** `billing-webhook.service.ts:46` habe ich nur
   statisch bewertet. Die Signaturprüfung und der Mock-TSA-Pfad wurden nicht
   end-to-end durchlaufen; insbesondere ob dort ein Retrying des Providers die
   Audit-Semantik verfälscht.
5. **Absicht der ursprünglichen Interceptor-Architektur.** Ob der Interceptor
   global oder controller-gebunden gedacht war, geht aus dem Repo nicht hervor.
   `docs/gobd-architektur.md:19` beschreibt ein globales „hängt sich an alle
   Requests"-Modell, was für die globale Bindung spricht. Ein Design-Doc, der die
   Transaktionsfrage behandelt, existiert nicht — `AUDIT-ATOMICITY-REVIEW.md` ist
   in `REPARATUR-REPORT.md:929ff` nur als offener Verweis vorgemerkt.
6. **Die 47 Aufrufstellen wurden nicht einzeln zur Laufzeit verifiziert.** Die
   Kategorisierung (1.3) beruht auf statischer Analyse plus gezielter Stichproben
   (`datev-import`, `idw-pruefung`, `signatur`, `auth`, `webhook`, `mandant`,
   `branding`, `pdf`). Für die verbleibenden Stellen ist die Einstufung
   schreibend/nicht-schreibend plausibel, aber nicht je Stelle empirisch belegt.
7. **Build-Zustand.** `backend/dist/` ist gegenüber `src/` veraltet
   (`dist` vom 2026-09-29 22:41, `src/modules/audit/**` vom 2026-09-30 16:04/16:08).
   Ich habe deshalb für den Laufzeitnachweis direkt aus `src/` via `ts-node` gebootet
   und **nicht** neu gebaut. `npm run build` / `npm run typecheck` habe ich nicht
   ausgeführt — beim Probe-Boot fiel ein vorbestehender Typfehler in
   `mandant.service.ts:194` auf (`TS2352`), dessen Status im Projekt-Setup ich
   nicht geprüft habe.
8. **Die 232 Tests habe ich einmal sauber durchlaufen lassen** (17 Dateien, 232/232,
   190 s) — aber nur **nach** Entfernung meines Probe-Triggers. Ein erster Lauf
   lief während der Träger-Installation und war dadurch kontaminiert
   (121 provozierte Audit-Fehler); dieses Ergebnis habe ich verworfen.

---

## Anhang: Methodik und Aufräumen

Alle Befunde sind reproduzierbar. Es wurde **keine Projektdatei geändert**
(`git status --porcelain` leer). Verwendet wurden:

- **Statische Analyse:** `grep`/`read` auf `src/`, `prisma/schema.prisma`,
  `eslint.config.mjs`, `vitest.config.ts`.
- **Echte Läufe gegen das laufende System** (PostgreSQL 15, Nest-Backend auf `:3000`):
  Login, `POST`/`PATCH` mit gültigem und ungültigem Payload, `GET /health/ready`,
  `GET /api/audit/integrity`.
- **Vier Ad-hoc-Proben** (außerhalb des Projektbaums, in `/workspace/_verifier-scratch/`):
  Replica-Routing in und außerhalb von Transaktionen, korrigiertes Routing,
  Retry-Verhalten in einer Transaktion, Interceptor-Laufzeit-Spy gegen die echte
  Nest-App.
- **Ein temporärer PostgreSQL-Trigger** (`probe_block_audit_ins`) zur Simulation
  eines totalen Audit-Ausfalls. **Vollständig entfernt**; verifiziert:
  `select tgname from pg_trigger where tgrelid='audit_log'::regclass and not tgisinternal`
  → 0 Zeilen. Es wurden keine fachlichen Testdaten zurückgelassen (Mandant
  `Demo GmbH`/`GmbH` entspricht dem Seed, `wp_notiz` unverändert bei 1,
  alle `PROBE_*`-Auditzeilen gelöscht).
- **Backend neu gestartet**, damit der `failedWrites`-Zähler wieder 0 ist:
  `/health/ready` → `{"status":"ok", … "auditWriteFailures":0}`.
