# Plan: Jahresabschluss-Modul (`abschluss/`)

> **Stand 2026-10-17.** Entstanden aus Nachtrag 27 des GoBD-Audit-Reports.
> Dieser Plan ist **Vorschlag**, nicht Freigabe. Die vier offenen
> Entscheidungen aus dem Audit stehen am Ende und sind Voraussetzung für
> Schritt 3 und 4.

---

## 1. Befund, aus dem das Modul folgt

Gemessen, vierfach abgesichert (Details in Nachtrag 27):

| Prüfung | Ergebnis |
|---|---|
| Schreibzugriffe auf `jahresabschluss` (create/update/upsert/delete) | keine |
| Controller-Routen mit `jahresabschluss` im Pfad | keine |
| `GET /api/jahresabschluss` | 404 |
| Datensätze nach `prisma db seed` | 0 |

Bilanz, GuV und Anhang sind einzeln vollständig: anlegen, bearbeiten,
abschließen, signieren. **Das Aggregat, um das § 314 HGB geht, kann die
Anwendung nicht erzeugen.** Damit sind `sign-abschluss`,
`abschluss/:id/generate` und die BAnz-Einreichung unerreichbar.

Der Plan baut **keinen** neuen Bestandteil, sondern die Orchestrierung der
bereits vorhandenen.

---

## 2. Was bereits da ist (nicht neu bauen)

| Baustein | Ort | Zustand |
|---|---|---|
| Datenmodell | `prisma/schema.prisma` → `model Jahresabschluss` | vollständig: `bilanzId`, `guvId`, `anhangId` **NOT NULL**, `lageberichtId?`, Status, vier Zeitstempel, `banzBestellnummer?`, **`@@unique([mandantId, geschaeftsjahr])`** |
| Bilanz-Balance | `common/utils/saldo.ts` → `saldoStimmt()` | ✅ Unit-getestet |
| GuV-Ergebnis | `guv.service.ts` → `validierung.jahresergebnis` | ✅ |
| Anhang-Platzhalter | `anhang.service.ts` → `offenePlatzhalter()` | ✅ Nachtrag 26 |
| Archiv-Sperre | `common/utils/mandant-archivierung.ts` | ✅ Nachtrag 15 |
| Monotone Bearbeitungsstatus | `common/utils/status-transition.ts` | ✅ |
| qeS-Signatur Abschluss | `signatur.service.ts` → `signAbschluss()` | ✅ vorhanden, **ohne Aufrufer** |
| Abschluss-PDF | `pdf.controller.ts` → `abschluss/:id/generate` | ✅ vorhanden, **ohne Aufrufer** |
| Audit + WORM | `audit.service.ts`, `worm-object.repository.ts` | ✅ |

**Der Aufwand ist Orchestrierung, nicht Fundament.** Das ist der Grund,
warum der Befund so lange unbemerkt blieb: jedes Einzelteil funktioniert.

---

## 3. Schritt für Schritt

### Schritt 1 — `AbschlussService.create()` (ohne Entscheidung möglich)

Neues Modul `src/modules/abschluss/`.

```
POST /api/jahresabschluss
  Body: { mandantId, geschaeftsjahr }
  → bilanzId/guvId/anhangId der Sätze DIESES Mandanten und Jahres
  → 409, wenn einer fehlt
  → status: DRAFT
  → Audit: CREATE
```

Der Model-Zwang (`NOT NULL` auf allen drei IDs) ist bereits die
Eigenheitlichkeitssicherung: Es kann keinen unvollständigen Abschluss geben.

Der Unique-Constraint auf `(mandantId, geschaeftsjahr)` liegt bereits im
Schema — Doppelerfassung und „ein Abschluss je Mandant und Jahr" sind damit
strukturell gesichert, nicht nur im Service.

**Test:** Anlegen ohne GuV → 409. Anlegen mit allen dreien → 201, `DRAFT`.
Zweites Anlegen im selben Jahr → 409.

### Schritt 2 — `GET /api/jahresabschluss` (behebt den 404-Schlucker)

```
GET /api/jahresabschluss?mandantId=…&pageSize=…
  → Liste inkl. Status, den drei Zeitstempeln, den Signatur-Daten
```

**Pflicht dabei:** `JahresabschlussView` muss aufhören, 404 als leere Liste
zu behandeln. Nach diesem Schritt ist der 404 ein **Fehler**, kein Zustand —
und der Smoke-Test prüft danach einen Inhalt, nicht nur die Renderbarkeit.

### Schritt 3 — `finalize()` — die Vollständigkeitsprüfung

