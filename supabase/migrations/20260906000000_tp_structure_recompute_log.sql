-- Continuous structure-recompute (Mode A, attended) — audit log + per-run summary.
--
-- Mode A means: the nightly job DETECTS structures whose stored %-targets no longer match the
-- athlete's current threshold/description, LOGS them here as candidates, and notifies the coach with
-- an apply command. It does NOT write to TrainingPeaks on its own. The coach reviews and applies.
--
-- Two tables:
--   tp_structure_recompute_run  — one row per nightly run (summary + anomaly-stop bookkeeping).
--   tp_structure_recompute_log  — one row per planned workout examined in a run (drift/clean/defer).
--
-- Anomaly stop (Mode A): if drift_count / workouts_scanned > 0.5 in a run, the run marks
-- anomaly_stopped and the notification says "остановлено, проверь глазами" instead of an apply list.
-- verify_fail on any workout also stops the run. Magnitude: render shifts are BUCKETED 20-40 / 40-60 /
-- >60s in the run header (one 70s shift ≠ fifteen 25s shifts — different stories); <20s is rounding.
-- The morning summary GROUPS drift by athlete, not by workout: three drifting workouts on one person
-- is a threshold story (re-apply the athlete recomputes all of them), not three separate items.
--
-- Timestamps are UTC. tp_last_modified is stored ALREADY CORRECTED (+6h) from TP's UTC-6 value —
-- the incremental cursor compares this against the previous run to skip untouched workouts.

create table if not exists public.tp_structure_recompute_run (
  run_id                    uuid primary key default gen_random_uuid(),
  started_at                timestamptz not null default now(),
  finished_at               timestamptz,
  mode                      text not null default 'A',
  athletes_scanned          int  not null default 0,
  workouts_scanned          int  not null default 0,
  drift_count               int  not null default 0,
  clean_count               int  not null default 0,
  defer_count               int  not null default 0,
  verify_fail_count         int  not null default 0,
  shift_20_40_count         int  not null default 0,   -- изменённых шагов со сдвигом рендера 20-40с
  shift_40_60_count         int  not null default 0,   -- 40-60с
  shift_over_60_count       int  not null default 0,   -- >60с (крупные — отдельная история)
  anomaly_stopped           boolean not null default false,
  anomaly_reason            text
);

create table if not exists public.tp_structure_recompute_log (
  id                        bigint generated always as identity primary key,
  run_id                    uuid not null references public.tp_structure_recompute_run(run_id) on delete cascade,
  detected_at               timestamptz not null default now(),
  trainingpeaks_athlete_id  bigint not null,
  athlete_name              text,
  trainingpeaks_workout_id  bigint not null,
  workout_date              date,
  title                     text,
  tp_last_modified          timestamptz,          -- UTC, already +6h corrected from TP's UTC-6
  threshold_sec             int,                   -- threshold (sec/km) used for the recompute
  anchor_sec                int,                   -- easy anchor (sec/km) if any anchor step present
  decision                  text not null,         -- 'drift' | 'clean' | 'defer' | 'verify_fail'
  steps_total               int,
  steps_changed             int,
  max_shift_sec             int,                   -- крупнейший сдвиг рендера (сек) по шагам; ведёт корзины и per-athlete сортировку
  anchor_steps              int not null default 0, -- steps whose pace came from the anchor (blind zone)
  defer_reason              text,
  detail                    jsonb,                 -- per-step { block, step, role, oldMin/Max, newMin/Max, src, shiftSec }
  applied                   boolean not null default false,
  applied_at                timestamptz,
  applied_by                text
);

create index if not exists idx_recompute_log_run          on public.tp_structure_recompute_log (run_id);
create index if not exists idx_recompute_log_athlete      on public.tp_structure_recompute_log (trainingpeaks_athlete_id, detected_at desc);
create index if not exists idx_recompute_log_pending      on public.tp_structure_recompute_log (applied) where applied = false;
create index if not exists idx_recompute_log_workout_seen on public.tp_structure_recompute_log (trainingpeaks_workout_id, detected_at desc);

-- Internal tables: service_role only (the launchd runner reads/writes; the coach applies via the
-- same tool). RLS on, no anon/authenticated access. No DELETE grant — history is append-only;
-- pruning, if ever needed, goes through a SECURITY DEFINER RPC (see tp cache-table policy).
alter table public.tp_structure_recompute_run enable row level security;
alter table public.tp_structure_recompute_log enable row level security;

grant select, insert, update on public.tp_structure_recompute_run to service_role;
grant select, insert, update on public.tp_structure_recompute_log to service_role;
grant usage, select on all sequences in schema public to service_role;

create policy tp_recompute_run_service on public.tp_structure_recompute_run
  for all to service_role using (true) with check (true);
create policy tp_recompute_log_service on public.tp_structure_recompute_log
  for all to service_role using (true) with check (true);
