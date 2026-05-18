create table if not exists public.trainingpeaks_student_health_metric_profiles (
  student_id uuid primary key references public.trainingpeaks_students(id) on delete cascade,
  student_name text not null,
  trainingpeaks_athlete_id bigint,
  status text not null default 'unknown',
  recovery_metrics_enabled boolean not null default false,
  has_hrv boolean not null default false,
  has_sleep_hours boolean not null default false,
  has_pulse boolean not null default false,
  has_body_battery boolean not null default false,
  has_stress_level boolean not null default false,
  has_weight boolean not null default false,
  coverage_7d jsonb not null default '{}'::jsonb,
  coverage_30d jsonb not null default '{}'::jsonb,
  last_checked_at timestamptz not null default now(),
  next_full_check_at timestamptz,
  warnings text[] not null default '{}'::text[],
  source_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trainingpeaks_student_health_metric_profiles_status_check check (
    status in ('ready', 'partial', 'no_metrics', 'failed', 'skipped_no_athlete_id', 'unknown')
  ),
  constraint trainingpeaks_student_health_metric_profiles_trainingpeaks_athlete_id_check check (
    trainingpeaks_athlete_id is null or trainingpeaks_athlete_id > 0
  )
);

create index if not exists trainingpeaks_student_health_metric_profiles_status_idx
  on public.trainingpeaks_student_health_metric_profiles (status);

create index if not exists trainingpeaks_student_health_metric_profiles_recovery_metrics_enabled_idx
  on public.trainingpeaks_student_health_metric_profiles (recovery_metrics_enabled);

create index if not exists trainingpeaks_student_health_metric_profiles_next_full_check_at_idx
  on public.trainingpeaks_student_health_metric_profiles (next_full_check_at);

create index if not exists trainingpeaks_student_health_metric_profiles_trainingpeaks_athlete_id_idx
  on public.trainingpeaks_student_health_metric_profiles (trainingpeaks_athlete_id);

create or replace function public.set_trainingpeaks_student_health_metric_profiles_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_trainingpeaks_student_health_metric_profiles_updated_at
  on public.trainingpeaks_student_health_metric_profiles;

create trigger set_trainingpeaks_student_health_metric_profiles_updated_at
before update on public.trainingpeaks_student_health_metric_profiles
for each row
execute function public.set_trainingpeaks_student_health_metric_profiles_updated_at();

revoke all on table public.trainingpeaks_student_health_metric_profiles from anon, authenticated, public;
grant select, insert, update on table public.trainingpeaks_student_health_metric_profiles to service_role;

alter table public.trainingpeaks_student_health_metric_profiles enable row level security;
