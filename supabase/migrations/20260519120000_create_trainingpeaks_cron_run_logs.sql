create table if not exists public.trainingpeaks_cron_run_logs (
  id uuid primary key default gen_random_uuid(),
  job_name text not null,
  source text not null default 'unknown',
  status text not null,
  http_method text null,
  user_agent text null,
  request_path text null,
  started_at timestamptz not null default now(),
  finished_at timestamptz null,
  duration_ms integer null,
  response_status integer null,
  counts jsonb not null default '{}'::jsonb,
  error_message text null,
  created_at timestamptz not null default now(),
  constraint trainingpeaks_cron_run_logs_source_check check (source in ('vercel_cron', 'manual', 'unknown')),
  constraint trainingpeaks_cron_run_logs_status_check check (
    status in ('started', 'sent', 'failed', 'unauthorized', 'skipped')
  )
);

create index if not exists trainingpeaks_cron_run_logs_job_name_started_at_desc_idx
  on public.trainingpeaks_cron_run_logs (job_name, started_at desc);

create index if not exists trainingpeaks_cron_run_logs_source_started_at_desc_idx
  on public.trainingpeaks_cron_run_logs (source, started_at desc);

create index if not exists trainingpeaks_cron_run_logs_status_started_at_desc_idx
  on public.trainingpeaks_cron_run_logs (status, started_at desc);

revoke all on table public.trainingpeaks_cron_run_logs from anon, authenticated, public;
grant select, insert, update on table public.trainingpeaks_cron_run_logs to service_role;

alter table public.trainingpeaks_cron_run_logs enable row level security;
