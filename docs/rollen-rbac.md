# Rollen- und Berechtigungsmodell (RBAC)

> Erzeugt aus dem tatsächlichen Code (Stand 2026-09-29). Dieses Dokument existierte
> bisher nicht, wurde aber in `AGENTS.md §1` und `README.md` referenziert.
> Bei Änderungen an Guards oder Rollen-Konstanten ist dieses Dokument nachzuführen.

## 1. Rollen

Definierte Rollen (Konstanten in `src/modules/auth/`, Schema-Feld `User.globalRole`
bzw. `UserMandantRole.rolle`):

| Rolle | Geltung |
|---|---|
| `USER` | Basisrolle ohne Fachberechtigung; in der Regel mit Mandantenrollen kombiniert |
| `GF` | Geschäftsführer eines Mandanten |
| `STEUERBERATER` | Steuerberater der Kanzlei |
| `WIRTSCHAFTSPRUEFER` | Wirtschaftsprüfer (Prüfsignatur, Konzernabschluss, IDW-Regeln) |
| `KANZLEI_ADMIN` | Administration einer Kanzlei inkl. aller Mandanten |
| `SYSTEM_ADMIN` | Systemadministration; einzige Rolle mit mandantübergreifendem Zugriff |

`globalRole` gilt mandantenübergreifend, `UserMandantRole` ordnet eine Rolle einem
konkreten Mandanten zu. Ein `GF` ist also z. B. `SYSTEM_ADMIN`? Nein — `globalRole`
ist die übergeordnete Rolle, `UserMandantRole.rolle` die mandantbezogene.

## 2. Guard-Kette

Globale Guards in `app.module.ts` (Reihenfolge zählt):

1. `ThrottlerGuard` — Rate-Limit
2. `JwtAuthGuard` — JWT-Prüfung, **überspringbar per `@Public()`**
3. `RolesGuard` — prüft `@Roles(...)` gegen `globalRole`

Zusätzlich auf Methodenebene:

4. `MandantGuard` — aktiviert durch `@RequireMandant()`; prüft, dass die
   `mandantId` zum zugänglichen Mandanten des Users gehört

### Präzedenz der `mandantId` (MandantGuard)

```
params.mandantId  →  header x-mandant-id  →  query mandantId  →  body mandantId
```

Der Header steht bewusst **vor** dem Query, damit ein Client per Query-Parameter
 keinen per Header gesetzten Mandanten überschreiben kann.

Fehlt die `mandantId` vollständig: `403 "mandantId erforderlich"`.
Gehört sie nicht zum User: `403 "Kein Zugriff auf diesen Mandanten"`.

> **Bugfix 2026-09-28:** `req.query` fehlte ursprünglich in dieser Kette. Da alle
> Listen-Endpunkte `@Query('mandantId')` verwenden, antwortete jede Mandantenliste
> für alle Rollen außer `SYSTEM_ADMIN` mit 403 — unabhängig davon, was der Client
> sendete.

## 3. Rollenmatrix je Modul

Aus den tatsächlichen `@Roles(...)`-Deklarationen:

| Modul | erlaubte Rollen |
|---|---|
| `mandant` | `KANZLEI_ADMIN` |
| `bilanz` | `STEUERBERATER`, `KANZLEI_ADMIN` |
| `guv` | `STEUERBERATER`, `KANZLEI_ADMIN` |
| `anhang` | `STEUERBERATER`, `KANZLEI_ADMIN` |
| `pdf` | `STEUERBERATER`, `KANZLEI_ADMIN` |
| `ebilanz` | `STEUERBERATER`, `WIRTSCHAFTSPRUEFER`, `KANZLEI_ADMIN` |
| `datev` (Export) | `STEUERBERATER`, `WIRTSCHAFTSPRUEFER`, `KANZLEI_ADMIN` |
| `datev-import` | `STEUERBERATER`, `KANZLEI_ADMIN` |
| `signatur` | `WIRTSCHAFTSPRUEFER`, `STEUERBERATER` |
| `konsolidierung` | `WIRTSCHAFTSPRUEFER`, `KANZLEI_ADMIN` |
| `wp` | `WIRTSCHAFTSPRUEFER` |
| `audit` (Lesen) | `KANZLEI_ADMIN`, `WIRTSCHAFTSPRUEFER`, `SYSTEM_ADMIN` |
| `api` (API-Keys) | `KANZLEI_ADMIN` |
| `webhook` | `KANZLEI_ADMIN` |
| `branding` | `KANZLEI_ADMIN` |
| `api/v1` (Public-API) | API-Key-Scopes, **kein** Rollen-RBAC (siehe unten) |

## 4. Public-API (scopes statt Rollen)

`ApiV1Controller` nutzt **kein** Rollen-RBAC, sondern API-Keys mit Scopes
(`@RequireScopes(...)`, `ApiKeyGuard`). Format: `"<resource>:<action>"`, z. B.
`mandant:read`, `bilanz:write`.

Der Token wird als `Authorization: Bearer ak_<keyId>.<secret>` übergeben.
Fehlt der `ak_`-Präfix, interpretiert der Guard den Wert als OAuth2-JWT.

`ApiV1Controller` und `OAuthController` sind mit `@Public()` annotiert: sie
authentifizieren sich selbst (API-Key bzw. `client_credentials`) und würden vom
globalen `JwtAuthGuard` sonst mit 401 abgefangen, bevor ihre eigene Prüfung läuft.

## 5. Was dieses Modell NICHT abdeckt

* **Keine Feld-/Objektrechte.** Wer `bilanz:write` auf einen Mandant hat, darf alle
  Positionen desselben Geschäftsjahres ändern. Es gibt keine Rechte auf
  einzelne Positionen oder Jahre.
* **Keine zeitbezogene Rechte.** Ein entbundener Kanzlei-Admin verliert den Zugang
  erst mit `subscriptionPeriodEnd` (Feature-Flag-Ebene, nicht RBAC).
* **Self-Ack-Schutz** ist im WP-Modul anwendungsseitig umgesetzt
  (`PATCH /api/wp/notizen/:id/status` mit eigenem User → 403), nicht als
  generalisierte Regel.
* **`SYSTEM_ADMIN` umgeht `MandantGuard`.** Das ist beabsichtigt, aber heißt:
  ein SYSTEM_ADMIN kann jeden Mandanten adressieren. Der Zugriff wird im
  Audit-Trail protokolliert, nicht verhindert.
