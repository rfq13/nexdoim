-- Migration: Intelligence features for meridian-next
-- Run this in your Supabase SQL editor

-- ─── Signal Weights (Darwinian Learning) ─────────────────────────
CREATE TABLE IF NOT EXISTS signal_weights (
  id              INTEGER PRIMARY KEY DEFAULT 1,
  weights         JSONB NOT NULL DEFAULT '{}',
  last_recalc_at  TIMESTAMPTZ,
  recalc_count    INTEGER NOT NULL DEFAULT 0,
  history         JSONB NOT NULL DEFAULT '[]',
  updated_at      TIMESTAMPTZ DEFAULT now()
);

INSERT INTO signal_weights (id, weights)
VALUES (1, '{
  "organic_score": 1.0,
  "fee_tvl_ratio": 1.0,
  "volume": 1.0,
  "mcap": 1.0,
  "holder_count": 1.0,
  "smart_wallets_present": 1.0,
  "narrative_quality": 1.0,
  "study_win_rate": 1.0,
  "hive_consensus": 1.0,
  "volatility": 1.0
}')
ON CONFLICT (id) DO NOTHING;

-- ─── Decision Log ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS decision_log (
  id          BIGSERIAL PRIMARY KEY,
  created_at  TIMESTAMPTZ DEFAULT now(),
  type        TEXT NOT NULL,
  actor       TEXT NOT NULL DEFAULT 'GENERAL',
  pool        TEXT,
  pool_name   TEXT,
  position    TEXT,
  summary     TEXT,
  reason      TEXT,
  risks       TEXT[],
  metrics     JSONB DEFAULT '{}',
  rejected    TEXT[]
);

CREATE INDEX IF NOT EXISTS idx_decision_log_created ON decision_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_decision_log_pool ON decision_log(pool);

-- ─── Dev Blocklist ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dev_blocklist (
  address  TEXT PRIMARY KEY,
  reason   TEXT,
  added_at TIMESTAMPTZ DEFAULT now()
);

-- ─── Alter existing tables ────────────────────────────────────────
ALTER TABLE positions   ADD COLUMN IF NOT EXISTS signal_snapshot JSONB;
ALTER TABLE performance ADD COLUMN IF NOT EXISTS signal_snapshot JSONB;
