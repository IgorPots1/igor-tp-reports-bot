-- Comparison base (наряд 2). Praise pause needs to know when a student was last
-- given a positive observation, and of what WEIGHT (composite=3 > mechanism A=2
-- > mechanism B=1) — a stronger praise breaks a weaker one's 14-day pause.
--
-- A log, not a column on the student: praise is an event with history (audit of
-- when / for what / how strong), append-only. The comparison layer inserts a row
-- when it emits a praise; it reads back the latest row per student to gate the pause.
--
-- Design doc: /Users/igor/dev-notes/20 Coach OS/2026-07-14 Comparison Base Design.md.

create table if not exists public.trainingpeaks_comparison_praise_log (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.trainingpeaks_students(id) on delete cascade,
  praised_at date not null,                 -- the compared workout's date
  observation_kind text not null,           -- 'composite' | 'mechanism_a' | 'mechanism_b'
  weight smallint not null,                 -- 3 | 2 | 1 (composite > A > B)
  tier smallint,                            -- 1 | 2 | 3 (which matcher)
  trainingpeaks_workout_id bigint,
  created_at timestamptz not null default now(),

  constraint trainingpeaks_comparison_praise_log_kind_check
    check (observation_kind in ('composite', 'mechanism_a', 'mechanism_b')),
  constraint trainingpeaks_comparison_praise_log_weight_check
    check (weight between 1 and 3)
);

create index if not exists trainingpeaks_comparison_praise_log_student_date_idx
  on public.trainingpeaks_comparison_praise_log (student_id, praised_at desc);

revoke all on table public.trainingpeaks_comparison_praise_log from anon, authenticated, public;
grant select, insert on table public.trainingpeaks_comparison_praise_log to service_role;

alter table public.trainingpeaks_comparison_praise_log enable row level security;
