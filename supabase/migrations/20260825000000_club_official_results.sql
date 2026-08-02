-- Club — full journal of a student's OFFICIAL race results (verified against a probeg protocol).
-- Additive, non-destructive. Separate from club_records ON PURPOSE: club_records is the PR SHOWCASE
-- for the four standard buckets (5k/10k/21k/42k) and its reconstruction pipeline is tied to those keys;
-- extending distance_key would ripple through it. This table holds EVERY confirmed official result at
-- ANY distance (15k/30k/3k, and the standard ones too — a complete race log), shown in the student
-- profile as a dated list. club_records stays the "best-4" view; this is "all official results".
create table if not exists public.club_official_results (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.trainingpeaks_students(id) on delete cascade,
  race_date date not null,
  distance_km numeric,        -- any distance (null when the protocol gave none we can read)
  distance_label text,        -- e.g. «15 км», «Марафон» — for display
  result_seconds integer not null,
  -- protocol side (the verified source)
  protocol_url text,
  protocol_name text,         -- finisher name exactly as probeg shows it
  place text,
  city text,
  event text,
  source text not null default 'official_protocol' check (source in ('official_protocol', 'coach_confirmed')),
  trust text not null default 'verified' check (trust in ('verified', 'preliminary')),
  distance_doubtful boolean not null default false, -- our GPS distance conflicted; still confirmed by name+time
  confirmed_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- one journal row per student + date + protocol; a re-run of the writer updates in place
  unique (student_id, race_date, protocol_url)
);

comment on table public.club_official_results is
  'Full journal of a student''s official (protocol-verified) race results, ANY distance. club_records stays the best-4 PR showcase; this is the complete dated list shown in the student profile.';

alter table public.club_official_results enable row level security;
-- service_role gets NO default privilege on a new public table in this project — grant explicitly, or
-- every read/write is "permission denied for table" (same pattern as club_calendar_entries).
grant select, insert, update, delete on table public.club_official_results to service_role;

create index if not exists club_official_results_student_idx
  on public.club_official_results (student_id, race_date desc);
