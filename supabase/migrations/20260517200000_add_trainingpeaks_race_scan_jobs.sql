alter table public.trainingpeaks_jobs
  drop constraint if exists trainingpeaks_jobs_job_type_check;

alter table public.trainingpeaks_jobs
  add constraint trainingpeaks_jobs_job_type_check
  check (job_type in ('weekly_reports', 'race_scan_events'));

create unique index if not exists trainingpeaks_jobs_active_race_scan_range_idx
  on public.trainingpeaks_jobs (job_type, week_from, week_to)
  where job_type = 'race_scan_events' and status in ('queued', 'running');
