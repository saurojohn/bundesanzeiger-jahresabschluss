#!/bin/bash
# ============================================================================
# Generiert ein selbstsigniertes P12-Test-Zertifikat für Dev-Tests
# ============================================================================
# WICHTIG: NICHT für Produktion verwenden — nur für lokale Entwicklung!
#
# Aufruf: ./scripts/generate-test-p12.sh [Zielverzeichnis]
# Default-Zielverzeichnis: ./tmp/test-certs
# ============================================================================

set -euo pipefail

CERT_DIR="${1:-./tmp/test-certs}"
mkdir -p "$CERT_DIR"

# Private Key + Self-Signed Cert (RSA 2048, 1 Jahr gültig)
openssl req -x509 -newkey rsa:2048 -keyout "$CERT_DIR/key.pem" \
  -out "$CERT_DIR/cert.pem" -days 365 -nodes \
  -subj "/CN=Test User/O=BANZ Pilot Test Cert/C=DE" \
  -addext "keyUsage=digitalSignature,keyEncipherment" \
  -addext "extendedKeyUsage=clientAuth,emailProtection"

# P12 zusammenbauen (Passwort: test1234)
openssl pkcs12 -export -out "$CERT_DIR/test-token.p12" \
  -inkey "$CERT_DIR/key.pem" -in "$CERT_DIR/cert.pem" \
  -passout pass:test1234

echo "================================================================"
echo "Test-P12 erstellt: $CERT_DIR/test-token.p12"
echo "Passwort:          test1234"
echo "================================================================"
echo ""
echo "ACHTUNG: NICHT für Produktion verwenden!"
echo ""
echo "Verwendung in M2 Pilot:"
echo "  - Backend: TSA_URL nicht gesetzt → Mock-TSA aktiv"
echo "  - signpdf/signer-p12 nutzt test-token.p12 + 'test1234'"
echo ""
echo "Mögliche nächste Schritte:"
echo "  - Token mit echter SmartCard verbinden (M3)"
echo "  - QC-Statement-Extension ergänzen für QUALIFIZIERT-Erkennung"
echo "    (siehe ETSI ES 319 412-5)"