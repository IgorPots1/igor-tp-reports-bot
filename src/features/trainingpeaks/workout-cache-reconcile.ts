// Reconciliation logic for the TrainingPeaks workout cache.
//
// The scanner only ever upserts rows by (athlete_id, workout_id) and never used
// to delete rows that TrainingPeaks stopped returning. When a plan is moved to a
// new date or deleted after its date left the previous scan window, the old
// planned-but-not-completed row lingers forever as a "phantom".
//
// Fix: after a SUCCESSFUL scan of a student's window, delete the planned rows in
// that window that this run did not refresh. `scanned_at` acts as a "last seen"
// marker: rows the current run touched carry `scanned_at === runStartedAt`; rows
// TrainingPeaks no longer returns keep their older `scanned_at` and are stale.
//
// The predicate below is the single source of truth for "which rows are stale".
// It MUST stay in sync with the supabase filters in
// `reconcileTrainingPeaksWorkoutCachePlannedRows` (repository.ts), which is the
// production implementation that actually runs the delete server-side.

export type PlannedCacheRowForReconcile = {
  workout_date: string;
  is_planned: boolean;
  is_completed: boolean;
  scanned_at: string;
};

export type ReconcileWindow = {
  from: string;
  to: string;
  // Fixed once at the start of the run, before the student loop. Upserted rows
  // are written with scanned_at === runStartedAt, so `scanned_at < runStartedAt`
  // never matches a row this run just wrote.
  runStartedAt: string;
};

// A row is a stale phantom (safe to delete) iff it sits inside the scanned
// window, is a still-open plan (planned & not completed), and was NOT refreshed
// by the current run. Completed rows are never touched.
export function plannedCacheRowIsStale(
  row: PlannedCacheRowForReconcile,
  win: ReconcileWindow,
): boolean {
  return (
    row.workout_date >= win.from &&
    row.workout_date <= win.to &&
    row.is_planned &&
    !row.is_completed &&
    row.scanned_at < win.runStartedAt
  );
}

// Pure model of the reconcile delete for ONE student after a scan of `win`.
//
// SAFETY: when the student's scan did not succeed (`scanOk === false`, e.g. HTTP
// 401 / non-array body / thrown error before the upsert), NOTHING is deleted —
// otherwise a failed scan would wipe live plans. The production call site
// enforces this by only invoking the reconcile delete after a successful upsert.
export function selectRowsToReconcile<T extends PlannedCacheRowForReconcile>(
  rows: T[],
  win: ReconcileWindow,
  scanOk: boolean,
): T[] {
  if (!scanOk) {
    return [];
  }
  return rows.filter((row) => plannedCacheRowIsStale(row, win));
}
