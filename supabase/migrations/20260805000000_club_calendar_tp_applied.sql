-- Club Phase 11 — idempotency for TP execution of calendar entries.
--
-- The assisted-write pipeline's payload-fingerprint check guarantees "execute exactly
-- what was confirmed" but does NOT prevent creating a SECOND identical workout on a
-- re-run (see docs/club-phase11-report.md §4). So the create-level dedup key lives on
-- the source row: once a calendar entry has produced a TP marker workout, its id is
-- stored here, and the planner refuses to plan it again (planCalendarEntryAction skips
-- rows where applied_tp_workout_id IS NOT NULL). Cancellation = delete that workout by
-- id via the existing delete_workout action, then clear these columns.
--
-- Additive, non-destructive. NOT applied by this task.

alter table public.club_calendar_entries
  add column if not exists applied_tp_workout_id bigint,
  add column if not exists applied_at timestamptz;

comment on column public.club_calendar_entries.applied_tp_workout_id is
  'Phase 11 idempotency: the TP workout id created for this entry (null = not yet applied). The planner skips non-null rows; cancellation deletes that workout and clears this.';
