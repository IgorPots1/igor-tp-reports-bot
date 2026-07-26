// Phase 3 — translate an APPROVED club request into an assisted-write action SPEC
// for the EXISTING TrainingPeaks executor. PURE: no Supabase, no network, no
// enqueue, no execution. A spec produced here would be handed to
// createTrainingPeaksAction (action_type=create_workout, status=pending_coach),
// after which the proven pipeline takes over: dry-run → coach confirm → local
// runner → verify → rollback. Nothing here writes to TP or to the DB.
//
// SAFETY: this module only PLANS. Turning a plan into a queued action is gated by
// CLUB_TP_EXECUTION_ENABLED (OFF) and is NOT done here or by the dry-run script.

import type { CreateWorkoutPayload } from "@/features/trainingpeaks/tp-write-action-types";

export { isClubTpExecutionEnabled } from "./constants";

/**
 * Run workout type. workoutTypeValueId=3 = run is CONFIRMED
 * (workout-activity-classification.ts; move-workout-resolver.test.ts). A club race
 * is a planned run — we reuse this proven type rather than invent a "race" type id.
 */
export const CLUB_RUN_WORKOUT_TYPE_VALUE_ID = 3;

export type ClubRaceRow = {
  id: string;
  studentId: string;
  name: string | null;
  raceDate: string | null;
  distanceMeters: number | null;
  distanceLabel: string | null;
  city: string | null;
  country: string | null;
  targetResultSeconds: number | null;
  status: string;
};

export type ClubDayoffRow = {
  id: string;
  studentId: string;
  fromDate: string | null;
  toDate: string | null;
  reason: string | null;
  status: string;
};

export type ClubActionPlan =
  | {
      ok: true;
      requestId: string;
      kind: "start" | "dayoff";
      actionType: "create_workout";
      payload: CreateWorkoutPayload;
      label: string;
      /** Fields we could NOT resolve from a proven source — left unset, never guessed. */
      unresolved: string[];
    }
  | { ok: false; requestId: string; kind: "start" | "dayoff"; reason: string };

/**
 * Approved club start → create_workout spec (a planned race on the athlete's TP
 * calendar). Reuses the proven run type. Does NOT set a planned time from
 * target_result_seconds — the totalTimePlanned unit on the write payload is not
 * proven here, so we leave it null and flag it rather than send a wrong-unit value.
 */
export function planClubRaceAction(row: ClubRaceRow, athleteId: number | null): ClubActionPlan {
  if (row.status !== "approved") {
    return { ok: false, requestId: row.id, kind: "start", reason: `status=${row.status} (нужно approved)` };
  }
  if (!athleteId || !Number.isFinite(athleteId)) {
    return { ok: false, requestId: row.id, kind: "start", reason: "нет trainingpeaks_athlete_id у ученика" };
  }
  if (!row.raceDate) {
    return { ok: false, requestId: row.id, kind: "start", reason: "нет даты старта" };
  }
  const title = (row.name && row.name.trim()) || `Гонка ${row.distanceLabel ?? ""}`.trim();
  const description = [row.distanceLabel, row.city, row.country].filter((x) => x && x.trim()).join(", ") || null;
  const unresolved: string[] = [];
  if (row.targetResultSeconds && row.targetResultSeconds > 0) {
    unresolved.push("totalTimePlanned (единица totalTimePlanned на write-payload не подтверждена — целевое время НЕ проставлено)");
  }
  const payload: CreateWorkoutPayload = {
    athleteId,
    workoutDay: row.raceDate,
    title,
    workoutTypeValueId: CLUB_RUN_WORKOUT_TYPE_VALUE_ID,
    workoutSubTypeId: null,
    description,
    coachComments: null,
    distancePlanned: row.distanceMeters && row.distanceMeters > 0 ? row.distanceMeters : null,
    totalTimePlanned: null,
    structure: null,
  };
  return {
    ok: true,
    requestId: row.id,
    kind: "start",
    actionType: "create_workout",
    payload,
    label: `Старт: ${title} → ${row.raceDate}`,
    unresolved,
  };
}

/**
 * Approved day-off request. There is NO proven TP representation of a "day off" as
 * a create/update payload, and the destructive reading (removing planned sessions
 * across from..to) must never be fabricated. So this is deliberately a REVIEW CASE,
 * not an auto-action: the coach applies days off manually in TP until a proven
 * day-off action type exists. See docs/questions.md §26.
 */
export function planClubDayoffAction(row: ClubDayoffRow): ClubActionPlan {
  if (row.status !== "approved") {
    return { ok: false, requestId: row.id, kind: "dayoff", reason: `status=${row.status} (нужно approved)` };
  }
  return {
    ok: false,
    requestId: row.id,
    kind: "dayoff",
    reason:
      "выходной не имеет ПРОВЕРЕННОГО TP-представления (нет type-id отдыха; деструктивная " +
      "трактовка «снять сессии» не фабрикуется) — ручной review-case, тренер применяет в TP. См. questions.md §26",
  };
}
