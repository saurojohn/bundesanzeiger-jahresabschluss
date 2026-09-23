# DEPLOY-PILOT — Hetzner VPS Setup

> **Zweck**: Schritt-für-Schritt-Anleitung zur Bereitstellung der Pilot-Instanz
> auf einem Hetzner Cloud VPS. Production-Hardening: Ubuntu 24.04 + Docker +
> nginx + fail2ban + automatische Backups.

**Ziel-Hardware**: Hetzner Cloud CX22 (4 vCPU, 8 GB RAM, 80 GB SSD) — ca. € 11/Monat

**Voraussetzungen**:
- Hetzner Cloud Account
- SSH-Key generiert
- Domain oder Subdomain (z. B. `pilot.banz-jahresabschluss.example`)
- DNS A-Record auf VPS-IP
- Let's-Encrypt-Wildcard-Cert oder Single-Domain-Cert

---

## 1. VPS Provisioning

### 1.1 Hetzner Cloud Console

1. **Neuer Server** → Ubuntu 24.04 → CX22
2. **SSH-Key** auswählen
3. **Standort**: Falkenstein (DC1) oder Nürnberg (DC2) — DSGVO-konform
4. **Backups**: aktivieren (+20% Kostet, ca. € 2)
5. **Netzwerk**: IPv4 + IPv6
6. **Cloud-init**: leer (keine Sonderkonfiguration)
7. **Name**: `banz-pilot-01`
8. **Erstellen**

Nach Bereitstellung: VPS-IP notieren (z. B. `78.46.123.45`).

### 1.2 DNS-Records

```
A    pilot.banz-jahresabschluss.example    78.46.123.45
AAAA pilot.banz-jahresabschluss.example    2a01:4f8:1c1c:abcd::1
```

DNS-Propagation abwarten (5-60 Minuten).

---

## 2. VPS-Grundkonfiguration

### 2.1 Initial Setup

```bash
# Per SSH verbinden
ssh root@78.46.123.45

# System aktualisieren
apt update && apt upgrade -y

# Nicht-Root-User anlegen
useradd -m -s /bin/bash banz
mkdir -p /home/banz/.ssh
cp ~/.ssh/authorized_keys /home/banz/.ssh/
chown -R banz:banz /home/banz/.ssh
chmod 700 /home/banz/.ssh && chmod 600 /home/banz/.ssh/authorized_keys

# Sudo-Berechtigung
usermod -aG sudo banz

# Ab jetzt als banz weiterarbeiten
su - banz
```

### 2.2 Firewall (UFW)

```bash
sudo apt install -y ufw

# Default-Policies
sudo ufw default deny incoming
sudo ufw default allow outgoing

# SSH (Standard)
sudo ufw allow 22/tcp

# HTTP/HTTPS für nginx
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Aktivieren
sudo ufw enable
sudo ufw status verbose
```

### 2.3 fail2ban

```bash
sudo apt install -y fail2ban

# Custom-Config für SSH + nginx
sudo tee /etc/fail2ban/jail.local <<'EOF'
[DEFAULT]
bantime = 1h
findtime = 10m
maxretry = 5

[sshd]
enabled = true
port = ssh
filter = sshd
logpath = /var/log/auth.log
maxretry = 3

[nginx-http-auth]
enabled = true
filter = nginx-http-auth
port = http,https
logpath = /var/log/nginx/error.log

[nginx-noscript]
enabled = true
port = http,https
filter = nginx-noscript
logpath = /var/log/nginx/access.log
maxretry = 2
EOF

sudo systemctl enable fail2ban
sudo systemctl restart fail2ban
sudo fail2ban-client status
```

---

## 3. Docker Installation

```bash
# Docker CE installieren
sudo apt install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# banz-User zur docker-Gruppe hinzufügen
sudo usermod -aG docker banz
# Neu einloggen, damit Gruppe aktiv wird

# Version prüfen
docker --version
docker compose version
```

---

## 4. Anwendung deployen

