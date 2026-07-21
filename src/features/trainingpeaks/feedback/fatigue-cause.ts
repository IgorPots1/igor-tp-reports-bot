// C4 — усталость → причина, СЛОВА УЧЕНИКА БЬЮТ ЦИФРУ (Igor's correction to the
// original design, verbatim in the ЭТАП 2 plan). High pulse on an easy run is a
// DEVELOPING QUESTION, never a standalone verdict:
//   - memory says "легко/нормально" for THIS workout → silence, don't even look at health.
//   - memory says "тяжело/устал" → pulse confirms; health (RHR/sleep/HRV) is the
//     SECOND layer, read only now, to name a caring cause.
//   - memory says nothing → ask, don't assert.
// Health never overrides or substitutes for words — it only enriches a
// tired-confirmation that already came from the student.
//
// Trigger ("was this pulse elevated") is either avg_hr above this student's own
// easy-run history, or hr_decoupling_pct high on an easy run (signal-type-table's
// evaluateEasyHrDrift — the design explicitly routes that case through C4, "если
// высок → причина, не вина", same as a high avg_hr).

import { computeHealthBaseline, resolveMetricValueOnDate } from "./health-baseline.ts";
import { evaluateEasyHrDrift } from "./signal-type-table.ts";
import type { AdviceKey } from "./advice-keys.ts";
import type { ContextPacket, PlannerDerivedMetrics, PlannerMemoryItem, SessionType } from "./types.ts";

export const EASY_AVG_HR_HIGH_DELTA_BPM = 8; // judgment call: above sensor noise (~2-4bpm), below the 15bpm "unusual shift" flag
export const RHR_ELEVATED_DELTA_BPM = 3; // design: "3-5 уд", entry at the lower bound
export const SLEEP_BELOW_BASELINE_HOURS = 1;
export const HRV_DROP_BELOW_BASELINE_PCT = 10;
export const MEMORY_WORD_WINDOW_DAYS = 1; // check-ins often land the next day

const TIRED_KEYWORDS = ["тяжело", "устал", "устала", "умер", "без сил", "сложно да", "разбит"];
const EASY_WORD_KEYWORDS = ["легко", "нормально", "бодро", "полегче", "без проблем", "хорошо себя чувств"];

export type FatigueCauseOutcome =
  | { kind: "not_triggered" }
  | { kind: "silent"; reason: string }
  | { kind: "confirmed"; adviceKey: AdviceKey; numbers: Record<string, number>; reason: string }
  | { kind: "question"; numbers: Record<string, number>; reason: string };

function daysBetween(a: string, b: string): number {
  const da = new Date(`${a}T00:00:00Z`).getTime();
  const db = new Date(`${b}T00:00:00Z`).getTime();
  return Math.abs(da - db) / 86_400_000;
}

export function classifyWords(memoryItems: PlannerMemoryItem[], workoutDate: string): "tired" | "easy" | "unknown" {
  const relevant = memoryItems.filter(
    (m) => (m.type === "emotional_state" || m.type === "health_status") && m.date !== null && daysBetween(m.date, workoutDate) <= MEMORY_WORD_WINDOW_DAYS
  );
  for (const item of relevant) {
    const text = item.text.toLowerCase();
    if (TIRED_KEYWORDS.some((kw) => text.includes(kw))) return "tired";
  }
  for (const item of relevant) {
    const text = item.text.toLowerCase();
    if (EASY_WORD_KEYWORDS.some((kw) => text.includes(kw))) return "easy";
  }
  return "unknown";
}

function computeEasyAvgHrBaseline(history: PlannerDerivedMetrics[]): { median: number; sampleCount: number } | null {
  const values = history
    .filter((r) => !(r.workoutType === "run" && r.comparisonKey !== null && (r.repsDetectedCount ?? 0) >= 2))
    .map((r) => r.avgHr)
    .filter((v): v is number => v !== null);
  if (values.length < 5) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  return { median, sampleCount: values.length };
}

function evaluatePulseTrigger(current: PlannerDerivedMetrics, sessionType: SessionType, history: PlannerDerivedMetrics[]): { fired: boolean; numbers: Record<string, number>; reason: string } {
  const drift = evaluateEasyHrDrift({ current, sessionType });
  if (drift.fired) {
    return { fired: true, numbers: { hrDecouplingPct: drift.decouplingPct }, reason: `hr_decoupling_pct=${drift.decouplingPct} elevated on an easy run` };
  }

  if (sessionType === "easy" && current.avgHr !== null) {
    const baseline = computeEasyAvgHrBaseline(history);
    if (baseline !== null) {
      const delta = current.avgHr - baseline.median;
      if (delta >= EASY_AVG_HR_HIGH_DELTA_BPM) {
        return { fired: true, numbers: { avgHr: current.avgHr, baselineAvgHr: baseline.median, deltaBpm: delta }, reason: `avg_hr ${current.avgHr} is ${delta}bpm above this student's easy-run baseline ${baseline.median} (n=${baseline.sampleCount})` };
      }
    }
  }

  return { fired: false, numbers: {}, reason: "" };
}

