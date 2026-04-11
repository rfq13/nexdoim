-- Migration: Cron run history with captured logs
-- Run this in your Supabase SQL editor

CREATE TABLE IF NOT EXISTS cron_runs (
  id          BIGSERIAL PRIMARY KEY,
  job_name    TEXT NOT NULL,
  started_at  TIMESTAMPTZ NOT NULL,
  ended_at    TIMESTAMPTZ,
  duration_ms INTEGER,
  success     BOOLEAN,
  error       TEXT,
  output      TEXT,
  logs        JSONB NOT NULL DEFAULT '[]',
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cron_runs_job_started ON cron_runs(job_name, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_cron_runs_started ON cron_runs(started_at DESC);