### 4.1 Repository klonen

```bash
cd /opt
sudo git clone https://github.com/<owner>/bundesanzeiger-jahresabschluss.git
sudo chown -R banz:banz bundesanzeiger-jahresabschluss
cd bundesanzeiger-jahresabschluss
```

### 4.2 Environment konfigurieren

```bash
cp .env.example .env
nano .env  # siehe unten
```

**Kritische Variablen** (siehe `.env.example` für alle):

```bash
# JWT_SECRET (256-bit, MUSS neu generiert werden!)
JWT_SECRET=$(openssl rand -hex 32)

# DB-Passwort (NICHT banz_dev_pwd in Produktion!)
POSTGRES_PASSWORD=$(openssl rand -hex 24)

# S3-Storage (Hetzner S3)
S3_ENDPOINT=https://fsn1.your-objectstorage.com
S3_ACCESS_KEY=<hetzner-s3-access-key>
S3_SECRET_KEY=<hetzner-s3-secret-key>
S3_BUCKET=banz-jahresabschluss-worm

# SMTP (für User-Invites + Passwort-Reset)
SMTP_HOST=smtp.example.com
SMTP_USER=...
SMTP_PWD=...

# Domain für CORS + Cookies
FRONTEND_URL=https://pilot.banz-jahresabschluss.example
COOKIE_DOMAIN=pilot.banz-jahresabschluss.example
COOKIE_SECURE=true
```

### 4.3 TLS-Zertifikat (Let's Encrypt)

```bash
# Certbot installieren
sudo apt install -y certbot python3-certbot-nginx

# Cert anfordern
sudo certbot --nginx -d pilot.banz-jahresabschluss.example

# Auto-Renewal testen
sudo certbot renew --dry-run
```

### 4.4 nginx Reverse Proxy

```bash
sudo tee /etc/nginx/sites-available/banz-pilot <<'EOF'
upstream banz_backend {
    server 127.0.0.1:3000;
    keepalive 32;
}

upstream banz_frontend {
    server 127.0.0.1:3001;
    keepalive 32;
}

# HTTP → HTTPS redirect
server {
    listen 80;
    listen [::]:80;
    server_name pilot.banz-jahresabschluss.example;
    return 301 https://$host$request_uri;
}

# HTTPS
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name pilot.banz-jahresabschluss.example;

    ssl_certificate /etc/letsencrypt/live/pilot.banz-jahresabschluss.example/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/pilot.banz-jahresabschluss.example/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    # Security Headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self';" always;

    # Body size limit (für File-Uploads)
    client_max_body_size 50M;

    # Frontend
    location / {
        proxy_pass http://banz_frontend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    # Backend API
    location /api/ {
        proxy_pass http://banz_backend/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
    }
}
EOF

sudo ln -s /etc/nginx/sites-available/banz-pilot /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 4.5 Stack starten

```bash
cd /opt/bundesanzeiger-jahresabschluss
docker compose -f infra/docker-compose.yml up -d

# Logs verfolgen
docker compose -f infra/docker-compose.yml logs -f

# Healthcheck
sleep 30
docker compose -f infra/docker-compose.yml ps
curl -f https://pilot.banz-jahresabschluss.example/api/health
```

### 4.6 Prisma Migration + Seed

```bash
# Backend-Container betreten
docker compose -f infra/docker-compose.yml exec backend bash

# Im Container:
cd /app
npx prisma migrate deploy
npm run prisma:seed
exit
```

---

## 5. Backup-Strategie

### 5.1 Datenbank-Backup

```bash
# Backup-Script erstellen
sudo tee /opt/banz-backup.sh <<'EOF'
#!/bin/bash
set -euo pipefail

BACKUP_DIR=/opt/backups/banz
DATE=$(date +%Y%m%d_%H%M%S)
RETENTION_DAYS=30

mkdir -p $BACKUP_DIR