export function evaluateFatigueCause(packet: ContextPacket, sessionType: SessionType): FatigueCauseOutcome {
  const trigger = evaluatePulseTrigger(packet.current, sessionType, packet.history);
  if (!trigger.fired) return { kind: "not_triggered" };

  const words = classifyWords(packet.memoryItems, packet.workout.workoutDate);

  if (words === "easy") {
    return { kind: "silent", reason: `pulse elevated (${trigger.reason}) but student reported feeling fine — words beat the number, staying silent` };
  }

  if (words === "unknown") {
    return { kind: "question", numbers: trigger.numbers, reason: `pulse elevated (${trigger.reason}), no report from the student — asking, not asserting` };
  }

  // words === "tired": pulse confirms, now read health as the second layer.
  const profile = packet.healthProfile;
  if (profile?.hasPulse) {
    const rhrBaseline = computeHealthBaseline({ metrics: packet.healthMetrics, metricKey: "pulse", asOfDate: packet.workout.workoutDate });
    const rhrToday = resolveMetricValueOnDate(packet.healthMetrics, "pulse", packet.workout.workoutDate);
    if (rhrBaseline !== null && rhrToday !== null) {
      const delta = rhrToday - rhrBaseline.medianValue;
      if (delta >= RHR_ELEVATED_DELTA_BPM) {
        return {
          kind: "confirmed",
          adviceKey: "cause_confirmed_tired_rhr",
          numbers: { ...trigger.numbers, rhrToday, rhrBaseline: rhrBaseline.medianValue, rhrDeltaBpm: delta },
          reason: `student confirmed tired; resting HR ${rhrToday} is ${delta}bpm above personal baseline ${rhrBaseline.medianValue} (n=${rhrBaseline.sampleCount})`,
        };
      }
    }
  }

  if (profile?.hasSleepHours) {
    const sleepBaseline = computeHealthBaseline({ metrics: packet.healthMetrics, metricKey: "sleep_hours", asOfDate: packet.workout.workoutDate });
    const sleepToday = resolveMetricValueOnDate(packet.healthMetrics, "sleep_hours", packet.workout.workoutDate);
    if (sleepBaseline !== null && sleepToday !== null) {
      const delta = sleepBaseline.medianValue - sleepToday;
      if (delta >= SLEEP_BELOW_BASELINE_HOURS) {
        return {
          kind: "confirmed",
          adviceKey: "cause_confirmed_tired_sleep",
          numbers: { ...trigger.numbers, sleepToday, sleepBaseline: sleepBaseline.medianValue, sleepDeltaHours: delta },
          reason: `student confirmed tired; sleep ${sleepToday}h is ${delta}h below personal baseline ${sleepBaseline.medianValue}h (n=${sleepBaseline.sampleCount})`,
        };
      }
    }
  }

  if (profile?.hasHrv) {
    const hrvBaseline = computeHealthBaseline({ metrics: packet.healthMetrics, metricKey: "hrv", asOfDate: packet.workout.workoutDate });
    const hrvToday = resolveMetricValueOnDate(packet.healthMetrics, "hrv", packet.workout.workoutDate);
    if (hrvBaseline !== null && hrvToday !== null && hrvBaseline.medianValue > 0) {
      const dropPct = ((hrvBaseline.medianValue - hrvToday) / hrvBaseline.medianValue) * 100;
      if (dropPct >= HRV_DROP_BELOW_BASELINE_PCT) {
        return {
          kind: "confirmed",
          adviceKey: "cause_confirmed_tired_hrv_soft",
          numbers: { ...trigger.numbers, hrvToday, hrvBaseline: hrvBaseline.medianValue, hrvDropPct: dropPct },
          reason: `student confirmed tired; HRV ${hrvToday} is ${Math.round(dropPct)}% below personal baseline ${hrvBaseline.medianValue} — single metric, hedge (не опираться на одну)`,
        };
      }
    }
  }

  return {
    kind: "confirmed",
    adviceKey: "cause_confirmed_tired_generic",
    numbers: trigger.numbers,
    reason: "student confirmed tired; no health data confirms a specific cause — acknowledge care without naming one",
  };
}
