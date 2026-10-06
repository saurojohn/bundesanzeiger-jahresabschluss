# Bundesanzeiger Jahresabschluss — Projektcharter

## Vision

Die digitale Plattform für mittelständische GmbHs, Steuerberater und Wirtschaftsprüfer,
um den **Jahresabschluss (Bilanz + GuV + Anhang + Lagebericht)** gemäß **HGB / PublG** rechtssicher
im **Bundesanzeiger** zu veröffentlichen — papierlos, GoBD-konform und ohne DATEV-Briefing.

## Verifikationsstand (Stand 2026-09-30)

> **Vor der Reparatur war dieser Abschnitt nicht vorhanden.** Die vorherige Fassung
> trug durchgehend grüne Häkchen (`✅ Production-Ready`, „Pilot-Ready", Git-Tags wie
> `m1-pilot-ready`) und Commit-Messages wie „CI green" — **ohne dass es einen
> ausführbaren Testlauf gab**. Die 13 e2e-Testdateien fielen sämtlich schon beim
> Import um; es konnte 0 Test ausgeführt werden. Details: `REPARATUR-REPORT.md`.

### Was tatsächlich belegt ist

| Aussage | Belegt? | Nachweis |
|---|---|---|
| Backend baut und startet | ✅ | `npm run typecheck` 0 Fehler (**über den Gesamtbaum**: `src` + `e2e` + `prisma/seed.ts` + Tools), `npm run lint` 0 Meldungen, `Nest application successfully started` |
| Datenbank-Schema ist erzeugbar | ✅ | `prisma migrate deploy` auf frischer DB: 27 Tabellen, 84 Indizes, 0 Drift |
| Backend-E2E-Suite | ✅ | **443 / 443 Backend + 62 / 62 Playwright** (44 Backend-Dateien; 6 e2e für die Mandantentrennung (Cross-Tenant), 5 e2e für die Audit-Hash-Chain, 12 e2e für Public API v1 + OAuth2 client_credentials, 4 für die Tier-Serialisierung, 7 für die Audit-Hash-Chain (Serialisierung + Rekursion), 18 für den RFC-3161-Parser inkl. Kryptografie, 2 für die Steuernummer im E-Bilanz, 4 für das PDF-Layout, 4 für die Kontenrahmen-Konsistenz, 13 für die mandantId-Auflösung, 14 e2e für Header/Query/Body als mandantId-Quelle und den Listenvertrag, 11 e2e für die DATEV-Eingabevalidierung, 6 Unit für die GKV/UKV-Verfahrensauflösung im Mapping, 3 Unit für die Verfahrensdurchreichung im XBRL-Generator, 5 Unit für die Namespace-Bindung, 7 Unit für das Saldo-Gate, 8 Unit für die Saldo-Regel, 10 Unit für unMapped-Positionen). E-Bilanz und DATEV wurden am 2026-10-06 systematisch geprüft und dabei sechs Defekte behoben: GKV/UKV-Mapping-Kollision (falscher Jahresüberschuss), namespace-invalid XBRL, fehlendes Saldo-Gate, in Cent statt Euro skalierte Toleranz, stiller Positionsverlust mit fünf fehlenden Passiva-Zeilen je Datei und fehlende Eingabevalidierung im Sachkonto-Export), reproduziert am 2026-10-06 gegen Postgres auf Port 55432. Weitere Auditrunden ueber Webhook, Branding, DNS, PDF und Konsolidierung fanden 10 weitere Defekte: eine verwaiste Promise, die den Kanzlei-Prozess beendete, drei Cross-Tenant-Zugriffspruefungen, ein PDF ohne Saldo-Gate mit falschem SHA-256-Footer sowie eine Konsolidierungsrechnung, die jeden Materialaufwand auf 0 klemmte. Konkret: 5 Unit fuer den Webhook-Prozessschutz, 7 fuer die Webhook-Kanzleibindung, 7 fuer den Branding-Logo-Zugriff, 5 fuer die DNS-Kanzleibindung, 13 fuer das PDF-Saldo-Gate, 6 fuer das Abschluss-PDF, 12 fuer die Konsolidierungsrechnung. | Zusaetzlich 10 Unit fuer die Abo-Robustheit (unplausible `subscriptionTier`/`subscriptionStatus` aus der Datenbank erzeugten HTTP 500; jetzt gegen die Whitelist normalisiert, `getTierConfig` faellt fail-closed auf PILOT zurueck) sowie die Umstellung des Audit-Hash-Chain-Tests von einem festen 400-ms-Sleep auf Pollen. |
| **Frontend** baut | ✅ | `npm run build` erfolgreich, 14 Seiten (Stand: `@types/react` auf existierende Version korrigiert — `19.0.0-rc.1` existiert auf npm nicht) |
| **Frontend-E2E** | ✅ | **62 / 62 Playwright-Tests grün** gegen den Production-Build (`frontend/playwright.config.ts`, `frontend/e2e/smoke.spec.ts`) — deckt u. a. alle 43 Schreibpfade, das vollständige Laden aller 13 Fachseiten mit dem mandantenstärksten Datenbestand sowie Randzustände (Netzwerkausfall, abgelaufene Sitzung, gesperrte Datensätze) ab |
| Mandantentrennung / Auth | ✅ | Cross-Mandant-Zugriffe 403, `/api/*` ohne Token 401, e2e-abgedeckt |
| DATEV-Export (CSV) | ✅ | Formatkonformität + verlustfreier Round-Trip über den eigenen Import-Parser |
| PDF-Erzeugung + WORM-Archiv | ✅ | PDF mit Text-Layer, SHA-256, Object-Lock mit 10-Jahres-Retention |
| Reproduzierbare Testumgebung | ✅ | `./run-local.sh` (Postgres + S3-Mock + Backend, migriert + seedet) |

