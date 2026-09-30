# Unabhängige Code-Review — Bundesanzeiger Jahresabschluss

**Prüfer:** Verifier (unabhängige Gegenprüfung)
**Datum:** 2026-09-30
**Prüfgegenstand:** `origin/main..HEAD` (4 Commits, 79 Dateien, +14.918/−657) plus Gesamt-Sicherheits- und Korrektheitsüberblick
**Methode:** eigener Aufbau der Testumgebung, eigener Testlauf, statische Analyse, **live adversarial probing per `curl` gegen das laufende Backend**, eigene Gegenproben gegen den CRL-Parser

---

## 1. Verdict

# ❌ FAIL

Der Code ist in dieser Runde **substanziell besser geworden** — die Signaturprüfung ist erstmals kryptografisch belastbar, `tsc`/`eslint` sind sauber, die Mandantentrennung auf den Listen-Endpunkten hält einem direkten Angriff stand. Aber zwei Dinge blockieren eine Freigabe:

1. **Ein vollständig belegter SSRF-Bypass.** Der neue `ssrf-guard.ts` lässt die Cloud-Metadaten-Adresse und die lokale PostgreSQL-Port-Adresse zu. Ich habe es live ausgenutzt: HTTP 201, Datensatz persistiert, **echte TCP-Verbindung zu 127.0.0.1:5432 aufgebaut** (`ECONNRESET: socket hang up` im Backend-Log). Der Guard erfüllt damit genau nicht das, wofür er geschrieben wurde.
2. **Die Testsuite ist nicht grün — entgegen der Behauptung.** Real gemessen: **158 passed, 1 failed, 10 skipped** (nicht „169 grün"). Die 10 übersprungenen Tests sind die komplette `pdf.e2e`-Suite (WORM-Storage, PDF-Integrität, Cross-Mandant-Download), die wegen eines **falschen Health-Pfads** nie startet. Der Test, der die Cursor-Pagination prüft, schlägt deterministisch fehl — die in diesem Diff geänderte `pagination.dto.ts` hat damit **keinen bestandenen Test**.

Bemerkenswert: Die uncommitteten Änderungen im Working Tree, die während meiner Prüfung auftauchten, ersetzen stille `return`-Skips durch laute `throw`s. Das ist die richtige Richtung — hat aber den Health-Bug eingeführt und die Suite rot hinterlassen. Der committete Stand ist in diesem Punkt **ehrlicher gesehen** schlechter.

---

## 2. Befunde nach Schwere

### 🔴 KRITISCH

#### K-1 · SSRF-Guard umgehbar über IPv4-mapped / IPv4-kompatible / NAT64-IPv6
**Ort:** `backend/src/common/security/ssrf-guard.ts:57` (Ursache), wirksam in `:95-101` und `:114-119`

**Was:** `isPrivateV6()` erkennt IPv4-mapped-Adressen nur in **Dezimalpunkt-Form**:
```ts
const mapped = norm.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
```
Die WHATWG-URL-API normalisiert IPv6-Literale aber **immer auf Hex-Form**. `new URL('http://[::ffff:127.0.0.1]/').hostname` liefert `[::ffff:7f00:1]`, nie `::ffff:127.0.0.1`. Der Regex matcht also **nie** — toter Code. Danach greift keiner der anderen Zweige (`::`/`::1`/`fe80`/`fc`/`fd`/`ff`), also `return false` = **wird als öffentlich eingestuft**.

**Warum ein Fehler:** Das ist der Zweck des Guards. Ein Angreifer mit `KANZLEI_ADMIN`-Rechte erreicht damit genau die Ziele, die der Guard verhindern soll.

**Nachweis (live gegen das laufende Backend, KANZLEI_ADMIN-Token):**
```
http://[::ffff:169.254.169.254]/latest/meta-data/  HTTP=201   ← Cloud-Metadaten
http://[::ffff:127.0.0.1]:5432/                    HTTP=201   ← lokale PostgreSQL
http://[::7f00:1]/                                 HTTP=201   ← IPv4-kompatibel
http://[64:ff9b::7f00:1]/                          HTTP=201   ← NAT64 → 127.0.0.1
--- Baseline: Literal-Formen werden korrekt abgewiesen ---
http://127.0.0.1:5432/                             HTTP=400
http://169.254.169.254/                            HTTP=400
```
Persistiert in `webhook_subscription`:
```
http://[::ffff:169.254.169.254]/latest/meta-data/
http://[::ffff:127.0.0.1]:5432/
http://[::7f00:1]/
http://[64:ff9b::7f00:1]/
```
**Ausnutzung nachgewiesen** (`POST /api/webhook-subscriptions/:id/test`):
```
[WARN] [WebhookService] Webhook delivery e5327ad9-… failed (attempt 1): ECONNRESET: socket hang up
```
`socket hang up` ist die Antwort von PostgreSQL, das einen **HTTP-POST auf seinem Port empfangen** hat. Die Verbindung wurde real aufgebaut.

**Vorschlag:** IPv4-mapped/-kompatible Formen in **Hex** behandeln, nicht per Regex auf Dezimalpunkt:
- `::ffff:x.x.x.x` **und** `::ffff:HHHH:HHHH` → IPv4 projizieren
- `::x.x.x.x` und `::HHHH:HHHH` (IPv4-compatible, `::7f00:1`) → blockieren
- `64:ff9b::/96` (NAT64) und `2002::/16` (6to4) → als Mapping-Ziel behandeln/blockieren
- Am sichersten: `ipaddr.js`/`net.BlockList` verwenden und die **aufgelöste** Adresse prüfen statt Text-Muster zu matchen.
- **Testfall aufnehmen:** jeder obige Bypass als Negativtest in die Spec.

---

### 🟠 HOCH

#### H-1 · CRL-Prüfung ist fail-**open**, wenn `issuerCertPem === null`
**Ort:** `backend/src/modules/signatur/utils/crl-checker.ts:486`

**Was:** Die Signaturprüfung der CRL steht *innerhalb* eines `if (issuerCertPem) { … }`. Ist das Argument `null`, wird die Signatur **nie geprüft**, die Auswertung läuft normal weiter und endet in:
```ts
return { revoked: false, determined: true, reason: 'Zertifikat ist nicht gesperrt (CRL geprüft)' };
```
Eine **frei erfundene, unsignierte CRL ohne die Seriennummer** liefert damit ein selbstbewusstes „nicht gesperrt, bestimmt: true" — und der `reason` behauptet sogar wörtlich „CRL geprüft".

**Nachweis:**
```ts
await checkCertificateRevocation(leafCert, null, { fetchCrl: async () => forgedCrl })
// → { revoked: false, determined: true, reason: "Zertifikat ist nicht gesperrt (CRL geprüft)" }
```
**Ehrliche Einordnung:** Der einzige Produktionsaufrufer (`signatur.service.ts:366`) übergibt nie `null`, der Pfad ist also **heute nicht erreichbar**. Es ist aber eine exportierte Funktion mit dokumentiertem fail-closed-Vertrag, und die Fehlermeldung behauptet aktiv eine Prüfung, die nicht stattgefunden hat.

**Vorschlag:** `if (!issuerCertPem) { problems.push('kein Ausstellerzertifikat'); continue; }` — also fail-closed erzwingen statt die Prüfung zu überspringen.

#### H-2 · CRL-Signaturprüfung im Produktionspfad faktisch nie erfolgreich
**Ort:** `backend/src/modules/signatur/services/signatur.service.ts:365-368`
```ts
revocation = await checkCertificateRevocation(
  verification.certificatePem,
  verification.certificatePem, // selbstsigniert im Pilot: Issuer = Subject
);
```
Das Zertifikat wird als **sein eigener Aussteller** übergeben. Bei einem selbstsignierten Pilot-Zertifikat passt das; bei jedem **echten, von einer CA ausgestellten** Zertifikat schlägt `crypto.verify` gegen den Leaf-Public-Key fehl → `determined: false` → fail-closed → *es kann nie ein Sperrstatus positiv festgestellt werden*. Zusammen mit H-3 heißt das: Revocation-Prüfung ist im Pilot nie positiv und in Produktion nie funktionsfähig.

**Vorschlag:** Issuer-Zertifikat aus der PKCS#7-Kette (`parsed.certificates[1]`) nehmen; den Self-Signed-Sonderfall explizit und dokumentiert behandeln.

#### H-3 · `SIGNATURE_REQUIRE_REVOCATION_CHECK` fehlt in `.env.example`, Default `false`
**Ort:** `backend/src/modules/signatur/services/signatur.service.ts:154`, `.env.example`

```
$ grep -c "SIGNATURE_REQUIRE_REVOCATION_CHECK" .env.example
0
```
Der **Kern der neuesten Commit (`a74249f`, CRL-Prüfung)** ist damit **standardmäßig ausgeschaltet** und in der Beispiel-Config nicht einmal dokumentiert. `SIGNATURE_TRUSTED_ISSUERS` und `SIGNATURE_ALLOW_SELF_SIGNED` stehen drin, diese Variable nicht. Wer dem README folgt, bekommt keine Sperrlistenprüfung und erfährt nicht, dass es sie gibt.

**Nachweis:** `grep -n "SIGNATURE" run-local.sh` → kein Treffer. Auch die lokale Testumgebung prüft nicht auf Sperrung.

**Vorschlag:** in `.env.example` aufnehmen, Default bewusst setzen und im README als GoBD-Pflichtposition benennen.

#### H-4 · Testsuite nicht grün: 158/1/10 statt „169 grün"
**Ort:** `backend/e2e/pdf.e2e.spec.ts:112`

**Nachweis (eigener Lauf, `npx vitest run`):**
```
Test Files  2 failed | 13 passed (15)
     Tests  1 failed | 158 passed | 10 skipped (169)
  Duration  147.39s
```
Ursache der 10 Skips: die Spec prüft `${BASE}/api/health`, der Health-Endpunkt liegt aber unter `/health`:
```
$ curl -o /dev/null -w "%{http_code}" http://localhost:3000/api/health   → 404
$ curl -o /dev/null -w "%{http_code}" http://localhost:3000/health       → 200
```
`beforeAll` wirft, die gesamte Suite (10 Tests: WORM-Upload, SHA-256, `wormObjectKey`-Format, PDF-Textlayer, **Cross-Mandant-PDF-Download → 403**) fällt aus. Betroffen ist ausgerechnet die WORM- und Mandantentrennungs-Strecke.

**Vorschlag:** `${BASE}/health` verwenden. Besser: die Specs sollten den Server **selbst starten** statt gegen `localhost:3000` zu laufen (siehe H-6).

#### H-5 · Cursor-Pagination (in diesem Diff geändert) hat keinen bestandenen Test
**Ort:** `backend/e2e/pagination.e2e.spec.ts:115`, `backend/src/common/dto/pagination.dto.ts`

**Nachweis — deterministisch, auch im Isolationslauf:**
```
$ npx vitest run e2e/pagination.e2e.spec.ts
Tests  1 failed | 7 passed (8)
Error: Cursor-Test braucht mindestens 6 Bilanzen, hat 5 (hasMore=false)
```
Nicht flakyg, sondern **immer rot**: der Seed liefert für den ersten Mandanten des `steuerberater` genau 5 Bilanzen, der Test braucht 6. Positiv zu bewerten ist, dass der Test nicht still überspringt, sondern wirft — die ehrliche Variante stand allerdings **erst in den uncommitteten Änderungen**; committet ist dort ein `return;` (stiller Skip). `pagination.dto.ts` (`CursorCodec`, `BoundedIntPipe`) ist in diesem Diff geändert worden und damit faktisch **ungeprüft**.

**Vorschlag:** Fixtures für ≥6 Bilanzen im Seed oder im Spec anlegen — im Spec, nicht im Seed, damit die Testdaten nicht vom Produktiv-Seed abhängen.

#### H-6 · Testsuite ist nicht standalone reproduzierbar
**Ort:** `backend/vitest.config.ts:35`, 13 von 15 Spec-Dateien

12 der 13 e2e-Specs sprechen **HTTP gegen einen extern laufenden Server** (`const BASE = 'http://localhost:3000'`), `Test.createTestingModule` wird nur für Login-Hilfen benutzt. `npm test` allein schlägt deshalb fehl:
```
FAIL e2e/pdf.e2e.spec.ts
Error: Backend unter http://localhost:3000 nicht erreichbar — bitte ./run-local.sh starten
```
`globalSetup` startet nur Postgres/Seed, **nicht** den Server. Zusätzlich mutieren die Specs die geteilte Live-DB (ich habe während des Laufs `geschaeftsjahr: 2099` aus einem laufenden Spec im Produktiv-Backend gesehen) — Test und laufende Instanz teilen sich denselben Datenbestand.

**Vorschlag:** `globalSetup` um einen gestarteten/gestoppten Nest-Server erweitern, damit `npm test` in einem Befehl läuft.

---

### 🟡 MITTEL

#### M-1 · `@RequireMandant()` fehlt an 8 von 10 WP-Routen
**Ort:** `backend/src/modules/wp/controllers/wp.controller.ts` — nur Zeilen 142 und 159 tragen den Decorator; `POST notizen` (71), `PATCH notizen/:id/status` (86), `GET notizen` (102), `POST pruefungen` (172), `GET pruefungen/:id` (188), `:id/finalize` (197), `:id/report` (216), `bilanz/:bilanzId/pruefungen` (225) tragen ihn nicht.

`MandantGuard.canActivate` steigt bei `if (!required) return true;` sofort aus — auf diesen Routen **läuft die Mandantenprüfung des Guards nicht**. Live bestätigt: `GET /api/wp/notizen?bilanzId=<fremd>` lieferte 400 aus der Pipe, nicht 403 aus dem Guard — der Guard war nicht beteiligt.

**Warum trotzdem (noch) kein Datenleck:** Der Service leitet den Mandanten aus der referenzierten Entität ab und prüft selbst — `wp-notiz.service.ts:263`:
```ts
private assertMandantAccess(mandantId: string, user: AuthUser): void {
  if (user.globalRole === 'SYSTEM_ADMIN') return;
  const accessible = new Set(user.mandanten.map((m) => m.id));
  if (!accessible.has(mandantId)) throw new ForbiddenException('Kein Zugriff auf diesen Mandanten');
}
```
**Das ist klassische Defense-in-Depth, aber die obere Schicht fehlt.** Mein erster Live-Test war ein **Fehlschluss**: der WP-User hat laut JWT legitimen Zugriff auf *zwei* Mandanten, der Schreibvorgang war also nicht tenant-fremd. Dass die Service-Prüfung greift, habe ich statisch verifiziert, nicht durch einen erfolgreichen Angriff.

**Vorschlag:** `@RequireMandant()` + `@UseGuards(MandantGuard)` an alle WP-Routen, Service-Check behalten.

#### M-2 · Audit-Trail: Fehler werden verschluckt, Geschäftsvorgang bleibt
**Ort:** `backend/src/modules/audit/services/audit.service.ts:97-104`, 49 Aufrufstellen mit `void this.auditService.record(…)`

`record()` fängt Fehler und kehrt normal zurück:
```ts
} catch (err) {
  this.logger.error(`AuditLog write fehlgeschlagen (…)`);
  return;                 // ← kein Re-throw
}
```
Der aufrufende Geschäftsvorgang ist zu diesem Zeitpunkt **bereits committet**. Für ein GoBD-System, in dem der Audit-Trail rechtlich zwingend ist, bedeutet das: ein fehlgeschlagener Audit-Write ist eine **stille, nicht nachvollziehbare Lücke** — der Nutzer bekommt Erfolg.

Verschärfend die Hash-Chain (`:120`):
```ts
void this.integrityService.computeHashForEntry(id).catch(err => this.logger.warn(…));
```
Schlägt die Hash-Berechnung fehl, steht der Audit-Eintrag **ohne** Kettenhash da, nur mit einer Warnung. Eine Hash-Chain mit Lücken ist nicht verifizierbar.

**Vorschlag:** Audit-Write mindestens als Transaktion erzwingen oder den Geschäftsvorgang bei Audit-Fehler ablehnen. Hash-Chain-Berechnung synchron und mit Retry, Lücken als harter Fehler.

#### M-3 · Zweiter SSRF-Vektor: CRL-Abruf ohne Adressprüfung
**Ort:** `backend/src/modules/signatur/utils/crl-checker.ts:405-417`, `:122`

`extractCrlEndpoints` gewinnt URLs per Regex aus dem **Zertifikat selbst** (`/https?:\/\/[^\s"'<>]+/`, Zeile 122) und `defaultFetchCrl` ruft sie **ohne jede `ssrf-guard`-Prüfung** ab. Das `ssrf-guard` wird in dieser Datei **nicht importiert**. Ein Zertifikat mit bösartigem CRL-Distribution-Point lässt den Server einen beliebigen internen HTTP-Endpunkt kontaktieren. Mein Testlauf zeigt die URLs real auf `http://127.0.0.1:9100/…`.

**Einschränkung, die ich nicht wegargumentieren will:** Erforderlich ist, ein Zertifikat mit manipuliertem DP in den Prüfpfad zu bringen — das setzt Kontrolle über das Zertifikat voraus. Ich konnte das mangels geeigneter PKCS#7-Testdaten **nicht end-to-end ausnutzen**, nur den fehlenden Guard belegen.

**Vorschlag:** `assertResolvesToPublicAddress()` auch auf CRL-URLs anwenden.

#### M-4 · DNS-Rebinding bleibt möglich (TOCTOU)
**Ort:** `backend/src/modules/webhook/services/webhook.service.ts:321-323`

```ts
await assertResolvesToPublicAddress(sub.url);   // löst auf und prüft
const response = await axios.post(sub.url, …);  // löst SELBST neu auf
```
Schicht 2 prüft eine DNS-Auflösung, axios/Node take danach eine **zweite** vor. Der Kommentar „Fängt DNS-Rebinding" ist damit nur für den Sprung *Registrierung → Zustellung* zutreffend, nicht für *Prüfung → Verbindung*. Ein Host mit niedriger TTL (oder ein Angreifer-Resolver mit alternierender Antwort) liefert beim ersten Mal eine öffentliche, beim zweiten Mal `127.0.0.1`.

Der Response-Body wird nicht mehr persistiert (gute Teil-Reparatur), der **Statuscode** schon — es bleibt ein Statuscode-Orakel.

**Vorschlag:** einmalig auflösen und die aufgelöste IP pinnen (axios `httpAgent`/`lookup`-Override mit `Host`-Header), statt zweimal aufzulösen.

#### M-5 · Public-API: `nextCursor` ist immer `null`, `cursor` wird ignoriert
**Ort:** `backend/src/modules/api/services/public-api-read.service.ts:104-119`
```ts
void CursorCodec; // tutil no-op to silence linter
const items = await this.bilanzRepository.findByMandantAndJahr(…);
const sliced = items.slice(0, pageSize + 1);
return { items, nextCursor: null, total: items.length, hasMore: sliced.length > pageSize };
```
Bei >20 Bilanzen meldet die API `hasMore: true` und `nextCursor: null`. Ein Client, der `nextCursor` folgt, erhält **nichts** — Seite 2 ist unerreichbar. Zusätzlich wird die **gesamte** Liste in den Speicher geladen. Und `void CursorCodec; // tutil no-op to silence linter` ist eine toten Zeile, die einen Linter-Fehler zum Schweigen bringt, statt Code zu entfernen.

**Vorschlag:** echte Cursor-Pagination über `findByMandantPaginated` (existiert bereits in `bilanz.repository.ts`) oder den `cursor`-Parameter aus dem D entfernen und als nicht implementiert dokumentieren.

#### M-6 · `POST /api/v1/banz-submissions` gibt 202 + erfundene ID zurück
**Ort:** `backend/src/modules/api/controllers/v1/api-v1.controller.ts:219-252`
```ts
const placeholder = { id: `placeholder-${Date.now()}`, jahresabschlussId: 'pending', status: 'PREPARED', … };
return placeholder;
```
`@HttpCode(202 ACCEPTED)` signalisiert dem Client eine angenommene, in Arbeit befindliche Einreichung. Tatsächlich wird **nichts persistiert**; die ID existiert in der DB nicht. Ein Client, der die ID protokolliert, verweist auf einen Datensatz, den es nie gab. Der Kommentar „Für die Pilot-Phase geben wir einen Platzhalter-Datensatz zurück" ist im Quellcode, nicht in der API-Dokumentation.

**Vorschlag:** entweder wirklich `banz_submission` anlegen, oder `501 Not Implemented` mit klarer Doku statt `202`.

#### M-7 · CRL-Parser liefert `issuer` immer als Leerstring
**Ort:** `backend/src/modules/signatur/utils/crl-checker.ts:322-326`

In der `tbsCertList`-Sequenz steht **zuerst** die `signature` AlgorithmIdentifier-SEQUENCE, **vor** dem `issuer` Name. Die Bedingung `if (el.tag === 0x30 && issuer === undefined)` frisst deshalb die AlgorithmIdentifier und liefert Müll.

**Nachweis (echte CRL aus `tmp/test-crl/crl-revoked.pem`):**
```
revokedSerials: [ '1000' ]
issuer  -> ""            ← immer leer
thisUpdate: 2026-09-29T22:13:00.000Z   ← korrekt
revokedSerials/tbsDer/sigValue          ← korrekt
```
`issuer` wird heute für die Trust-Entscheidung **nicht** verwendet, der Fehler ist also nicht ausnutzbar — aber das Feld ist tot und irreführend; wer später eine Issuer-Bindung darauf setzt, prüft gegen `""`.

**Vorschlag:** Positionsbasiert parsen: nach `version` kommt `signature`, dann `issuer` — feste Feldreihenfolge nach RFC 5280 §5 statt heuristischer Tag-Prüfung.

#### M-8 · CRL-Sperrstatus prüft nicht, ob die CRL in der Zukunft ausgestellt wurde
**Ort:** `backend/src/modules/signatur/utils/crl-checker.ts:510`

Nur `nextUpdate` wird geprüft, `thisUpdate` nicht. Eine CRL mit `thisUpdate` in der Zukunft gilt als gültig. `crlAgeSeconds` wird per `Math.max(0, …)` sogar auf 0 geklemmt, was ein negatives Alter verschleiert.

**Vorschlag:** `thisUpdate > now + Toleranz` ablehnen.

---

### 🟢 NIEDRIG

#### N-1 · `CursorCodec` validiert nicht, verspricht es aber
**Ort:** `backend/src/common/dto/pagination.dto.ts:87-97`
Der Docstring sagt „Selbst-validierend (Decoder prüft Format)" und „Sort-Field-Wechsel führt zu 400-Error (graceful)". `decode()` macht **keinerlei** Prüfung. Folge: `Buffer.from(cursor,'base64')` ist tolerant, `?cursor=beliebig` ergibt `id=''`, das Datum ist ungültig, und `bilanz.repository.ts:127` / `pagination.service.ts:92` behandeln das still als **erste Seite** — kein 400. Nicht ausnutzbar, aber die Dokumentation verspricht eine Härte, die nicht existiert.

#### N-2 · `worm-object.repository.findByObjectKey` ohne Mandantenfilter
**Ort:** `backend/src/modules/storage/repositories/worm-object.repository.ts:69`
`findUnique({ where: { objectKey } })` — kein Mandantenfilter, also genau die vom Fragesteller gefürchtete WORM-Umgehung. **Nach Prüfung: kein Aufrufer im Code** (`grep` über `src/` findet nur die Definition). Heute nicht ausnutzbar, aber eine latente Fußangel. Entweder Mandantenparameter erzwingen oder die Methode entfernen.

#### N-3 · Toter und doppelter Code in `crl-checker.ts`
**Ort:** `:29-48` und `:64-80`, `:293`, `:369`
`CrlEndpoint` und `RevocationStatus` sind **zweimal** deklariert (TypeScript mergt still). Zeile 293 berechnet ein `tbsDer`, das `der.subarray(tbs.valueStart, tbs.valueEnd)` ist und in Zeile 369 mit `void tbsDer;` verworfen wird — der echte Wert ist `tbsFull` (`:296`). Tot, aber irreführend: Wer `tbsDer` liest, hält es für das signierte TBS, es ist aber die Value-Nutzlast ohne Tag/Länge.

#### N-4 · Dokumentierte Testzahlen stimmen nicht
`run-local.sh` verkündet „Backend-Tests: 137/137", die Aufgabenbeschreibung nennt 169. Real: 158 passed / 1 failed / 10 skipped. Mindestens zwei Zahlen im Umlauf, keine stimmt.

---

## 3. Geprüft und **nicht** gefunden

Diese Punkte sind ausdrücklich bestätigt — ich habe sie aktiv angegriffen:

| Bereich | Ergebnis | Beleg |
|---|---|---|
| **Mandantentrennung Listen-Endpunkte** | **hält** | GF-Token (nur „Demo GmbH") gegen `?mandantId=<Beispiel>` **und** `x-mandant-id:` → `403 "Kein Zugriff auf diesen Mandanten"` auf `/api/bilanz`, `/api/guv`, `/api/anhang`. Die neue Query-Unterstützung hat die Trennung **nicht** ausgehebelt. |
| **Service-Level-Mandantenprüfung (WP)** | **korrekt** | `wp-notiz.service.ts:263` leitet `mandantId` aus der referenzierten Entität ab und prüft die User-Mandanten. |
| **Signaturprüfung Kryptografie-Stufe** | **behoben** | `pdf-signature-verify.ts` prüft jetzt **beide** Werte: `messageDigest` gegen SHA-256 der ByteRange (`:304-319`) **und** `encryptedDigest` via `cryptoVerify` gegen `signedAttrsContent` (`:349-372`). Der Runde-7-Bypass („messageDigest ist kein Signaturnachweis") ist damit **tatsächlich** geschlossen — nicht nur behauptet. |
| **`valid`-Berechnung konsistent** | **ja** | `signatur.service.ts:412` `valid = signatureCount > 0 && documentIntegrity && issuerTrusted && !certificateExpired && errors.length === 0`, und `documentIntegrity = verifyPdfSignature(...).verified` (`:803`) — enthält die Krypto-Stufe. Gesperrtes Zertifikat → `errors.push(...)` → `valid: false`. Konsistent. |
| **`tsc` / `eslint`** | **sauber** | `npx tsc --noEmit` → exit 0; `npx tsc -p tsconfig.test.json` → exit 0; `npx eslint src --max-warnings 0` → exit 0. |
| **SQL-Injection** | **kein Befund** | `grep -rn "queryRawUnsafe\|executeRawUnsafe" src/` → **null Treffer** (außer einem Kommentar). `$queryRaw` nur getaggt mit ``SELECT 1``. `LIMIT`/`ORDER BY` kommen nicht aus Benutzereingaben; Seitengrößen laufen durch `BoundedIntPipe` (max 100/200). |
| **`@Public()`-Controller** | **korrekt** | `ApiV1Controller` ist klassenweit `@Public() @UseGuards(ApiKeyGuard)`, **alle 8 Routen** tragen `@RequireScope`, und `readService` ruft `assertMandantInKanzlei`. Kein unauthentifizierter Weg. |
| **Leere `catch {}`** | **kein Befund** | `grep -rEn "catch\s*(\([^)]*\))?\s*\{\s*\}"` → 0 Treffer. Alle geprüften `catch`-Blöcke loggen oder werfen weiter. |
| **Secrets / `.env`** | **unauffällig** | `.env` nicht git-tracked (nur `.env.example`), keine Klartext-Passwörter in `src/`, keine Secrets im Backend-Log. `forbidNonWhitelisted` greift live (400 bei Fremd-Properties). |
| **Redis lazy init** | **korrekt** | `redis-cache-provider.ts:44-49` verbindet nur bei `CACHE_PROVIDER === 'redis'`, wirft ohne `REDIS_URL`, behandelt `'error'`-Event. Die Reparatur ist echt. |
| **`pdf-parse` Deep-Import** | **korrekt begründet** | `pdf-parse/lib/pdf-parse.js` statt Paket-Einstieg, weil dessen `index.js` `isDebugMode = !module.parent` prüft und unter Vitest den Demo-Code ausführt. `require('pdf-parse')` löst auf, der Deep-Import ebenfalls. |
| **Testblöcke mit Assertions** | **vollständig** | 169 `it`/`test`-Blöcke, **169 davon enthalten `expect()`**, 0 leer, 0 `it.fails`/`it.skip`/`test.todo`. |
| **`global-setup.ts` wird ausgeführt** | **ja** | Im Laufprotokoll sichtbar: `[globalSetup] DB wird in definierten Ausgangszustand versetzt …` / `[globalSetup] DB-Reset abgeschlossen.` — und der Isolationslauf des pagination-Specs zeigt, dass der Seed tatsächlich greift. |
| **Unit-Specs liegen im `include`** | **ja** | `vitest.config.ts:31` `include: ['e2e/**/*.spec.ts', 'src/**/*.spec.ts']`; beide `src/**`-Specs laufen mit und werden gezählt (crl-checker: 11 Tests). `fileParallelism: false` und `globalSetup` zwingen sie nicht in eine fremde Umgebung — `environment: 'node'` passt. |
| **WORM-Umgehung über direkten Storage-Zugriff** | **kein Befund** | Alle PDF-Routen (`pdf.controller.ts:62,79,113,130,164,181,215`) tragen `@RequireMandant()` **und** `@UseGuards(MandantGuard)`; Repository-Zugriffe gehen über `pdfService.downloadForEntity` mit Service-Filter. |
| **CRL-Spec-Abdeckung** | **solide** | 11 Tests in `crl-checker.spec.ts`, inkl. Müll-Eingabe, fremd-signierte CRL, nicht erreichbare CRL, fehlender Endpoint, gesperrt/ungesperrt. Für den Parser selbst gut — er ist der einzige Ort mit Tests für negative Fälle. |

---

## 4. Was ich **nicht** verifizieren konnte

- **Git-Historie ist nicht vollständig prüfbar.** `git log`/`git diff origin/main..HEAD` funktionieren, es gibt aber kein pushbares Arbeitsverzeichnis. Ich konnte **nicht** committen, branchen oder pushen und habe **keine** Projektdatei geändert (`git status` am Ende zeigt nur die drei producer-seitigen Änderungen, s. u.).
- **Der Working Tree hat sich während meiner Prüfung verändert.** `seed.ts` (13:52), `pdf.e2e.spec.ts` (13:55), `pagination.e2e.spec.ts` (13:57) wurden **während** meines Laufs von außen editiert — nicht durch mich und nicht durch `run-local.sh` (das schreibt dort nichts). Die Testzahlen von 14:03 beziehen sich auf diesen Zwischenstand, nicht auf `HEAD`. **Die behaupteten „169 grün" sind von `HEAD` aus nicht reproduzierbar**, weil dort in `pagination.e2e.spec.ts` noch ein stilles `return;` steht.
- **Frontend-Tests wurden nicht ausgeführt.** Playwright (`frontend/e2e/smoke.spec.ts`, 10 Tests) verlangt ein laufendes Frontend auf :3001; ich habe `./run-local.sh --frontend` nicht gestartet. Die 9.200 LOC Frontend sind **nicht** geprüft.
- **Echter Cloud-Metadatenabruf nicht möglich.** In dieser Sandbox gibt es keine IMDS. Ich habe nachgewiesen, dass die Metadaten-URL **akzeptiert und gespeichert** wird (HTTP 201) und dass der Mechanismus bis zur echten TCP-Verbindung funktioniert (Postgres auf 127.0.0.1:5432). Den Abruf der IMDS selbst konnte ich nicht zeigen.
- **M-3 (CRL-SSRF) nicht end-to-end ausnutzbar.** Der fehlende Guard ist bewiesen, ein vollständiger Angriffskette fehlt aber an einem Zertifikat mit manipuliertem Distribution Point.
- **`node-forge.crlFromPem === undefined`** habe ich nicht selbst nachgemessen — der Befund stützt sich auf den Kommentar in `crl-checker.ts:172-176` und darauf, dass der eigene Parser nötig war. Ich habe **bestätigt**, dass der eigene Parser mit echten CRLs funktioniert (Serien, `thisUpdate`/`nextUpdate`, `sigValue`, `tbsDer`).
- **Keine Produktions-CRLs / echte CA-Kette.** Alle CRL-Tests laufen gegen die selbstsignierten Fixtures aus `tmp/test-crl/`. Das Verhalten gegen eine echte Bundesnetzagentur-CA ist unbelegt.
- **Performance, Last, Zeitzonen-/Geschäftsjahr-Randfälle** (31.12./29.02., Schaltjahr, Bilanzjahrwechsel) habe ich nicht systematisch getestet.
- **`frontend/`-Code wurde nicht gelesen** außer den vier geänderten Komponenten.

---

## 5. Testintegritäts-Bewertung (mit Zahlen)

### Gemessene Realität

| Kennzahl | Wert | Quelle |
|---|---|---|
| Test-Dateien | 15 (13 e2e + 2 Unit) | `find` |
| `it(`/`test(`-Blöcke | **169** | AST-nahe Zählung |
| Blöcke **mit** `expect()` | **169 (100 %)** | eigene Analyse |
| Blöcke ohne Assertion | **0** | eigene Analyse |
| `it.fails` / `it.skip` / `test.todo` | **0** | `grep` |
| Stille `return`-Skips (committet) | **1** (`pagination.e2e.spec.ts:113`) | `git diff` |
| Stille `return`-Skips (Working Tree) | **0** — ersetzt durch `throw` | `git diff` |
| **Bestanden** | **158** | eigener Lauf |
| **Fehlgeschlagen** | **1** (`pagination.e2e`) | eigener Lauf |
| **Übersprungen** | **10** (ganze `pdf.e2e`-Suite) | eigener Lauf |
| `tsc --noEmit` / `tsc -p tsconfig.test.json` / `eslint --max-warnings 0` | exit 0 / 0 / 0 | eigener Lauf |
| Laufzeit | 147 s | eigener Lauf |

### Bewertung

**Stärken.** Die Testintegrität ist im Kern besser als der Ruf der Historie vermuten lässt: **alle 169 Blöcke enthalten eine echte Assertion**, es gibt keine `it.fails`, keine leeren Bodies. `globalSetup` wird nachweislich ausgeführt und setzt die DB wirklich zurück — das beseitigt die dokumentierte Nicht-Idempotenz. `unplugin-swc` statt esbuild ist die **richtige** Begründung (`emitDecoratorMetadata` fehlt bei esbuild) und erklärt die DI-Defekte der früheren Runden korrekt. Die CRL-Unit-Tests decken die negativen Fälle ab.

**Schwächen, die die Zahl entwertet.**

1. **Die Suite ist nicht standalone.** 12 von 13 e2e-Specs brauchen einen extern gestarteten Server auf :3000. `npm test` ist damit keine Reproduktion der behaupteten Zahl, sondern ein Handshake mit `run-local.sh`.
2. **10 der 169 Tests prüfen nichts** — sie laufen nie, weil `beforeAll` am falschen Health-Pfad scheitert. Betroffen ist genau die WORM-/Mandantentrennungs-Strecke, also der sicherheitskritischste Teil.
3. **Die geänderte `pagination.dto.ts` ist ungetestet.** Der zugehörige Test schlägt deterministisch fehl (5 statt 6 Bilanzen) — nicht flakyg, sondern **immer** rot. `CursorCodec` und `BoundedIntPipe` haben damit keinen bestandenen Test.
4. **Test und laufende Instanz teilen die DB.** Die Specs schreiben in die produktiv laufende Datenbank (beobachtet: `geschaeftsjahr: 2099` im laufenden Backend). Ein Testlauf „setzt" die Anwendungsumgebung zurück, auf der danach gearbeitet wird.
5. **Die 10 Skips sind nicht als Skips ausgewiesen**, sondern als `10 skipped` in der Zusammenfassung — auf den ersten Blick nicht von einem grünen `158 passed` zu unterscheiden. Genau diese Form von Grünlich ist in der Historie schon einmal als Fortschritt durchgegangen.
6. **`fileParallelism: false` kaschiert Kollisionen, statt sie zu lösen.** Die Specs räumen gegenseitig auf (`auth.e2e` leert `user_session`) — ein Hinweis, dass die Testdaten voneinander abhängen. Reihenfolgeabhängigkeit bleibt damit bestehen.

**Zur Historie:** Die drei genannten Fehlermuster sind **nicht** erneut aufgetreten. Kein `.d.ts` fehlend (Importauflösung geprüft), kein `emitDecoratorMetadata`-Problem (swc, mit korrekter Begründung), und `forge.pki.crlFromPem` wird nicht mehr verwendet (eigener Parser, der mit echten CRLs nachweislich funktioniert). Die Signaturprüfung ist der überzeugendste Teil des Diffs.

**Aber:** „Grün" wurde nie erreicht. 158/169 mit 10 Totalausfällen und einem harten Fehler ist keine Veröffentlichungsreife — und die zwei im Umlauf befindlichen Zahlen (137 und 169) sind beide falsch.

---

## 6. Empfohlene Reihenfolge

1. **K-1** IPv6-Normalisierung im SSRF-Guard + Negativtests für die sechs Bypass-URLs *(blockierend)*
2. **H-4** `/api/health` → `/health` *(ein Zeichen, zehn Tests zurück)*
3. **H-5** Fixtures für ≥6 Bilanzen im Spec *(macht `pagination.dto.ts` überhaupt testbar)*
4. **H-1/H-2** CRL fail-closed erzwingen + echtes Issuer-Zertifikat aus der PKCS#7-Kette
5. **H-3** `SIGNATURE_REQUIRE_REVOCATION_CHECK` in `.env.example`, Default bewusst setzen
6. **H-6** Server in `globalSetup` starten, damit `npm test` ein Befehl ist
7. M-1 … M-8, danach N-1 … N-4
