-- Race Protocols matcher (Фаза 10.3) — the PROBABLE confirmation queue. Additive, non-destructive.
-- Apply before running the writer with --commit.
--
-- EXACT matches auto-link straight into club_records (source=official_protocol, trust=verified). PROBABLE
-- ones (name matches but our GPS distance is suspect, or a shortened/unreadable name, or a surname-less
-- student) land HERE for the coach to confirm — both sides side by side, as in the probe output. On
-- confirm, the row is promoted into club_records and the probeg spelling is remembered in
-- club_probeg_athlete_links so the same person never re-queues. UNIQUE(student, date, protocol time)
-- makes the writer idempotent: a re-run touches nothing already queued or resolved.
create table if not exists public.club_protocol_pending (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.trainingpeaks_students(id) on delete cascade,
  -- our side (from race_events + the day's workout)
  race_date date not null,
  our_seconds integer,
  our_distance_km numeric,
  our_title text,
  -- protocol side (from probeg)
  protocol_url text,
  protocol_name text,
  protocol_event text,
  protocol_city text,
  protocol_place text,
  protocol_seconds integer,
  protocol_distance_km numeric,
  -- why it is only PROBABLE (shown to the coach)
  distance_doubtful boolean not null default false,
  name_unrecognized boolean not null default false,
  weak_name boolean not null default false,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected')),
  resolved_by text,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (student_id, race_date, protocol_seconds)
);

comment on table public.club_protocol_pending is
  'PROBABLE protocol matches awaiting coach confirmation. On confirm → club_records (official_protocol/verified) + club_probeg_athlete_links (remembered spelling). UNIQUE(student, date, protocol time) makes the writer idempotent.';

alter table public.club_protocol_pending enable row level security;

create index if not exists club_protocol_pending_status_idx
  on public.club_protocol_pending (status, student_id);
