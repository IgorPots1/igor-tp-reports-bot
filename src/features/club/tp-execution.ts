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

import { CLUB_MARKER_TITLE_SENTINEL } from "./cache-guard";

export { isClubTpExecutionEnabled } from "./constants";

/**
 * Run workout type. workoutTypeValueId=3 = run is CONFIRMED
 * (workout-activity-classification.ts; move-workout-resolver.test.ts). A club race
 * is a planned run — we reuse this proven type rather than invent a "race" type id.
 */
export const CLUB_RUN_WORKOUT_TYPE_VALUE_ID = 3;

/**
 * "Other" workout type (TP catch-all, confirmed present in the real cache —
 * workout-activity-classification.ts). Used for non-race markers (day_off / note /
 * preference) so a marker is NOT mislabelled as a run. NOTE: create of a type-100
 * workout is not independently proven end-to-end here — flagged in `unresolved` so the
 * dry-run surfaces it and the coach tests one before mass execution.
 */
export const CLUB_MARKER_WORKOUT_TYPE_VALUE_ID = 100;

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
    unresolved.push("totalTimePlanned (единица totalTimePlanned на write-payload не подтверждена - целевое время НЕ проставлено)");
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
      "трактовка «снять сессии» не фабрикуется) - ручной review-case, тренер применяет в TP. См. questions.md §26",
  };
}

// ---------------------------------------------------------------------------
// Phase 11 — unified calendar entry → TP "pometka" (description-only planned workout)
// ---------------------------------------------------------------------------
// KEY PRINCIPLE (naryad 11): TP gets ONLY NEW MARKER events — existing workouts and
// plans are NEVER modified/deleted/moved. TP's write client can create ONLY workouts
// (the events/note/day-off API is unproven — probe returned HTTP 500, see
// docs/club-phase11-report.md §1). So each marker is a DESCRIPTION-ONLY planned
// workout with a recognizable title, which COEXISTS with whatever is already planned
// that day (it does not touch it). This reuses the fully-proven create_workout path —
// no new action type, no new/unproven client method.

export type ClubCalendarEntryRow = {
  id: string;
  studentId: string;
  date: string | null;
  kind: "day_off" | "preference" | "note" | "race";
  preferredType: "long" | "intervals" | "rest" | null;
  note: string | null;
  raceName: string | null;
  raceCity: string | null;
  raceDistanceLabel: string | null;
  raceDistanceMeters: number | null;
  raceTargetSeconds: number | null;
  status: string;
  /** Idempotency: the TP workout id this entry already created (null = not applied). */
  appliedTpWorkoutId: number | null;
};

const PREF_RU: Record<string, string> = { long: "длительная", intervals: "интервальная", rest: "отдых" };

/**
 * Approved calendar entry → create_workout spec (a NEW marker workout on the date;
 * the existing plan is untouched). Skips entries already applied (idempotency). The
 * title is uniform and recognizable so it's obvious in the TP calendar the marker
 * came from the club. Nothing here queues or executes — pure planning.
 */
export function planCalendarEntryAction(row: ClubCalendarEntryRow, athleteId: number | null): ClubActionPlan {
  const kindTag = row.kind === "race" ? "start" : "dayoff"; // reuse the existing ClubActionPlan kind union
  if (row.status !== "approved") {
    return { ok: false, requestId: row.id, kind: kindTag, reason: `status=${row.status} (нужно approved)` };
  }
  if (row.appliedTpWorkoutId) {
    return { ok: false, requestId: row.id, kind: kindTag, reason: `уже применено (tp_workout_id=${row.appliedTpWorkoutId}) - идемпотентно пропущено` };
  }
  if (!athleteId || !Number.isFinite(athleteId)) {
    return { ok: false, requestId: row.id, kind: kindTag, reason: "нет trainingpeaks_athlete_id у ученика" };
  }
  if (!row.date) {
    return { ok: false, requestId: row.id, kind: kindTag, reason: "нет даты записи" };
  }

  // Race stays a run-typed planned workout (distance kept); the rest are description-
  // only markers with no distance/time (a note pinned to the day).
  let title: string;
  let description: string | null;
  let workoutTypeValueId: number;
  let distancePlanned: number | null = null;
  const unresolved: string[] = [];

  if (row.kind === "race") {
    title = (row.raceName && row.raceName.trim()) || `Забег ${row.raceDistanceLabel ?? ""}`.trim();
    description = ["🏁 Забег (заявка ученика)", row.raceDistanceLabel, row.raceCity].filter((x) => x && x.trim()).join(" · ") || "🏁 Забег (заявка ученика)";
    workoutTypeValueId = CLUB_RUN_WORKOUT_TYPE_VALUE_ID;
    distancePlanned = row.raceDistanceMeters && row.raceDistanceMeters > 0 ? row.raceDistanceMeters : null;
    if (row.raceTargetSeconds && row.raceTargetSeconds > 0) {
      unresolved.push("targetTime (единица totalTimePlanned не подтверждена - целевое время в описании, не в поле)");
      description += ` · цель ${row.raceTargetSeconds}s`;
    }
  } else {
    // Non-race markers → description-only "Other" (type 100) workout, coexists with plan.
    workoutTypeValueId = CLUB_MARKER_WORKOUT_TYPE_VALUE_ID;
    unresolved.push("workoutTypeValueId=100 (Other) - создание типа Other не подтверждено end-to-end, проверить одну запись перед массовым исполнением");
    if (row.kind === "day_off") {
      title = "🛌 Выходной день (заявка ученика)";
      description = row.note && row.note.trim() ? row.note.trim() : "Выходной, запрошен учеником через клуб. План на день не тронут.";
    } else if (row.kind === "preference") {
      title = `🎯 Пожелание: ${PREF_RU[row.preferredType ?? ""] ?? row.preferredType ?? "тип тренировки"}`;
      description = "Пожелание ученика по типу тренировки на день (через клуб). План не тронут.";
    } else {
      title = "📝 Заметка ученика";
      description = row.note && row.note.trim() ? row.note.trim() : "Заметка ученика на день (через клуб).";
    }
    // Phase A: mark every non-race marker title with the sentinel so the cache-guard can
    // exclude it from feed/completion/missed-signal/nutrition when it returns via cache
    // (these markers are type Other=100 and a running-keyword title like "интервальная"
    // would otherwise be misclassified as a run). Race markers are real planned runs —
    // no sentinel. See src/features/club/cache-guard.ts.
    title = `${title} · ${CLUB_MARKER_TITLE_SENTINEL}`;
  }

  const payload: CreateWorkoutPayload = {
    athleteId,
    workoutDay: row.date,
    title,
    workoutTypeValueId,
    workoutSubTypeId: null,
    description,
    coachComments: null,
    distancePlanned,
    totalTimePlanned: null,
    structure: null,
  };
  return {
    ok: true,
    requestId: row.id,
    kind: kindTag,
    actionType: "create_workout",
    payload,
    label: `${title} → ${row.date}`,
    unresolved,
  };
}
