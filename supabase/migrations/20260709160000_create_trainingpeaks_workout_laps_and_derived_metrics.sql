-- FIT-ingest pipeline (stage 3): per-lap FIT data + one derived-metrics row per
-- workout. Design doc: /Users/igor/dev-notes/20 Coach OS/2026-07-09 FIT Ingest
-- & Derived Metrics Design.md (stage 2, RESOLVED 2026-07-09).
--
-- This migration only creates the two tables + the lap replace RPC. The
-- derived-metrics scalar columns (pct_time_*_target, rep_*, hr_decoupling_pct,
-- aerobic_ef, ...) are defined here (schema-complete per the design doc) but
-- this stage's ingest code only ever writes the metadata + cleaned avg_hr
-- subset; the scalar columns are populated by a later ingest stage.

create table if not exists public.trainingpeaks_workout_laps (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.trainingpeaks_students(id) on delete cascade,
  student_name text not null,
  trainingpeaks_athlete_id bigint not null,
  trainingpeaks_workout_id bigint not null,
  -- hard link to the cache row; laps disappear with the workout they belong to
  workout_cache_id uuid not null
    references public.trainingpeaks_workout_cache(id) on delete cascade,

  lap_index integer not null,
  source text not null,                    -- 'fit' | 'planned' (only 'fit' populated so far)
  start_offset_s numeric,                   -- lap start offset from workout start, sec
  timer_time_s numeric,                     -- FIT total_timer_time
  elapsed_time_s numeric,                   -- FIT total_elapsed_time
  distance_m numeric,                       -- FIT total_distance
  avg_speed_mps numeric,                    -- enhanced_avg_speed ?? avg_speed
  max_speed_mps numeric,                    -- enhanced_max_speed ?? max_speed
  pace_sec_per_km numeric,                  -- derived from distance/duration
  avg_hr numeric,                           -- FIT avg_heart_rate, RAW device value
  max_hr numeric,                           -- FIT max_heart_rate
  min_hr numeric,                           -- FIT min_heart_rate
  avg_cadence numeric,                      -- FIT avg_cadence (rpm; spm = x2 for running)
  max_cadence numeric,                      -- FIT max_cadence
  avg_power numeric,                        -- FIT avg_power (usually null for running)
  total_ascent_m numeric,                   -- FIT total_ascent
  total_descent_m numeric,                  -- FIT total_descent
  lap_trigger text,                         -- FIT lap_trigger enum
  intensity text,                           -- FIT intensity (active/rest/warmup/cooldown)
  wkt_step_index integer,                   -- FIT wkt_step_index (structured-workout step ref, if any)
  is_work boolean,                          -- classified work-effort vs jog/rest lap; null = undetermined
  planned_target jsonb,
  -- matched target from plan-structure: {metric,min,max,unit,step_name,...}; not populated yet.
  -- Nullable, no default: null = "no target matched" must stay distinct from
  -- {} = "matched but empty" — collapsing them into '{}' would lose that signal.

  source_snapshot jsonb not null default '{}'::jsonb,
  normalization_warnings text[] not null default '{}'::text[],
  scanned_at timestamptz not null default now(),
  scan_job_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint trainingpeaks_workout_laps_source_check
    check (source in ('fit', 'planned')),
  constraint trainingpeaks_workout_laps_lap_index_check
    check (lap_index >= 0),
  constraint trainingpeaks_workout_laps_unique
    unique (workout_cache_id, source, lap_index)
);

create index if not exists trainingpeaks_workout_laps_workout_cache_id_idx
  on public.trainingpeaks_workout_laps (workout_cache_id, source, lap_index);

create index if not exists trainingpeaks_workout_laps_athlete_workout_idx
  on public.trainingpeaks_workout_laps (trainingpeaks_athlete_id, trainingpeaks_workout_id);

create or replace function public.set_trainingpeaks_workout_laps_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_trainingpeaks_workout_laps_updated_at
  on public.trainingpeaks_workout_laps;

create trigger set_trainingpeaks_workout_laps_updated_at
before update on public.trainingpeaks_workout_laps
for each row
execute function public.set_trainingpeaks_workout_laps_updated_at();

