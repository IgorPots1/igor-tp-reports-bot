-- Club Phase 5 — unified 45-day calendar entries (day-off / preference / note / race).
--
-- ONE machine-readable table for everything a student marks on a future day, so the
-- coach inbox AND a future auto-planner can ask "what are this student's constraints
-- on date X?" with a single query. Supersedes the separate day-off form as the primary
-- surface (club_dayoff_requests / club_wishes / club_races stay for back-compat and are
-- not removed). Nothing here is written to TrainingPeaks — that is Phase 11, gated
-- separately; these rows are the source of truth, TP is only a projection for the coach.
--
-- kinds:
--   day_off     — student requests a rest day (plan is NOT touched; coach decides).
--   preference  — preferred workout type for the day: long | intervals | rest (NO strength).
--   note        — free-text note attached to a specific day.
--   race        — a race the student declares (name/city/distance/target in columns below).
--
-- status: pending → approved | rejected (coach), then applied (Phase 11 TP execution).
--
-- Additive, non-destructive. NOT applied by this task. The service tolerates the missing
-- table (reads return empty, writes report "section not active").

create table if not exists public.club_calendar_entries (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.trainingpeaks_students(id) on delete cascade,
  entry_date date not null,
  kind text not null,

  -- preference kind: the acceptable/preferred training type for that day.
  preferred_workout_type text,           -- 'long' | 'intervals' | 'rest' (strength excluded)
  note text,

  -- race kind: exact race identity (link NOT required — naryad 5.2).
  race_name text,
  race_city text,
  race_distance_label text,
  race_target_seconds integer,

  status text not null default 'pending',
  source text not null default 'club',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint club_calendar_entries_kind_check
    check (kind in ('day_off', 'preference', 'note', 'race')),
  constraint club_calendar_entries_pref_check
    check (preferred_workout_type is null or preferred_workout_type in ('long', 'intervals', 'rest')),
  constraint club_calendar_entries_status_check
    check (status in ('pending', 'approved', 'rejected', 'applied'))
);

create index if not exists club_calendar_entries_student_date_idx
  on public.club_calendar_entries (student_id, entry_date);
create index if not exists club_calendar_entries_status_date_idx
  on public.club_calendar_entries (status, entry_date);

-- day_off and preference are one-per-day: re-marking updates (upsert), not duplicates.
-- notes and races may repeat on a day, so they are excluded from the uniqueness rule.
create unique index if not exists club_calendar_entries_singleton_idx
  on public.club_calendar_entries (student_id, entry_date, kind)
  where kind in ('day_off', 'preference');

create or replace function public.set_club_calendar_entries_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_club_calendar_entries_updated_at on public.club_calendar_entries;
create trigger set_club_calendar_entries_updated_at
before update on public.club_calendar_entries
for each row execute function public.set_club_calendar_entries_updated_at();

-- App writes/reads via service_role (bypasses RLS). Upsert needs insert+update; the
-- student may delete their OWN pending entry, so delete is granted (ownership enforced
-- in the API from validated initData, never from the client).
revoke all on table public.club_calendar_entries from anon, authenticated, public;
grant select, insert, update, delete on table public.club_calendar_entries to service_role;

alter table public.club_calendar_entries enable row level security;
-- Deliberately no CREATE POLICY: default-deny for anon/authenticated.

comment on table public.club_calendar_entries is
  'Club Phase 5: unified 45-day calendar entries (day_off/preference/note/race). Single source for the coach inbox and a future auto-planner. Not written to TP here (Phase 11).';
