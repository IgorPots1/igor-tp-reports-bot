-- Phase 1.4 follow-up (club speed): per-student WEEKLY rollups + current streak.
--
-- WHY: club_daily_aggregates only cut rows ~1.4× (students train ~daily), so tops/
-- challenge stayed ~0.9–1.2 s (multi-page reads). These rollups collapse the read to a
-- single page: one row per (student, ISO-week) for km/counts, and one row per student
-- for the current streak. tops/challenge/statistics/profile-rank then read ≤~1 page.
--
-- club_week_rollup: running metrics per (student, week_start = Monday of the ISO week).
-- club_student_rollup: per-student "as of last materialize" values (currently: streak).
-- Both written by materializeClubRecords (same incremental pass as records/daily),
-- scoped DELETE+INSERT per affected student. Read gated by CLUB_AGGREGATES_ENABLED.
--
-- Do NOT apply in production automatically — file-of-record; apply via the rollout.

create table if not exists public.club_week_rollup (
  student_id uuid not null,
  week_start date not null,               -- Monday of the ISO week (weekStartIso)
  running_km numeric not null default 0,  -- completed running km that week, FULL precision
  completed_running integer not null default 0,
  planned_running integer not null default 0,
  computed_at timestamptz not null default now(),
  primary key (student_id, week_start)
);
create index if not exists club_week_rollup_week_idx
  on public.club_week_rollup (week_start);

create table if not exists public.club_student_rollup (
  student_id uuid primary key,
  current_streak integer not null default 0, -- consecutive active days ending at materialize "today"
  computed_at timestamptz not null default now()
);

alter table public.club_week_rollup enable row level security;
alter table public.club_student_rollup enable row level security;
grant select, insert, update, delete on public.club_week_rollup to service_role;
grant select, insert, update, delete on public.club_student_rollup to service_role;
