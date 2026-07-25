-- Club Mini App — training-process wishes (Пожелания). Block 7.1.
--
-- Mirrors the nutrition weekly check-in pattern: 1–10 scales + free text. The
-- student sees their own past submissions; the coach is NOT auto-notified (the
-- club never pushes to students, and nothing is auto-sent to the coach either —
-- surfaced later in the coach panel). Flag CLUB_WISHES_ENABLED (OFF). NOT applied.

create table if not exists public.club_wishes (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.trainingpeaks_students(id) on delete cascade,
  load_scale smallint check (load_scale between 1 and 10),
  wellbeing_scale smallint check (wellbeing_scale between 1 and 10),
  schedule_scale smallint check (schedule_scale between 1 and 10),
  note text,
  created_at timestamptz not null default now()
);

create index if not exists club_wishes_student_idx
  on public.club_wishes (student_id, created_at desc);

alter table public.club_wishes enable row level security;

comment on table public.club_wishes is
  'Student training-process wishes (/m/club Пожелания): 1–10 scales + free text. Read by coach later; no auto-send.';
