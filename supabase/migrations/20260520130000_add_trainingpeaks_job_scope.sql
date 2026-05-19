alter table public.trainingpeaks_jobs
  add column if not exists scope text not null default 'all_enabled',
  add column if not exists student_id text;

alter table public.trainingpeaks_jobs
  drop constraint if exists trainingpeaks_jobs_scope_check;

alter table public.trainingpeaks_jobs
  add constraint trainingpeaks_jobs_scope_check
  check (scope in ('all_enabled', 'single_student'));

alter table public.trainingpeaks_jobs
  drop constraint if exists trainingpeaks_jobs_single_student_scope_check;

alter table public.trainingpeaks_jobs
  add constraint trainingpeaks_jobs_single_student_scope_check
  check (
    (scope = 'all_enabled' and student_id is null)
    or (scope = 'single_student' and student_id is not null)
  );

drop index if exists public.trainingpeaks_jobs_active_week_idx;

create unique index if not exists trainingpeaks_jobs_active_all_enabled_week_idx
  on public.trainingpeaks_jobs (job_type, week_from, week_to)
  where job_type = 'weekly_reports'
    and scope = 'all_enabled'
    and status in ('queued', 'running');

create unique index if not exists trainingpeaks_jobs_active_single_student_week_idx
  on public.trainingpeaks_jobs (job_type, week_from, week_to, student_id)
  where job_type = 'weekly_reports'
    and scope = 'single_student'
    and status in ('queued', 'running');