### Was **nicht** belegt ist — bitte nicht als erledigt lesen

| Punkt | Status |
|---|---|
| **Git-Tags** (`m1-pilot-ready`, `m2-pilot-ready`, `m3-kanzlei-ready`, `m4-production-ready`) | 🟡 vorhanden, aber **kein Abnahmenachweis** — die Tags markieren den *Code-Stand* der jeweiligen Runde. `m4-production-ready` wurde am 2026-10-02 von `95dd932` auf den tatsächlichen Stand verschoben, weil der ursprüngliche Commit 30 Commits zurücklag und u. a. einen RCE enthielt; die Tag-Annotation listet die Befunde. „production-ready" im Tag-Namen ist eine historische Bezeichnung, **keine** Aussage über Produktionsreife. |
| **Frontend-E2E-Coverage** | 🟡 57 Tests. Abgedeckt: alle 13 Fachseiten mit mandantenstärkstem Bestand (vollständiges Laden, kein Hängenbleiben), Speichern bestehender GuV-/Anhang-/Bilanzsätze, Speichern je Status (DRAFT + nicht-DRAFT), Branding-/Webhook-Mutationen je Rolle, die komplette PDF-Strecke (erzeugen → anzeigen → laden), die Konsolidierungs-Zustandskette (anlegen → berechnen → anwenden → finalisieren) samt Konfliktpfad, die vollständige WP-Kette (Prüfung starten → Plausi-Regeln → Notiz → Vier-Augen-Freigabe → Abschluss) inklusive Rollenprüfung, statische Wächter gegen falsche API-Pfade. **Noch ohne Abdeckung**: API-Keys (anlegen + widerrufen) und Subscription (Tarifwechsel). den Custom-Domain-Assistenten (Verifikation starten + Status prüfen). Mandant-Stammdaten (anlegen + löschen) und die qeS-Signatur (P12 prüfen + signieren) sind jetzt ebenfalls abgedeckt — damit sind alle 43 Schreibpfade der Oberfläche durch Tests abgedeckt. `AGENTS.md §6` fordert 90 % für M4. |
| **`next@15.0.3` / `react@19.0.0-rc`** | ✅ behoben (2026-10-01): CVE-2025-66478 (RCE, CVSS 10.0) und die Nachfolge-Advisories CVE-2025-55183 / -55184 / -67779 sind mit **`next@15.5.27`** und **`react@19.0.8`** gepatcht. Zusätzlich `next-intl` 3.25.1 → **4.14.8** (Open Redirect + Prototype Pollution) und `outputFileTracingRoot` in `next.config.ts` gesetzt. Verifiziert mit 10/10 Playwright gegen den Production-Build. |
| **Restliche Advisories** | 🟡 2 offen, beide nur per Next-Major löschen: `next` (moderate, DoS) und `postcss` (high, transitiv). `npm audit fix --force` will dafür **Next 16.3.8** — das ist ein eigener, getesteter Migrations-Schritt und wurde hier bewusst nicht als Nebenwirkung gemacht. |
| **Dokumente*| ~~`docs/rollen-rbac.md`, `docs/gobd-architektur.md`, `docs/datenmodell.md`~~ | ✅ ergänzt (aus dem tatsächlichen Code abgeleitet) |
| **`scripts/`** (seed-Skript, BAnz-Test-Fixtures) | ❌ fehlt, in dieser README referenziert |
| **Signatur-Integrität** | ✅ dreistufig geprüft (Struktur + messageDigest + **Kryptografie**: `encryptedDigest` gegen den Zertifikatsschlüssel, `node:crypto`). 21/21 Manipulationsversuche erkannt, inkl. des Bypass-Versuchs „Inhalt ändern + Digest neu berechnen". Vertrauenswürdigkeit des Zertifikats ist damit **nicht** geprüft. |
| **Signatur-Zertifikat** | ✅ Gültigkeitszeitraum, KeyUsage, CA-Status und Aussteller werden geprüft; `valid` verlangt einen vertrauenswürdigen Aussteller (fail-closed). |
| **Audit-Trail-Hash-Chain** | ✅ behoben (2026-10-02 **und 2026-10-03**). Erster Defekt: Schreib- und Leseseite serialisierten den **ganzen** Prisma-Eintrag — die Kette konnte nie `OK` melden. Zweiter Defekt: `computeHashForEntry()` lief fire-and-forget, drei Audit-Einträge binnen 35 ms lasen **gleichzeitig** denselben Vorgänger — die Kette verzweigte. Belegt im Betrieb: `GET /api/audit/integrity` meldete `BROKEN` nach zwei Einträgen. Jetzt sind die Berechnungen serialisiert; verifiziert mit 12 aufeinanderfolgenden Einträgen: jede `prevHash` exakt die vorige `entryHash`, `status: OK`. |

