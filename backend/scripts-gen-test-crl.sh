#!/usr/bin/env bash
# =============================================================================
# Erzeugt eine Test-CA, ein Leaf-Zertifikat und zwei CRLs für die Tests der
# Zertifikatssperrprüfung (src/modules/signatur/utils/crl-checker.spec.ts).
#
# Warum OpenSSL und nicht node-forge: **node-forge kann keine CRLs erzeugen.**
# `forge.pki.CertificateRevocationList`, `forge.pki.crlFromPem` und
# `forge.pki.certificateRevocationListToPem` sind zur Laufzeit `undefined`.
# Für den Test brauchen wir aber eine echte, von einer CA signierte CRL — ein
# selbstgebautes Objekt würde die Prüfung nicht auf die Probe stellen.
#
# Ergebnis (unter tmp/test-crl/):
#   ca.crt / ca.key            Test-CA
#   leaf.crt / leaf.key        Leaf-Zertifikat (mit CRL-Distribution-Point)
#   revoked.crt / revoked.key  Leaf mit derselben Seriennummer, aber gesperrt
#   crl-empty.pem              CRL ohne Sperrung
#   crl-revoked.pem            CRL mit der Seriennummer des Leaf
#   crl-fake.pem               CRL mit GLEICHER Seriennummer, aber von einer
#                              FREMDEN CA signiert (Angriffsszenario)
#
# Aufruf: bash scripts-gen-test-crl.sh
# =============================================================================
set -euo pipefail

OUT_DIR="$(cd "$(dirname "$0")" && pwd)/tmp/test-crl"
CRL_URL="${CRL_URL:-http://127.0.0.1:9100/bundesanzeiger-test.crl}"
DAYS_CA=365
DAYS_LEAF=365

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR/newcerts"
cd "$OUT_DIR"

# --- Seriennummern-Dateien (openssl ca verlangt sie) -------------------------
echo 1000 > serial
echo 1000 > crlnumber
: > index.txt
: > index.txt.attr

# --- openssl.cnf -------------------------------------------------------------
cat > openssl.cnf <<EOF
[ ca ]
default_ca = CA_default

[ CA_default ]
dir               = .
database          = \$dir/index.txt
new_certs_dir     = \$dir/newcerts
serial            = \$dir/serial
crlnumber         = \$dir/crlnumber
certificate       = \$dir/ca.crt
private_key       = \$dir/ca.key
default_md        = sha256
default_days      = $DAYS_LEAF
default_crl_days  = 30
policy            = policy_any
unique_subject    = no
copy_extensions   = none
preserve          = no

[ policy_any ]
commonName = supplied

[ leaf_ext ]
basicConstraints       = critical,CA:FALSE
keyUsage               = critical,digitalSignature,nonRepudiation
subjectAltName         = email:signer@bundesanzeiger-jahresabschluss.test
crlDistributionPoints  = URI:$CRL_URL
subjectKeyIdentifier   = hash
EOF

echo "[crl] CA erzeugen …"
openssl req -x509 -newkey rsa:2048 -sha256 -days "$DAYS_CA" -nodes \
  -keyout ca.key -out ca.crt -subj "/C=DE/O=Bundesanzeiger Jahresabschluss (TEST)/CN=Test-CA" 

# --- Leaf 1: gueltig --------------------------------------------------------
echo "[crl] Leaf-Zertifikat ausstellen …"
openssl req -newkey rsa:2048 -nodes -keyout leaf.key -out leaf.csr \
  -subj "/C=DE/O=Bundesanzeiger Jahresabschluss (TEST)/CN=Bundesanzeiger Test-Signer" 
openssl ca -batch -config openssl.cnf -in leaf.csr -out leaf.crt \
  -extfile openssl.cnf -extensions leaf_ext 

# --- Leaf 2: gleiche Seriennummer, spaeter gesperrt ------------------------
# openssl ca vergibt selbst eine Seriennummer; fuer den Sperrtest wird das
# Leaf spaeter per `openssl ca -revoke` gesperrt und die CRL neu erzeugt.
echo "[crl] CRL ohne Sperrung erzeugen …"
openssl ca -config openssl.cnf -gencrl -out crl-empty.pem 

# --- Leaf sperren und zweite CRL erzeugen -----------------------------------
echo "[crl] Leaf sperren und CRL mit Sperrung erzeugen …"
openssl ca -config openssl.cnf -revoke leaf.crt 
openssl ca -config openssl.cnf -gencrl -out crl-revoked.pem 

# Leaf-Zertifikat fuer den "gesperrt"-Fall wieder aus der DB lesen (bleibt gueltig)
cp leaf.crt revoked-leaf.crt

# --- Fremd-CA: CRL mit derselben Seriennummer, aber fremder Signatur -------
# Angriffsszenario: jemand schiebt eine untergeschobene CRL unter, die
# "nicht gesperrt" behauptet. Sie ist mit einem ANDEREN Schluessel signiert;
# die Signaturpruefung muss sie zurueckweisen. Ein frisch generiertes
# Fremd-CRL reicht dafuer — entscheidend ist die Signatur, nicht der Inhalt.
echo "[crl] Fremd-CA fuer das Angriffsszenario erzeugen …"
openssl req -x509 -newkey rsa:2048 -sha256 -days "$DAYS_CA" -nodes \
  -keyout fake.key -out fake.crt \
  -subj "/C=DE/O=Bundesanzeiger Jahresabschluss (TEST)/CN=Test-CA" 

mkdir -p fakeca/newcerts
cp openssl.cnf fake-ca.cnf
sed -i 's|^dir .*|dir               = ./fakeca|; s|^database .*|database          = $dir/index.txt|; s|^new_certs_dir .*|new_certs_dir     = $dir/newcerts|; s|^serial .*|serial            = $dir/serial|; s|^crlnumber .*|crlnumber         = $dir/crlnumber|; s|^certificate .*|certificate       = ./fake.crt|; s|^private_key .*|private_key       = ./fake.key|' fake-ca.cnf
echo 2000 > fakeca/serial
echo 2000 > fakeca/crlnumber
: > fakeca/index.txt
: > fakeca/index.txt.attr
openssl ca -config fake-ca.cnf -gencrl -out crl-fake.pem 

# --- Seriennummer des Leaf ausgeben (fuer die Tests) -----------------------
SERIAL=$(openssl x509 -in leaf.crt -noout -serial | cut -d= -f2)
echo "$SERIAL" > leaf-serial.txt

echo
echo "[crl] fertig. Verzeichnis: $OUT_DIR"
echo "[crl] Leaf-Seriennummer: $SERIAL"
ls -1 "$OUT_DIR"/*.pem "$OUT_DIR"/*.crt 2>/dev/null | sed 's|.*/|  |'
