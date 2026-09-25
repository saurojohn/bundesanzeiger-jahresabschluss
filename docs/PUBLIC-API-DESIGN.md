# Public-API — Architektur-Design (M4 Sprint 1)

> **Status**: 📐 Architektur-Skizze. Implementierung folgt in M4 Sprint 1.
> **Zweck**: Externe API für Kanzlei-Software-Integration (DATEV-Direkt-
> Anbindung, ERP-Systeme, Mobile-Apps, Bilanz-Tools).

---

## 1. Übersicht

### Ziele

- **Maschinenlesbar**: Standardisierte REST-API mit OpenAPI 3.1-Spec
- **Sicher**: OAuth2-Client-Credentials-Flow, kein User-Password-Sharing
- **Mandant-trennend**: Jeder API-Key ist an genau eine Kanzlei gebunden
- **Versioniert**: `/api/v1` und `/api/v2` parallel für Breaking Changes
- **Rate-Limited**: Per API-Key konfigurierbar (Default 600 req/min)
- **Webhook-fähig**: Push-Events für `submission.status-changed`

### Nicht-Ziele

- Kein User-Login via Public-API (das bleibt im User-Facing-Frontend)
- Kein Public-Read aller Kanzleien — strikte Mandant-Trennung
- Keine Bilanz-Eingabe via API (UI-only) — API nur für Reads + Submissions

---

## 2. Authentifizierung: OAuth2 Client-Credentials

### Token-Endpunkt

```http
POST /oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials
&client_id=<kanzlei-api-key-id>
&client_secret=<kanzlei-api-key-secret>
&scope=read:mandanten read:bilanzen write:submissions
```

**Response**:

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "read:mandanten read:bilanzen write:submissions"
}
```

### Scopes

| Scope                       | Beschreibung                                    |
| --------------------------- | ----------------------------------------------- |
| `read:mandanten`            | Liste + Details eigener Mandanten               |
| `read:bilanzen`             | Lesen von Bilanzen/GuV/Anhang                   |
| `read:audit`                | Audit-Log lesen (für externe Compliance-Tools)  |
| `write:submissions`         | Bundesanzeiger-Submissionen anlegen             |
| `write:webhooks`            | Webhook-Subscriptions verwalten                 |

### Token-Validation

API-Requests tragen `Authorization: Bearer <access_token>`. JWT enthält:
- `sub` = API-Key-ID
- `kanzleiId` = bound Kanzlei
- `scopes` = erteilte Scopes
- `exp` = Ablaufzeit (max 1h)

---

## 3. Endpunkte (M4 Sprint 1)

### 3.1 Mandanten

```http
GET /api/v1/mandanten
  ?cursor=<opak>
  &pageSize=50
Authorization: Bearer <token>

→ 200 OK
{
  "items": [
    {
      "id": "uuid",
      "firmenname": "Muster GmbH",
      "rechtsform": "GmbH",
      "handelsregister": "HRB 12345",
      "groessenklasse": "MITTEL",
      "publishChannel": "BUNDESANZEIGER"
    }
  ],
  "nextCursor": "...",
  "total": 15,
  "hasMore": false
}
```

```http
GET /api/v1/mandanten/{mandantId}
→ 200 OK / 404 Not Found / 403 Forbidden (Mandant-Trennung!)
```

### 3.2 Jahresabschluss

```http
GET /api/v1/bilanzen
  ?mandantId=<uuid>
  &jahr=<int>
  &cursor=<opak>
Authorization: Bearer <token>
→ 200 OK
```

```http
GET /api/v1/guv
  ?mandantId=<uuid>
  &jahr=<int>
  &verfahren=GKV|UKV
→ 200 OK
```

```http
GET /api/v1/anhang
  ?mandantId=<uuid>
  &jahr=<int>
→ 200 OK
```

### 3.3 Bundesanzeiger-Submissions

```http
POST /api/v1/banz-submissions
Authorization: Bearer <token>  (Scope: write:submissions)
Content-Type: application/json

{
  "mandantId": "uuid",
  "geschaeftsjahr": 2025,
  "publishChannel": "BUNDESANZEIGER|DATEV|EBILANZ"
}

→ 202 Accepted
{
  "id": "submission-uuid",
  "status": "QUEUED",
  "wormObjectKey": "kanzlei/.../submission-uuid.pdf",
  "estimatedCompletionAt": "2025-12-31T23:59:59Z"
}
```

```http
GET /api/v1/banz-submissions/{submissionId}
→ 200 OK / 404 Not Found / 403 Forbidden

