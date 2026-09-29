/**
 * Unterstützte Webhook-Event-Typen (M4 Sprint 1).
 *
 * Jedes Event entspricht einer Domain-Mutation (Submission, Bilanz-Update
 * etc.). Subscriber können mehrere Events abonnieren — die Subscription
 * filtert serverseitig per `events: string[]`.
 */
export const WEBHOOK_EVENTS = [
  /** Neue BAnz-Submission wurde vorbereitet (PREPARED). */
  'banz.submission.prepared',
  /** BAnz-Submission erfolgreich eingereicht (SUBMITTED). */
  'banz.submission.submitted',
  /** BAnz-Submission veröffentlicht (PUBLISHED). */
  'banz.submission.published',
  /** BAnz-Submission fehlgeschlagen (REJECTED / ERROR). */
  'banz.submission.failed',
  /** Bilanz eines Mandanten wurde aktualisiert. */
  'bilanz.updated',
  /** GuV eines Mandanten wurde aktualisiert. */
  'guv.updated',
  /** Anhang eines Mandanten wurde aktualisiert. */
  'anhang.updated',
  /** Jahresabschluss finalisiert. */
  'jahresabschluss.finalized',
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

/**
 * Type-Guard für Webhook-Event-Strings.
 */
export function isWebhookEvent(value: string): value is WebhookEvent {
  return (WEBHOOK_EVENTS as readonly string[]).includes(value);
}

/**
 * Exponential-Backoff-Delays (in ms) für Webhook-Retry.
 *
 * Index = Versuchsnummer (0 = erster Retry, 1 = zweiter, 2 = dritter).
 * Nach dem 3. Retry (Index 3) → DEAD_LETTER.
 *
 * Spec: 1s, 5s, 30s, 5min
 */
export const WEBHOOK_RETRY_DELAYS_MS = [
  1_000, // 1s nach attempt 1
  5_000, // 5s nach attempt 2
  30_000, // 30s nach attempt 3
  300_000, // 5min (würde DEAD_LETTER auslösen, falls erreicht)
] as const;

export const WEBHOOK_MAX_ATTEMPTS = 3; // danach DEAD_LETTER

/**
 * Maximale Response-Body-Länge für `WebhookDelivery.responseBody`.
 * Wir kürzen große Responses (z.B. HTML-Error-Pages) auf 500 Zeichen.
 */
/**
 * @deprecated Wird seit 2026-09-28 nicht mehr verwendet: Der Antwortkoerper des
 * Webhook-Ziels wird nicht mehr gespeichert (SSRF-Reading, siehe
 * ssrf-guard.ts). Die Konstante bleibt erhalten, damit bestehende Imports nicht
 * brechen, und wird erst mit dem naechsten Major-Version entfernt.
 */
export const WEBHOOK_RESPONSE_BODY_MAX_LENGTH = 500;

/**
 * HTTP-Timeout für Webhook-Delivery (in ms).
 */
export const WEBHOOK_DELIVERY_TIMEOUT_MS = 10_000;