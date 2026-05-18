create table if not exists public.trainingpeaks_workout_cache (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.trainingpeaks_students(id) on delete cascade,
  student_name text not null,
  trainingpeaks_athlete_id bigint not null,
  trainingpeaks_workout_id bigint not null,
  workout_date date not null,
  title text,
  sport_or_type_code text,
  workout_type_value_id bigint,
  workout_sub_type_id bigint,
  is_planned boolean not null default false,
  is_completed boolean not null default false,
  planned_time_raw numeric,
  completed_time_raw numeric,
  planned_distance_raw numeric,
  completed_distance_raw numeric,
  compliance_duration_percent numeric,
  compliance_distance_percent numeric,
  start_time_planned text,
  start_time text,
  source_updated_at timestamptz,
  order_on_day numeric,
  scanned_at timestamptz not null default now(),
  scan_job_id uuid,
  normalization_warnings text[] not null default '{}'::text[],
  source_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trainingpeaks_workout_cache_trainingpeaks_workout_id_check check (trainingpeaks_workout_id > 0),
  constraint trainingpeaks_workout_cache_trainingpeaks_athlete_id_check check (trainingpeaks_athlete_id > 0),
  constraint trainingpeaks_workout_cache_athlete_workout_unique unique (trainingpeaks_athlete_id, trainingpeaks_workout_id)
);

create index if not exists trainingpeaks_workout_cache_student_workout_date_idx
  on public.trainingpeaks_workout_cache (student_id, workout_date desc);

create index if not exists trainingpeaks_workout_cache_workout_date_scanned_at_idx
  on public.trainingpeaks_workout_cache (workout_date desc, scanned_at desc);

create index if not exists trainingpeaks_workout_cache_athlete_workout_date_idx
  on public.trainingpeaks_workout_cache (trainingpeaks_athlete_id, workout_date desc);

create index if not exists trainingpeaks_workout_cache_scan_job_id_idx
  on public.trainingpeaks_workout_cache (scan_job_id);

create or replace function public.set_trainingpeaks_workout_cache_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_trainingpeaks_workout_cache_updated_at on public.trainingpeaks_workout_cache;

create trigger set_trainingpeaks_workout_cache_updated_at
before update on public.trainingpeaks_workout_cache
for each row
execute function public.set_trainingpeaks_workout_cache_updated_at();

revoke all on table public.trainingpeaks_workout_cache from anon, authenticated, public;
grant select, insert, update on table public.trainingpeaks_workout_cache to service_role;

alter table public.trainingpeaks_workout_cache enable row level security;
