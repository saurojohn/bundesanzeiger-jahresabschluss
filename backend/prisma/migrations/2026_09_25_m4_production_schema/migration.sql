-- ============================================================================
-- Migration: M4 Production-Schema (Subscription + Audit-Hash-Chain)
-- Datum: 2026-09-25
-- Sprint: M4 Sprint 3 (Subscription) + M4 Sprint 5 (Hash-Chain)
--
-- Zweck:
--   1. Kanzlei-Subscription-Felder hinzufügen (M4 Sprint 3)
--   2. AuditLog-Hash-Chain-Felder hinzufügen (M4 Sprint 5)
--   3. Performance-Indexes für Hash-Verifikation
--
-- Backwards-Compat:
--   - Alle neuen Felder haben DEFAULT-Werte → bestehende Kanzleien
--     landen automatisch auf PILOT/Mock-Provider/TRIALING.
--   - entryHash + prevHash sind NULLABLE → bestehende Audit-Logs
--     bleiben unverändert; verifyIntegrity() liefert PARTIAL-Status
--     bis neue Einträge die Chain aufbauen.
--
-- Idempotenz:
--   - ALTER TABLE ADD COLUMN IF NOT EXISTS verfügbar ab Postgres 9.6
--     (IF NOT EXISTS für Spalten ist nicht standard-SQL aber von Postgres
--     supported).
--   - CREATE INDEX IF NOT EXISTS standard-Postgres.
--
-- Anwendung:
--   npx prisma migrate deploy
-- ============================================================================

-- ============================================================================
-- 1. Kanzlei-Subscription (M4 Sprint 3)
-- ============================================================================
ALTER TABLE kanzlei
  ADD COLUMN IF NOT EXISTS "subscriptionTier" TEXT DEFAULT 'PILOT',
  ADD COLUMN IF NOT EXISTS "subscriptionStatus" TEXT DEFAULT 'TRIALING',
  ADD COLUMN IF NOT EXISTS "subscriptionProvider" TEXT DEFAULT 'mock',
  ADD COLUMN IF NOT EXISTS "subscriptionProviderId" TEXT,
  ADD COLUMN IF NOT EXISTS "subscriptionPeriodEnd" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "subscriptionCancelAtEnd" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "providerCustomerId" TEXT;

-- Kommentar für Auditoren
COMMENT ON COLUMN kanzlei."subscriptionTier"
  IS 'M4 Sprint 3: Tier (PILOT|STANDARD|PREMIUM). Default PILOT für Zero-Impact-Migration.';

COMMENT ON COLUMN kanzlei."subscriptionProvider"
  IS 'M4 Sprint 3: Billing-Provider (stripe|mock). Default mock wenn STRIPE_SECRET_KEY fehlt.';

-- ============================================================================
-- 2. Audit-Hash-Chain (M4 Sprint 5)
-- ============================================================================
ALTER TABLE audit_log
  ADD COLUMN IF NOT EXISTS "entryHash" TEXT,
  ADD COLUMN IF NOT EXISTS "prevHash" TEXT;

COMMENT ON COLUMN audit_log."entryHash"
  IS 'M4 Sprint 5: SHA-256-Hash des Eintrags für Manipulations-Erkennung. Nullable für Backwards-Compat.';

COMMENT ON COLUMN audit_log."prevHash"
  IS 'M4 Sprint 5: Hash des vorherigen Eintrags. Genesis = 64×"0".';

-- ============================================================================
-- 3. Performance-Index für verifyIntegrity()
-- ============================================================================
-- verifyIntegrity() iteriert chronologisch + filtert nach NULL entryHash.
-- Der Index hilft beim PARTIAL-Status-Scan (ältester unhashed Entry).
CREATE INDEX IF NOT EXISTS idx_audit_log_created_hash
  ON audit_log ("createdAt" DESC, "entryHash");

-- ============================================================================
-- 4. Backfill: Bestehende Kanzleien auf Default-Tier setzen
-- ============================================================================
-- Falls DB schon Einträge hat (Pilot-Kanzleien aus M1-M3): explizit
-- PILOT setzen. Idempotent.
UPDATE kanzlei
SET
  "subscriptionTier" = COALESCE("subscriptionTier", 'PILOT'),
  "subscriptionStatus" = COALESCE("subscriptionStatus", 'TRIALING'),
  "subscriptionProvider" = COALESCE("subscriptionProvider", 'mock'),
  "subscriptionCancelAtEnd" = COALESCE("subscriptionCancelAtEnd", false)
WHERE "subscriptionTier" IS NULL
   OR "subscriptionStatus" IS NULL
   OR "subscriptionProvider" IS NULL;

-- ============================================================================
-- 5. Backfill: Genesis-Hash für existierende Audit-Einträge (optional)
-- ============================================================================
-- Falls Audit-Log bereits Daten enthält: wir lassen entryHash NULL und
-- der erste neue Eintrag startet die Chain. verifyIntegrity() wird dann
-- PARTIAL melden bis die Chain einmal komplett durchläuft — was OK ist
-- für die Übergangsphase.
--
-- Für vollständige Chain-Rekonstruktion in Production:
--   1. Ältester unhashed Entry → entryHash = SHA-256("0"*64 + serialize(entry))
--   2. Jeder folgende Entry → entryHash = SHA-256(prevHash + serialize(entry))
--   3. Speichern via UPDATE audit_log SET "entryHash" = ?, "prevHash" = ?
--   4. Idempotent: WHERE "entryHash" IS NULL
--
-- Wir bieten dafür ein separates Script an:
--   backend/scripts/backfill-audit-hash-chain.ts