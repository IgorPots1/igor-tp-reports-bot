-- Phase 1.4 (club speed): per-student per-day RUNNING aggregates.
--
-- WHY: challenge / statistics / tops (and the profile challenge-rank) each read a wide
-- whole-club window of trainingpeaks_workout_cache on every request (tops = 60 days,
-- ~1.1 s) and aggregate in JS. This table precomputes the running numbers per student
-- per day, so those tabs read a small indexed slice instead of the raw window.
--
-- GRAIN: (student_id, day). Columns are RUNNING-focused because all four consumers
-- filter to running workouts (isRunning && isCompleted / isPlanned). The profile's
-- per-type breakdown stays on its own narrow single-student raw read (already fast),
-- so a per-family grain is unnecessary here. running_km is stored at FULL precision
-- (no rounding) — consumers sum days and round once at the end, matching the raw path
-- exactly (zero parity drift).
--
-- RECOMPUTE: written by materializeClubRecords in the same incremental pass as
-- club_record_snapshots (scoped DELETE+INSERT per affected student), after
-- workout-cache-scan and fit-ingest-scan, gated by CLUB_MATERIALIZE_ENABLED.
--
-- Do NOT apply in production automatically — file-of-record; apply via the rollout.

create table if not exists public.club_daily_aggregates (
  student_id uuid not null,
  day date not null,
  -- Completed running distance that day (full precision; sum-then-round downstream).
  running_km numeric not null default 0,
  -- Count of COMPLETED running workouts that day.
  completed_running integer not null default 0,
  -- Count of PLANNED running workouts that day (independent of completion, like buildWeekPerformers).
  planned_running integer not null default 0,
  -- Active day = at least one completed running workout (drives streaks + active set).
  active_day boolean not null default false,
  computed_at timestamptz not null default now(),
  primary key (student_id, day)
);

-- Week/month/period range scans over the whole club (statistics, tops, challenge).
create index if not exists club_daily_aggregates_day_idx
  on public.club_daily_aggregates (day);
-- Per-student slice + scoped recompute delete.
create index if not exists club_daily_aggregates_student_day_idx
  on public.club_daily_aggregates (student_id, day);

-- Deny-by-default for anon/authenticated (mirrors other club tables); the app
-- reads/writes server-side via service_role, which bypasses RLS.
alter table public.club_daily_aggregates enable row level security;

-- service_role runs the materialize job (scoped DELETE+INSERT) and the read path.
grant select, insert, update, delete on public.club_daily_aggregates to service_role;
