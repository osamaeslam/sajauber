-- ============================================================
-- Cron Job: Process Trip Queue every 30 seconds
-- ============================================================

-- Enable pg_cron extension (available on all Supabase plans)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule the process_trip_queue function to run every 30 seconds
SELECT cron.schedule(
  'process-trip-queue',
  '*/30 * * * *',
  $$SELECT process_trip_queue();$$
);
