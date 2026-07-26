-- Club Mini App — device-computed peak pace by distance (TrainingPeaks mean-max).
-- A3 (2026-07): TP exposes `meanMaxSpeedsByDistance` per workout (getWorkoutDetails
-- record) — the fastest continuous pace over each target distance INSIDE a workout,
-- computed by the device. It is cleaner than the local lap best-split heuristic
-- (no pause-gap noise, exact target distances). This table holds the athlete's BEST
-- peak per target distance across all their workouts, populated by a read-only
-- backfill (scripts/tp-peaks-coverage.ts / an ingest job). Consumed by records
-- reconstruction ONLY when CLUB_RECORDS_TP_PEAKS=true; lap heuristic stays the
-- fallback. A premium TP feature — absent for athletes without it (partial coverage).
--
-- NOT a race: a peak is still the fastest segment of a TRAINING run. It improves the
-- ACCURACY of the "training split", it does not create a competitive result. The
-- meaningfulness filter (A1) and the pace/VDOT plausibility checks apply on top.
--
-- NOT applied by this task. Apply before enabling CLUB_RECORDS_TP_PEAKS.

create table if not exists public.club_tp_peaks (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null,
  distance_key text not null check (distance_key in ('5k', '10k', '21k', '42k')),
  best_speed_mps double precision not null,       -- device mean-max speed (m/s)
  duration_seconds integer not null,              -- derived at backfill: target_m / speed
  trainingpeaks_workout_id bigint,                -- source workout of the best peak
  workout_date date,
  fetched_at timestamptz not null default now(),
  unique (student_id, distance_key)
);

create index if not exists club_tp_peaks_student_idx
  on public.club_tp_peaks (student_id);

alter table public.club_tp_peaks enable row level security;
-- Writes go through the app / backfill (service_role); default-deny for anon/authenticated.

-- Grant DML to service_role explicitly — the other club_* tables shipped WITHOUT
-- these grants and silently 42501-failed (see 20260726130000). Do not repeat that.
grant select, insert, update, delete on table public.club_tp_peaks to service_role;

comment on table public.club_tp_peaks is
  'Best TrainingPeaks device mean-max pace per athlete+distance (premium; partial coverage). Feeds the training-split "best segment" when CLUB_RECORDS_TP_PEAKS=true. Not a race result.';