{
  "id": "submission-uuid",
  "mandantId": "uuid",
  "geschaeftsjahr": 2025,
  "status": "PUBLISHED",
  "publishedAt": "2025-12-30T14:23:11Z",
  "bundesanzeigerUrl": "https://...",
  "wormObjectKey": "..."
}
```

### 3.4 Webhooks

```http
POST /api/v1/webhooks
Authorization: Bearer <token>  (Scope: write:webhooks)

{
  "url": "https://kanzlei-domain.de/webhook/banz",
  "events": ["submission.status-changed", "submission.failed"],
  "secret": "<32-char-hmac-secret>"
}

→ 201 Created
{ "id": "webhook-uuid", "url": "...", "events": [...], "createdAt": "..." }
```

**Outgoing Webhook-Format**:

```http
POST https://kanzlei-domain.de/webhook/banz
Content-Type: application/json
X-Webhook-Signature: sha256=<hmac>
X-Webhook-Event: submission.status-changed
X-Webhook-Id: <uuid>
X-Webhook-Timestamp: <unix-seconds>

{
  "id": "evt-uuid",
  "type": "submission.status-changed",
  "data": {
    "submissionId": "submission-uuid",
    "mandantId": "uuid",
    "geschaeftsjahr": 2025,
    "status": "PUBLISHED",
    "previousStatus": "QUEUED"
  }
}
```

### 3.5 Health + Diagnose

```http
GET /api/v1/health
→ 200 OK (kein Auth)
{ "status": "ok", "version": "1.0.0", "uptimeSeconds": 12345 }
```

---

## 4. Rate-Limits

Per API-Key konfigurierbar im Branding/Admin-Bereich:

| Tier       | Default-Limit | Burst |
| ---------- | ------------- | ----- |
| Pilot      | 60 req/min    | 100   |
| Standard   | 600 req/min   | 1000  |
| Premium    | 6000 req/min  | 10000 |

**Response bei Limit-Überschreitung**:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 30
X-RateLimit-Limit: 600
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1702032000

{
  "statusCode": 429,
  "error": "rate_limited",
  "message": "API-Rate-Limit überschritten. Retry nach 30 Sekunden."
}
```

---

## 5. Versionierung

- URI-basiert: `/api/v1/...`, `/api/v2/...`
- Deprecation-Policy: V1 bleibt 12 Monate nach V2-Release aktiv
- Breaking Changes nur in Major-Versionen (v1 → v2)
- Minor-Versionen (v1.1) nur additive Features
- Header `Sunset` signalisiert Deprecation:
  ```
  Sunset: Sat, 31 Dec 2026 23:59:59 GMT
  Deprecation: true
  Link: </api/v2/mandanten>; rel="successor-version"
  ```

---

## 6. OpenAPI 3.1 Spec

Spec wird automatisch aus NestJS-Decorators generiert via
`@nestjs/swagger` (geplant für Sprint 1).

**Geplante Spec-Struktur**:

```yaml
openapi: 3.1.0
info:
  title: Bundesanzeiger Jahresabschluss Public API
  version: 1.0.0
  description: |
    Externe API für Kanzlei-Integration. OAuth2 Client-Credentials.
    Mandant-Trennung wird serverseitig erzwungen.
servers:
  - url: https://api.banz-jahresabschluss.de
    description: Production
  - url: https://api-staging.banz-jahresabschluss.de
    description: Staging
security:
  - OAuth2: [read:mandanten, read:bilanzen, write:submissions]
paths:
  /oauth/token:
    post: { ... }
  /api/v1/mandanten:
    get: { ... }
  /api/v1/bilanzen:
    get: { ... }
  /api/v1/banz-submissions:
    post: { ... }
    get: { ... }
components:
  securitySchemes:
    OAuth2:
      type: oauth2
      flows:
        clientCredentials:
          tokenUrl: /oauth/token
          scopes:
            read:mandanten: Lesezugriff auf Mandanten
            read:bilanzen: Lesezugriff auf Jahresabschluss
            write:submissions: Submissions anlegen
            write:webhooks: Webhook-Subscriptions
  schemas:
    Mandant: { ... }
    Bilanz: { ... }
    Submission: { ... }
```

