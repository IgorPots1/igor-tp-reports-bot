create table if not exists public.trainingpeaks_health_metrics_cache (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.trainingpeaks_students(id) on delete cascade,
  student_name text not null,
  trainingpeaks_athlete_id bigint not null,
  metric_timestamp timestamptz not null,
  metric_date date not null,
  metric_type_id integer not null,
  metric_key text not null,
  metric_label text,
  raw_value_text text,
  value_numeric double precision,
  value_min_numeric double precision,
  value_max_numeric double precision,
  value_avg_numeric double precision,
  unit text,
  upload_client text,
  source_snapshot jsonb not null default '{}'::jsonb,
  normalization_warnings text[] not null default '{}'::text[],
  scanned_at timestamptz not null default now(),
  scan_job_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trainingpeaks_health_metrics_cache_trainingpeaks_athlete_id_check check (trainingpeaks_athlete_id > 0),
  constraint trainingpeaks_health_metrics_cache_metric_type_id_check check (metric_type_id > 0),
  constraint trainingpeaks_health_metrics_cache_student_metric_unique unique (
    student_id,
    metric_timestamp,
    metric_type_id,
    metric_key
  )
);

create index if not exists trainingpeaks_health_metrics_cache_student_metric_date_idx
  on public.trainingpeaks_health_metrics_cache (student_id, metric_date desc);

create index if not exists trainingpeaks_health_metrics_cache_metric_key_metric_date_idx
  on public.trainingpeaks_health_metrics_cache (metric_key, metric_date desc);

create index if not exists trainingpeaks_health_metrics_cache_athlete_metric_date_idx
  on public.trainingpeaks_health_metrics_cache (trainingpeaks_athlete_id, metric_date desc);

create or replace function public.set_trainingpeaks_health_metrics_cache_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_trainingpeaks_health_metrics_cache_updated_at
  on public.trainingpeaks_health_metrics_cache;

create trigger set_trainingpeaks_health_metrics_cache_updated_at
before update on public.trainingpeaks_health_metrics_cache
for each row
execute function public.set_trainingpeaks_health_metrics_cache_updated_at();

revoke all on table public.trainingpeaks_health_metrics_cache from anon, authenticated, public;
grant select, insert, update on table public.trainingpeaks_health_metrics_cache to service_role;

alter table public.trainingpeaks_health_metrics_cache enable row level security;

create table if not exists public.trainingpeaks_health_metrics_scan_status (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.trainingpeaks_students(id) on delete cascade,
  student_name text not null,
  trainingpeaks_athlete_id bigint,
  scan_from date not null,
  scan_to date not null,
  status text not null,
  raw_items_count integer not null default 0,
  normalized_items_count integer not null default 0,
  upserted_rows_count integer not null default 0,
  metric_types_found text[] not null default '{}'::text[],
  warnings_count integer not null default 0,
  error_message text,
  scanned_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trainingpeaks_health_metrics_scan_status_status_check check (
    status in ('ok', 'failed', 'skipped')
  ),
  constraint trainingpeaks_health_metrics_scan_status_trainingpeaks_athlete_id_check check (
    status = 'skipped' or (trainingpeaks_athlete_id is not null and trainingpeaks_athlete_id > 0)
  ),
  constraint trainingpeaks_health_metrics_scan_status_student_scan_range_unique unique (
    student_id,
    scan_from,
    scan_to
  )
);

create index if not exists trainingpeaks_health_metrics_scan_status_student_scan_to_desc_idx
  on public.trainingpeaks_health_metrics_scan_status (student_id, scan_to desc);

create index if not exists trainingpeaks_health_metrics_scan_status_status_idx
  on public.trainingpeaks_health_metrics_scan_status (status);

create index if not exists trainingpeaks_health_metrics_scan_status_scanned_at_desc_idx
  on public.trainingpeaks_health_metrics_scan_status (scanned_at desc);

create or replace function public.set_trainingpeaks_health_metrics_scan_status_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_trainingpeaks_health_metrics_scan_status_updated_at
  on public.trainingpeaks_health_metrics_scan_status;

create trigger set_trainingpeaks_health_metrics_scan_status_updated_at
before update on public.trainingpeaks_health_metrics_scan_status
for each row
execute function public.set_trainingpeaks_health_metrics_scan_status_updated_at();

revoke all on table public.trainingpeaks_health_metrics_scan_status from anon, authenticated, public;
grant select, insert, update on table public.trainingpeaks_health_metrics_scan_status to service_role;

alter table public.trainingpeaks_health_metrics_scan_status enable row level security;
