#!/usr/bin/env bash
# ============================================================================
# Bundesanzeiger Jahresabschluss — Release-Verifikation (M4 Sprint 0)
# ============================================================================
# Zweck: Verifiziert alle Signaturen + Attestations eines Docker-Image-Tags.
#
# Voraussetzungen:
#   - cosign (https://docs.sigstore.dev/cosign/installation)
#   - cosign.pub des Signierers (in diesem Verzeichnis oder als Argument)
#
# Aufruf: ./scripts/verify-signature.sh IMAGE_TAG [PUBKEY_PATH]
# Beispiel: ./scripts/verify-signature.sh ghcr.io/shledergmbh/banz-jahresabschluss:v1.0.0
# ============================================================================

set -euo pipefail

IMAGE="${1:?Usage: $0 IMAGE_TAG [PUBKEY_PATH]}"
PUBKEY="${2:-cosign.pub}"

if [ ! -f "${PUBKEY}" ]; then
  echo "[FAIL] Pubkey nicht gefunden: ${PUBKEY}"
  echo "       Bitte cosign.pub des Signierers bereitstellen."
  exit 1
fi

if ! command -v cosign >/dev/null 2>&1; then
  echo "[FAIL] cosign nicht installiert. Siehe https://docs.sigstore.dev/cosign/installation"
  exit 1
fi

echo "=== Verifiziere ${IMAGE} ==="
echo ""

echo ">>> Image-Signatur..."
cosign verify --key "${PUBKEY}" "${IMAGE}"

echo ""
echo ">>> SBOM-Attestation (SPDX)..."
cosign verify-attestation --key "${PUBKEY}" --type spdx "${IMAGE}"

echo ""
echo ">>> SLSA-Provenance-Attestation..."
cosign verify-attestation --key "${PUBKEY}" --type slsaprovenance "${IMAGE}"

echo ""
echo "=== Signatur gültig ==="
echo "Alle drei Verifikationen (Image + SBOM + Provenance) sind erfolgreich."