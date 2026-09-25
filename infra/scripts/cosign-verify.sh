#!/usr/bin/env bash
# ============================================================================
# Cosign-Verifikations-Helper (M4 Sprint 2)
# ============================================================================
# Verifiziert die Signatur + SBOM + Provenance-Attestations eines
# Container-Image-Tags. Wird von blue-green-switch.sh aufgerufen und
# kann auch manuell genutzt werden.
#
# Aufruf:
#   bash infra/scripts/cosign-verify.sh <IMAGE>:<TAG>
# Beispiel:
#   bash infra/scripts/cosign-verify.sh ghcr.io/shledergmbh/banz-jahresabschluss:v1.0.0
# ============================================================================
set -euo pipefail

IMAGE="${1:?Usage: $0 <IMAGE>:<TAG>}"
COSIGN_PUB_KEY="${COSIGN_PUB_KEY_PATH:-/etc/banz/cosign.pub}"

if ! command -v cosign >/dev/null 2>&1; then
  echo "[FAIL] cosign ist nicht installiert."
  echo "        Installation: https://docs.sigstore.dev/cosign/installation"
  exit 1
fi

if [ ! -f "${COSIGN_PUB_KEY}" ]; then
  echo "[FAIL] Cosign-Public-Key nicht gefunden: ${COSIGN_PUB_KEY}"
  exit 1
fi

echo "=== Cosign-Verifikation: ${IMAGE} ==="

echo ">>> [1/3] Image-Signatur..."
if cosign verify --key "${COSIGN_PUB_KEY}" "${IMAGE}" 2>&1; then
  echo "[OK] Image-Signatur gültig"
else
  echo "[FAIL] Image-Signatur ungültig oder fehlend"
  exit 1
fi

echo ">>> [2/3] SBOM-Attestation (SPDX)..."
if cosign verify-attestation --key "${COSIGN_PUB_KEY}" --type spdx "${IMAGE}" 2>&1; then
  echo "[OK] SBOM-Attestation vorhanden"
else
  echo "[WARN] SBOM-Attestation fehlt — Image nicht SLSA-L3-konform"
fi

echo ">>> [3/3] SLSA-Provenance..."
if cosign verify-attestation --key "${COSIGN_PUB_KEY}" --type slsaprovenance "${IMAGE}" 2>&1; then
  echo "[OK] SLSA-Provenance vorhanden"
else
  echo "[WARN] SLSA-Provenance fehlt — Image nicht SLSA-L3-konform"
fi

echo ""
echo "=== Verifikation abgeschlossen: ${IMAGE} ==="