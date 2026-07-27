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

// Raw inbound athlete message (verbatim preview) from telegram_context_observations —
// the transient "what the student said about this workout" that (correctly) never becomes
// durable memory. Loaded per student; context-packet windows it to the workout date.
export type PlannerStudentMessage = {
  text: string;
  date: string; // 'YYYY-MM-DD' (observed_at day)
  at?: string; // full ISO observed_at — lets windowStudentWords anchor to the trigger TIME, not just day
  labels: string[];
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

/** A cause the STUDENT themselves named around this workout, extracted from their raw messages
 *  (жара, не пил, недосып, болел, устал по жизни/работа/ремонт, болит, рельеф/дорожка/ветер).
 *  Igor's rule "причина, не вина": a named factor beats a mechanical verdict — the planner honors
 *  it as a cause and suppresses the "student said nothing → ask" question. Words only, NEVER a
 *  number source (the quote is for tone/coach-panel; the fact-check still forbids stray digits). */
export type StatedFactorKind =
  | "illness" // болел, простыл, горло, температура, недомогание
  | "soreness" // болит/тянет/забиты (колено, стопа, спина)
  | "undersleep" // мало спал, недосып, не выспался
  | "dehydration" // не пил, забыл попить, воду не брал, пил мало
  | "heat" // жара, духота, пекло (перекрывает существующий HEAT_RE)
  | "life_stress" // работа, ремонт, аврал, стресс, устаю по жизни
  | "conditions" // рельеф/горки, дорожка/манеж, ветер — внешние условия бега
  | "device_glitch"; // часы/датчик врут, глючат, «странно себя ведут» — НЕ причина усталости, а
  // сигнал НЕ доверять пульсу этой тренировки (иначе разбор врёт: «пульс подрос» по кривым данным)

export type StatedFactor = {
  factor: StatedFactorKind;
  quote: string; // verbatim span the student wrote (tone/coach-panel only, never a number)
  date: string; // 'YYYY-MM-DD' of the message
  recurring: boolean; // named on ≥2 distinct days in the window → accumulation, not a one-off
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
  /** Recent raw athlete messages (verbatim); context-packet windows them to the workout. */
  studentMessages: PlannerStudentMessage[];
  /** ISO timestamp of the REPORT that triggered this card (the message the sweep matched to the run).
   *  When set, windowStudentWords anchors the words to it — the trigger + same-day messages from it
   *  onward — instead of a date window, so yesterday's report about a DIFFERENT run can't bleed in.
   *  Optional: callers that don't know the trigger (tests, targeted rebuilds) fall back to the window. */
  triggerObservedAt?: string;
  healthMetrics: PlannerHealthMetric[];
  healthProfile: PlannerHealthProfile | null;
  /** Factors the student named around this workout, extracted from studentMessages at packet-build
   *  time (Haiku with a deterministic keyword fallback). Optional: callers that don't extract leave
   *  it undefined and the planner behaves exactly as before (no factor → no override). */
  statedFactors?: StatedFactor[];
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