Hier wird **Entscheidung 1** gebraucht (Bilanz↔GuV-Abgleich, Nachtrag 22).

Vorschlag, zur Freigabe:

```
POST /api/jahresabschluss/:id/finalize
```

| Prüfung | Wirkung |
|---|---|
| Mandant nicht archiviert | **Sperre** (409) — entschieden 2026-10-14 |
| Bilanz `saldostimmt` | **Sperre** — eine unausgeglichene Bilanz ist keine Bilanz |
| GuV vorhanden und schlüssig | **Sperre** |
| Anhang `offenePlatzhalter` leer | **Sperre** — sonst geht „[Ort]" zum Bundesanzeiger |
| Bilanz-GuV-Saldoabgleich | **Warnung** — siehe unten |
| Status der drei Sätze | **Sperre** — nicht `DRAFT` bedeutet unfertig |

**Warum der Saldoabgleich nur eine Warnung ist:** `A.V.` (Jahresüberschuss in
der Bilanz) ist nicht zwangsläufig das GuV-Ergebnis — Kapitalerhöhungen und
Entnahmen verschieben den Saldo, ohne in der GuV zu erscheinen. Das Produkt
modelliert diese Eigenkapitalbewegungen **nicht** (gemessen: keine
Bewegungs-Entität, kein Feld). Eine harte Sperre würde berechtigte Abschlüsse
blockieren. Korrekt wäre: erst Eigenkapitalbewegungen erfassen, dann sperren.

**Statusübergang:** `DRAFT → FINALIZED`, monoton. `finalisiertAm` +
`finalizedById`. Ein Zurück auf `DRAFT` ist **nicht** erlaubt — ein
finalisierter Abschluss wird durch einen neuen ersetzt, nicht zurückgesetzt.
Dieselbe Regel, die `status-transition.ts` für die Bestandteile durchsetzt.

### Schritt 4 — `submit()` — die Freigabe zur Einreichung

**Hier wird die Einreichung an den Bundesanzeiger angeschlossen**, die
heute als 501 dasteht. Das ist die größte Einzelposition und hängt an
externen Bedingungen, die lokal nicht herstellbar sind (Portal-Zugang,
Vorgangsnummer, Gebühren). **Nicht Teil dieses Plans**, sondern der
nächste Schritt danach.

### Schritt 5 — Frontend

`JahresabschlussView` bekommt: Liste mit Status, ein „Abschluss anlegen" mit
Jahresauswahl, ein „Abschließen"-Knopf mit der Vollständigkeitsanzeige
(Prüfungen mit Ampeln), und die Signatur-Aktion, die es bereits gibt, aber
nie ein Objekt fand.

---

## 4. Reihenfolge und Abhängigkeiten

```
Schritt 1 (create)     ─┐
                        ├─→ keine offene Fachfrage
Schritt 2 (GET)         ─┘

Schritt 3 (finalize)    ──→ braucht Entscheidung 1 (Saldoabgleich: Sperre/Warnung)
Schritt 4 (submit)      ──→ externe Bedingungen, eigener Plan
Schritt 5 (Frontend)    ──→ nach 1-3
```

Schritt 1 und 2 sind **freigabefrei umsetzbar** und beseitigen sofort den
404-Schlucker im Produktcode.

---

## 5. Was dieser Plan nicht löst

| Thema | Wo |
|---|---|
| Audit-Anker am Kettenende (Nachtrag 24) | eigene Entscheidung, unabhängig |
| Refresh-Token-Rotation (Nachtrag 25) | eigene Entscheidung |
| Rollenprüfung live vs. Revoke-Blacklist | eigene Entscheidung |
| Bilanz-Signatur bleibt nach Abschluss sperrbar? (Nachtrag 13) | eigene Entscheidung |

---

## 6. Aufwand und Risiko

| Schritt | Größenordnung | Risiko |
|---|---|---|
| 1 + 2 | klein | gering — reine Neuanlage, Schema trägt |
| 3 | mittel | **hoch** — Sperren, die falsch greifen, blockieren einen Abschluss, den sonst niemand prüfen kann |
| 4 | groß | hoch — extern |
| 5 | mittel | mittel — ersetzt die 404-Sonderbehandlung |

Das Risiko von Schritt 3 ist der eigentliche Grund, warum die
Vollständigkeitsprüfung **nicht automatisch gebaut** werden sollte: Sie ist
die letzte Instanz vor der Veröffentlichung, und eine zu strenge Prüfung
erzeugt einen Workaround (Abschlüsse prüfen sich selbst nicht mehr), der
schlimmer ist als die Lücke.
