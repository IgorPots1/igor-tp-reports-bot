-- Club calendar → TP rollback INTENT. Additive, non-destructive. Apply before enabling the
-- club-rollback-requested runner.
--
-- The web app (mini-app + admin) CANNOT mutate TrainingPeaks — there are no TP creds there; every
-- TP write/delete is the Mac runner's job. So cancelling an ALREADY-APPLIED start records an INTENT
-- here, and the runner drains it: it deletes the TP entity by applied_tp_workout_id +
-- applied_entity_type (the proven rollback path), then removes the row. A start that has NOT reached
-- TP yet (applied_tp_workout_id IS NULL) is deleted directly by the web app — no TP entity exists.
--
-- These columns record that intent + who asked, so a FAILED rollback stays visible (the row is kept
-- with tp_send_error) and is retried next run, instead of the app silently claiming the start is gone.
alter table public.club_calendar_entries
  add column if not exists tp_rollback_requested_at timestamptz,
  add column if not exists tp_rollback_requested_by text;

comment on column public.club_calendar_entries.tp_rollback_requested_at is
  'Set when a student/coach cancels an ALREADY-APPLIED start. The runner deletes the TP entity by applied_tp_workout_id/applied_entity_type, then removes the row. NULL = no pending rollback. A row kept with this set AND tp_send_error means the TP delete failed and needs attention.';

-- Drain lookup for the runner + the admin "awaiting removal from TP" counter.
create index if not exists club_calendar_entries_rollback_requested_idx
  on public.club_calendar_entries (tp_rollback_requested_at)
  where tp_rollback_requested_at is not null;
