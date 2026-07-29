// Club Phase A — cache-pollution guard.
//
// Phase 11 creates "club marker" workouts in TrainingPeaks to represent a student's
// day-off / preference / note request (there is no proven TP event/annotation API, so
// they are description-only planned workouts of type Other=100). On the next cache scan
// these rows return into trainingpeaks_workout_cache. They are NOT real training and
// must be excluded from: the club feed, planned/completion counting (красавчики /
// challenge / statistics / aggregates), missed-workout signals, feedback, records,
// digests — anywhere a real planned/completed workout is counted or shown.
//
// A row is a club marker when EITHER signal fires (naryad A2 — both, so it's
// recognizable by data AND by back-reference):
//   1) TITLE marker  — the title ends with CLUB_MARKER_TITLE_SENTINEL (cheap, works on
//      an already-loaded row without a DB round-trip).
//   2) BACK-REFERENCE — its TrainingPeaks workout id is stored in
//      club_calendar_entries.applied_tp_workout_id (authoritative; survives a title edit).
//
// A club-declared RACE is deliberately NOT a marker: it becomes a genuine planned run
// (type 3) the student intends to do, so it counts like any real planned workout.

import { createSupabaseServerClient } from "@/features/supabase/server";
import { logClubDbError } from "./db-errors";

/**
 * Uniform suffix on every club MARKER title (day_off / preference / note). Distinctive
 * enough that a real workout title will not collide; combined with the authoritative
 * id set it is bulletproof. Kept as the single source of truth: the planner appends it,
 * the guards below detect it.
 */
export const CLUB_MARKER_TITLE_SENTINEL = "клубная пометка";

/** Cheap title check — true when the title carries the club-marker sentinel. */
export function isClubMarkerTitle(title: string | null | undefined): boolean {
  return typeof title === "string" && title.includes(CLUB_MARKER_TITLE_SENTINEL);
}

/**
 * Authoritative set of TrainingPeaks workout ids that are club markers (from
 * club_calendar_entries.applied_tp_workout_id). Empty and tolerant when the column /
 * table is absent (migration not applied) or nothing has been executed yet — the title
 * check still guards those cases. Small set (only executed markers).
 */
export async function loadClubMarkerWorkoutIds(): Promise<Set<number>> {
  const out = new Set<number>();
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("club_calendar_entries")
    .select("applied_tp_workout_id")
    .not("applied_tp_workout_id", "is", null);
  if (error || !data) {
    // Data-integrity read: if this fails (permission/column), club markers stop being excluded
    // and pollute feed/красавчики/challenge/records. A missing TABLE is benign; anything else
    // must be seen, not silently degrade counting.
    logClubDbError("loadClubMarkerWorkoutIds", error);
    return out;
  }
  for (const row of data as Array<{ applied_tp_workout_id: number | string | null }>) {
    const id = row.applied_tp_workout_id;
    if (id != null && Number.isFinite(Number(id))) out.add(Number(id));
  }
  return out;
}

/**
 * True when a cache row is a club marker: title sentinel OR TP workout id in the
 * authoritative marker set. `markerIds` is optional — pass it (from
 * loadClubMarkerWorkoutIds) when the back-reference matters; omit for a title-only check.
 */
export function isClubMarkerCacheRow(
  row: { title?: string | null; trainingPeaksWorkoutId?: number | null; workoutTypeValueId?: number | null },
  markerIds?: Set<number>
): boolean {
  if (isClubMarkerTitle(row.title ?? null)) {
    return true;
  }
  if (markerIds && row.trainingPeaksWorkoutId != null && markerIds.has(row.trainingPeaksWorkoutId)) {
    return true;
  }
  return false;
}
