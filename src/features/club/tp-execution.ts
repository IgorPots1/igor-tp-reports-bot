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

/**
 * "Day Off" workout type. CONFIRMED BY FACT from the real cache: a row with
 * workout_type_value_id=7 carries a custom title ("Отдых", "Работа") and is
 * is_planned=false / is_completed=false. So a day-off marker uses TP's NATIVE Day Off
 * type (not the generic Other=100), keeps its title (guard sentinel survives), and is
 * naturally excluded from planned/completion/feed counting by its flags.
 */
export const CLUB_DAYOFF_WORKOUT_TYPE_VALUE_ID = 7;

/**
 * 1.3 — marker title style. Two variants, switchable with THIS ONE constant:
 *   "text"  → prefix "[Клуб]" (default). Portable and robust: no emoji to be mangled by
 *             the TP API / calendar exports / some clients, consistent with the club
 *             mini-app no-emoji convention, and the coach still sees at a glance that the
 *             workout came from the club. The cache-guard anchors on the text sentinel
 *             "клубная пометка", so detection is unaffected either way.
 *   "emoji" → prefix 🛌/🎯/📝/🏁 (a coloured visual marker in the coach's TP calendar).
 * Default is "text"; flip to "emoji" here if the coach prefers the glyphs.
 */
export type ClubMarkerTitleStyle = "text" | "emoji";
export const CLUB_MARKER_TITLE_STYLE: ClubMarkerTitleStyle = "text";

const MARKER_EMOJI: Record<"day_off" | "preference" | "note" | "race", string> = {
  day_off: "🛌",
  preference: "🎯",
  note: "📝",
  race: "🏁",
};

/** Title/description prefix for a marker of the given kind, per CLUB_MARKER_TITLE_STYLE. */
function markerPrefix(kind: "day_off" | "preference" | "note" | "race"): string {
  return CLUB_MARKER_TITLE_STYLE === "emoji" ? MARKER_EMOJI[kind] : "[Клуб]";
}

/**
 * 1.4 — whether to write a race's target time into the TP field `totalTimePlanned`.
 * TP time fields are HOURS (confirmed by fact: the cache's completed_time_raw is hours,
 * see rawHoursToSeconds in service.ts), so the value sent is targetSeconds / 3600.
 * DEFAULT false: the write must be confirmed by a capability probe (a real create + read
 * back, which is Igor's hand) before we send a value on the first real execution. Until
 * then the target time stays only in the description. Flip to true AFTER the probe
 * confirms TP stores/returns totalTimePlanned on a race.
 */
export const CLUB_RACE_SET_PLANNED_TIME = false;

/** Race target seconds → the value for totalTimePlanned (TP hours), or null when disabled. */
function racePlannedTimeHours(targetSeconds: number | null): number | null {
  if (!CLUB_RACE_SET_PLANNED_TIME || !targetSeconds || targetSeconds <= 0) return null;
  return Math.round((targetSeconds / 3600) * 1000) / 1000; // hours, 3 dp
}

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

/**
 * Native TP Event payload (a race as a real Event, not a workout). Contract from a
 * verified UI network capture — docs/tp-write-payloads.md §2. Endpoint is
 * POST /fitness/v6/athletes/{id}/event (SINGULAR /event); the athlete id is `personId`,
 * NOT `athleteId`; eventType is a real type like "RunningRoad", NOT "Other".
 */
