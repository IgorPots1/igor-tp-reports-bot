-- Club calendar → TP auto-send tracking. Additive, non-destructive. Apply before enabling the
-- club-execute-approved runner. No new QUEUE table is needed: the queue IS the set of entries
-- with status='approved' AND applied_tp_workout_id IS NULL. Once an entry is applied (status
-- 'applied' + id set) the runner never touches it again → re-runs never duplicate in TP.
--
-- These columns record the LAST send attempt so the coach admin can show what is queued and what
-- FAILED (with a reason), and so a failed entry stays 'approved' and is retried next run.

alter table public.club_calendar_entries
  add column if not exists tp_send_attempts integer not null default 0,
  add column if not exists tp_send_attempted_at timestamptz,
  add column if not exists tp_send_error text;

comment on column public.club_calendar_entries.tp_send_error is
  'Last auto-send error (NULL = never failed / succeeded). The entry stays status=approved and is retried; the coach admin lists these as failed-with-reason. Cleared on a successful apply.';

-- "Awaiting send" + "failed" lookups for the admin counter: approved rows not yet applied.
create index if not exists club_calendar_entries_awaiting_send_idx
  on public.club_calendar_entries (status, applied_tp_workout_id)
  where status = 'approved' and applied_tp_workout_id is null;