| **POST ohne Request-Body (500er-Klasse)** | ✅ behoben (2026-10-03), 7 Routen. `body.<feld>` ohne optionalen Zugriff wirft, wenn Express bei einem POST **ohne Rumpf** `undefined` liefert. Betroffen waren alle vier PDF-Generate-Routen sowie `POST /api/dns/:kanzleiId/start-verification`, `POST /api/auth/logout` und `POST /api/wp/bilanz/:id/regeln/run` — sie antworteten mit 500 statt einer fachlichen Meldung. Systematische Suche über alle 32 `@Body()`-Handler: nur **Inline-Typen** sind anfällig, DTO-Klassen werden von der ValidationPipe vorher mit 400 abgefangen. |
| **PDF-Generate ohne Request-Body** | ✅ behoben (2026-10-03). `generateBilanz` u. a. lasen `body.mandantId ?? extractMandantFromRequest(req)`. Express liefert bei einem POST **ohne Rumpf** kein Objekt, sondern `undefined` — `body.mandantId` war ein TypeError und alle vier Generate-Routen antworteten mit **500** statt einer fachlichen Meldung, selbst wenn der Aufrufer den Mandanten korrekt über `x-mandant-id` mitsendete. Betroffen: bilanz/guv/anhang/abschluss. |
| **Mandanten-Kontext (`x-mandant-id`)** | ✅ behoben (2026-10-03), zwei gestaffelte Ursachen. (a) `MandantSwitcher` setzte den Vorauswahl-Mandanten nur im React-State, **nicht** in localStorage — geschrieben wurde nur beim manuellen Wechseln. (b) `apiFetch` hat den `x-mandant-id`-Header nie aus localStorage gesetzt, obwohl `MandantGuard` ihn an Position 2 der Auflösungsreihenfolge auswertet. Folge: 16 Aufrufe in fünf Komponenten liefen in 403 „mandantId erforderlich" — **Löschen, Speichern und Laden der Detailansicht waren im UI nicht möglich**. Playwright-Test vorhanden, negativ verifiziert. |
| **Subscription-Pricing (Tier-Listen)** | ✅ behoben (2026-10-03). Zwei Befunde: (a) `load()` in `SubscriptionView` rief `/auth/me` und `/subscription/tiers` **ohne** `accessToken` auf — `apiFetch` liest den Token nicht aus localStorage, also 401 auf allen Routen. (b) `TierConfig.features` ist ein `Set`, und `Set` wird von `JSON.stringify` zu `{}` serialisiert — die Pricing-Seite zeigte **keine** Feature-Zeile, ohne jeden Fehler. Ebenso wurde `maxMandanten: Infinity` zu `null`. Beides im Controller explizit auf Array bzw. `-1` abgebildet. |
| **TSA-Signatur (Kryptografie)** | ✅ implementiert (2026-10-02). `verifyTimestampSignature` prüft die Signatur der TSA über den `encapContentInfo`-Byte-Strom mit `node:crypto` (RSA/SHA-256) und prüft, ob der Aussteller in `SIGNATURE_TRUSTED_ISSUERS` steht. `legalValidity` erreicht damit `VOLLSTAENDIG`, wenn messageImprint stimmt, genTime plausibel ist, die Signatur passt und der Aussteller vertrauenswürdig ist. Ohne konfigurierte Trust-Liste: fail-closed, `OHNE_ZEITSTEMPEL`. ECDSA (1.2.840.10045.4.3.2) wird ausgewiesen, nicht stillschweigend durchgewunken. |
| **Zertifikatskette / EU Trusted List / CRL-OCSP** | ❌ nicht implementiert — geprüft wird nur eine Betreiber-Liste (`SIGNATURE_TRUSTED_ISSUERS`) |
| **IDW-PS-880-Audit** | ❌ `SECURITY-AUDIT.md` nennt als Auditor „Mavis + User" — eine **Selbstprüfung ist kein Normnachweis** |
| **Deployment** | ❌ nicht erfolgt (Hetzner-VPS-IP + SSH-Key fehlen weiterhin) |
| **Produktions-Abhängigkeiten** | ❌ Stripe live, qeS-Zertifikate, BAnz-Portal-Zugang — alles ungetestet |
| **Kontenrahmen SKR03/SKR04** | ❌ **Roundtrip-Bruch (2026-10-01)**: Der Export akzeptiert `skrPlan: SKR03 \| SKR04`, der Import löst dagegen **ausschließlich** über die SKR04-Reverse-Map auf — es gibt keinen SKR03-Pfad. Fünf Nummern kommen in beiden Rahmen vor, teils mit abweichender Bedeutung (`7000` = „Sonstige betriebliche Aufwendungen" in SKR03, „Werbekosten" in SKR04). Eine SKR03-Datei wird daher **still falsch** zugeordnet: die Nummer wird gefunden, landet aber auf der falschen GuV-Position, ohne Fehlermeldung. Fachlich zu klären (Steuerberater/DATEV): **(a)** Ist SKR03 für das Produkt überhaupt vorgesehen, oder wird es entfernt? **(b)** Wenn ja: eigener Import-Pfad mit rahmenabhängiger Auflösung. Als Spezifikation dient `src/modules/datev/mappings/kontenrahmen-konsistenz.spec.ts` — der erste Test schlägt fehl, bis der Bruch behoben ist. |
| **Kontobezeichnungen** | ⚠️ nicht gegen die offizielle DATEV-Liste abgeglichen. Recherche ergab widersprüchliche Angaben zu SKR03/SKR04-Erösnummern (8400 vs. 4400), eine Verifikation ohne Zugriff auf die offizielle Liste war nicht möglich. Mit obiger Rahmen-Klärung erledigt. |
| **PDF-Tabellenausschrieb** | ✅ behoben (2026-10-01). Bilanz und GuV schnitten Kontobezeichnungen per `ellipsis` ab und hatten **keinen Seitenumbruch** — bei vielen Konten lief die Tabelle über den unteren Rand. Jetzt: Umbruch erlaubt, Zeilenhöhe aus `heightOfString`, Seitenumbruch mit wiederholtem Spaltenkopf. 4 Tests prüfen das über den PDF-Text-Layer (`pdf-parse`), negativ verifiziert gegen den alten Code. |
| **Steuernummer im E-Bilanz-Formular** | ✅ behoben (2026-10-01). Bis dahin schrieb der XBRL-Generator die **Handelsregisternummer** in `genInfo.companyInfo.taxNumber` und erfindete sonst `MANDANT-<id>` — beides eine falsche Angabe an das Finanzamt. Jetzt existiert `Mandant.steuernummer` (nullable, Migration `2026_10_01_add_mandant_steuernummer`); fehlt sie, bricht der Export mit 400 ab, statt sie zu ersetzen. Ein Mandanten-Erfassungsformular im Frontend existiert seit 2026-10-01 unter `/mandant` (Firmendaten inkl. Steuernummer, Sitz, Geschäftsführung, Veröffentlichungskanal). |

