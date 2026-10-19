#!/usr/bin/env bash
#
# Zahlungsweg-Abnahme (TODO-8.18).
#
# WARUM DAS Skript existiert: Im Pilotbetrieb laeuft der Mock-Provider, und
# `MockProvider.handleWebhook()` liefert **immer null**. Der Zahlungsweg wird
# im Pilot also **nicht** geprueft — weder die Signaturpruefung noch der
# Tarifwechsel. Genau daran ist der Befund aus Nachtrag 52 gescheitert: Die
# Anwendung startete mit `STRIPE_SECRET_KEY` gar nicht, weil das Paket
# `stripe` nicht in der `package.json` stand.
#
# Dieses Skript startet das Backend im **Stripe-Modus** und fuehrt die
# Abnahme aus. Es ist der Schritt, der vor dem **ersten bezahlten Mandanten**
# einmal laufen muss.
#
# Aufruf:
#
#     cd backend
#     STRIPE_SECRET_KEY=sk_test_… STRIPE_WEBHOOK_SECRET=whsec_… \
#       ./scripts/verify-billing-webhook.sh
#
# Ohne die Variablen bricht das Skript ab — eine Abnahme, die ihr Ziel
# nicht erreicht, ist keine Abnahme.
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -z "${STRIPE_SECRET_KEY:-}" ] || [ -z "${STRIPE_WEBHOOK_SECRET:-}" ]; then
  echo "FEHLT: STRIPE_SECRET_KEY und STRIPE_WEBHOOK_SECRET muessen gesetzt sein." >&2
  echo "Beispiel (Testschluessel):" >&2
  echo "  STRIPE_SECRET_KEY=sk_test_… STRIPE_WEBHOOK_SECRET=whsec_… $0" >&2
  exit 2
fi

PORT="${PORT:-3000}"
LOG="${LOG:-/tmp/bz-billing-abnahme.log}"

echo "== 1/3: Backend im Stripe-Modus starten (Port ${PORT}) =="
lsof -ti:"${PORT}" 2>/dev/null | xargs kill -9 2>/dev/null || true
sleep 2
nohup npx ts-node -r tsconfig-paths/register src/main.ts > "${LOG}" 2>&1 &
SERVER_PID=$!

# Auf den Health-Endpunkt warten
for _ in $(seq 1 40); do
  if curl -fsS "http://localhost:${PORT}/health" > /dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! curl -fsS "http://localhost:${PORT}/health" > /dev/null 2>&1; then
  echo "FEHLER: Das Backend ist nicht gestartet. Log:" >&2
  tail -30 "${LOG}" >&2
  kill -9 "${SERVER_PID}" 2>/dev/null || true
  exit 1
fi

if ! grep -q "Billing-Provider: STRIPE" "${LOG}"; then
  echo "FEHLER: Das Backend laeuft NICHT im Stripe-Modus." >&2
  grep -i "Billing-Provider" "${LOG}" >&2 || true
  kill -9 "${SERVER_PID}" 2>/dev/null || true
  exit 1
fi
echo "   Provider: STRIPE (ok)"

cleanup() {
  kill -9 "${SERVER_PID}" 2>/dev/null || true
}
trap cleanup EXIT

echo "== 2/3: Abnahme-Spec ausfuehren =="
# Die Spec braucht dieselben Variablen und den laufenden Server.
set +e
npx vitest run e2e/billing-webhook-stripe.e2e.spec.ts
ERGEBNIS=$?
set -e

echo "== 3/3: Ergebnis =="
if [ "${ERGEBNIS}" -eq 0 ]; then
  echo "OK — der Zahlungsweg ist abgenommen."
  exit 0
fi
echo "FEHLGESCHLAGEN — der Zahlungsweg ist NICHT abgenommen. Log: ${LOG}" >&2
exit "${ERGEBNIS}"
