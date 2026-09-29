#!/usr/bin/env node
/**
 * Minimaler S3-kompatibler Mock-Server fuer die WORM-/Object-Lock-Tests.
 *
 * Warum: MinIO ist als Open-Source-Server archiviert (dl.min.io liefert 410),
 * und ohne S3-Endpoint kann die GoBD-Pflichtstrecke (Upload -> SHA-256 ->
 * Object Lock COMPLIANCE -> 10 Jahre Retention -> Download) nicht end-to-end
 * verifiziert werden. Dieser Mock implementiert genau die Operationen,
 * die `StorageService` verwendet:
 *
 *   HEAD /:bucket/:key   -> Existenz + x-amz-meta-* + Object-Lock-Header
 *   PUT  /:bucket/:key   -> Body speichern, Object-Lock-Metadaten uebernehmen
 *   GET  /:bucket/:key   -> Body zurueckgeben
 *   DELETE /:bucket/:key -> 403, sobald ein COMPLIANCE-/GOVERNANCE-Lock sitzt
 *
 * Signaturpruefung (SigV4) wird bewusst NICHT durchgefuehrt — der Server
 * ist ausschliesslich fuer lokale Tests gedacht und haelt nichts ueber
 * einen Prozess-Neustart hinaus.
 *
 * WORM-Semantik ist echt nachgebildet (Stand 2026-09-28, nach Audit):
 *   1. x-amz-meta-* werden gespeichert und bei HEAD zurueckgegeben.
 *      Ohne das war der Produkt-Guard in storage.service.ts (Hash-Vergleich
 *      gegen head.Metadata['sha256']) unter diesem Mock TOT — der
 *      Re-Upload-Schutz konnte nie greifen.
 *   2. Ein Re-PUT auf ein Objekt mit aktivem COMPLIANCE-Lock wird mit 403
 *      abgelehnt; der Lock wird NIE ueberschrieben. Echtes S3 verhaelt
 *      sich so, und nur so wird ein GoBD-Verstoss im Produktcode sichtbar.
 *   3. Retention ist zeitabhaengig: ein abgelaufenes Retain-Datum gibt das
 *      Objekt wieder frei (echte S3-Semantik).
 */

const http = require('http');

const PORT = Number(process.env.S3_MOCK_PORT || 9000);
const HOST = process.env.S3_MOCK_HOST || '127.0.0.1';

/** @type {Map<string, {body: Buffer, lockMode: string|null, retainUntil: string|null, legalHold: string|null, contentType: string|null, metadata: Record<string,string>}>} */
const store = new Map();

function log(...args) {
  process.stdout.write(`[s3-mock] ${args.join(' ')}\n`);
}

/** Ist auf dem Objekt gerade ein Lock wirksam? */
function lockActive(obj) {
  if (obj.legalHold === 'ON') return true;
  if (obj.lockMode && obj.retainUntil) {
    const until = new Date(obj.retainUntil).getTime();
    // Ein abgelaufenes Retain-Datum gibt das Objekt wieder frei.
    return Number.isFinite(until) ? until > Date.now() : true;
  }
  return false;
}

/** Sammelt alle x-amz-meta-* Header in ein plain object (lower-case keys). */
function collectMetadata(headers) {
  const meta = {};
  for (const [k, v] of Object.entries(headers)) {
    const lower = k.toLowerCase();
    if (lower.startsWith('x-amz-meta-')) {
      meta[lower.slice('x-amz-meta-'.length)] = Array.isArray(v) ? v[0] : v;
    }
  }
  return meta;
}

function parseKey(reqUrl) {
  // Path-Style: /:bucket/:key...   (Key kann "/" enthalten)
  const path = decodeURIComponent(reqUrl.split('?')[0]);
  const trimmed = path.replace(/^\/+/, '');
  const slash = trimmed.indexOf('/');
  if (slash === -1) return { bucket: trimmed, key: '' };
  return { bucket: trimmed.slice(0, slash), key: trimmed.slice(slash + 1) };
}