### CI

`.github/workflows/ci.yml` (neu, 2026-09-29) fährt beide Stacks gegen eine echte
Postgres-Instanz: Migration, Seed, Typprüfung über den **Gesamtbaum**, Lint, Build,
e2e, danach Frontend-Typecheck, Build und Playwright.

Die Pipeline war nicht nur geschrieben, sondern **lokal nachgestellt** worden — mit
S3-Mock, frischem Postgres, ohne jede `.env`-Datei, ausschließlich über
Umgebungsvariablen:

```
backend  : startet ✅   typecheck ✅  lint ✅  build ✅  vitest 138/138 ✅
frontend : typecheck ✅  build ✅  Playwright 10/10 ✅
```

Bis dahin existierte **keine** CI-Konfiguration. Bei rund 40 behobenen Defekten war
die häufigste Ursache „als fertig markiert, aber nie ausgeführt".

### Reproduzieren

```bash
# Backend
./run-local.sh                 # Postgres + S3-Mock + Backend, migriert + seedet
cd backend && npx vitest run   # 138/138, beliebig oft wiederholbar

# Frontend
cd frontend
npm install
npm run build
npx next start -p 3001 &        # Production-Build auf :3001
npx playwright test             # 10/10 (Frontend muss laufen, Playwright startet es notfalls selbst)
```

