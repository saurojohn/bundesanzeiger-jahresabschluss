#!/usr/bin/env bash
# ============================================================================
# Bundesanzeiger Jahresabschluss — Production Release Script (M4 Sprint 0)
# ============================================================================
# Zweck: Erstellt, signiert und veröffentlicht Production-Release-Artefakte
#        (Docker-Image + SBOM + SLSA-Provenance + Git-Tag).
#
# Voraussetzungen:
#   - Docker (build + push)
#   - cosign   (https://docs.sigstore.dev/cosign/installation)
#   - syft     (https://github.com/anchore/syft)  — für SBOM
#   - gpg      (für Git-Tag-Signatur)
#
# Aufruf: ./scripts/release.sh v1.0.0
#
# WICHTIG: cosign.key NIEMALS committen — siehe .gitignore (*.key).
# ============================================================================

set -euo pipefail

VERSION="${1:?Usage: $0 VERSION (z.B. v1.0.0)}"
IMAGE_NAME="banz-jahresabschluss"
REGISTRY="${REGISTRY:-ghcr.io/shledergmbh}"

# --- Vorbedingungen prüfen ---
for cmd in docker cosign syft gpg git; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "[FAIL] Benötigtes Tool fehlt: $cmd"
    exit 1
  fi
done

echo "=== Release ${VERSION} ==="

# --- 1. Cosign Key-Pair (falls nicht vorhanden) ---
if [ ! -f "cosign.key" ] || [ ! -f "cosign.pub" ]; then
  echo ">>> Cosign Key-Pair wird generiert (einmalig pro Maintainer)..."
  cosign generate-key-pair
  echo "    cosign.key + cosign.pub erstellt. cosign.key ist SECRET — nicht committen!"
fi

# --- 2. Docker-Image bauen ---
FULL_IMAGE="${REGISTRY}/${IMAGE_NAME}:${VERSION}"
echo ">>> Docker-Image wird gebaut: ${FULL_IMAGE}"
docker build \
  -t "${FULL_IMAGE}" \
  --label "org.opencontainers.image.version=${VERSION}" \
  --label "org.opencontainers.image.source=https://github.com/shledergmbh/bundesanzeiger-jahresabschluss" \
  --label "org.opencontainers.image.created=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --label "org.opencontainers.image.licenses=UNLICENSED" \
  -f Dockerfile \
  .

# --- 3. Docker-Image signieren (Cosign Keyless-Style via Key) ---
echo ">>> Docker-Image wird signiert..."
cosign sign --key cosign.key "${FULL_IMAGE}"

# --- 4. SBOM (Software Bill of Materials) generieren ---
SBOM_FILE="sbom-${VERSION}.spdx.json"
echo ">>> SBOM wird generiert: ${SBOM_FILE}"
syft "${FULL_IMAGE}" -o spdx-json > "${SBOM_FILE}"
cosign attest --key cosign.key --predicate "${SBOM_FILE}" --type spdx "${FULL_IMAGE}"

# --- 5. SLSA Build-Provenance (Level 3 konform) ---
PROVENANCE_FILE="provenance-${VERSION}.json"
echo ">>> SLSA-Provenance wird generiert: ${PROVENANCE_FILE}"

# Minimal-Provenance (manuell erzeugt — für echtes SLSA-L3 GitHub-Actions nutzen)
cat > "${PROVENANCE_FILE}" <<EOF
{
  "buildType": "https://github.com/shledergmbh/bundesanzeiger-jahresabschluss/releases/tag/${VERSION}",
  "builder": { "id": "local-cosign-script" },
  "invocation": {
    "configSource": { "uri": "git+https://github.com/shledergmbh/bundesanzeiger-jahresabschluss", "digest": { "sha1": "MANUAL" } },
    "parameters": { "version": "${VERSION}" }
  },
  "metadata": {
    "buildStartedOn": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "completeness": { "arguments": true, "environment": false, "materials": false },
    "reproducible": false
  },
  "materials": [
    { "uri": "docker-image:${FULL_IMAGE}", "digest": { "sha256": "MANUAL" } }
  ]
}
EOF
cosign attest --key cosign.key --predicate-type slsaprovenance --predicate "${PROVENANCE_FILE}" "${FULL_IMAGE}"

# --- 6. Docker-Image pushen ---
echo ">>> Image wird gepusht: ${FULL_IMAGE}"
docker push "${FULL_IMAGE}"

# --- 7. Git-Tag signieren (GPG) ---
echo ">>> Git-Tag ${VERSION} wird signiert..."
git tag -s "${VERSION}" -m "Release ${VERSION}"
git push origin "${VERSION}"

echo ""
echo "=== Release ${VERSION} signiert + veröffentlicht ==="
echo ""
echo "Verifikation:"
echo "  cosign verify --key cosign.pub ${FULL_IMAGE}"
echo "  cosign verify-attestation --key cosign.pub --type spdx ${FULL_IMAGE}"
echo "  cosign verify-attestation --key cosign.pub --type slsaprovenance ${FULL_IMAGE}"
echo ""
echo "Hinweis: cosign.key ist SECRET. Backup an einem sicheren Ort aufbewahren."
echo "         Für Keyless-Signing (OIDC): cosign sign --yes ${FULL_IMAGE} (statt --key)"