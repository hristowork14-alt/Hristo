-- Runs the follow-up + reminder jobs every 15 minutes, from Supabase itself (free).
-- 1. Supabase -> Database -> Extensions: enable "pg_cron" and "pg_net".
-- 2. Replace the two placeholders below, then run this in the SQL editor.
-- To stop it later:  select cron.unschedule('salonagent-jobs');

select cron.schedule(
  'salonagent-jobs',
  '*/15 * * * *',
  $$
  select net.http_get(
    url := 'https://YOUR-APP.vercel.app/api/cron',
    headers := jsonb_build_object('Authorization', 'Bearer YOUR_CRON_SECRET'),
    timeout_milliseconds := 30000
  );
  $$
);