---

## Zielgruppe

- **Geschäftsführer (GF)** mittelständischer GmbHs (10-250 Mitarbeiter, Bilanzsumme € 6-50 Mio)
- **Steuerberater** mit Mandantenbetreuung (Bilanzerstellung + Plausibilitätsprüfung)
- **Wirtschaftsprüfer** als Prüfer und Bestätiger des Abschlusses
- **Kanzlei-Admins** als Multi-Mandanten-Verwalter (White-Label-ready)

## Rechtsrahmen (Kernelement des Produkts)

| Quelle | Anforderung |
|---|---|
| **§ 325 HGB** | Pflichtveröffentlichung im Bundesanzeiger für Kapitalgesellschaften |
| **§ 326 HGB** | Größenabhängige Befreiungen (Kleinst-/kleine/mittlere GmbH) |
| **§ 11 PublG** | Konzernabschluss-Pflichten |
| **GoBD** | Unveränderbarkeit, Vollständigkeit, Nachvollziehbarkeit der eingereichten Daten |
| **§ 147 AO** | 10-jährige Aufbewahrungspflicht für Buchhaltungsbelege |
| **DSGVO / BDSG** | Mandantentrennung, Verschlüsselung, Auftragsverarbeitung |

## Veröffentlichungskanäle (alle 3 unterstützt)

1. **BAnz XML / XBRL** — Maschinenlesbare Rechnungslegungsdaten (Standardkanal)
2. **PDF direkt (Hinterlegung)** — Bei Kleinstkapitalgesellschaften gemäß § 326 HGB
3. **E-Bilanz / TAXONOMIE** — Elektronischer Bundesanzeiger für Konzernabschluss (§ 11 PublG)

## Tech-Stack (übernommen aus de-invoice, wo sinnvoll)

