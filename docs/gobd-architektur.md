# GoBD-Architektur

> Erzeugt aus dem tatsächlichen Code (Stand 2026-09-29). Dieses Dokument existierte
> bisher nicht, wurde aber in `AGENTS.md §1` referenziert.

## 1. Was GoBD hier verlangt

| Anforderung | Umsetzung im Code |
|---|---|
| Vollständigkeit | `AuditInterceptor` erfasst **jede** Mutation (`POST`, `PUT`, `PATCH`, `DELETE`) mit Vorher-/Nachher-Zustand |
| Nachvollziehbarkeit | `AuditService.record()` schreibt User, Mandant, Aktion, Entity, IP, User-Agent |
| Unveränderlichkeit (10 Jahre) | `StorageService` legt jedes Dokument mit S3 Object Lock `COMPLIANCE` und `Sachkontenlaenge`-Retention von **3650 Tagen** ab (§ 147 AO) |
| Manipulationserkennung | `AuditIntegrityService` verkettet jeden Eintrag per SHA-256-Hash-Chain |

## 2. Audit-Trail

### 2.1 Erfassung

`AuditInterceptor` (`src/modules/audit/interceptors/audit.interceptor.ts`) hängt sich
an `POST`, `PUT`, `PATCH`, `DELETE` und ruft `AuditService.record()` auf. Die Aktion
wird aus der HTTP-Methode abgeleitet:

```
POST   → CREATE
PUT    → UPDATE
PATCH  → UPDATE
DELETE → DELETE
```

Signatur-, Submit- und Login-Vorgänge verwenden abweichende Aktionen
(`SIGN`, `SUBMIT`, `LOGIN`).

### 2.2 Hash-Chain (M4 Sprint 5)

`AuditIntegrityService` berechnet je Eintrag:

```
entryHash = SHA-256(prevHash + serialisierter Eintrag)
prevHash  = entryHash des unmittelbar vorherigen Eintrags
Genesis   = "0" × 64
```

Wird ein Eintrag nachträglich geändert, stimmt sein `entryHash` nicht mehr; alle
folgenden Einträge tragen einen `prevHash`, der nicht mehr in der Kette steht.
`verifyIntegrity()` erkennt das.

**Wichtig:** `entryHash` wird **nicht** bei jedem Read neu berechnet (zu teuer), sondern
beim Schreiben gespeichert.

> **Offener Punkt:** Bei Migration einer bereits befüllten Tabelle bleiben
> `entryHash`/`prevHash` zunächst `NULL`; `verifyIntegrity()` meldet dann `PARTIAL`,
> bis die Kette einmal vollständig durchlaufen ist. Ein Rechen-Skript dafür ist
> vorgesehen, aber **nicht implementiert**.

## 3. WORM-Dokumentenarchiv

`StorageService` (`src/modules/storage/services/storage.service.ts`):

* Bucket aus `S3_BUCKET`, Endpoint aus `S3_ENDPOINT` (MinIO / Hetzner S3)
* `ObjectLockMode: COMPLIANCE` — weder überschreiben noch löschen, auch nicht durch
  den Bucket-Owner. Gewählt, weil GoBD „unveränderlich" verlangt.
* `ObjectLockRetainUntilDate = jetzt + 3650 Tage`
* `ObjectLockLegalHoldStatus: ON`
* SHA-256 des Inhalts wird als User-Metadatum `sha256` mitgeschrieben und vor
  jedem erneuten Upload gegen den Bestand geprüft (Konflikterkennung)

### 3.1 WORM-Unterstützung in der Testumgebung

MinIO ist als Open-Source-Server archiviert (Download liefert `410 Gone`).
Für die automatisierte Prüfung liegt daher `s3-mock/server.js` bei, das die vier
benötigten Operationen (Head/Put/Get/Delete) inkl. **echter** Lock-Semantik bildet:
DELETE auf ein Objekt mit aktivem Lock → `403`, Re-PUT auf ein COMPLIANCE-Objekt →
`403`, abgelaufene Retention gibt das Objekt wieder frei.

**Grenze:** Der Mock prüft keine SigV4-Signaturen und hält seinen Zustand nur im RAM.
Er ersetzt keine Abnahme gegen einen echten S3-kompatiblen Dienst.

## 4. Dokumenten-Pipeline

```
[Bilanz/GuV/Anhang/Abschluss]
   → PDFKit-Rendering (src/modules/pdf/pdf-templates/)
   → SHA-256 über die PDF-Bytes
   → S3-Upload mit Object Lock COMPLIANCE + Legal Hold
   → WormObject-Datensatz (mandantId, entityType, entityId, key, hash, retention)
```

Die erzeugten PDFs tragen im Footer den WORM-Hinweis, den BAnz-WORM-Key und den
SHA-256-Auszug.

> **Einschränkung:** In den Tabellen-PDFs wird `bezeichnung` per `ellipsis`
> gekürzt (z. B. „Selbst geschaffene…"). Für die Pflichtveröffentlichung ist das
> zu kurz; das Layout ist fachlich nachzuziehen.

## 5. Signaturstatus — bewusst offen

`SignaturService.validateSignature()` setzt derzeit:

```ts
const certificateExpired = false;   // hart kodiert
const timestampValid = false;       // hart kodiert
const valid = signatureCount > 0 && documentIntegrity &&
              !certificateExpired && errors.length === 0;
```

`timestampValid` geht **nicht** in `valid` ein. Ein PDF ohne gültigen Zeitstempel
kann damit als `valid: true` durchgehen.

Das ist **nicht** produktiv geändert worden: Eine falsch-positive Signaturprüfung
ist auf einem Compliance-Produkt schlimmer als ein offen als Mock markierter
Zustand. Diese Stelle ist vor jedem Realbetrieb zu schließen (siehe
`REPARATUR-REPORT.md` §D.1).

## 6. Aufbewahrung

* WORM-Objekte: 3650 Tage (COMPLIANCE, Legal Hold) — § 147 AO
* Audit-Log-Einträge: dauerhaft, manipulationserkennbar über die Hash-Chain
* Datenlöschung: für gelockte Objekte technisch ausgeschlossen

## 7. Noch nicht erfüllt

* **IDW-PS-880-Audit:** `SECURITY-AUDIT.md` nennt als Auditor „Mavis + User" — eine
  Selbstprüfung ist kein Normnachweis. Vor Produktivbetrieb ist eine unabhängige
  Prüfung erforderlich.
* **Revisionssichere Signaturverifikation** (Abschnitt 5).
* **Aufbewahrungskonzept für das Audit-Log selbst** (DB-seitige Löschfristen fehlen).
