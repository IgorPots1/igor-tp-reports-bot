create table if not exists public.trainingpeaks_workout_cache_scan_status (
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
  planned_count integer not null default 0,
  completed_count integer not null default 0,
  planned_not_completed_count integer not null default 0,
  warnings_count integer not null default 0,
  error_message text null,
  scanned_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trainingpeaks_workout_cache_scan_status_status_check check (status in ('ok', 'failed', 'skipped')),
  constraint trainingpeaks_workout_cache_scan_status_trainingpeaks_athlete_id_check check (
    status = 'skipped' or (trainingpeaks_athlete_id is not null and trainingpeaks_athlete_id > 0)
  ),
  constraint trainingpeaks_workout_cache_scan_status_student_scan_range_unique unique (student_id, scan_from, scan_to)
);

create index if not exists trainingpeaks_workout_cache_scan_status_scan_range_status_idx
  on public.trainingpeaks_workout_cache_scan_status (scan_from, scan_to, status);

create index if not exists trainingpeaks_workout_cache_scan_status_student_scan_range_desc_idx
  on public.trainingpeaks_workout_cache_scan_status (student_id, scan_from desc, scan_to desc);

create index if not exists trainingpeaks_workout_cache_scan_status_scanned_at_desc_idx
  on public.trainingpeaks_workout_cache_scan_status (scanned_at desc);

create or replace function public.set_trainingpeaks_workout_cache_scan_status_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_trainingpeaks_workout_cache_scan_status_updated_at
  on public.trainingpeaks_workout_cache_scan_status;

create trigger set_trainingpeaks_workout_cache_scan_status_updated_at
before update on public.trainingpeaks_workout_cache_scan_status
for each row
execute function public.set_trainingpeaks_workout_cache_scan_status_updated_at();

revoke all on table public.trainingpeaks_workout_cache_scan_status from anon, authenticated, public;
grant select, insert, update on table public.trainingpeaks_workout_cache_scan_status to service_role;

alter table public.trainingpeaks_workout_cache_scan_status enable row level security;