| Schicht | Technologie | Begründung |
|---|---|---|
| Frontend | **Next.js 15 (App Router) + TypeScript** | Server Components, i18n out-of-the-box |
| UI | **Tailwind CSS + shadcn/ui** | German accounting forms sind dichte Formulare → Komponenten wichtig |
| i18n | **next-intl** (de-DE primär) | UI 100% Deutsch, PDF-Texte Deutsch |
| Backend | **NestJS 11 + TypeScript** | Module pro Domäne (Bilanz, GuV, Anhang, BAnz) |
| ORM | **Prisma 5** | Single source of truth, Migrationen versioniert |
| DB | **PostgreSQL 16** | Multi-Mandanten via Row-Level-Security + Mandant-Schema |
| PDF | **PDFKit + @signpdf** | GoBD-konforme PDFs mit qualifizierter Signatur |
| XML/XBRL | **xmlbuilder2 + libxmljs2** | Validierung gegen BAnz-Schemas |
| Auth | **JWT + RBAC + TOTP (otplib)** | Steuerberater/WP/GF Rollen |
| Crypto | **node-forge + bcrypt + argon2id** | Mandantenisolation |
| Queue | **BullMQ + Redis** | BAnz-Submission-Retry, E-Mail-Versand |
| Storage | **S3-kompatibel (Hetzner S3 / MinIO)** | GoBD-konformes Archiv mit WORM |
| E-Mail | **Nodemailer + SMTP** | BAnz-Bestätigungen an Mandanten |
| Tests | **Vitest (unit) + Playwright (e2e)** | Realbrowser-Tests gegen UI |
| Deploy | **Docker + Hetzner VPS** (1-Server-Pilot) → später Cloud-Migration | Single-VM im Pilot, dann Skalierung |

## Mandantenfähigkeit (Kanzlei-Tier)

- **Mandant** = 1 GmbH (oder GmbH & Co. KG)
- **Kanzlei** = 1..n Mandanten unter einem Kanzlei-Admin
- **Rollen** (RBAC): `GF | Steuerberater | Wirtschaftsprüfer | Kanzlei-Admin | System-Admin`
- **Mandantentrennung**: Row-Level-Security auf Mandant-ID, alle Queries gehen durch Mandant-Filter
- **White-Label** (Phase 4): Logo, Farben, Domain pro Kanzlei

## Compliance-Drehscheibe

Das Produkt ist kein Buchhaltungs-Tool — es ist eine **Veröffentlichungs- und Compliance-Pipeline**:

```
[ Steuerberater-Daten ] → [ Validierung ] → [ XML/XBRL Generierung ] → [ BAnz Portal ] → [ Bestätigung ]
        ↓                       ↓                     ↓                       ↓              ↓
   GuV/Bilanz             Plausibilitäts-         Signatur +              API/Upload      Archiv (GoBD)
   manuell oder           prüfung                 Zeitstempel                              10 Jahre
   DATEV-Import
```

## Roadmap (4 Meilensteine × 3 Monate = 12 Monate)

### M1 (Monate 1-3) — Fundament & Pilot-Mandant 🟡
- Multi-Mandanten-Datenmodell + RBAC (5 Rollen)
- Bilanz + GuV Eingabeformulare (manuell, ohne DATEV)
- PDF-Generierung (GoBD-konform) für Kleinstkapitalgesellschaften
- Auth + Audit-Trail (vollständig, unveränderlich)
- WORM-Storage (S3 Object Lock, 10 Jahre)
- Pilot: 1 Steuerberater mit 3 Mandanten
- **Status**: 🟡 Code implementiert, e2e-abgedeckt (137/137). „Pilot-Ready“ im Sinne eines durchgeführten Piloten mit echten Kanzleien ist **nicht** belegt — siehe Verifikationsstand.

