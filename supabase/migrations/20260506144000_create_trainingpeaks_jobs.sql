create table if not exists public.trainingpeaks_jobs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null default 'weekly_reports',
  status text not null default 'queued',
  week_from date not null,
  week_to date not null,
  requested_by_chat_id text,
  requested_by_user_id text,
  result_json jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint trainingpeaks_jobs_job_type_check check (job_type in ('weekly_reports')),
  constraint trainingpeaks_jobs_status_check check (status in ('queued', 'running', 'completed', 'failed'))
);

create index if not exists trainingpeaks_jobs_created_at_idx
  on public.trainingpeaks_jobs (created_at asc);

create unique index if not exists trainingpeaks_jobs_active_week_idx
  on public.trainingpeaks_jobs (job_type, week_from, week_to)
  where status in ('queued', 'running');

create or replace function public.set_trainingpeaks_jobs_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_trainingpeaks_jobs_updated_at on public.trainingpeaks_jobs;

create trigger set_trainingpeaks_jobs_updated_at
before update on public.trainingpeaks_jobs
for each row
execute function public.set_trainingpeaks_jobs_updated_at();

revoke all on table public.trainingpeaks_jobs from anon, authenticated, public;
grant select, insert, update on table public.trainingpeaks_jobs to service_role;

alter table public.trainingpeaks_jobs enable row level security;
