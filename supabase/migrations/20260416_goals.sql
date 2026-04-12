-- Migration: Goals & targets for PnL tracking and strategy auto-adjustment
-- Stores user-defined targets with deadline, and the system tracks progress
-- daily to inform screening aggressiveness.

CREATE TABLE IF NOT EXISTS goals (
  id           BIGSERIAL PRIMARY KEY,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  title        TEXT NOT NULL,
  target_pnl   NUMERIC NOT NULL,
  currency     TEXT NOT NULL DEFAULT 'USD',
  start_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  end_date     DATE NOT NULL,
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'failed', 'cancelled')),
  notes        TEXT,
  -- Snapshot fields updated by the progress tracker
  current_pnl  NUMERIC NOT NULL DEFAULT 0,
  last_sync_at TIMESTAMPTZ,
  -- Config adjustments proposed by analyzer (HITL: user must approve)
  proposed_adjustments JSONB DEFAULT NULL,
  updated_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_goals_status ON goals(status, end_date);
