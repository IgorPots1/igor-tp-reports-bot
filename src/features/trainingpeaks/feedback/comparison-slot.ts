// C8 — thin adapter over the comparison base (compareWorkout, already in main
// from наряды 1-2). It is pure and already does everything the design asks:
// one observation or silence, pulse-sensor question vs coach-only flag already
// split (hr_sensor kind = draft question; coachFlags = coach-only), praise
// pause already applied. This file only translates its output shape into the
// planner's Observation vocabulary — no new decision logic.

import { compareWorkout } from "../comparison/index.ts";
import type { PraiseWeight } from "../comparison/types.ts";
import type { AdviceKey } from "./advice-keys.ts";
import type { ContextPacket } from "./types.ts";

export type ComparisonSlotResult = {
  praise: { numbers: Record<string, number>; reason: string; weight: PraiseWeight } | null;
  hrSensorQuestion: { numbers: Record<string, number>; reason: string } | null;
  coachSignals: Array<{ adviceKey: Extract<AdviceKey, "signal_pulse_sensor_suspect" | "signal_unusual_shift">; numbers: Record<string, number>; reason: string }>;
};

function metricsToNumbers(metrics: Array<{ metric: string; before: number | null; after: number | null; delta: number | null; baseN: number }>): Record<string, number> {
  const numbers: Record<string, number> = {};
  for (const m of metrics) {
    if (m.before !== null) numbers[`${m.metric}Before`] = m.before;
    if (m.after !== null) numbers[`${m.metric}After`] = m.after;
    if (m.delta !== null) numbers[`${m.metric}Delta`] = m.delta;
    numbers[`${m.metric}BaseN`] = m.baseN;
  }
  return numbers;
}

export function evaluateComparisonSlot(packet: ContextPacket): ComparisonSlotResult {
  // MemoryContextInput needs a validity RANGE; ContextPacket only carries a
  // single best-effort "date this was said" per item. Adapting validFrom=date,
  // validUntil=null (open-ended) reads as "ongoing context mentioned around
  // this date, still relevant" — the closest honest approximation available.
  const memoryItems = packet.memoryItems.map((m) => ({ type: m.type, text: m.text, validFrom: m.date, validUntil: null }));

  const result = compareWorkout({
    current: packet.current,
    history: packet.history,
    memoryItems,
    lastPraise: packet.lastPraise,
  });

  function toCoachSignal(flag: (typeof result.coachFlags)[number]): ComparisonSlotResult["coachSignals"][number] {
    if (flag.kind === "pulse_sensor_suspect") {
      return {
        adviceKey: "signal_pulse_sensor_suspect",
        numbers: { shortfallBpm: flag.shortfallBpm, currentHr: flag.currentHr, normHr: flag.normHr, baseN: flag.baseN },
        reason: `пульс на ${flag.shortfallBpm} уд ниже нормы класса (${flag.currentHr} против ${flag.normHr}, n=${flag.baseN}) — средняя зона, помечаю тренеру, не спрашиваю`,
      };
    }
    const numbers: Record<string, number> = { delta: flag.delta };
    if (flag.before !== null) numbers.before = flag.before;
    if (flag.after !== null) numbers.after = flag.after;
    return {
      adviceKey: "signal_unusual_shift",
      numbers,
      reason: `необычно большой сдвиг по ${flag.metric} (Δ${flag.delta}) — возможно артефакт, помечаю на проверку`,
    };
  }

  const coachSignals: ComparisonSlotResult["coachSignals"] = result.coachFlags.map(toCoachSignal);

  if (result.observation === null) {
    return { praise: null, hrSensorQuestion: null, coachSignals };
  }

  if (result.observation.kind === "hr_sensor") {
    const line = result.observation.metrics[0];
    return {
      praise: null,
      hrSensorQuestion: {
        numbers: line ? { current: line.after ?? 0, norm: line.before ?? 0, baseN: line.baseN } : {},
        reason: "детектор датчика по базе сравнения: пульс заметно ниже нормы класса на сопоставимом темпе — спрашиваю ученика, не тренера",
      },
      coachSignals,
    };
  }

  // Carry the norm window (recent ≤8 нед / old >6 нед) so the draft can anchor the delta
  // in TIME ("чем месяц назад") instead of a vague "раньше", and the coach panel can show
  // the raw baseline. mode is dropped nowhere else, so stash it as a 0/1 flag in numbers.
  const praiseNumbers = metricsToNumbers(result.observation.metrics);
  praiseNumbers.comparisonModeOld = result.observation.mode === "old" ? 1 : 0;

  return {
    praise: {
      numbers: praiseNumbers,
      reason: `comparison base progress (${result.observation.kind}, weight ${result.observation.weight}, mode ${result.observation.mode})`,
      weight: result.observation.weight as PraiseWeight,
    },
    hrSensorQuestion: null,
    coachSignals,
  };
}
