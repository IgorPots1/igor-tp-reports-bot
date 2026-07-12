-- PR3: generalize the assisted-write action pipeline beyond move_workout.
--
-- trainingpeaks_actions.action_type currently has a CHECK constraint pinning it
-- to the single literal 'move_workout' (confirmed via information_schema +
-- pg_constraint read before writing this migration -- the naryad's proposed
-- short names like 'move'/'create' do NOT match the real existing value).
-- This migration widens that constraint to the real, already-established
-- naming convention (snake_case, "<verb>_workout" / "batch"), and adds the
-- columns needed for rollback (pre_image_json, prior_workout_day) and batch
-- parent/child linkage (parent_batch_action_id) plus rollback linkage
-- (rollback_of_run_id).
--
-- NOT APPLIED by the agent -- deny-guard blocks supabase db/migration commands
-- from this session by design (TrainingPeaks/Supabase writes require Igor's
-- explicit hand). Apply manually:
--   supabase db push
-- or via the Supabase SQL editor, after review.

begin;

-- 1) Widen action_type beyond the single 'move_workout' value.
alter table public.trainingpeaks_actions
  drop constraint trainingpeaks_actions_action_type_check;

alter table public.trainingpeaks_actions
  add constraint trainingpeaks_actions_action_type_check
  check (
    action_type = any (
      array[
        'move_workout',
        'create_workout',
        'update_workout',
        'delete_workout',
        'strength_workout',
        'batch'
      ]
    )
  );

-- 2) Batch parent/child linkage. A 'batch' action is a parent row that exists
--    purely to carry ONE coach confirmation for the whole batch; each real
--    unit of work is its own ordinary action row (action_type = create_workout
--    / update_workout / etc) with parent_batch_action_id set to the parent's
--    id. Deleting the parent cascades to its children (a batch's children are
--    meaningless without it).
alter table public.trainingpeaks_actions
  add column parent_batch_action_id uuid references public.trainingpeaks_actions(id) on delete cascade;

create index if not exists trainingpeaks_actions_parent_batch_action_id_idx
  on public.trainingpeaks_actions (parent_batch_action_id)
  where parent_batch_action_id is not null;

-- 3) Rollback linkage. A rollback is itself an ordinary assisted action (goes
--    through propose -> dry-run -> coach confirm -> execute, same as anything
--    else) whose action_type/payload are derived from the ORIGINAL run's
--    pre-image. rollback_of_run_id points at the action_run being undone.
--    ON DELETE SET NULL: if the original run is ever purged, the rollback
--    action record itself should not disappear (it's still a real thing that
--    happened / was proposed), it just loses the backlink.
alter table public.trainingpeaks_actions
  add column rollback_of_run_id uuid references public.trainingpeaks_action_runs(id) on delete set null;

create index if not exists trainingpeaks_actions_rollback_of_run_id_idx
  on public.trainingpeaks_actions (rollback_of_run_id)
  where rollback_of_run_id is not null;

-- 4) Pre-image + prior-state capture, promoted from being buried inside
--    log_json (current move behavior) to first-class columns so rollback can
--    read them directly without parsing an opaque blob.
alter table public.trainingpeaks_action_runs
  add column pre_image_json jsonb;

alter table public.trainingpeaks_action_runs
  add column prior_workout_day text;

commit;
