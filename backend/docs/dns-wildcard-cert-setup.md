# DNS-Wildcard-Zertifikat — Setup-Dokumentation (M4 Sprint 0 Vorbereitung)

> **Zweck**: Wildcard-SSL-Zertifikate (`*.kanzlei-domain.de`) für
> Custom-Domain-Support im M4 Production-Tier. Ermöglicht jeder Kanzlei,
> ihre eigene Subdomain (z.B. `muster-kanzlei.kanzlei-bw.de`) per CNAME
> auf unsere Production-Infrastruktur zu zeigen.

> **Status**: Vorbereitung Sprint 0 — Setup-Dokumentation. Tatsächlicher
> Roll-out in M4 Sprint 3 (Subscription + White-Label-Production).

---

## 1. Übersicht

### Was ist ein Wildcard-Zertifikat?

Ein SSL/TLS-Zertifikat, das für `*.example.com` ausgestellt ist und damit
**alle Subdomains** (`a.example.com`, `b.example.com`, ...) absichert.
Voraussetzung: **DNS-01-Challenge** bei Let's Encrypt (HTTP-01 reicht
für Wildcards nicht).

### Anwendungsfall im Projekt

Jede Kanzlei soll ihre eigene Subdomain bekommen:
- `muster-kanzlei.banz-jahresabschluss.de` (Default, gehostet von uns)
- `abschluss.muster-kanzlei.de` (Custom, CNAME auf unsere Infrastruktur)

Das Wildcard-Cert deckt die Default-Domain ab; für Custom-Domains
erstellt jede Kanzlei ihr eigenes Cert (out-of-scope für Sprint 0).

---

## 2. Let's Encrypt DNS-01 Challenge

### Voraussetzungen

