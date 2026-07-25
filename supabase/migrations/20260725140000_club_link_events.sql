-- Club Mini App — registration attempt log (spec v3 block 2.1).
--
-- Every /m/club binding attempt is logged: who (telegram user), when, result
-- (confirmed | rejected | conflict), reason. Rejections and conflicts must be
-- visible to the coach (admin view is a follow-up; this table is the data).
--
-- NOT applied by this task. Until applied, logClubLinkEvent is inert (writes are
-- wrapped and swallowed). Conflicts are ALSO surfaced live to the coach via the
-- existing resolver Telegram notification, so coach visibility does not depend on
-- this table.

create table if not exists public.club_link_events (
  id uuid primary key default gen_random_uuid(),
  telegram_user_id bigint,
  telegram_username text,
  -- intended / bound student (nullable: a rejected attempt may not resolve one)
  student_id uuid references public.trainingpeaks_students(id) on delete set null,
  result text not null check (result in ('confirmed', 'rejected', 'conflict')),
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists club_link_events_result_idx
  on public.club_link_events (result, created_at desc);
create index if not exists club_link_events_user_idx
  on public.club_link_events (telegram_user_id, created_at desc);

comment on table public.club_link_events is
  'Audit of /m/club account-binding attempts (confirmed|rejected|conflict). Coach-visible; rejections/conflicts need review.';
