alter table public.trainingpeaks_jobs
  add column if not exists request_json jsonb;

alter table public.trainingpeaks_jobs
  drop constraint if exists trainingpeaks_jobs_job_type_check;

alter table public.trainingpeaks_jobs
  add constraint trainingpeaks_jobs_job_type_check
  check (job_type in ('weekly_reports', 'race_scan_events', 'race_results_probe'));

create unique index if not exists trainingpeaks_jobs_active_race_results_probe_student_idx
  on public.trainingpeaks_jobs (job_type, student_id)
  where job_type = 'race_results_probe'
    and status in ('queued', 'running');
