create table if not exists public.athlete_training_baselines (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.trainingpeaks_students(id) on delete cascade,
  trainingpeaks_athlete_id text,
  source_report_path text,
  source_from date not null,
  source_to date not null,
  generated_at timestamptz not null default now(),
  is_current boolean not null default true,
  frequency_cap integer check (frequency_cap is null or frequency_cap >= 0),
  weekly_minutes_cap integer check (weekly_minutes_cap is null or weekly_minutes_cap >= 0),
  long_run_cap_min integer check (long_run_cap_min is null or long_run_cap_min >= 0),
  quality_count_cap integer check (quality_count_cap is null or quality_count_cap >= 0),
  interval_like_count integer check (interval_like_count is null or interval_like_count >= 0),
  confidence text not null default 'low' check (confidence in ('low', 'medium', 'high')),
  needs_review boolean not null default true,
  context_flags text[] not null default '{}'::text[],
  family_label_advisory text,
  raw_stats_jsonb jsonb not null default '{}'::jsonb,
  is_manually_overridden boolean not null default false,
  override_frequency_cap integer check (override_frequency_cap is null or override_frequency_cap >= 0),
  override_weekly_minutes_cap integer check (override_weekly_minutes_cap is null or override_weekly_minutes_cap >= 0),
  override_long_run_cap_min integer check (override_long_run_cap_min is null or override_long_run_cap_min >= 0),
  override_quality_count_cap integer check (override_quality_count_cap is null or override_quality_count_cap >= 0),
  override_reason text,
  override_by text,
  override_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (source_from <= source_to),
  check (
    is_manually_overridden = false
    or (
      override_reason is not null
      and length(btrim(override_reason)) > 0
    )
  )
);

comment on table public.athlete_training_baselines is
  'Per-athlete planning guardrails derived from recent baseline reports. Advisory labels must not be used as guardrail truth.';

comment on column public.athlete_training_baselines.family_label_advisory is
  'ADVISORY ONLY. Do not use this field for guardrail logic.';

create index if not exists athlete_training_baselines_student_id_idx
  on public.athlete_training_baselines (student_id);

create index if not exists athlete_training_baselines_trainingpeaks_athlete_id_idx
  on public.athlete_training_baselines (trainingpeaks_athlete_id);

create index if not exists athlete_training_baselines_is_current_idx
  on public.athlete_training_baselines (is_current);

create index if not exists athlete_training_baselines_source_window_idx
  on public.athlete_training_baselines (source_from, source_to);

create unique index if not exists athlete_training_baselines_one_current_per_student_idx
  on public.athlete_training_baselines (student_id)
  where is_current = true;

create or replace function public.set_athlete_training_baselines_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_athlete_training_baselines_updated_at on public.athlete_training_baselines;

create trigger set_athlete_training_baselines_updated_at
before update on public.athlete_training_baselines
for each row
execute function public.set_athlete_training_baselines_updated_at();

revoke all on table public.athlete_training_baselines from anon, authenticated, public;

grant select, insert, update, delete on table public.athlete_training_baselines to service_role;

alter table public.athlete_training_baselines enable row level security;
