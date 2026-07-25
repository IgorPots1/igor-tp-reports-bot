-- Club Mini App — day-off REQUESTS (Выходные). Block 8 / v3 2.3.
--
-- A student REQUESTS a day off (does NOT set it). It lands in a coach-approval
-- queue. No TP write, no auto-apply, no notifications. On approval the coach's TP
-- mutation pipeline applies it — see docs/races-plan.md / miniapp-club-report-v4.md.
-- Flag CLUB_DAYOFF_ENABLED (OFF). NOT applied by this task.

create table if not exists public.club_dayoff_requests (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.trainingpeaks_students(id) on delete cascade,
  from_date date not null,
  to_date date not null,
  reason text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'applied')),
  status_by text,
  status_at timestamptz,
  apply_result_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint club_dayoff_window check (to_date >= from_date)
);

create index if not exists club_dayoff_student_idx
  on public.club_dayoff_requests (student_id, from_date desc);
create index if not exists club_dayoff_status_idx
  on public.club_dayoff_requests (status, from_date desc);

alter table public.club_dayoff_requests enable row level security;

comment on table public.club_dayoff_requests is
  'Student day-off requests (/m/club Выходные). Coach-approval queue; TP apply happens later via the coach pipeline, never from the mini app.';