-- service_role deliberately NOT granted DELETE (see replace RPC below).
revoke all on table public.trainingpeaks_workout_laps from anon, authenticated, public;
grant select, insert, update on table public.trainingpeaks_workout_laps to service_role;

alter table public.trainingpeaks_workout_laps enable row level security;

--------------------------------------------------------------------------------

create table if not exists public.trainingpeaks_workout_derived_metrics (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.trainingpeaks_students(id) on delete cascade,
  student_name text not null,
  trainingpeaks_athlete_id bigint not null,
  trainingpeaks_workout_id bigint not null,
  workout_cache_id uuid not null
    references public.trainingpeaks_workout_cache(id) on delete cascade,
  workout_date date not null,
  workout_type text,                        -- 'run'|'bike'|'swim'|... (comparison-base hook)

  -- metadata / degradation
  has_fit boolean not null default false,
  fallback_level text not null,             -- 'fit_full'|'details_only'|'summary_only'
  source_fit_file_id text,                  -- fileId or fileName of the matched FIT file
  match_confidence numeric,                 -- 0..1: confidence of FIT<->workout match
  computed_at timestamptz not null default now(),

  -- HR cleaning (this stage populates these)
  hr_quality text,                          -- 'good'|'degraded'|'unreliable'|null
  pct_hr_cleaned numeric,                   -- % of HR samples dropped/replaced by cleaning
  avg_hr numeric,                           -- CLEANED average HR over moving samples
                                            -- (comparison-base hook; laps.avg_hr stays raw)

  -- goal-vs-actual (populated by a later ingest stage)
  pct_time_hr_target numeric,
  pct_time_pace_target numeric,
  target_source text,                       -- 'plan'|'athlete_zones'|null
  time_in_zones jsonb,
  zone_basis text,

  -- intervals under the loupe (populated by a later ingest stage)
  reps_detected_count integer,
  rep_detection_method text,                -- 'structure'|'lap_trigger'|'heuristic'|'none'
  rep_paces jsonb,
  rep_pace_fade_pct numeric,
  rep_pace_cv numeric,
  rep_peak_hrs jsonb,
  rep_recovery_drops jsonb,

  -- steady-effort / decoupling (populated by a later ingest stage)
  steady_duration_s numeric,
  hr_decoupling_pct numeric,
  decoupling_valid boolean not null default false,
  decoupling_invalid_reason text,

  -- comparison (observation, never a verdict — populated by a later ingest stage)
  aerobic_ef numeric,
  ef_context_flag text not null default 'context_dependent',

  source_snapshot jsonb not null default '{}'::jsonb,
  normalization_warnings text[] not null default '{}'::text[],
  scanned_at timestamptz not null default now(),
  scan_job_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint trainingpeaks_workout_derived_metrics_fallback_check
    check (fallback_level in ('fit_full', 'details_only', 'summary_only')),
  constraint trainingpeaks_workout_derived_metrics_hr_quality_check
    check (hr_quality is null or hr_quality in ('good', 'degraded', 'unreliable')),
  constraint trainingpeaks_workout_derived_metrics_ef_flag_check
    check (ef_context_flag = 'context_dependent'),
  constraint trainingpeaks_workout_derived_metrics_decoupling_reason_check
    check (decoupling_valid = true or decoupling_invalid_reason is not null),
  constraint trainingpeaks_workout_derived_metrics_unique
    unique (workout_cache_id)
);

create index if not exists trainingpeaks_workout_derived_metrics_student_date_idx
  on public.trainingpeaks_workout_derived_metrics (student_id, workout_date desc);

create index if not exists trainingpeaks_workout_derived_metrics_athlete_date_idx
  on public.trainingpeaks_workout_derived_metrics (trainingpeaks_athlete_id, workout_date desc);

create index if not exists trainingpeaks_workout_derived_metrics_type_quality_idx
  on public.trainingpeaks_workout_derived_metrics (workout_type, hr_quality);

create or replace function public.set_trainingpeaks_workout_derived_metrics_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_trainingpeaks_workout_derived_metrics_updated_at
  on public.trainingpeaks_workout_derived_metrics;

create trigger set_trainingpeaks_workout_derived_metrics_updated_at
before update on public.trainingpeaks_workout_derived_metrics
for each row
execute function public.set_trainingpeaks_workout_derived_metrics_updated_at();

