// Feedback observation planner (Этап 2 — наряд "планировщик наблюдений"). Shared
// types. The planner is DETERMINISTIC: it reads a ContextPacket built entirely
// from Supabase (no TP calls) and returns a structure of Observations — no
// text, no model call. Этап 3 (voice) turns adviceKey + numbers into prose.

import type { DerivedRowForComparison, LastPraise } from "../comparison/types.ts";
import type { TrainingPeaksStudentMemoryType } from "../repository.ts";
import type { AdviceKey } from "./advice-keys.ts";

/** One run's derived metrics, in the shape the planner (and, via it,
 *  compareWorkout) consume. Superset of DerivedRowForComparison — the planner
 *  needs a few fields compareWorkout does not (rep_pace_cv, pct_time_*_target,
 *  pace/distance trust) to run its own slots and to prove which slots sleep. */
export type PlannerDerivedMetrics = DerivedRowForComparison & {
  repPaceCv: number | null;
  pctTimeHrTarget: number | null;
  pctTimePaceTarget: number | null;
  paceTrusted: boolean | null;
  distanceTrusted: boolean | null;
  // FIT availability — the feedback bridge blocks (coach signal, no student draft)
  // when there is no usable FIT data. Optional: the planner itself ignores them.
  hasFit?: boolean | null;
  fallbackLevel?: "fit_full" | "details_only" | "summary_only" | null;
};

export type PlannerLap = {
  lapIndex: number;
  distanceM: number | null;
  timerTimeS: number | null;
  // elapsed − timer per lap sums to the paused time — the feedback arc uses it to
  // ask "много остановок — почему?"; optional (older callers omit it).
  elapsedTimeS?: number | null;
  paceSecPerKm: number | null;
  avgHr: number | null;
  isWork: boolean | null;
};

/** A memory item relevant to this workout. `date` is a best-effort proxy for
 *  "when this was said" (validFrom, else lastSeenAt's date) — the memory table
 *  stores durable facts, not a per-workout log, so callers should pass items
 *  whose date falls in a window around the workout date. */
export type PlannerMemoryItem = {
  type: TrainingPeaksStudentMemoryType;
  text: string;
  date: string | null;
};

export type PlannerHealthMetric = {
  metricDate: string; // 'YYYY-MM-DD'
  metricKey: "pulse" | "sleep_hours" | "hrv" | "body_battery";
  value: number;
};

export type PlannerHealthProfile = {
  hasPulse: boolean;
  hasSleepHours: boolean;
  hasHrv: boolean;
  hasBodyBattery: boolean;
};

export type ContextPacket = {
  studentId: string;
  sex: "female" | "male" | null;
  telegramFormality: "ty" | "vy" | "unknown";
  workout: {
    workoutId: number;
    workoutDate: string;
    title: string | null;
  };
  /** Current run, in compareWorkout's own input shape (plus the planner's extra fields). */
  current: PlannerDerivedMetrics;
  /** Student's run history, oldest first — feeds compareWorkout (C8). */
  history: PlannerDerivedMetrics[];
  /** Comparison base's cross-workout pause state. */
  lastPraise: LastPraise | null;
  /** Current workout's laps only (for the split-half computation). */
  laps: PlannerLap[];
  memoryItems: PlannerMemoryItem[];
  healthMetrics: PlannerHealthMetric[];
  healthProfile: PlannerHealthProfile | null;
};

export type ObservationType = "praise" | "correction" | "question" | "coach_signal";

export type SessionType = "interval" | "easy" | "long_tempo";

/** One planned observation. `numbers` carries every raw number behind the
 *  observation (never invented — this is what the fact-check in Этап 3
 *  validates against). `focused` marks the 1-2 observations selected for the
 *  actual draft; coach_signal observations are never focused (C7: they go to
 *  the coach panel, never the student draft). */
export type Observation = {
  type: ObservationType;
  metric: string;
  numbers: Record<string, number>;
  sessionType: SessionType | null;
  adviceKey: AdviceKey;
  priority: number;
  reason: string;
  focused: boolean;
};