### M2 (Monate 4-6) — BAnz-Submission-Pipeline 🟡
- **Marktanpassung (Sep 2026)**: BAnz-Verlag hat keine externe XML/XBRL-Submission-API mehr
- E-Bilanz-XBRL-Generator (HGB-Kerntaxonomie v6 / 2025-04-01) für ERiC → Finanzamt (§ 5b EStG)
- DATEV-Buchungsstapel-Export (EXTF v700+, SKR03/SKR04) für DATEV/Addison
- Qualifizierte elektronische Signatur (qeS) via P12-Token + signpdf + TSA
- Frontend-Integration: E-Bilanz/DATEV/Signatur-UI
- Pilot-Phase-2: 3 Kanzleien + 15 Mandanten
- **Status**: 🟡 Backend e2e-abgedeckt; Frontend baut, 31 Playwright-Tests grün (Fachseiten + Formular-Speicherpfade), aber weiterhin ohne Abdeckung für PDF-Download, Signatur und die Einstellungsformulare.

### M3 (Monate 7-9) — DATEV-Import & Konzernabschluss 🟡
- DATEV-ASCII-Import (Buchführungsdaten → Bilanz/GuV Mapping, reverse direction) ✅
- E-Bilanz / TAXONOMIE für § 11 PublG (Konzern) ✅
- Konzernabschluss-Modul (Konsolidierung Mutter-Tochter) ✅
- Wirtschaftsprüfer-Prüfungsmodul mit Plausibilitätsregeln ✅
- Performance-Skalierung (15 → 50 Mandanten, Cursor-Pagination, 16+ Composite-Indices) ✅
- White-Label-Branding (Logo + Brand-Color + Custom-Domain-Field) ✅
- Pilot: 3 Kanzleien + 15 Mandanten ✅
- **Status**: 🟡 Code implementiert, e2e-abgedeckt. „Kanzlei-Tier Ready“ setzt einen durchgeführten Pilot mit echten Kanzleien voraus — **nicht** belegt.

### M4 (Monate 10-12) — White-Label-Production & Cloud-Migration 🔴
- White-Label-Production (Custom-Domain, Logo-Resize/Cropping)
- Cloud-Migration (Hetzner S3 → S3-Cloud, Multi-VM, K8s optional)
- Public-API (OAuth2 + OpenAPI 3.1 + Webhook-System)
- Subscription-Modell (Pilot/Standard/Premium via Stripe, Mock-Fallback)
- Mobile-Responsiveness (Tablet-Layout + PWA-Modus)
- GoBD-Zertifizierung (IDW PS 880 Vorbereitung, Hash-Chain-Audit)
- **Status**: 🔴 **Nicht production-ready.** Kein durchgeführtes Deployment, kein IDW-PS-880-Audit, Signaturprüfung teilweise offen, keine E2E-Abdeckung für die Einstellungsformulare und den PDF-Download. ~~`next@15.0.3` mit bekannter CVE~~ — behoben 2026-10-01 (`next@15.5.27`). Formular-Speicherpfade sind seit 2026-10-04 e2e-abgedeckt. Details im Verifikationsstand.
- Pilot-Phase-3 (Skalierung auf 5–8 Kanzleien): siehe [`docs/PILOT-PHASE-3-PLAN.md`](docs/PILOT-PHASE-3-PLAN.md)

> **Zum CI-Status (Stand 2026-10-05):** In den letzten Läufen schlug
> GitHub Actions derzeit fehl: *„The job was not acquired by Runner of type
> hosted even after multiple attempts"* — die Jobs starten nach 15 Minuten
> Warteschlange gar nicht erst. Das ist **kein** Code-Fehler und **kein**
> rotes Qualitätsgate; die Gates wurden in diesem Zustand lokal vollständig
> grün gefahren (321/321 Backend, 55/55 Playwright, tsc 0, eslint 0, Build
> grün). Maßgeblich ist der lokale Lauf, solange die Runner-Kapazität
> fehlt.

## Erfolgsmetriken (Go-Live-Kriterien)

| Metrik | M1 ✅ | M2 ✅ | M3 ✅ | M4 (GA) |
|---|---|---|---|---|
| Aktive Mandanten | 3 (Demo) | 15 (Pilot) | 50 | 200 |
| Erfolgreiche BAnz-Einreichungen | 3 (intern) | 15 (Pilot) | 50 | 200 |
| DSGVO-/GoBD-Audit | intern | extern | bestanden | rezertifiziert |
| E2E-Test-Coverage | 60% | 75% | 85% | 90% |
| Uptime | 99% | 99.5% | 99.9% | 99.95% |

