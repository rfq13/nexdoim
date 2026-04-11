-- Migration: Auto-cleanup old cron_runs rows via pg_cron
-- Runs daily at 03:00 UTC, deletes any cron_runs row older than 28 days.
--
-- Prerequisite: pg_cron extension must be enabled.
-- In Supabase Dashboard: Database → Extensions → search "pg_cron" → enable.
-- (Or run the CREATE EXTENSION line below — it's a no-op if already enabled.)

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Unschedule any previous registration so re-running this migration is safe.
DO $$
BEGIN
  PERFORM cron.unschedule('meridian-cleanup-cron-runs');
EXCEPTION WHEN OTHERS THEN
  -- Job didn't exist yet; ignore.
  NULL;
END $$;

-- Schedule the cleanup job.
SELECT cron.schedule(
  'meridian-cleanup-cron-runs',
  '0 3 * * *',
  $$ DELETE FROM cron_runs WHERE created_at < now() - interval '28 days' $$
);

-- Verify: list scheduled jobs
-- SELECT jobid, jobname, schedule, command FROM cron.job WHERE jobname = 'meridian-cleanup-cron-runs';
--
-- View run history of the cleanup job:
-- SELECT * FROM cron.job_run_details
--   WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'meridian-cleanup-cron-runs')
--   ORDER BY start_time DESC LIMIT 10;
