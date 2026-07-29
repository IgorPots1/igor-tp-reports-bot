-- Backward race-scan backfill (Вариант A): allow the new job_type on trainingpeaks_jobs.
-- The weekly forward scan enqueues 'race_scan_events' (window [today, today+120d]); the
-- backfill enqueues 'race_scan_backfill' (window [today - RACE_SCAN_BACKFILL_DAYS, today]).
-- Same runner, same persist — only the CHECK constraint has to admit the new value.
-- Additive only: existing job types are preserved; the forward job is untouched.

alter table public.trainingpeaks_jobs
  drop constraint if exists trainingpeaks_jobs_job_type_check;

alter table public.trainingpeaks_jobs
  add constraint trainingpeaks_jobs_job_type_check
  check (job_type in ('weekly_reports', 'race_scan_events', 'race_results_probe', 'race_scan_backfill'));

-- Dedupe guard (mirrors the race_scan_events active-scan index): at most one backfill
-- scan queued or running at a time. The enqueue script also checks this in-app, but the
-- partial unique index makes the guarantee atomic against concurrent enqueues.
create unique index if not exists trainingpeaks_jobs_active_race_scan_backfill_idx
  on public.trainingpeaks_jobs (job_type)
  where job_type = 'race_scan_backfill' and status in ('queued', 'running');