# Postgres Backup
docker compose -f /opt/bundesanzeiger-jahresabschluss/infra/docker-compose.yml \
  exec -T postgres pg_dump -U banz banz_jahresabschluss | \
  gzip > $BACKUP_DIR/db-$DATE.sql.gz

# Audit-Log-Export (für IDW-PS-880)
docker compose -f /opt/bundesanzeiger-jahresabschluss/infra/docker-compose.yml \
  exec backend node -e "
    const { PrismaClient } = require('@prisma/client');
    const p = new PrismaClient();
    p.auditLog.findMany().then(entries => {
      console.log(JSON.stringify(entries, null, 2));
      process.exit(0);
    });
  " | gzip > $BACKUP_DIR/audit-$DATE.json.gz

# Alte Backups löschen
find $BACKUP_DIR -name "*.gz" -mtime +$RETENTION_DAYS -delete

echo "Backup abgeschlossen: $BACKUP_DIR"
EOF

sudo chmod +x /opt/banz-backup.sh

# Cron einrichten
(crontab -l 2>/dev/null; echo "0 2 * * * /opt/banz-backup.sh >> /var/log/banz-backup.log 2>&1") | crontab -
```

### 5.2 WORM-Storage-Backup

S3-Objekte sind bereits in Hetzner S3 Object Lock (10 Jahre Retention).
Zusätzlich: Cross-Region-Replication in andere Hetzner DC aktivieren.

```bash
# Hetzner S3 Console → banz-jahresabschluss-worm → Replication → aktivieren
# Target-Bucket: banz-jahresabschluss-worm-backup (anderes DC)
```

### 5.3 Off-Site-Backup (Notfall)

Wöchentliches Push auf Hetzner Storage Box:

```bash
# rclone konfigurieren
sudo apt install -y rclone
rclone config  # Interactive Setup für Hetzner Storage Box

# Cron: Sonntags 03:00
(crontab -l 2>/dev/null; echo "0 3 * * 0 rclone sync /opt/backups/banz hetzner-storagebox:/banz-backups --transfers 4 --checkers 8") | crontab -
```

---

## 6. Monitoring

### 6.1 Uptime-Monitoring (extern)

Empfehlung: UptimeRobot (kostenlos) oder HetrixTools

Monitors:
- `https://pilot.banz-jahresabschluss.example/api/health` (1-Minuten-Intervall)
- `https://pilot.banz-jahresabschluss.example/de-DE/login` (5-Minuten-Intervall)

### 6.2 Log-Aggregation

```bash
# Docker-Logs zentralisieren
sudo mkdir -p /var/log/banz

# Cron: alle 5 Minuten Logs zusammenführen
(crontab -l 2>/dev/null; echo "*/5 * * * * cd /opt/bundesanzeiger-jahresabschluss && docker compose -f infra/docker-compose.yml logs --since 5m > /var/log/banz/app.log 2>&1")) | crontab -
```

### 6.3 Disk-Space-Alerting

```bash
# Disk-Alert bei > 80%
sudo tee /opt/banz-disk-alert.sh <<'EOF'
#!/bin/bash
THRESHOLD=80
USAGE=$(df / | tail -1 | awk '{print $5}' | tr -d '%')
if [ $USAGE -gt $THRESHOLD ]; then
  echo "Disk usage is ${USAGE}% on $(hostname)" | \
    mail -s "Disk Alert: $(hostname)" admin@banz-jahresabschluss.example
fi
EOF
sudo chmod +x /opt/banz-disk-alert.sh

# Cron: stündlich
(crontab -l 2>/dev/null; echo "0 * * * * /opt/banz-disk-alert.sh") | crontab -
```

---

## 7. Updates deployen

```bash
cd /opt/bundesanzeiger-jahresabschluss

# Code aktualisieren
sudo git pull

# Container neu bauen + starten
docker compose -f infra/docker-compose.yml build
docker compose -f infra/docker-compose.yml up -d

# Migration
docker compose -f infra/docker-compose.yml exec backend npx prisma migrate deploy

# Healthcheck
sleep 30
curl -f https://pilot.banz-jahresabschluss.example/api/health
```

**Zero-Downtime-Rollout** (für Produktion in M4):
```bash
# Blue-Green-Deployment
docker compose -f infra/docker-compose.yml up -d --no-deps --scale backend=2
# nginx-Load-Balancing zwischen 2 Backends
# Nach erfolgreichem Healthcheck: alte Version stoppen
```

---

## 8. Disaster Recovery

### 8.1 Szenario: VPS komplett verloren

1. **Neuen VPS provisionieren** (siehe Abschnitt 1)
2. **DNS-Record umstellen** auf neue IP
3. **Repository klonen + Environment** (Schritte 4.1, 4.2)
4. **Database-Backup einspielen**:
   ```bash
   gunzip -c /backup/db-20260923_020000.sql.gz | \
     docker compose exec -T postgres psql -U banz banz_jahresabschluss
   ```
5. **WORM-Storage**: Hetzner S3 ist region-übergreifend (Replikation) → automatisch verfügbar
6. **TLS-Cert erneuern** (Certbot)
7. **Healthcheck** + Pilot-Kanzlei informieren

**RTO**: ca. 2-3 Stunden
**RPO**: max. 24 Stunden (tägliches DB-Backup)

### 8.2 Szenario: Versehentliche Daten-Mutation

```bash
# 1. User informieren
# 2. AuditLog prüfen (Vorher/Nachher-Snapshots)
docker compose exec backend node -e "
  const { PrismaClient } = require('@prisma/client');
  const p = new PrismaClient();
  p.auditLog.findMany({
    where: { entityType: 'Bilanz', entityId: '<id>' },
    orderBy: { createdAt: 'desc' },
    take: 5
  }).then(console.log);
"

# 3. Backup-Restore falls kritisch
# 4. AuditLog-Eintrag mit manueller Korrektur
```

---

## 9. Kosten-Übersicht (Pilot)

| Komponente | Kosten/Monat |
|---|---|
| Hetzner CX22 (4 vCPU, 8 GB RAM, 80 GB) | € 11 |
| Hetzner Backups (+20%) | € 2 |
| Hetzner S3 Storage (~100 GB für 1 Kanzlei + 3 Mandanten) | € 2.50 |
| Hetzner Object Lock (enthalten) | € 0 |
| Hetzner Storage Box (10 GB Off-Site-Backup) | € 1 |
| Domain (pilot.banz-jahresabschluss.example) | € 1 |
| Let's Encrypt (kostenlos) | € 0 |
| SMTP-Provider (z. B. Mailgun, 5k Mails) | € 0 |
| UptimeRobot (kostenlos) | € 0 |
| **Summe Pilot** | **~€ 17.50/Monat** |

Für M3 (Konzern + 5 Kanzleien):
- CX32 (8 vCPU, 16 GB): € 22
- S3 Storage (~500 GB): € 12.50
- Summe: ~€ 40/Monat

Für M4 (Production, 50+ Kanzleien):
- CCX63 (48 vCPU, 192 GB): € 320
- S3 Storage (~5 TB): € 125
- Multi-VM-Cluster
- Summe: ~€ 600/Monat + DB + Redis + Load-Balancer

---

## 10. Anhang: Notfall-Kontakte

| Rolle | Kontakt |
|---|---|
| Hetzner Support | https://www.hetzner.com/support |
| Let's Encrypt Community | https://community.letsencrypt.org/ |
| Intern: DevOps | devops@banz-jahresabschluss.example |
| Intern: Sicherheit | security@banz-jahresabschluss.example |

---

**Bereitstellungsdauer**: ca. 90 Minuten (VPS + DNS-Propagation + Backups)
**RTO**: 2-3 Stunden (Disaster Recovery)
**RPO**: 24 Stunden (tägliches Backup)

**Nächste Schritte**: Pilot-Kanzlei onboarden (siehe RUNBOOK.md §4) → 14 Tage Pilot-Phase → M2-Entwicklung starten (BAnz XML/XBRL)