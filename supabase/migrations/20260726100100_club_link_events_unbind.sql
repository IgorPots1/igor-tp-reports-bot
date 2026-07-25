-- Club coach panel — allow logging unbind/relink in club_link_events (Phase 1.2).
-- The applied table restricts result to confirmed|rejected|conflict; the coach
-- unbind/relink operation needs two more values. NOT applied by this task.

alter table public.club_link_events
  drop constraint if exists club_link_events_result_check;

alter table public.club_link_events
  add constraint club_link_events_result_check
  check (result in ('confirmed', 'rejected', 'conflict', 'unbound', 'relinked'));
