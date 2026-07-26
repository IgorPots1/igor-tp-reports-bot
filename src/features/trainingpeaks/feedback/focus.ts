// C5 — focus selection. "Несколько наблюдений → сказать ГЛАВНОЕ (1-2), не все"
// (design). All observations are always returned (this planner's job is
// honest structure, not the final message) — this file only decides which
// ones get `focused: true`, i.e. which would actually make the draft.
//
// Priority order, from the наряд verbatim where it is explicit
// (сигнал_тренеру > жёсткая аномалия > составной прогресс > коррекция по
// контролю усилия > позитив) and filled in by judgment where it isn't
// (composite vs mechanism_a/b, question tiers, C3's internal ranking).
// coach_signal sits at the top of the SCALE but is never eligible for focus —
// C7's hard rule keeps it off the student draft regardless of rank.

import type { AdviceKey } from "./advice-keys.ts";
import type { Observation } from "./types.ts";

export const FOCUS_CAP = 2;

export const PRIORITY: Record<AdviceKey, number> = {
  // coach-only — always returned, never focused (see selectFocus)
  signal_hr_untrusted: 100,
  signal_pace_distance_untrusted: 100,
  signal_pulse_sensor_suspect: 100,
  signal_unusual_shift: 100,

  // жёсткая аномалия — data-integrity question, draft-facing
  question_hr_sensor: 90,

  // составной прогресс (C8, weight=3) — set by observation-planner.ts per-weight;
  // this entry covers the composite tier specifically
  praise_comparison_progress: 70,

  // Block 1 — student NAMED the cause: sits at the top of the cause tier (a factor the student
  // spoke outright beats a health-inferred one). Care-worthy (illness/soreness) highest.
  cause_confirmed_illness: 67,
  cause_confirmed_soreness: 66,
  cause_confirmed_undersleep: 65,
  cause_confirmed_dehydration: 64,
  cause_confirmed_heat: 64,
  cause_confirmed_life_stress: 63,
  cause_confirmed_conditions: 63,

  // C4 confirmed cause — words confirmed tired, health named a reason
  cause_confirmed_tired_rhr: 62,
  cause_confirmed_tired_sleep: 62,
  cause_confirmed_tired_hrv_trend: 61,
  cause_confirmed_tired_generic: 58,

  // коррекция по контролю усилия (C1/C2)
  correction_second_half_surge_easy: 60,
  correction_second_half_surge_tempo: 60,
  correction_hr_drift_tempo: 60,
  correction_interval_fade: 57,
  correction_fast_start_rep: 60, // sleeping — priority set for when Этап 0.5 lands
  correction_recovery_too_fast: 60, // sleeping
  correction_easy_too_fast: 60, // sleeping

  // questions below correction, above baseline positive
  question_contradiction: 48,
  question_high_pulse_unknown: 46,
  question_accumulated_load: 44,

  // позитив (C3) — tiered by specificity, judgment call
  praise_full_structure: 30,
  praise_negative_split: 28,
  praise_long_held_steady: 26,
  praise_hr_steady_long: 24,
  praise_good_recovery: 22,
  praise_steady_hr_rise: 20,
  praise_even_pace: 18,
  praise_in_zone: 16, // sleeping
  praise_default_good: 10,
};

export function priorityForComparisonWeight(weight: 1 | 2 | 3): number {
  if (weight === 3) return 70; // composite
  if (weight === 2) return 50; // mechanism_a
  return 40; // mechanism_b
}

export function selectFocus(observations: Observation[]): Observation[] {
  const eligible = observations.filter((o) => o.type !== "coach_signal");
  const focusedKeys = new Set(
    [...eligible]
      .sort((a, b) => b.priority - a.priority)
      .slice(0, FOCUS_CAP)
      .map((o) => `${o.adviceKey}:${o.metric}`)
  );

  return observations.map((o) => (o.type !== "coach_signal" && focusedKeys.has(`${o.adviceKey}:${o.metric}`) ? { ...o, focused: true } : { ...o, focused: false }));
}