const server = http.createServer((req, res) => {
  const { bucket, key } = parseKey(req.url || '/');
  const mapKey = `${bucket}/${key}`;

  if (req.method === 'GET' && key === '') {
    // Bucket-Liste — vom SDK gelegentlich zur Verfuegbarkeitspruefung.
    res.writeHead(200, { 'content-type': 'application/xml' });
    res.end(
      `<?xml version="1.0" encoding="UTF-8"?><ListAllMyBucketsResult><Buckets>` +
        [...new Set([...store.keys()].map((k) => k.split('/')[0]))]
          .map((b) => `<Bucket><Name>${b}</Name></Bucket>`)
          .join('') +
        `</Buckets></ListAllMyBucketsResult>`
    );
    return;
  }

  if (req.method === 'HEAD') {
    const obj = store.get(mapKey);
    if (!obj) {
      res.writeHead(404, { 'content-type': 'application/xml' });
      res.end();
      return;
    }
    const headers = {
      'content-length': String(obj.body.length),
      'content-type': obj.contentType || 'application/octet-stream',
      etag: `"${obj.body.length.toString(16)}"`,
    };
    // User-Metadaten zurueckgeben — der Produktcode liest hier den SHA-256.
    for (const [k, v] of Object.entries(obj.metadata || {})) {
      headers[`x-amz-meta-${k}`] = v;
    }
    const active = lockActive(obj);
    if (obj.lockMode) headers['x-amz-object-lock-mode'] = obj.lockMode;
    if (obj.retainUntil) headers['x-amz-object-lock-retain-until-date'] = obj.retainUntil;
    if (obj.legalHold) headers['x-amz-object-lock-legal-hold'] = obj.legalHold;
    if (active) headers['x-amz-object-lock-active'] = 'true';
    res.writeHead(200, headers);
    res.end();
    return;
  }

  if (req.method === 'PUT') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const existing = store.get(mapKey);

      // WORM: ein Objekt mit aktivem COMPLIANCE-Lock darf weder geloescht
      // noch ueberschrieben werden. Governance waere mit Bypass-Header
      // ueberschreibbar — wir modellieren nur den COMPLIANCE-Fall, den die
      // GoBD-Pflichtstrecke verwendet.
      if (existing && lockActive(existing) && existing.lockMode === 'COMPLIANCE') {
        log(`PUT  ${mapKey} -> 403 (Object-Lock COMPLIANCE, Objekt unveraenderlich)`);
        res.writeHead(403, { 'content-type': 'application/xml' });
        res.end(
          '<Error><Code>AccessDenied</Code>' +
            '<Message>Object Lock in COMPLIANCE mode: object is immutable</Message></Error>'
        );
        return;
      }

      store.set(mapKey, {
        body,
        lockMode: req.headers['x-amz-object-lock-mode'] || existing?.lockMode || null,
        retainUntil:
          req.headers['x-amz-object-lock-retain-until-date'] || existing?.retainUntil || null,
        legalHold: req.headers['x-amz-object-lock-legal-hold'] || existing?.legalHold || null,
        contentType: req.headers['content-type'] || null,
        metadata: { ...(existing?.metadata || {}), ...collectMetadata(req.headers) },
      });
      log(
        `PUT  ${mapKey} (${body.length} B, lock=${req.headers['x-amz-object-lock-mode'] || '-'}, ` +
          `meta=${JSON.stringify(collectMetadata(req.headers))})`
      );
      res.writeHead(200, { etag: `"${body.length.toString(16)}"` });
      res.end();
    });
    return;
  }

  if (req.method === 'GET') {
    const obj = store.get(mapKey);
    if (!obj) {
      res.writeHead(404, { 'content-type': 'application/xml' });
      res.end('<Error><Code>NoSuchKey</Code></Error>');
      return;
    }
    res.writeHead(200, {
      'content-length': String(obj.body.length),
      'content-type': obj.contentType || 'application/octet-stream',
    });
    res.end(obj.body);
    return;
  }

  if (req.method === 'DELETE') {
    const obj = store.get(mapKey);
    if (!obj) {
      res.writeHead(404);
      res.end();
      return;
    }
    if (lockActive(obj)) {
      log(`DELETE ${mapKey} -> 403 (Object-Lock ${obj.lockMode} aktiv)`);
      res.writeHead(403, { 'content-type': 'application/xml' });
      res.end(
        '<Error><Code>AccessDenied</Code><Message>Object Lock retention prevents deletion</Message></Error>'
      );
      return;
    }
    store.delete(mapKey);
    log(`DELETE ${mapKey} -> 204 (kein aktiver Lock)`);
    res.writeHead(204);
    res.end();
    return;
  }

  res.writeHead(405);
  res.end();
});

server.listen(PORT, HOST, () => {
  log(`S3-Mock laeuft auf http://${HOST}:${PORT} (path-style, ohne SigV4-Pruefung)`);
});

