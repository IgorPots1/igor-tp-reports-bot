-- Race Protocols matcher (Фаза 10.3) — the IDENTIFIER memory. Additive, non-destructive. Apply before
-- turning on protocol writes; safe to apply early (empty table changes nothing).
--
-- This table is NOT the results — a matched result upgrades club_records (source=official_protocol,
-- trust=verified). It is what stops the confirmation queue from regrowing on the SAME people. probeg
-- shows some students under a shortened spelling (roster «Хадижат» vs finisher «Хади Муртазалиева»):
-- such a name is only PROBABLE on its own even when date+distance+time are a perfect 0-1s match, so it
-- would come back for confirmation on every new race. Once the coach confirms that a probeg spelling
-- belongs to a student, that exact spelling is stored here and counts as name-EXACT for that student
-- thereafter — new races under it auto-link (source→official_protocol, trust→verified) with no re-ask.
-- coach_confirmed club_records are never overwritten by this path.
create table if not exists public.club_probeg_athlete_links (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.trainingpeaks_students(id) on delete cascade,
  -- The confirmed finisher spelling exactly as probeg shows it (e.g. «Хади Муртазалиева»).
  confirmed_name text not null,
  -- lowercase, ё→е, collapsed spaces — the key the matcher compares a finisher name against.
  confirmed_name_normalized text not null,
  -- Optional resolved probeg profile (/user/<id>/) if the coach pasted one — lets a later scan skip the
  -- name search entirely. Matching itself stays date+distance+time; this is only a shortcut.
  probeg_user_id text,
  confirmed_by text,
  confirmed_at timestamptz not null default now(),
  note text,
  unique (student_id, confirmed_name_normalized)
);

comment on table public.club_probeg_athlete_links is
  'Coach-confirmed probeg finisher spellings per student. A confirmed spelling counts as name-EXACT for that student, so shortened names (Хади vs Хадижат) auto-link on future races instead of re-queuing.';
comment on column public.club_probeg_athlete_links.confirmed_name_normalized is
  'Normalized (lowercase, ё→е, single spaces) confirmed spelling; the matcher compares a finisher name''s normalized form against this. Unique per student.';
comment on column public.club_probeg_athlete_links.probeg_user_id is
  'Optional probeg /user/<id>/ the coach resolved. A shortcut to skip name search on later scans; disambiguation is still date+distance+time.';

-- Coach/admin only. RLS on with no anon/authenticated policies → default-deny; the app reaches it via
-- service_role (which bypasses RLS), exactly like the other club server-side tables. In THIS project
-- service_role gets NO default privilege on a new public table, so grant it explicitly (same as
-- club_calendar_entries) — without this every read/write is "permission denied for table".
alter table public.club_probeg_athlete_links enable row level security;
grant select, insert, update, delete on table public.club_probeg_athlete_links to service_role;

create index if not exists club_probeg_athlete_links_student_idx
  on public.club_probeg_athlete_links (student_id);
