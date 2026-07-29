-- Club — real "opened the club" record. Until now there was NO stored open signal:
-- /api/m/club/clientlog only console.warns (Vercel logs, not queryable) and club_link_events
-- logs BIND attempts, not opens. So "~1 open" was missing logging, not missing people.
--
-- One row per (student, day): upserted on every SUCCESSFUL club resolve, so the table stays
-- bounded (<= students * days) yet answers "who opened, when last, how many unique this week,
-- from which section". `last_section` is the section the most recent open came from (via the
-- deep-link start_param: starts / schedule / главная).
--
-- Additive, non-destructive. NOT applied by this task.

create table if not exists public.club_open_events (
  student_id uuid not null references public.trainingpeaks_students(id) on delete cascade,
  open_date date not null,
  telegram_user_id bigint,
  last_section text,
  last_seen_at timestamptz not null default now(),
  primary key (student_id, open_date)
);

create index if not exists club_open_events_last_seen_idx on public.club_open_events (last_seen_at desc);
create index if not exists club_open_events_date_idx on public.club_open_events (open_date);

comment on table public.club_open_events is
  'Real club-open log: one row per student per day, upserted on each successful club resolve. Answers who opened / last seen / unique-per-week / from which section. Fills the gap where clientlog only logged to console.';
