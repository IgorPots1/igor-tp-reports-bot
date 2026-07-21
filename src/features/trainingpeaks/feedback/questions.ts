// C5 (accumulation) + C6 (situational contradiction) — questions, not verdicts.
// Design: "не частить" — these are meant to be occasional, so both are scoped
// narrowly rather than firing on every ambiguous data point.
//
// C6 deliberately does NOT re-cover "data clean but words say tired" via pulse
// (that is C4's job now, per Igor's words-beat-the-number correction: an
// elevated pulse arbitrated by "tired" words becomes a CONFIRMED cause, not a
// contradiction question). C6 fills the gap C4 cannot see: words say tired
// while NO pulse/decoupling trigger fired at all — the corpus example "чисто,
// а «умер»". The inverse corpus example ("плохо, а «легко»") is now C4's silent
// branch, not a C6 contradiction — asking after the student already said they
// were fine would contradict Igor's own rule that words close the loop.

import { classifyWords } from "./fatigue-cause.ts";
import type { ContextPacket, PlannerDerivedMetrics } from "./types.ts";

export const ACCUMULATION_RECENT_WINDOW_DAYS = 14;
export const ACCUMULATION_BASELINE_WINDOW_DAYS = 56;
export const ACCUMULATION_LOAD_INCREASE_PCT = 20; // judgment call
export const ACCUMULATION_MIN_RECENT_WORKOUTS = 3;
export const ACCUMULATION_MIN_BASELINE_WORKOUTS = 4;

export type QuestionOutcome = { fired: false } | { fired: true; numbers: Record<string, number>; reason: string };

function daysBeforeDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function totalDuration(rows: PlannerDerivedMetrics[]): number {
  return rows.reduce((sum, r) => sum + (r.durationS ?? 0), 0);
}

/** C5 — 2-3 weeks of accumulated load vs this student's own longer baseline.
 *  There is no TSS in this base (design doc D2 note); duration is the trend
 *  proxy — same limitation the design flagged as "уточнить". */
export function evaluateAccumulationQuestion(packet: ContextPacket): QuestionOutcome {
  const workoutDate = packet.workout.workoutDate;
  const recentFrom = daysBeforeDate(workoutDate, ACCUMULATION_RECENT_WINDOW_DAYS);
  const baselineFrom = daysBeforeDate(workoutDate, ACCUMULATION_BASELINE_WINDOW_DAYS);

  const recent = packet.history.filter((r) => r.workoutDate >= recentFrom && r.workoutDate < workoutDate);
  const baseline = packet.history.filter((r) => r.workoutDate >= baselineFrom && r.workoutDate < recentFrom);

  if (recent.length < ACCUMULATION_MIN_RECENT_WORKOUTS || baseline.length < ACCUMULATION_MIN_BASELINE_WORKOUTS) {
    return { fired: false };
  }

  const recentWeeklyAvgS = totalDuration(recent) / (ACCUMULATION_RECENT_WINDOW_DAYS / 7);
  const baselineWeeks = (ACCUMULATION_BASELINE_WINDOW_DAYS - ACCUMULATION_RECENT_WINDOW_DAYS) / 7;
  const baselineWeeklyAvgS = totalDuration(baseline) / baselineWeeks;

  if (baselineWeeklyAvgS <= 0) return { fired: false };

  const increasePct = ((recentWeeklyAvgS - baselineWeeklyAvgS) / baselineWeeklyAvgS) * 100;
  if (increasePct < ACCUMULATION_LOAD_INCREASE_PCT) return { fired: false };

  return {
    fired: true,
    numbers: { recentWeeklyAvgMin: Math.round(recentWeeklyAvgS / 60), baselineWeeklyAvgMin: Math.round(baselineWeeklyAvgS / 60), increasePct: Math.round(increasePct) },
    reason: `recent ${ACCUMULATION_RECENT_WINDOW_DAYS}d weekly avg ${Math.round(recentWeeklyAvgS / 60)}min is ${Math.round(increasePct)}% above this student's own ${Math.round(baselineWeeks)}-week baseline ${Math.round(baselineWeeklyAvgS / 60)}min`,
  };
}

/** C6 — words say tired, but no pulse/decoupling trigger fired at all (so C4
 *  never engaged). Pass C4's outcome kind so this never double-fires. */
export function evaluateContradictionQuestion(packet: ContextPacket, fatigueCauseTriggered: boolean): QuestionOutcome {
  if (fatigueCauseTriggered) return { fired: false }; // C4 already owns this workout's tired-signal

  const words = classifyWords(packet.memoryItems, packet.workout.workoutDate);
  if (words !== "tired") return { fired: false };

  return {
    fired: true,
    numbers: {},
    reason: "student reported tired/hard for this workout, but no pulse or decoupling signal backs it up — data looked clean, worth asking",
  };
}
