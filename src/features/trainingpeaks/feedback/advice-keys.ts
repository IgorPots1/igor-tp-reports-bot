// Stable keys the planner attaches to each Observation. Этап 3 (voice) maps
// each key to a real corpus phrase — this planner never generates text.
// Grouped by igor-voice-corpus.md category (A praise / B praise-but / C
// question / D cause-not-blame) for traceability back to the source examples.

export type AdviceKey =
  // C3 — positive dictionary (corpus category A)
  | "praise_even_pace"
  | "praise_negative_split"
  | "praise_hr_steady_long"
  | "praise_good_recovery"
  | "praise_steady_hr_rise"
  | "praise_full_structure"
  | "praise_long_held_steady"
  | "praise_comparison_progress"
  | "praise_in_zone" // sleeping: pct_time_*_target NULL
  | "praise_default_good"
  // C2 — corrections (corpus category B, "похвала, но...")
  | "correction_fast_start_rep" // sleeping: needs Этап 0.5
  | "correction_interval_fade"
  | "correction_recovery_too_fast" // sleeping: no recovery-pace field exists
  | "correction_easy_too_fast" // sleeping: needs pace target corridor
  | "correction_second_half_surge_easy"
  | "correction_second_half_surge_tempo"
  | "correction_hr_drift_tempo"
  // C4 — fatigue → cause (corpus category D, cause not blame)
  | "cause_confirmed_tired_rhr"
  | "cause_confirmed_tired_sleep"
  | "cause_confirmed_tired_hrv_trend"
  | "cause_confirmed_tired_generic"
  // Block 1 — student NAMED the cause (жара/не пил/недосып/болел/ремонт/болит/рельеф).
  // Same "причина, не вина" category D; honored over a mechanical question.
  | "cause_confirmed_heat"
  | "cause_confirmed_dehydration"
  | "cause_confirmed_undersleep"
  | "cause_confirmed_illness"
  | "cause_confirmed_life_stress"
  | "cause_confirmed_soreness"
  | "cause_confirmed_muscle_doms"
  | "cause_confirmed_conditions"
  // Questions (corpus category C)
  | "question_high_pulse_unknown"
  | "question_accumulated_load"
  | "question_contradiction"
  | "question_hr_sensor"
  // Coach-only signals (never shown to the student)
  | "signal_hr_untrusted"
  | "signal_pace_distance_untrusted"
  | "signal_pulse_sensor_suspect"
  | "signal_unusual_shift";