Spec wird unter `/api/v1/openapi.json` und `/api/v1/openapi.yaml`
served sowie unter `/api-docs` als Swagger-UI angezeigt.

---

## 7. Mandant-Trennung (KRITISCH)

Die Public-API erbt die Mandant-Trennung aus dem Backend:

```typescript
// Beispiel: bilanz.controller.ts (Public-API)
@Get('api/v1/bilanzen')
@UseGuards(PublicApiAuthGuard)
async listBilanzen(
  @Query() query: ListBilanzenDto,
  @CurrentApiKey() apiKey: ApiKey,
) {
  // apiKey.kanzleiId ist ERZWUNGEN — kein Mandant außerhalb ist erreichbar
  return this.bilanzService.findAllPaginated({
    mandantId: query.mandantId,
    kanzleiId: apiKey.kanzleiId,  // ← Mandant-Trennung
    jahr: query.jahr,
    cursor: query.cursor,
    pageSize: query.pageSize,
  });
}
```

**Garantie**: Auch wenn ein böswilliger Client eine fremde `mandantId`
angibt, antwortet die API mit `404 Not Found` (kein 403, um
Existenz-Leaks zu vermeiden).

---

## 8. Sicherheits-Überlegungen

1. **API-Key-Speicherung**: API-Secrets werden mit bcrypt gehasht in
   der DB persistiert (analog zu User-Passwörtern).
2. **Token-Speicherung beim Client**: Empfehlung „ephemeral in memory"
   (nicht in LocalStorage wegen XSS).
3. **Webhook-Signaturen**: HMAC-SHA256 über den Body, Secret wird bei
   Subscription-Generierung einmalig zurückgegeben.
4. **Rate-Limits**: Pro API-Key, nicht pro IP (NAT-Problem in Kanzleien).
5. **Audit-Trail**: JEDER Public-API-Call wird im AuditLog protokolliert
   (GoBD §147 AO).
6. **TLS erzwingen**: Alle Public-API-Endpoints nur via HTTPS; HTTP gibt
   301 → HTTPS.
7. **Input-Validierung**: class-validator auf allen DTOs (gleiche Pipeline
   wie User-Facing-API).

---

## 9. Implementierungs-Reihenfolge

### Sprint 1.a — Foundation
- OAuth2-Server-Modul (`/oauth/token`)
- API-Key-Management (Branding/Admin-UI)
- Public-Api-Auth-Guard
- OpenAPI-Generator-Integration (`@nestjs/swagger`)

### Sprint 1.b — Read-Endpoints
- `GET /api/v1/mandanten` + Detail
- `GET /api/v1/bilanzen` + Detail
- `GET /api/v1/guv` + Detail
- `GET /api/v1/anhang` + Detail

### Sprint 1.c — Write-Endpoints
- `POST /api/v1/banz-submissions`
- `GET /api/v1/banz-submissions/{id}`
- Webhook-Management (POST/DELETE)
- Webhook-Outgoing-Service

### Sprint 1.d — Rate-Limiting + Doku
- Rate-Limit-Per-Key (separater Throttler)
- OpenAPI-Spec generiert + unter `/api-docs`
- Public-API-User-Guide (für Kanzlei-Entwickler)

---

## 10. Offene Fragen

1. **Pagination-Cursor-Format**: Bestehendes `CursorCodec`-Format
   weiterverwenden oder eigenes Public-API-Cursor-Format? (Vorschlag:
   bestehend, da schon opaque)
2. **Webhook-Retry-Policy**: 3x exponentielles Backoff bei 5xx? (Vorschlag:
   ja, max 24h)
3. **API-Key-Rotation**: Erzwingen oder optional? (Vorschlag: optional,
   aber empfohlen alle 90 Tage)
4. **GraphQL-Alternative**: Parallel zu REST oder nur REST? (Vorschlag:
   nur REST für Sprint 1; GraphQL in M5, falls Kundenbedarf)

---

## Referenzen

- `docs/MILESTONE-4.md` — Gesamt-Roadmap M4
- `backend/src/modules/branding/services/branding.service.ts` — Branding (für API-Key-UI)
- OAuth2-Spec: https://datatracker.ietf.org/doc/html/rfc6749
- OpenAPI 3.1: https://spec.openapis.org/oas/v3.1.0
- Webhook-Signaturen: https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries