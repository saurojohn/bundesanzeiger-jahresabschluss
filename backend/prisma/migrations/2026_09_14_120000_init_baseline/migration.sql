-- ============================================================================
-- Migration: init_baseline (NACHGETRAGT)
-- Datum: 2026-09-14
--
-- Warum diese Datei nachträglich erstellt wurde:
--   Das Repository enthielt bis 2026-09-28 NUR die M4-Migration
--   (2026_09_25_m4_production_schema), die ausschliesslich ALTER TABLE
--   kanzlei / audit_log ausfuehrt. Diese Tabellen wurden nie erstellt —
--   `prisma migrate deploy` auf einer leeren DB schlug deshalb fehl.
--
-- Inhalt:
--   Vollstaendiges Baseline-Schema fuer alle 27 Modelle aus
--   prisma/schema.prisma (27 CREATE TABLE + 84 CREATE INDEX), erzeugt via:
--     npx prisma migrate diff --from-empty \
--       --to-schema-datamodel prisma/schema.prisma --script
--
-- Reihenfolge:
--   Diese Migration muss VOR 2026_09_25_m4_production_schema laufen.
--   Die M4-Migration nutzt ausschliesslich ADD COLUMN IF NOT EXISTS und ist
--   damit idempotent: da schema.prisma die M4-Spalten bereits enthaelt, sind
--   ihre ALTERs nach diesem Baseline No-Ops. COMMENT/UPDATE-Statements in der
--   M4-Migration bleiben schadlos (neue Zeilen sind bereits vorbelegt).
--
-- Erzeugt mit: prisma migrate diff (deterministisch, kein DB noetig)
-- ============================================================================

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateTable
CREATE TABLE "kanzlei" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "rechtsform" TEXT NOT NULL,
    "adresse" JSONB NOT NULL,
    "ustId" TEXT,
    "logoUrl" TEXT,
    "logoWormKey" TEXT,
    "primaryColor" TEXT DEFAULT '#2563eb',
    "accentColor" TEXT DEFAULT '#0ea5e9',
    "customDomain" TEXT,
    "customDomainVerified" BOOLEAN NOT NULL DEFAULT false,
    "brandingUpdatedAt" TIMESTAMP(3),
    "brandingUpdatedById" UUID,
    "subscriptionTier" TEXT DEFAULT 'PILOT',
    "subscriptionStatus" TEXT DEFAULT 'TRIALING',
    "subscriptionProvider" TEXT DEFAULT 'mock',
    "subscriptionProviderId" TEXT,
    "subscriptionPeriodEnd" TIMESTAMP(3),
    "subscriptionCancelAtEnd" BOOLEAN NOT NULL DEFAULT false,
    "providerCustomerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kanzlei_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mandant" (
    "id" UUID NOT NULL,
    "kanzleiId" UUID NOT NULL,
    "firmenname" TEXT NOT NULL,
    "rechtsform" TEXT NOT NULL,
    "handelsregister" TEXT,
    "ustId" TEXT,
    "adresse" JSONB NOT NULL,
    "geschaeftsfuehrer" JSONB NOT NULL,
    "gruendungsdatum" TIMESTAMP(3),
    "bilanzsummeVorjahr" DECIMAL(18,2),
    "umsatzVorjahr" DECIMAL(18,2),
    "mitarbeiterAnzahl" INTEGER,
    "groessenklasse" TEXT NOT NULL,
    "publishChannel" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mandant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user" (
    "id" UUID NOT NULL,
    "kanzleiId" UUID,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "vorname" TEXT NOT NULL,
    "nachname" TEXT NOT NULL,
    "telefon" TEXT,
    "totpSecret" TEXT,
    "totpEnabled" BOOLEAN NOT NULL DEFAULT false,
    "mfaRecoveryCodes" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "lastLoginIp" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "globalRole" TEXT NOT NULL DEFAULT 'USER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_session" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_mandant_role" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "mandantId" UUID NOT NULL,
    "rolle" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grantedById" UUID,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "user_mandant_role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bilanz" (
    "id" UUID NOT NULL,
    "mandantId" UUID NOT NULL,
    "geschaeftsjahr" INTEGER NOT NULL,
    "erstelltAm" TIMESTAMP(3),
    "gueltigBis" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "hinweise" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "bilanz_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bilanz_position" (
    "id" UUID NOT NULL,
    "bilanzId" UUID NOT NULL,
    "seite" TEXT NOT NULL,
    "kontonummer" TEXT NOT NULL,
    "bezeichnung" TEXT NOT NULL,
    "betragVorjahr" DECIMAL(18,2),
    "betragAktuell" DECIMAL(18,2) NOT NULL,
    "reihenfolge" INTEGER NOT NULL,
    "bemerkung" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bilanz_position_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guv" (
    "id" UUID NOT NULL,
    "mandantId" UUID NOT NULL,
    "bilanzId" UUID,
    "geschaeftsjahr" INTEGER NOT NULL,
    "verfahren" TEXT NOT NULL DEFAULT 'GKV',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "hinweise" TEXT,
    "ergebnis" DECIMAL(18,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "guv_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guv_position" (
    "id" UUID NOT NULL,
    "guvId" UUID NOT NULL,
    "kontonummer" TEXT NOT NULL,
    "bezeichnung" TEXT NOT NULL,
    "kategorie" TEXT NOT NULL,
    "betragVorjahr" DECIMAL(18,2),
    "betragAktuell" DECIMAL(18,2) NOT NULL,
    "reihenfolge" INTEGER NOT NULL,
    "bemerkung" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guv_position_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "anhang" (
    "id" UUID NOT NULL,
    "mandantId" UUID NOT NULL,
    "geschaeftsjahr" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "bilanzierungsMethoden" TEXT,
    "bewertungsMethoden" TEXT,
    "sonstigePflichtangaben" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "anhang_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "anhang_abschnitt" (
    "id" UUID NOT NULL,
    "anhangId" UUID NOT NULL,
    "titel" TEXT NOT NULL,
    "inhalt" TEXT NOT NULL,
    "reihenfolge" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "anhang_abschnitt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jahresabschluss" (
    "id" UUID NOT NULL,
    "mandantId" UUID NOT NULL,
    "geschaeftsjahr" INTEGER NOT NULL,
    "bilanzId" UUID NOT NULL,
    "guvId" UUID NOT NULL,
    "anhangId" UUID NOT NULL,
    "lageberichtId" UUID,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "finalisiertAm" TIMESTAMP(3),
    "signiertAm" TIMESTAMP(3),
    "eingereichtAm" TIMESTAMP(3),
    "veroeffentlichtAm" TIMESTAMP(3),
    "banzBestellnummer" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "finalizedById" UUID,

    CONSTRAINT "jahresabschluss_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signature" (
    "id" UUID NOT NULL,
    "jahresabschlussId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "rolle" TEXT NOT NULL,
    "signaturTyp" TEXT NOT NULL,
    "zertifikatSubject" TEXT,
    "zertifikatIssuer" TEXT,
    "zertifikatSeriennummer" TEXT,
    "zertifikatGueltigAb" TIMESTAMP(3),
    "zertifikatGueltigBis" TIMESTAMP(3),
    "zeitstempel" TIMESTAMP(3) NOT NULL,
    "zeitstempelIssuer" TEXT,
    "hashVorher" TEXT NOT NULL,
    "hashNachher" TEXT NOT NULL,
    "signaturDaten" BYTEA NOT NULL,
    "signaturFormat" TEXT NOT NULL DEFAULT 'PKCS7',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "signature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "banz_submission" (
    "id" UUID NOT NULL,
    "jahresabschlussId" UUID NOT NULL,
    "mandantId" UUID NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PREPARED',
    "preparedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "banzVorgangsnummer" TEXT,
    "banzBestellnummer" TEXT,
    "rawPayload" BYTEA NOT NULL,
    "payloadFormat" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "banzResponse" JSONB,
    "errorMessage" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" UUID,

    CONSTRAINT "banz_submission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "worm_object" (
    "id" UUID NOT NULL,
    "objectKey" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" UUID NOT NULL,
    "mandantId" UUID NOT NULL,
    "sha256Hash" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "objectLockMode" TEXT NOT NULL,
    "retentionDays" INTEGER NOT NULL,
    "retentionExpiresAt" TIMESTAMP(3) NOT NULL,
    "uploadedById" UUID,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "legalHold" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "worm_object_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "kanzleiId" UUID,
    "mandantId" UUID,
    "userId" UUID,
    "jahresabschlussId" UUID,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "previousState" JSONB,
    "newState" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "geoLocation" TEXT,
    "entryHash" TEXT,
    "prevHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_config" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "description" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "konsolidierungs_einheit" (
    "id" UUID NOT NULL,
    "kanzleiId" UUID NOT NULL,
    "mutterMandantId" UUID NOT NULL,
    "tochterMandantIds" TEXT[],
    "geschaeftsjahr" INTEGER NOT NULL,
    "konsolidierungsArt" TEXT NOT NULL DEFAULT 'VOLLKONSOLIDIERUNG',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "konzernBilanzId" UUID,
    "konzernGuvId" UUID,
    "beteiligungsquote" DECIMAL(5,2) NOT NULL,
    "anschaffungskosten" DECIMAL(18,2) NOT NULL,
    "eigenkapitalTochter" DECIMAL(18,2) NOT NULL,
    "jahresueberschussTochter" DECIMAL(18,2) NOT NULL,
    "erstellungsdatum" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalisiertAm" TIMESTAMP(3),
    "finalisiertVonId" UUID,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "konsolidierungs_einheit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "konsolidierungs_buchung" (
    "id" UUID NOT NULL,
    "einheitId" UUID NOT NULL,
    "buchungsArt" TEXT NOT NULL,
    "beschreibung" TEXT NOT NULL,
    "kontoSoll" TEXT NOT NULL,
    "kontoHaben" TEXT NOT NULL,
    "betrag" DECIMAL(18,2) NOT NULL,
    "mandantId" UUID,
    "bezugId" UUID,
    "reihenfolge" INTEGER NOT NULL,
    "istAutomatisch" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "konsolidierungs_buchung_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wp_notiz" (
    "id" UUID NOT NULL,
    "bilanzId" UUID,
    "guvId" UUID,
    "bilanzPositionId" UUID,
    "guvPositionId" UUID,
    "wpUserId" UUID NOT NULL,
    "notizText" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedById" UUID,

    CONSTRAINT "wp_notiz_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pruefungs_regel" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "beschreibung" TEXT NOT NULL,
    "schweregrad" TEXT NOT NULL DEFAULT 'WARNUNG',
    "istAktiv" BOOLEAN NOT NULL DEFAULT true,
    "konfiguration" JSONB NOT NULL,
    "reihenfolge" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "pruefungs_regel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bilanz_pruefungs_result" (
    "id" UUID NOT NULL,
    "bilanzId" UUID NOT NULL,
    "guvId" UUID,
    "regelCode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "berechneterWert" DECIMAL(18,4),
    "schwellwert" DECIMAL(18,4),
    "meldung" TEXT NOT NULL,
    "geprueftAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bilanz_pruefungs_result_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wp_pruefungs_abschluss" (
    "id" UUID NOT NULL,
    "bilanzId" UUID NOT NULL,
    "guvId" UUID,
    "wpUserId" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "zusammenfassung" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "finalisierungAm" TIMESTAMP(3),
    "finalisierungVonId" UUID,

    CONSTRAINT "wp_pruefungs_abschluss_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_key" (
    "id" UUID NOT NULL,
    "kanzleiId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "scopes" TEXT[],
    "rateLimit" INTEGER NOT NULL DEFAULT 1000,
    "expiresAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "revokedAt" TIMESTAMP(3),
    "revokedById" UUID,

    CONSTRAINT "api_key_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_key_usage" (
    "id" UUID NOT NULL,
    "apiKeyId" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "responseTimeMs" INTEGER,

    CONSTRAINT "api_key_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_subscription" (
    "id" UUID NOT NULL,
    "kanzleiId" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "events" TEXT[],
    "secret" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "lastDeliveryAt" TIMESTAMP(3),
    "lastDeliveryStatus" INTEGER,

    CONSTRAINT "webhook_subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_delivery" (
    "id" UUID NOT NULL,
    "subscriptionId" UUID NOT NULL,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "responseCode" INTEGER,
    "responseBody" TEXT,
    "errorMessage" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "nextRetryAt" TIMESTAMP(3),

    CONSTRAINT "webhook_delivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "kanzlei_customDomain_key" ON "kanzlei"("customDomain");

-- CreateIndex
CREATE INDEX "kanzlei_customDomain_idx" ON "kanzlei"("customDomain");

-- CreateIndex
CREATE INDEX "mandant_kanzleiId_idx" ON "mandant"("kanzleiId");

-- CreateIndex
CREATE INDEX "mandant_groessenklasse_idx" ON "mandant"("groessenklasse");

-- CreateIndex
CREATE INDEX "mandant_kanzleiId_groessenklasse_idx" ON "mandant"("kanzleiId", "groessenklasse");

-- CreateIndex
CREATE INDEX "mandant_kanzleiId_publishChannel_idx" ON "mandant"("kanzleiId", "publishChannel");

-- CreateIndex
CREATE UNIQUE INDEX "mandant_kanzleiId_firmenname_key" ON "mandant"("kanzleiId", "firmenname");

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "user_session_refreshTokenHash_key" ON "user_session"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "user_session_userId_idx" ON "user_session"("userId");

-- CreateIndex
CREATE INDEX "user_session_expiresAt_idx" ON "user_session"("expiresAt");

-- CreateIndex
CREATE INDEX "user_mandant_role_userId_idx" ON "user_mandant_role"("userId");

-- CreateIndex
CREATE INDEX "user_mandant_role_mandantId_idx" ON "user_mandant_role"("mandantId");

-- CreateIndex
CREATE UNIQUE INDEX "user_mandant_role_userId_mandantId_rolle_key" ON "user_mandant_role"("userId", "mandantId", "rolle");

-- CreateIndex
CREATE INDEX "bilanz_mandantId_idx" ON "bilanz"("mandantId");

-- CreateIndex
CREATE INDEX "bilanz_status_idx" ON "bilanz"("status");

-- CreateIndex
CREATE INDEX "bilanz_mandantId_status_geschaeftsjahr_idx" ON "bilanz"("mandantId", "status", "geschaeftsjahr" DESC);

-- CreateIndex
CREATE INDEX "bilanz_mandantId_geschaeftsjahr_idx" ON "bilanz"("mandantId", "geschaeftsjahr" DESC);

-- CreateIndex
CREATE INDEX "bilanz_createdAt_idx" ON "bilanz"("createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "bilanz_mandantId_geschaeftsjahr_key" ON "bilanz"("mandantId", "geschaeftsjahr");

-- CreateIndex
CREATE INDEX "bilanz_position_bilanzId_idx" ON "bilanz_position"("bilanzId");

-- CreateIndex
CREATE INDEX "bilanz_position_seite_idx" ON "bilanz_position"("seite");

-- CreateIndex
CREATE INDEX "guv_mandantId_idx" ON "guv"("mandantId");

-- CreateIndex
CREATE INDEX "guv_mandantId_status_geschaeftsjahr_idx" ON "guv"("mandantId", "status", "geschaeftsjahr" DESC);

-- CreateIndex
CREATE INDEX "guv_mandantId_geschaeftsjahr_idx" ON "guv"("mandantId", "geschaeftsjahr" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "guv_mandantId_geschaeftsjahr_key" ON "guv"("mandantId", "geschaeftsjahr");

-- CreateIndex
CREATE INDEX "guv_position_guvId_idx" ON "guv_position"("guvId");

-- CreateIndex
CREATE INDEX "guv_position_kategorie_idx" ON "guv_position"("kategorie");

-- CreateIndex
CREATE INDEX "anhang_mandantId_geschaeftsjahr_idx" ON "anhang"("mandantId", "geschaeftsjahr" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "anhang_mandantId_geschaeftsjahr_key" ON "anhang"("mandantId", "geschaeftsjahr");

-- CreateIndex
CREATE INDEX "anhang_abschnitt_anhangId_idx" ON "anhang_abschnitt"("anhangId");

-- CreateIndex
CREATE INDEX "jahresabschluss_mandantId_idx" ON "jahresabschluss"("mandantId");

-- CreateIndex
CREATE INDEX "jahresabschluss_status_idx" ON "jahresabschluss"("status");

-- CreateIndex
CREATE UNIQUE INDEX "jahresabschluss_mandantId_geschaeftsjahr_key" ON "jahresabschluss"("mandantId", "geschaeftsjahr");

-- CreateIndex
CREATE INDEX "signature_jahresabschlussId_idx" ON "signature"("jahresabschlussId");

-- CreateIndex
CREATE INDEX "signature_userId_idx" ON "signature"("userId");

-- CreateIndex
CREATE INDEX "banz_submission_jahresabschlussId_idx" ON "banz_submission"("jahresabschlussId");

-- CreateIndex
CREATE INDEX "banz_submission_mandantId_idx" ON "banz_submission"("mandantId");

-- CreateIndex
CREATE INDEX "banz_submission_status_idx" ON "banz_submission"("status");

-- CreateIndex
CREATE INDEX "banz_submission_channel_idx" ON "banz_submission"("channel");

-- CreateIndex
CREATE UNIQUE INDEX "worm_object_objectKey_key" ON "worm_object"("objectKey");

-- CreateIndex
CREATE INDEX "worm_object_entityType_entityId_idx" ON "worm_object"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "worm_object_mandantId_idx" ON "worm_object"("mandantId");

-- CreateIndex
CREATE INDEX "worm_object_retentionExpiresAt_idx" ON "worm_object"("retentionExpiresAt");

-- CreateIndex
CREATE INDEX "worm_object_entityType_entityId_uploadedAt_idx" ON "worm_object"("entityType", "entityId", "uploadedAt" DESC);

-- CreateIndex
CREATE INDEX "worm_object_mandantId_retentionExpiresAt_idx" ON "worm_object"("mandantId", "retentionExpiresAt");

-- CreateIndex
CREATE INDEX "audit_log_kanzleiId_createdAt_idx" ON "audit_log"("kanzleiId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_log_mandantId_createdAt_idx" ON "audit_log"("mandantId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_log_userId_createdAt_idx" ON "audit_log"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_log_entityType_entityId_idx" ON "audit_log"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_log_action_idx" ON "audit_log"("action");

-- CreateIndex
CREATE INDEX "audit_log_kanzleiId_action_createdAt_idx" ON "audit_log"("kanzleiId", "action", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "audit_log_mandantId_action_createdAt_idx" ON "audit_log"("mandantId", "action", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "audit_log_entityType_entityId_createdAt_idx" ON "audit_log"("entityType", "entityId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "audit_log_createdAt_entryHash_idx" ON "audit_log"("createdAt" DESC, "entryHash");

-- CreateIndex
CREATE UNIQUE INDEX "system_config_key_key" ON "system_config"("key");

-- CreateIndex
CREATE INDEX "konsolidierungs_einheit_kanzleiId_idx" ON "konsolidierungs_einheit"("kanzleiId");

-- CreateIndex
CREATE INDEX "konsolidierungs_einheit_status_idx" ON "konsolidierungs_einheit"("status");

-- CreateIndex
CREATE UNIQUE INDEX "konsolidierungs_einheit_mutterMandantId_geschaeftsjahr_key" ON "konsolidierungs_einheit"("mutterMandantId", "geschaeftsjahr");

-- CreateIndex
CREATE INDEX "konsolidierungs_buchung_einheitId_idx" ON "konsolidierungs_buchung"("einheitId");

-- CreateIndex
CREATE INDEX "konsolidierungs_buchung_buchungsArt_idx" ON "konsolidierungs_buchung"("buchungsArt");

-- CreateIndex
CREATE INDEX "konsolidierungs_buchung_einheitId_buchungsArt_idx" ON "konsolidierungs_buchung"("einheitId", "buchungsArt");

-- CreateIndex
CREATE INDEX "wp_notiz_bilanzId_idx" ON "wp_notiz"("bilanzId");

-- CreateIndex
CREATE INDEX "wp_notiz_guvId_idx" ON "wp_notiz"("guvId");

-- CreateIndex
CREATE INDEX "wp_notiz_wpUserId_idx" ON "wp_notiz"("wpUserId");

-- CreateIndex
CREATE INDEX "wp_notiz_status_idx" ON "wp_notiz"("status");

-- CreateIndex
CREATE INDEX "wp_notiz_bilanzPositionId_status_idx" ON "wp_notiz"("bilanzPositionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "pruefungs_regel_code_key" ON "pruefungs_regel"("code");

-- CreateIndex
CREATE INDEX "bilanz_pruefungs_result_bilanzId_idx" ON "bilanz_pruefungs_result"("bilanzId");

-- CreateIndex
CREATE INDEX "bilanz_pruefungs_result_status_idx" ON "bilanz_pruefungs_result"("status");

-- CreateIndex
CREATE INDEX "bilanz_pruefungs_result_status_geprueftAm_idx" ON "bilanz_pruefungs_result"("status", "geprueftAm" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "bilanz_pruefungs_result_bilanzId_regelCode_key" ON "bilanz_pruefungs_result"("bilanzId", "regelCode");

-- CreateIndex
CREATE INDEX "wp_pruefungs_abschluss_bilanzId_idx" ON "wp_pruefungs_abschluss"("bilanzId");

-- CreateIndex
CREATE INDEX "wp_pruefungs_abschluss_status_idx" ON "wp_pruefungs_abschluss"("status");

-- CreateIndex
CREATE INDEX "wp_pruefungs_abschluss_bilanzId_status_idx" ON "wp_pruefungs_abschluss"("bilanzId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "api_key_keyId_key" ON "api_key"("keyId");

-- CreateIndex
CREATE INDEX "api_key_kanzleiId_idx" ON "api_key"("kanzleiId");

-- CreateIndex
CREATE INDEX "api_key_keyId_idx" ON "api_key"("keyId");

-- CreateIndex
CREATE INDEX "api_key_isActive_expiresAt_idx" ON "api_key"("isActive", "expiresAt");

-- CreateIndex
CREATE INDEX "api_key_usage_apiKeyId_timestamp_idx" ON "api_key_usage"("apiKeyId", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "webhook_subscription_kanzleiId_idx" ON "webhook_subscription"("kanzleiId");

-- CreateIndex
CREATE INDEX "webhook_subscription_isActive_idx" ON "webhook_subscription"("isActive");

-- CreateIndex
CREATE INDEX "webhook_delivery_subscriptionId_status_scheduledAt_idx" ON "webhook_delivery"("subscriptionId", "status", "scheduledAt");

-- CreateIndex
CREATE INDEX "webhook_delivery_status_nextRetryAt_idx" ON "webhook_delivery"("status", "nextRetryAt");

-- AddForeignKey
ALTER TABLE "mandant" ADD CONSTRAINT "mandant_kanzleiId_fkey" FOREIGN KEY ("kanzleiId") REFERENCES "kanzlei"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user" ADD CONSTRAINT "user_kanzleiId_fkey" FOREIGN KEY ("kanzleiId") REFERENCES "kanzlei"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_session" ADD CONSTRAINT "user_session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_mandant_role" ADD CONSTRAINT "user_mandant_role_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_mandant_role" ADD CONSTRAINT "user_mandant_role_mandantId_fkey" FOREIGN KEY ("mandantId") REFERENCES "mandant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bilanz" ADD CONSTRAINT "bilanz_mandantId_fkey" FOREIGN KEY ("mandantId") REFERENCES "mandant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bilanz_position" ADD CONSTRAINT "bilanz_position_bilanzId_fkey" FOREIGN KEY ("bilanzId") REFERENCES "bilanz"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guv" ADD CONSTRAINT "guv_mandantId_fkey" FOREIGN KEY ("mandantId") REFERENCES "mandant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guv_position" ADD CONSTRAINT "guv_position_guvId_fkey" FOREIGN KEY ("guvId") REFERENCES "guv"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anhang" ADD CONSTRAINT "anhang_mandantId_fkey" FOREIGN KEY ("mandantId") REFERENCES "mandant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anhang_abschnitt" ADD CONSTRAINT "anhang_abschnitt_anhangId_fkey" FOREIGN KEY ("anhangId") REFERENCES "anhang"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jahresabschluss" ADD CONSTRAINT "jahresabschluss_mandantId_fkey" FOREIGN KEY ("mandantId") REFERENCES "mandant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jahresabschluss" ADD CONSTRAINT "jahresabschluss_bilanzId_fkey" FOREIGN KEY ("bilanzId") REFERENCES "bilanz"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jahresabschluss" ADD CONSTRAINT "jahresabschluss_guvId_fkey" FOREIGN KEY ("guvId") REFERENCES "guv"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jahresabschluss" ADD CONSTRAINT "jahresabschluss_anhangId_fkey" FOREIGN KEY ("anhangId") REFERENCES "anhang"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signature" ADD CONSTRAINT "signature_jahresabschlussId_fkey" FOREIGN KEY ("jahresabschlussId") REFERENCES "jahresabschluss"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "banz_submission" ADD CONSTRAINT "banz_submission_jahresabschlussId_fkey" FOREIGN KEY ("jahresabschlussId") REFERENCES "jahresabschluss"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "banz_submission" ADD CONSTRAINT "banz_submission_mandantId_fkey" FOREIGN KEY ("mandantId") REFERENCES "mandant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_kanzleiId_fkey" FOREIGN KEY ("kanzleiId") REFERENCES "kanzlei"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_mandantId_fkey" FOREIGN KEY ("mandantId") REFERENCES "mandant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_jahresabschlussId_fkey" FOREIGN KEY ("jahresabschlussId") REFERENCES "jahresabschluss"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "konsolidierungs_einheit" ADD CONSTRAINT "konsolidierungs_einheit_kanzleiId_fkey" FOREIGN KEY ("kanzleiId") REFERENCES "kanzlei"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "konsolidierungs_einheit" ADD CONSTRAINT "konsolidierungs_einheit_mutterMandantId_fkey" FOREIGN KEY ("mutterMandantId") REFERENCES "mandant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "konsolidierungs_buchung" ADD CONSTRAINT "konsolidierungs_buchung_einheitId_fkey" FOREIGN KEY ("einheitId") REFERENCES "konsolidierungs_einheit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wp_notiz" ADD CONSTRAINT "wp_notiz_bilanzId_fkey" FOREIGN KEY ("bilanzId") REFERENCES "bilanz"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wp_notiz" ADD CONSTRAINT "wp_notiz_guvId_fkey" FOREIGN KEY ("guvId") REFERENCES "guv"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wp_notiz" ADD CONSTRAINT "wp_notiz_bilanzPositionId_fkey" FOREIGN KEY ("bilanzPositionId") REFERENCES "bilanz_position"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wp_notiz" ADD CONSTRAINT "wp_notiz_guvPositionId_fkey" FOREIGN KEY ("guvPositionId") REFERENCES "guv_position"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wp_notiz" ADD CONSTRAINT "wp_notiz_wpUserId_fkey" FOREIGN KEY ("wpUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wp_notiz" ADD CONSTRAINT "wp_notiz_acknowledgedById_fkey" FOREIGN KEY ("acknowledgedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bilanz_pruefungs_result" ADD CONSTRAINT "bilanz_pruefungs_result_bilanzId_fkey" FOREIGN KEY ("bilanzId") REFERENCES "bilanz"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bilanz_pruefungs_result" ADD CONSTRAINT "bilanz_pruefungs_result_guvId_fkey" FOREIGN KEY ("guvId") REFERENCES "guv"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wp_pruefungs_abschluss" ADD CONSTRAINT "wp_pruefungs_abschluss_bilanzId_fkey" FOREIGN KEY ("bilanzId") REFERENCES "bilanz"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wp_pruefungs_abschluss" ADD CONSTRAINT "wp_pruefungs_abschluss_guvId_fkey" FOREIGN KEY ("guvId") REFERENCES "guv"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wp_pruefungs_abschluss" ADD CONSTRAINT "wp_pruefungs_abschluss_wpUserId_fkey" FOREIGN KEY ("wpUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_kanzleiId_fkey" FOREIGN KEY ("kanzleiId") REFERENCES "kanzlei"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_key_usage" ADD CONSTRAINT "api_key_usage_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "api_key"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_subscription" ADD CONSTRAINT "webhook_subscription_kanzleiId_fkey" FOREIGN KEY ("kanzleiId") REFERENCES "kanzlei"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_subscription" ADD CONSTRAINT "webhook_subscription_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_delivery" ADD CONSTRAINT "webhook_delivery_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "webhook_subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

