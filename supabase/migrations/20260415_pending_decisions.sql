-- Migration: HITL (Human-In-The-Loop) pending decisions
-- Stores deploy/close recommendations from the agent that are waiting for
-- human approval via the dashboard or Telegram.

CREATE TABLE IF NOT EXISTS pending_decisions (
  id              BIGSERIAL PRIMARY KEY,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 minutes'),
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'executed', 'rejected', 'failed', 'expired')),
  action          TEXT NOT NULL CHECK (action IN ('deploy', 'close')),
  pool_address    TEXT,
  pool_name       TEXT,
  args            JSONB NOT NULL DEFAULT '{}',
  reason          TEXT,
  risks           TEXT[] DEFAULT '{}',
  source_run_id   BIGINT REFERENCES cron_runs(id) ON DELETE SET NULL,
  resolved_at     TIMESTAMPTZ,
  resolved_by     TEXT, -- 'web' | 'telegram' | 'auto_expire'
  result          JSONB,
  error           TEXT
);

CREATE INDEX IF NOT EXISTS idx_pending_decisions_status ON pending_decisions(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pending_decisions_created ON pending_decisions(created_at DESC);