- Eigene DNS-Zone für `banz-jahresabschluss.de` (oder gewählte Domain)
- API-Zugang zum DNS-Provider (für automatisches `_acme-challenge`-Setzen)
- `certbot` (https://certbot.eff.org) + passendes Plugin

### Certbot-Installation (Debian/Ubuntu)

```bash
sudo apt-get update
sudo apt-get install certbot
```

### Unterstützte DNS-Plugins

| Provider      | Plugin                        | API-Token-Variable                  |
| ------------- | ----------------------------- | ----------------------------------- |
| Cloudflare    | `certbot-dns-cloudflare`      | `CF_API_TOKEN`                      |
| Hetzner DNS   | `certbot-dns-hetzner`         | `HETZNER_DNS_API_TOKEN`             |
| AWS Route 53  | `certbot-dns-route53`         | IAM-Role oder `AWS_ACCESS_KEY_ID`   |
| Gandi        | `certbot-dns-gandi`           | `GANDI_API_KEY`                     |

Für das Projekt empfehlen wir **Hetzner DNS** (DSGVO-konform, EU-Hosted,
günstig) — alternative Cloudflare für internationale Kanzleien.

### Wildcard-Cert ausstellen (Hetzner DNS)

```bash
# 1. API-Token besorgen (Hetzner DNS Console → API-Tokens)
export HETZNER_DNS_API_TOKEN="<token>"

# 2. Certbot mit Hetzner-Plugin
sudo certbot certonly \
  --dns-hetzner \
  --dns-hetzner-credentials ~/.secrets/hetzner.ini \
  -d "banz-jahresabschluss.de" \
  -d "*.banz-jahresabschluss.de" \
  --email "ops@shleder-gmbh.de" \
  --agree-tos \
  --no-eff-email \
  --server https://acme-v02.api.letsencrypt.org/directory
```

### Cloudflare-Variante

```bash
# Cloudflare API-Token (Zone:DNS:Edit für die Zone)
export CF_API_TOKEN="<token>"

echo "dns_cloudflare_api_token = ${CF_API_TOKEN}" > ~/.secrets/cloudflare.ini
chmod 600 ~/.secrets/cloudflare.ini

sudo certbot certonly \
  --dns-cloudflare \
  --dns-cloudflare-credentials ~/.secrets/cloudflare.ini \
  -d "banz-jahresabschluss.de" \
  -d "*.banz-jahresabschluss.de" \
  --email "ops@shleder-gmbh.de" \
  --agree-tos \
  --no-eff-email
```

### Resultat

```text
/etc/letsencrypt/live/banz-jahresabschluss.de/
├── fullchain.pem     ← Zertifikatskette (Certbot intermediate)
├── privkey.pem       ← Private Key (SICHERHEITSRELEVANT — chmod 600!)
├── cert.pem          ← Nur das Cert (selten benötigt)
└── chain.pem         ← Intermediate-Chain
```

---

## 3. NGINX-Konfiguration

```nginx
# /etc/nginx/sites-available/banz-jahresabschluss.conf
server {
    listen 443 ssl http2;
    server_name *.banz-jahresabschluss.de banz-jahresabschluss.de;

    ssl_certificate     /etc/letsencrypt/live/banz-jahresabschluss.de/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/banz-jahresabschluss.de/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;

    # HSTS — 6 Monate (GoBD-konform, aber bewusst kurz für Pilot-Phase)
    add_header Strict-Transport-Security "max-age=15768000" always;

    # Security-Header
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header Referrer-Policy "strict-origin-when-cross-origin";

    # → Backend
    location / {
        proxy_pass         http://banz-backend:3000;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }
}

# HTTP → HTTPS
server {
    listen 80;
    server_name *.banz-jahresabschluss.de banz-jahresabschluss.de;
    return 301 https://$host$request_uri;
}
```

Cert + Key in den NGINX-Container mounten:

```yaml
# docker-compose.prod.yml (Auszug)
nginx:
  volumes:
    - /etc/letsencrypt:/etc/letsencrypt:ro
    - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
```

---

## 4. Auto-Renewal

Let's Encrypt-Certs laufen nach 90 Tagen ab. certbot bietet einen
Systemd-Timer für automatisches Renewal.

### Systemd-Timer aktivieren

```bash
# certbot installiert standardmäßig:
sudo systemctl enable certbot.timer
sudo systemctl start certbot.timer

# Status prüfen
sudo systemctl status certbot.timer
systemctl list-timers | grep certbot
```

### Pre-Renewal-Hook (NGINX reload)

```bash
# /etc/letsencrypt/renewal-hooks/pre/nginx-reload.sh
#!/bin/bash
docker exec banz-nginx nginx -s reload
```

```bash
chmod +x /etc/letsencrypt/renewal-hooks/pre/nginx-reload.sh
```

### Test-Renewal

```bash
sudo certbot renew --dry-run
```

Erwartung: `Congratulations, all simulated renewals succeeded`.

---

## 5. Troubleshooting

### 5.1 "Rate-Limit erreicht"

Let's Encrypt begrenzt Zertifikatsausstellungen:
- 50 Certs pro registrierter Domain pro Woche
- 5 Duplicate-Certs pro Woche
- 5 Accounts pro IP-Adresse

**Lösung**: Staging-Environment für Tests verwenden
(`--server https://acme-staging-v02.api.letsencrypt.org/directory`).

### 5.2 DNS-Propagation

`_acme-challenge.banz-jahresabschluss.de` muss global auflösbar sein,
bevor Let's Encrypt validiert. DNS-Provider brauchen unterschiedlich
lange für Propagation:

| Provider    | TTL   | Propagation-Zeit |
| ----------- | ----- | ---------------- |
| Cloudflare  | Auto  | < 60 Sekunden    |
| Hetzner DNS | 300s  | < 5 Minuten      |
| AWS Route 53 | 300s | < 5 Minuten      |

### 5.3 Permission Denied auf privkey.pem

NGINX muss den Key lesen können:

```bash
# Certbot speichert mit mode 0644; privkey.pem sollte mode 0640 sein
sudo chmod 0640 /etc/letsencrypt/live/banz-jahresabschluss.de/privkey.pem
sudo chown root:nginx /etc/letsencrypt/live/banz-jahresabschluss.de/privkey.pem
```

### 5.4 ACME-Challenge schlägt fehl (NXDOMAIN)

DNS-Provider-API nicht authorisiert für die Zone. Lösung:
- API-Token mit korrekten Zone-Berechtigungen erstellen
- Bei Hetzner: Token muss Schreibzugriff auf die Zone haben
- Bei Cloudflare: Zone:DNS:Edit-Scope

### 5.5 Wildcard wird nicht akzeptiert

Let's Encrypt erfordert explizit `*.example.com` (mit `*.` Prefix).
Manche ACME-Clients escapen das falsch — der `certbot`-Befehl oben
verwendet den korrekten Syntax.

---

## 6. Sicherheits-Hinweise

1. **privkey.pem ist SECRET**: Niemals committen, niemals per E-Mail
   versenden. Backup in verschlüsseltem Storage (z.B. Hetzner Storage Box
   mit Borg-Verschlüsselung).
2. **API-Tokens** für DNS-Provider: getrennt von Cert-Storage aufbewahren
   (z.B. Hashicorp Vault, Bitwarden).
3. **OCSP-Stapling** in NGINX aktivieren für Performance + Privacy:
   ```nginx
   ssl_stapling on;
   ssl_stapling_verify on;
   resolver 1.1.1.1 8.8.8.8 valid=300s;
   ```
4. **Cert-Pinning** in Mobile-Apps (M4 Sprint 4) muss erneuert werden,
   wenn Wildcard-Cert rotiert wird.

---

## 7. Referenzen

- Let's Encrypt Dokumentation: https://letsencrypt.org/docs/
- Certbot DNS-Plugins: https://eff-certbot.readthedocs.io/en/latest/using.html#dns-plugins
- NGINX SSL-Modul: https://nginx.org/en/docs/http/ngx_http_ssl_module.html
- Mozilla SSL-Config-Generator: https://ssl-config.mozilla.org/