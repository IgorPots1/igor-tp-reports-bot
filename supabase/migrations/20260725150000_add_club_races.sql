-- Club Mini App — race declarations (Старты). Block 6.
--
-- A student DECLARES a race from the mini app; it lands in a coach-approval queue.
-- The student never writes to TrainingPeaks. On approval the coach's existing TP
-- mutation pipeline (dry-run → confirm → queue → local runner → verify) carries the
-- race into TP — see docs/races-plan.md. Fields for a future probeg.org protocol
-- match (reconstructed record → official_protocol upgrade) are included.
--
-- Flag CLUB_RACES_ENABLED (OFF). NOT applied by this task.

create table if not exists public.club_races (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.trainingpeaks_students(id) on delete cascade,
  name text not null,
  race_date date not null,
  distance_meters integer,
  distance_label text,                         -- free label when distance is nonstandard
  city text,
  country text,
  target_result_seconds integer,              -- optional goal time
  status text not null default 'declared'
    check (status in ('declared', 'approved', 'synced_to_tp', 'rejected')),
  approved_by text,                            -- coach identifier who changed status
  approved_at timestamptz,
  sync_result_ref text,                        -- link/id of the TP sync result
  -- protocol matching (future): official result → upgrades a reconstructed record
  protocol_url text,
  protocol_matched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists club_races_student_idx
  on public.club_races (student_id, race_date desc);
create index if not exists club_races_status_idx
  on public.club_races (status, race_date desc);

alter table public.club_races enable row level security;
-- Writes go through the app (service_role); default-deny for anon/authenticated.

comment on table public.club_races is
  'Student race declarations (/m/club Старты). Queue for coach approval; TP sync happens later via the coach mutation pipeline, never from the mini app.';