revoke all on table public.trainingpeaks_workout_derived_metrics from anon, authenticated, public;
grant select, insert, update on table public.trainingpeaks_workout_derived_metrics to service_role;

alter table public.trainingpeaks_workout_derived_metrics enable row level security;

--------------------------------------------------------------------------------
-- Re-ingest for laps: service_role has no DELETE on this table (same policy as
-- trainingpeaks_workout_cache), so an atomic "replace all laps for this
-- workout+source" needs a narrow SECURITY DEFINER RPC instead of a blanket
-- DELETE grant. Mirrors reconcile_trainingpeaks_workout_cache_planned_rows in
-- 20260708131000_reconcile_workout_cache_rpc.sql.
--
-- p_rows is a jsonb array; each element's keys must match the columns listed
-- in jsonb_to_recordset below. Caller (repository.ts) is responsible for
-- supplying student_id/student_name/trainingpeaks_athlete_id/
-- trainingpeaks_workout_id/workout_cache_id/source consistently across rows.
create or replace function public.replace_trainingpeaks_workout_laps(
  p_workout_cache_id uuid,
  p_source text,
  p_rows jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer;
begin
  delete from public.trainingpeaks_workout_laps
   where workout_cache_id = p_workout_cache_id
     and source = p_source;

  insert into public.trainingpeaks_workout_laps (
    student_id,
    student_name,
    trainingpeaks_athlete_id,
    trainingpeaks_workout_id,
    workout_cache_id,
    lap_index,
    source,
    start_offset_s,
    timer_time_s,
    elapsed_time_s,
    distance_m,
    avg_speed_mps,
    max_speed_mps,
    pace_sec_per_km,
    avg_hr,
    max_hr,
    min_hr,
    avg_cadence,
    max_cadence,
    avg_power,
    total_ascent_m,
    total_descent_m,
    lap_trigger,
    intensity,
    wkt_step_index,
    is_work,
    planned_target,
    source_snapshot,
    normalization_warnings,
    scanned_at,
    scan_job_id
  )
  select
    x.student_id,
    x.student_name,
    x.trainingpeaks_athlete_id,
    x.trainingpeaks_workout_id,
    x.workout_cache_id,
    x.lap_index,
    x.source,
    x.start_offset_s,
    x.timer_time_s,
    x.elapsed_time_s,
    x.distance_m,
    x.avg_speed_mps,
    x.max_speed_mps,
    x.pace_sec_per_km,
    x.avg_hr,
    x.max_hr,
    x.min_hr,
    x.avg_cadence,
    x.max_cadence,
    x.avg_power,
    x.total_ascent_m,
    x.total_descent_m,
    x.lap_trigger,
    x.intensity,
    x.wkt_step_index,
    x.is_work,
    x.planned_target,
    coalesce(x.source_snapshot, '{}'::jsonb),
    coalesce(x.normalization_warnings, '{}'::text[]),
    coalesce(x.scanned_at, now()),
    x.scan_job_id
  from jsonb_to_recordset(p_rows) as x(
    student_id uuid,
    student_name text,
    trainingpeaks_athlete_id bigint,
    trainingpeaks_workout_id bigint,
    workout_cache_id uuid,
    lap_index integer,
    source text,
    start_offset_s numeric,
    timer_time_s numeric,
    elapsed_time_s numeric,
    distance_m numeric,
    avg_speed_mps numeric,
    max_speed_mps numeric,
    pace_sec_per_km numeric,
    avg_hr numeric,
    max_hr numeric,
    min_hr numeric,
    avg_cadence numeric,
    max_cadence numeric,
    avg_power numeric,
    total_ascent_m numeric,
    total_descent_m numeric,
    lap_trigger text,
    intensity text,
    wkt_step_index integer,
    is_work boolean,
    planned_target jsonb,
    source_snapshot jsonb,
    normalization_warnings text[],
    scanned_at timestamptz,
    scan_job_id uuid
  );

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

revoke all on function public.replace_trainingpeaks_workout_laps(uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.replace_trainingpeaks_workout_laps(uuid, text, jsonb)
  to service_role;
