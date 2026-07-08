-- Reconciliation RPC for the TrainingPeaks workout cache.
--
-- service_role is deliberately NOT granted DELETE on cache/record tables
-- (trainingpeaks_workout_cache among them). The scanner needs to delete stale
-- "phantom" planned rows (plans TrainingPeaks no longer returns) after a
-- successful scan, but we do not want to hand the server role blanket DELETE on
-- this table.
--
-- Instead: a narrow SECURITY DEFINER function, owned by postgres (which has
-- DELETE), that can ONLY delete planned-but-not-completed rows inside a given
-- window whose scanned_at is older than the run's start. service_role gets
-- EXECUTE on this function — not DELETE on the table. Completed rows and rows
-- refreshed by the current run (scanned_at >= p_run_started_at) are never touched.
--
-- Mirrors plannedCacheRowIsStale() in
-- src/features/trainingpeaks/workout-cache-reconcile.ts.

create or replace function public.reconcile_trainingpeaks_workout_cache_planned_rows(
  p_student_id uuid,
  p_from date,
  p_to date,
  p_run_started_at timestamptz
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from public.trainingpeaks_workout_cache
   where student_id = p_student_id
     and workout_date between p_from and p_to
     and is_planned
     and not is_completed
     and scanned_at < p_run_started_at;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

-- Lock down execution: only the server role may call it.
revoke all on function public.reconcile_trainingpeaks_workout_cache_planned_rows(uuid, date, date, timestamptz) from public;
revoke all on function public.reconcile_trainingpeaks_workout_cache_planned_rows(uuid, date, date, timestamptz) from anon;
revoke all on function public.reconcile_trainingpeaks_workout_cache_planned_rows(uuid, date, date, timestamptz) from authenticated;
grant execute on function public.reconcile_trainingpeaks_workout_cache_planned_rows(uuid, date, date, timestamptz) to service_role;