export type ClubEventPayload = {
  name: string;
  eventType: string;
  eventDate: string; // YYYY-MM-DD
  personId: number; // the athlete id
  distance: number | null;
  distanceUnits: string;
  atpPriority: number | null;
  raceTypeDuration: null;
  description: string | null;
  goals: Record<string, unknown>;
  legs: unknown[];
  workouts: unknown[];
  results: Array<{ resultType: string }>;
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
  | {
      ok: true;
      requestId: string;
      kind: "start" | "dayoff";
      actionType: "create_event";
      eventPayload: ClubEventPayload;
      label: string;
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
  const plannedTime = racePlannedTimeHours(row.targetResultSeconds);
  const baseDesc = [row.distanceLabel, row.city, row.country].filter((x) => x && x.trim()).join(", ");
  // Keep the target time in the description as a human-readable dup regardless of the field.
  const description = row.targetResultSeconds && row.targetResultSeconds > 0
    ? [baseDesc, `цель ${row.targetResultSeconds}s`].filter(Boolean).join(" · ")
    : (baseDesc || null);
  const unresolved: string[] = [];
  if (row.targetResultSeconds && row.targetResultSeconds > 0 && plannedTime === null) {
    unresolved.push("totalTimePlanned не проставлено (CLUB_RACE_SET_PLANNED_TIME=false до capability probe) - целевое время в описании");
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
    totalTimePlanned: plannedTime,
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
export function planCalendarEntryAction(
  row: ClubCalendarEntryRow,
  athleteId: number | null,
  options?: { raceAsEvent?: boolean }
): ClubActionPlan {
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

  // Race as a native TP Event (CLUB_RACE_AS_EVENT) — a real Event, not a workout. Does
  // not enter the workout cache (verified), so it never counts as training; the club
  // still sees the race from club_calendar_entries. See docs/tp-write-payloads.md §2.
  if (row.kind === "race" && options?.raceAsEvent) {
    const name = (row.raceName && row.raceName.trim()) || `Забег ${row.raceDistanceLabel ?? ""}`.trim();
    const descParts = [row.raceDistanceLabel, row.raceCity].filter((x): x is string => Boolean(x && x.trim()));
    const evUnresolved: string[] = [];
    let goals: Record<string, unknown> = {};
    if (row.raceTargetSeconds && row.raceTargetSeconds > 0) {
      descParts.push(`цель ${row.raceTargetSeconds}s`);
      // goals.time is a REAL field on the event (confirmed by read), but whether CREATE
      // accepts it is unverified, so gate it behind CLUB_RACE_SET_PLANNED_TIME. Default:
      // goals {} (the verified-working shape) + target time in the description.
      if (racePlannedTimeHours(row.raceTargetSeconds) !== null) {
        goals = { time: row.raceTargetSeconds };
      } else {
        evUnresolved.push("goals.time не задан (CLUB_RACE_SET_PLANNED_TIME=false; поле есть, приём на create не проверен) - цель в описании");
      }
    }
    const eventPayload: ClubEventPayload = {
      name,
      eventType: "RunningRoad",
      eventDate: row.date,
      personId: athleteId,
      distance: row.raceDistanceMeters && row.raceDistanceMeters > 0 ? row.raceDistanceMeters : null,
      distanceUnits: "meters",
      atpPriority: null, // клубные старты без A/B/C приоритета
      raceTypeDuration: null,
      description: descParts.length ? descParts.join(" · ") : null,
      goals,
      legs: [],
      workouts: [],
      results: [{ resultType: "Division" }, { resultType: "Gender" }, { resultType: "Overall" }],
    };
    return { ok: true, requestId: row.id, kind: kindTag, actionType: "create_event", eventPayload, label: `Старт (Event): ${name} -> ${row.date}`, unresolved: evUnresolved };
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
    const raceTag = `${markerPrefix("race")} Забег`;
    description = [raceTag, row.raceDistanceLabel, row.raceCity].filter((x) => x && x.trim()).join(" · ") || raceTag;
    workoutTypeValueId = CLUB_RUN_WORKOUT_TYPE_VALUE_ID;
    distancePlanned = row.raceDistanceMeters && row.raceDistanceMeters > 0 ? row.raceDistanceMeters : null;
    if (row.raceTargetSeconds && row.raceTargetSeconds > 0) {
      // Target time always kept in the description; written to the field only when the
      // capability probe has confirmed it (CLUB_RACE_SET_PLANNED_TIME).
      if (racePlannedTimeHours(row.raceTargetSeconds) === null) {
        unresolved.push("targetTime не в поле (CLUB_RACE_SET_PLANNED_TIME=false до capability probe) - целевое время в описании");
      }
      description += ` · цель ${row.raceTargetSeconds}s`;
    }
  } else if (row.kind === "day_off") {
    // day_off → TP NATIVE Day Off type (7), not the generic Other. Keeps a custom title
    // (proven), is is_planned=false so it never counts as a planned/missed workout.
    workoutTypeValueId = CLUB_DAYOFF_WORKOUT_TYPE_VALUE_ID;
    unresolved.push("workoutTypeValueId=7 (Day off) - создание типа Day off проверить ОДНОЙ записью перед массовым исполнением");
    title = `${markerPrefix("day_off")} Выходной`;
    description = row.note && row.note.trim() ? row.note.trim() : "Выходной, запрошен учеником через клуб. План на день не тронут.";
    title = `${title} · ${CLUB_MARKER_TITLE_SENTINEL}`;
  } else {
    // preference / note → "Other" (type 100). Create of type 100 CONFIRMED end-to-end
    // (ручной тест Игоря). These carry a running-keyword risk ("интервальная") so the
    // sentinel is essential - the guard excludes them from feed/counts/missed/nutrition.
    workoutTypeValueId = CLUB_MARKER_WORKOUT_TYPE_VALUE_ID;
    if (row.kind === "preference") {
      title = `${markerPrefix("preference")} Пожелание: ${PREF_RU[row.preferredType ?? ""] ?? row.preferredType ?? "тип"}`;
      description = "Пожелание ученика по типу тренировки на день (через клуб). План не тронут.";
    } else {
      title = `${markerPrefix("note")} Заметка`;
      description = row.note && row.note.trim() ? row.note.trim() : "Заметка ученика на день (через клуб).";
    }
    // Phase A sentinel: guard excludes the row when it returns via cache. See cache-guard.ts.
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