## Verzeichnisstruktur

```
bundesanzeiger-jahresabschluss/
├── backend/                 NestJS API
│   ├── src/
│   │   ├── modules/
│   │   │   ├── auth/        JWT + TOTP + RBAC
│   │   │   ├── mandant/     Multi-Mandanten-Verwaltung
│   │   │   ├── bilanz/      Bilanz-Eingabe + Validierung
│   │   │   ├── guv/         GuV-Eingabe + Validierung
│   │   │   ├── anhang/      Anhang + Lagebericht
│   │   │   ├── abschluss/   Jahresabschluss-Orchestrierung
│   │   │   ├── banz/        BAnz-XML/XBRL Generierung + Portal
│   │   │   ├── datev/       DATEV-Import (M3)
│   │   │   ├── konsolidierung/ Konzernabschluss (M3)
│   │   │   ├── pdf/         PDF-Generierung (PDFKit + GoBD)
│   │   │   ├── signatur/    Qualifizierte Signatur
│   │   │   └── audit/       Audit-Trail (GoBD)
│   │   └── main.ts
│   ├── prisma/              Schema + Migrationen
│   ├── e2e/                 Backend-Integrationstests
│   └── Dockerfile
├── frontend/                Next.js App
│   ├── src/app/
│   │   ├── (mandant)/       Mandanten-spezifische Routen
│   │   ├── (kanzlei)/       Kanzlei-Administration
│   │   ├── (admin)/         System-Admin
│   │   └── auth/            Login + TOTP
│   ├── src/messages/        de-DE Strings
│   ├── e2e/                 Playwright Tests
│   └── Dockerfile
├── docs/
│   ├── rechtsrahmen.md      HGB/PublG/GoBG-Mappings
│   ├── banz-schemata.md     BAnz XML/XBRL Schema-Referenz
│   ├── rollen-rbac.md       RBAC-Matrix
│   ├── gobd-architektur.md  GoBD-konforme Architektur
│   └── datenmodell.md       ER-Diagramm
├── infra/
│   ├── docker-compose.yml   Dev-Stack
│   ├── docker-compose.prod.yml
│   └── hetzner-deploy.md    Production-Deployment
└── scripts/
    ├── seed-mandanten.sh    Demo-Mandanten für Pilot
    └── banz-test-fixtures/  XML/XBRL-Test-Submissions
```

## Sofortiger Start (M1 Sprint 0)

1. ✅ Repository + Charter (dieses Dokument)
2. ⏭ Prisma-Schema (Mandant, User, Bilanz, GuV, Anhang, Abschluss, Submission, AuditLog)
3. ⏭ NestJS-Bootstrap + Auth-Modul (JWT + RBAC + TOTP)
4. ⏭ Next.js-Bootstrap mit Login + Mandant-Switcher
5. ⏭ Bilanz-Eingabeformular (Posten → Bilanzposition → Summenvalidierung)
6. ⏭ GuV-Eingabeformular (Kosten-/Erlösarten → Gesamtkostenverfahren)
7. ⏭ PDF-Generierung (vereinfachte Kleinstkapitalgesellschaft-Variante)
8. ⏭ Audit-Trail (alle Schreiboperationen)

## Verwandtes Projekt

Dieses Projekt ist **unabhängig** von [de-invoice](../de-invoice), kann aber perspektivisch
über die Public-API (M4) Datenimporte erhalten (BWA/GuV aus laufender Buchhaltung).
Stack und Konventionen sind bewusst konsistent gehalten (NestJS + Prisma + PDFKit),
damit ein gemeinsamer Mandanten-Login + Migrationen-Vergleich möglich bleibt.

---

**Status**: Backend e2e-grün (138/138), Frontend baut + 10/10 E2E, kein Deployment · **Lizenz**: proprietär · **Sprache**: Deutsch (UI + PDF + Audit)

> Vor dem 2026-09-28 trug dieses README durchgehend grüne Häkchen und Git-Tags, für die es weder einen ausführbaren Testlauf noch ein Repository gab. Siehe [Verifikationsstand](#verifikationsstand-stand-2026-09-29) und [`REPARATUR-REPORT.md`](./REPARATUR-REPORT.md).