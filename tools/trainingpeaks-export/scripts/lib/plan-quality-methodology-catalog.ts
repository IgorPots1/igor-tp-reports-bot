export type QualityIntent = "vo2max_intervals" | "controlled_sub_threshold" | "threshold_tempo";

export type QualityWorkoutKey =
  | "vo2_20x1"
  | "vo2_24x1"
  | "vo2_15x400"
  | "vo2_20x90sec"
  | "vo2_10x2"
  | "vo2_12x2"
  | "vo2_6x3"
  | "vo2_7x3"
  | "vo2_4x4"
  | "controlled_3x6"
  | "threshold_tempo_block";

export type AthleteRecoveryLevel = "standard" | "beginner_cautious";

export type ProgressionFamily = "vo2_short_to_long_intervals";

export type ProgressionContext = {
  workout_completed: boolean;
  partial_completion?: boolean;
  strong_fatigue_or_injury_signal?: boolean;
  illness_or_pain_signal?: boolean;
  rpe?: "low" | "moderate" | "high" | "very_high" | "unknown";
  coach_review_blocker?: boolean;
  unclear_recovery_feedback?: boolean;
  failed_to_hold_controlled_effort?: boolean;
};

export type QualityRepeatStructure = {
  repeat_count: number;
  work_minutes: number;
  recovery_minutes: number;
  work_label: string;
  recovery_label: string;
};

export type QualityStructure = {
  warmup_minutes: number;
  repeats: QualityRepeatStructure | null;
  cooldown_minutes: number;
  total_minutes: number;
};

export type QualityWorkoutCatalogEntry = {
  key: QualityWorkoutKey;
  intent: QualityIntent;
  display_title_ru: string;
  structure: QualityStructure;
  progression_family?: ProgressionFamily;
  progression_stage?: number;
  previous_workout_patterns?: string[];
  next_preferred_keys?: QualityWorkoutKey[];
  repeat_if?: string[];
  regress_if?: string[];
  do_not_progress_if?: string[];
  progression_examples?: string[];
  notes: string[];
};

export type QualityStructureValidationResult = {
  ok: boolean;
  reason: string | null;
};

export type RecoveryRule = {
  intent: QualityIntent;
  min_work_minutes: number;
  max_work_minutes: number;
  default_recovery_minutes: number;
  allowed_recovery_minutes: number[];
  beginner_cautious_recovery_minutes?: number;
  notes: string[];
};

export type ProgressionCandidatesResult = {
  progression_family: ProgressionFamily | null;
  decision:
    | "progress"
    | "repeat"
    | "regress_or_switch_to_easy_controlled"
    | "no_progression_rule";
  next_preferred_keys: QualityWorkoutKey[];
  rationale: string;
};

export type QualitySelectionResult =
  | {
      selected: true;
      intent: QualityIntent;
      workout_key: QualityWorkoutKey;
      structure: QualityStructure;
      selection_reason: string;
    }
  | {
      selected: false;
      reason: "draft_needs_quality_intent";
      selection_reason: string;
    };

const STANDARD_REPEAT_IF = [
  "completed_but_hard_or_high_rpe",
  "partial_completion",
  "unclear_recovery_feedback",
];

const STANDARD_REGRESS_IF = [
  "missed_workout",
  "illness_or_pain_signal",
  "very_high_rpe",
  "failed_to_hold_controlled_effort",
];

const STANDARD_DO_NOT_PROGRESS_IF = [
  "coach_review_blocker",
  "strong_fatigue_or_injury_signal",
  "rpe_high_or_very_high",
];

const QUALITY_CATALOG: Record<QualityWorkoutKey, QualityWorkoutCatalogEntry> = {
  vo2_20x1: {
    key: "vo2_20x1",
    intent: "vo2max_intervals",
    display_title_ru: "Интервалы 20×1 мин",
    structure: {
      warmup_minutes: 10,
      repeats: {
        repeat_count: 20,
        work_minutes: 1,
        recovery_minutes: 1,
        work_label: "strong_controlled_fast",
        recovery_label: "easy_jog",
      },
      cooldown_minutes: 5,
      total_minutes: 55,
    },
    progression_family: "vo2_short_to_long_intervals",
    progression_stage: 1,
    previous_workout_patterns: [],
    next_preferred_keys: ["vo2_15x400", "vo2_20x90sec", "vo2_10x2"],
    repeat_if: STANDARD_REPEAT_IF,
    regress_if: STANDARD_REGRESS_IF,
    do_not_progress_if: STANDARD_DO_NOT_PROGRESS_IF,
    progression_examples: ["20x1", "24x1", "15x400", "20x90sec", "10x2"],
    notes: [
      "VO2-oriented but controlled; do not convert into all-out sprinting.",
      "Easy jog recovery is mandatory.",
    ],
  },
  vo2_24x1: {
    key: "vo2_24x1",
    intent: "vo2max_intervals",
    display_title_ru: "Интервалы 24×1 мин",
    structure: {
      warmup_minutes: 10,
      repeats: {
        repeat_count: 24,
        work_minutes: 1,
        recovery_minutes: 1,
        work_label: "strong_controlled_fast",
        recovery_label: "easy_jog",
      },
      cooldown_minutes: 5,
      total_minutes: 63,
    },
    progression_family: "vo2_short_to_long_intervals",
    progression_stage: 1,
    previous_workout_patterns: ["20x1", "24x1"],
    next_preferred_keys: ["vo2_15x400", "vo2_20x90sec", "vo2_10x2"],
    repeat_if: STANDARD_REPEAT_IF,
    regress_if: STANDARD_REGRESS_IF,
    do_not_progress_if: STANDARD_DO_NOT_PROGRESS_IF,
    notes: [
      "High-volume short VO2 session used before extending interval duration.",
      "Easy jog recovery is mandatory.",
    ],
  },
  vo2_15x400: {
    key: "vo2_15x400",
    intent: "vo2max_intervals",
    display_title_ru: "Интервалы 15×400 м",
    structure: {
      warmup_minutes: 10,
      repeats: {
        repeat_count: 15,
        work_minutes: 1.5,
        recovery_minutes: 1.5,
        work_label: "strong_controlled_fast",
        recovery_label: "easy_jog",
      },
      cooldown_minutes: 5,
      total_minutes: 60,
    },
    progression_family: "vo2_short_to_long_intervals",
    progression_stage: 2,
    previous_workout_patterns: ["20x1", "24x1"],
    next_preferred_keys: ["vo2_20x90sec", "vo2_10x2"],
    repeat_if: STANDARD_REPEAT_IF,
    regress_if: STANDARD_REGRESS_IF,
    do_not_progress_if: STANDARD_DO_NOT_PROGRESS_IF,
    notes: [
      "Classic VO2 bridge workout between 1-minute and 2-minute interval blocks.",
      "Easy jog recovery is mandatory.",
    ],
  },
  vo2_20x90sec: {
    key: "vo2_20x90sec",
    intent: "vo2max_intervals",
    display_title_ru: "Интервалы 20×1:30",
    structure: {
      warmup_minutes: 10,
      repeats: {
        repeat_count: 20,
        work_minutes: 1.5,
        recovery_minutes: 1.5,
        work_label: "strong_controlled_fast",
        recovery_label: "easy_jog",
      },
      cooldown_minutes: 5,
      total_minutes: 75,
    },
    progression_family: "vo2_short_to_long_intervals",
    progression_stage: 2,
    previous_workout_patterns: ["20x1", "24x1", "15x400"],
    next_preferred_keys: ["vo2_10x2", "vo2_12x2"],
    repeat_if: STANDARD_REPEAT_IF,
    regress_if: STANDARD_REGRESS_IF,
    do_not_progress_if: STANDARD_DO_NOT_PROGRESS_IF,
    notes: [
      "Time-based equivalent of short VO2 progression bridge.",
      "Easy jog recovery is mandatory.",
    ],
  },
  vo2_10x2: {
    key: "vo2_10x2",
    intent: "vo2max_intervals",
    display_title_ru: "Интервалы 10×2 мин",
    structure: {
      warmup_minutes: 10,
      repeats: {
        repeat_count: 10,
        work_minutes: 2,
        recovery_minutes: 2,
        work_label: "strong_controlled_fast",
        recovery_label: "easy_jog",
      },
      cooldown_minutes: 5,
      total_minutes: 55,
    },
    progression_family: "vo2_short_to_long_intervals",
    progression_stage: 3,
    previous_workout_patterns: ["20x1", "24x1", "15x400", "20x90sec"],
    next_preferred_keys: ["vo2_12x2", "vo2_6x3", "vo2_7x3"],
    repeat_if: STANDARD_REPEAT_IF,
    regress_if: STANDARD_REGRESS_IF,
    do_not_progress_if: STANDARD_DO_NOT_PROGRESS_IF,
    progression_examples: ["24x1", "10x2", "12x2", "6x3", "7x3", "4x4"],
    notes: [
      "VO2-oriented but controlled; avoid all-out sprint behavior.",
      "Anna v0-safe structure keeps 2:00 recovery and 55-minute total alignment.",
      "Methodology default for 2:00 VO2 work is usually 1:30 easy jog, but 2:00 remains allowed.",
    ],
  },
  vo2_12x2: {
    key: "vo2_12x2",
    intent: "vo2max_intervals",
    display_title_ru: "Интервалы 12×2 мин",
    structure: {
      warmup_minutes: 10,
      repeats: {
        repeat_count: 12,
        work_minutes: 2,
        recovery_minutes: 1.5,
        work_label: "strong_controlled_fast",
        recovery_label: "easy_jog",
      },
      cooldown_minutes: 5,
      total_minutes: 59,
    },
    progression_family: "vo2_short_to_long_intervals",
    progression_stage: 3,
    previous_workout_patterns: ["10x2", "12x2", "20x90sec"],
    next_preferred_keys: ["vo2_6x3", "vo2_7x3"],
    repeat_if: STANDARD_REPEAT_IF,
    regress_if: STANDARD_REGRESS_IF,
    do_not_progress_if: STANDARD_DO_NOT_PROGRESS_IF,
    notes: [
      "Volume extension from 10x2 while keeping controlled execution.",
      "Easy jog recovery is mandatory.",
    ],
  },
  vo2_6x3: {
    key: "vo2_6x3",
    intent: "vo2max_intervals",
    display_title_ru: "Интервалы 6×3 мин",
    structure: {
      warmup_minutes: 10,
      repeats: {
        repeat_count: 6,
        work_minutes: 3,
        recovery_minutes: 2,
        work_label: "strong_controlled_fast",
        recovery_label: "easy_jog",
      },
      cooldown_minutes: 5,
      total_minutes: 45,
    },
    progression_family: "vo2_short_to_long_intervals",
    progression_stage: 4,
    previous_workout_patterns: ["10x2", "12x2"],
    next_preferred_keys: ["vo2_7x3", "vo2_4x4"],
    repeat_if: STANDARD_REPEAT_IF,
    regress_if: STANDARD_REGRESS_IF,
    do_not_progress_if: STANDARD_DO_NOT_PROGRESS_IF,
    notes: [
      "Longer VO2 intervals; effort remains controlled.",
      "Easy jog recovery is mandatory.",
    ],
  },
  vo2_7x3: {
    key: "vo2_7x3",
    intent: "vo2max_intervals",
    display_title_ru: "Интервалы 7×3 мин",
    structure: {
      warmup_minutes: 10,
      repeats: {
        repeat_count: 7,
        work_minutes: 3,
        recovery_minutes: 2,
        work_label: "strong_controlled_fast",
        recovery_label: "easy_jog",
      },
      cooldown_minutes: 5,
      total_minutes: 50,
    },
    progression_family: "vo2_short_to_long_intervals",
    progression_stage: 4,
    previous_workout_patterns: ["6x3", "7x3", "12x2"],
    next_preferred_keys: ["vo2_4x4"],
    repeat_if: STANDARD_REPEAT_IF,
    regress_if: STANDARD_REGRESS_IF,
    do_not_progress_if: STANDARD_DO_NOT_PROGRESS_IF,
    notes: [
      "Extended 3-minute VO2 variant; used before final long-interval stage.",
      "Easy jog recovery is mandatory.",
    ],
  },
  vo2_4x4: {
    key: "vo2_4x4",
    intent: "vo2max_intervals",
    display_title_ru: "Интервалы 4×4 мин",
    structure: {
      warmup_minutes: 10,
      repeats: {
        repeat_count: 4,
        work_minutes: 4,
        recovery_minutes: 3,
        work_label: "strong_controlled_fast",
        recovery_label: "easy_jog",
      },
      cooldown_minutes: 5,
      total_minutes: 43,
    },
    progression_family: "vo2_short_to_long_intervals",
    progression_stage: 5,
    previous_workout_patterns: ["6x3", "7x3"],
    next_preferred_keys: [],
    repeat_if: STANDARD_REPEAT_IF,
    regress_if: STANDARD_REGRESS_IF,
    do_not_progress_if: STANDARD_DO_NOT_PROGRESS_IF,
    notes: [
      "Final harder VO2 stage in short-to-long progression family.",
      "Easy jog recovery is mandatory.",
    ],
  },
  controlled_3x6: {
    key: "controlled_3x6",
    intent: "controlled_sub_threshold",
    display_title_ru: "Контролируемые интервалы 3×6 мин",
    structure: {
      warmup_minutes: 10,
      repeats: {
        repeat_count: 3,
        work_minutes: 6,
        recovery_minutes: 3,
        work_label: "controlled_sub_threshold",
        recovery_label: "easy_jog",
      },
      cooldown_minutes: 10,
      total_minutes: 47,
    },
    progression_stage: 0,
    notes: [
      "Catalog reference only. Not used as a generic default in v0.",
      "6/3 is explicitly disallowed as automatic controlled_sub_threshold default in v0.",
    ],
  },
  threshold_tempo_block: {
    key: "threshold_tempo_block",
    intent: "threshold_tempo",
    display_title_ru: "Пороговый темповый блок",
    structure: {
      warmup_minutes: 10,
      repeats: null,
      cooldown_minutes: 10,
      total_minutes: 50,
    },
    progression_stage: 0,
    notes: ["Continuous threshold-tempo variant. Detailed progression is coach-selected."],
  },
};

const RECOVERY_RULES: RecoveryRule[] = [
  {
    intent: "vo2max_intervals",
    min_work_minutes: 1,
    max_work_minutes: 1,
    default_recovery_minutes: 1,
    allowed_recovery_minutes: [1],
    notes: ["1:00 work -> 1:00 easy jog recovery"],
  },
  {
    intent: "vo2max_intervals",
    min_work_minutes: 1.5,
    max_work_minutes: 1.5,
    default_recovery_minutes: 1.5,
    allowed_recovery_minutes: [1.5],
    notes: ["1:30 work -> 1:30 easy jog recovery"],
  },
  {
    intent: "vo2max_intervals",
    min_work_minutes: 2,
    max_work_minutes: 2,
    default_recovery_minutes: 1.5,
    allowed_recovery_minutes: [1.5, 2],
    notes: [
      "2:00 work -> methodology default 1:30 easy jog.",
      "2:00 is still allowed as an explicitly selected safe v0 variant.",
    ],
  },
  {
    intent: "vo2max_intervals",
    min_work_minutes: 3,
    max_work_minutes: 3,
    default_recovery_minutes: 2,
    allowed_recovery_minutes: [2],
    notes: ["3:00 work -> 2:00 easy jog recovery"],
  },
  {
    intent: "vo2max_intervals",
    min_work_minutes: 4,
    max_work_minutes: 4,
    default_recovery_minutes: 3,
    allowed_recovery_minutes: [3],
    notes: ["4:00 work -> 3:00 easy jog recovery"],
  },
  {
    intent: "controlled_sub_threshold",
    min_work_minutes: 3,
    max_work_minutes: 8,
    default_recovery_minutes: 1.5,
    allowed_recovery_minutes: [1.5, 2],
    beginner_cautious_recovery_minutes: 2,
    notes: [
      "Below-threshold default recovery is 1:30 easy jog.",
      "Beginner/cautious can use 2:00 easy jog.",
      "6:00 work with 3:00 recovery is not a deterministic default.",
    ],
  },
  {
    intent: "threshold_tempo",
    min_work_minutes: 5,
    max_work_minutes: 8,
    default_recovery_minutes: 2,
    allowed_recovery_minutes: [1.5, 2, 2.5],
    notes: ["5-8 min threshold/tempo intervals supported."],
  },
  {
    intent: "threshold_tempo",
    min_work_minutes: 8.01,
    max_work_minutes: 30,
    default_recovery_minutes: 2,
    allowed_recovery_minutes: [2, 2.5],
    notes: [
      ">8:00 threshold/tempo usually uses 2:00-2:30 easy jog recovery.",
      "3:00 recovery is not a deterministic default.",
    ],
  },
];

const WORKOUT_PATTERN_ALIASES: Record<string, QualityWorkoutKey> = {
  "20x1": "vo2_20x1",
  "24x1": "vo2_24x1",
  "15x400": "vo2_15x400",
  "20x1:30": "vo2_20x90sec",
  "20x90sec": "vo2_20x90sec",
  "10x2": "vo2_10x2",
  "12x2": "vo2_12x2",
  "6x3": "vo2_6x3",
  "7x3": "vo2_7x3",
  "4x4": "vo2_4x4",
  vo2_20x1: "vo2_20x1",
  vo2_24x1: "vo2_24x1",
  vo2_15x400: "vo2_15x400",
  vo2_20x90sec: "vo2_20x90sec",
  vo2_10x2: "vo2_10x2",
  vo2_12x2: "vo2_12x2",
  vo2_6x3: "vo2_6x3",
  vo2_7x3: "vo2_7x3",
  vo2_4x4: "vo2_4x4",
};

export function getQualityWorkoutCatalogEntry(key: QualityWorkoutKey): QualityWorkoutCatalogEntry {
  return QUALITY_CATALOG[key];
}

function approximatelyEqualMinutes(left: number, right: number): boolean {
  return Math.abs(left - right) <= 0.01;
}

function getRecoveryRule(intent: QualityIntent, workMinutes: number): RecoveryRule | null {
  return (
    RECOVERY_RULES.find(
      (rule) =>
        rule.intent === intent && workMinutes >= rule.min_work_minutes && workMinutes <= rule.max_work_minutes,
    ) ?? null
  );
}

function recoveryListWithAthleteLevel(rule: RecoveryRule, athleteLevel: AthleteRecoveryLevel): number[] {
  const values = [...rule.allowed_recovery_minutes];
  if (
    athleteLevel === "beginner_cautious" &&
    typeof rule.beginner_cautious_recovery_minutes === "number" &&
    !values.some((value) => approximatelyEqualMinutes(value, rule.beginner_cautious_recovery_minutes))
  ) {
    values.push(rule.beginner_cautious_recovery_minutes);
  }
  return values;
}

export function getPreferredRecovery(
  intent: QualityIntent,
  workMinutes: number,
  athleteLevel: AthleteRecoveryLevel = "standard",
): number | null {
  const rule = getRecoveryRule(intent, workMinutes);
  if (!rule) return null;
  if (athleteLevel === "beginner_cautious" && typeof rule.beginner_cautious_recovery_minutes === "number") {
    return rule.beginner_cautious_recovery_minutes;
  }
  return rule.default_recovery_minutes;
}

export function isRecoveryAllowed(
  intent: QualityIntent,
  workMinutes: number,
  recoveryMinutes: number,
  athleteLevel: AthleteRecoveryLevel = "standard",
): boolean {
  const rule = getRecoveryRule(intent, workMinutes);
  if (!rule) return false;
  const allowed = recoveryListWithAthleteLevel(rule, athleteLevel);
  return allowed.some((value) => approximatelyEqualMinutes(value, recoveryMinutes));
}

export function isDefaultRecoveryValid(
  intent: QualityIntent,
  workMinutes: number,
  recoveryMinutes: number,
): boolean {
  const preferred = getPreferredRecovery(intent, workMinutes, "standard");
  if (preferred === null) return false;
  return approximatelyEqualMinutes(preferred, recoveryMinutes);
}

function normalizeWorkoutPattern(pattern: string): string {
  return pattern
    .trim()
    .toLowerCase()
    .replaceAll(" ", "")
    .replaceAll("×", "x")
    .replaceAll("м", "m");
}

function resolveWorkoutPatternToKey(previousWorkoutPattern: string): QualityWorkoutKey | null {
  const normalized = normalizeWorkoutPattern(previousWorkoutPattern);
  return WORKOUT_PATTERN_ALIASES[normalized] ?? null;
}

export function qualityStructureTotalMinutes(structure: QualityStructure): number {
  const repeatsTotal =
    structure.repeats === null
      ? 0
      : structure.repeats.repeat_count * (structure.repeats.work_minutes + structure.repeats.recovery_minutes);
  return structure.warmup_minutes + repeatsTotal + structure.cooldown_minutes;
}

export function validateQualityStructureForIntent(input: {
  intent: QualityIntent;
  workout_key: QualityWorkoutKey;
  structure: QualityStructure;
}): QualityStructureValidationResult {
  const catalog = getQualityWorkoutCatalogEntry(input.workout_key);
  if (catalog.intent !== input.intent) {
    return {
      ok: false,
      reason: "quality_workout_key_intent_mismatch",
    };
  }

  if (qualityStructureTotalMinutes(input.structure) !== input.structure.total_minutes) {
    return {
      ok: false,
      reason: "quality_structure_total_mismatch",
    };
  }

  if (input.intent === "controlled_sub_threshold") {
    const repeats = input.structure.repeats;
    if (repeats && approximatelyEqualMinutes(repeats.work_minutes, 6) && approximatelyEqualMinutes(repeats.recovery_minutes, 3)) {
      return {
        ok: false,
        reason: "controlled_sub_threshold_6x3_not_allowed_as_v0_default",
      };
    }
  }

  if (input.structure.repeats !== null) {
    const repeats = input.structure.repeats;
    if (repeats.recovery_label !== "easy_jog") {
      return {
        ok: false,
        reason: "recovery_label_must_be_easy_jog",
      };
    }
    if (!isRecoveryAllowed(input.intent, repeats.work_minutes, repeats.recovery_minutes, "standard")) {
      return {
        ok: false,
        reason: "recovery_minutes_not_allowed_for_intent_and_work_duration",
      };
    }
  }

  return { ok: true, reason: null };
}

export function getNextProgressionCandidates(
  previousWorkoutPattern: string,
  context: ProgressionContext,
): ProgressionCandidatesResult {
  const key = resolveWorkoutPatternToKey(previousWorkoutPattern);
  if (!key) {
    return {
      progression_family: null,
      decision: "no_progression_rule",
      next_preferred_keys: [],
      rationale: "unknown_previous_workout_pattern",
    };
  }
  const entry = getQualityWorkoutCatalogEntry(key);
  if (entry.progression_family !== "vo2_short_to_long_intervals") {
    return {
      progression_family: entry.progression_family ?? null,
      decision: "no_progression_rule",
      next_preferred_keys: [],
      rationale: "previous_workout_not_in_supported_progression_family",
    };
  }

  const rpe = context.rpe ?? "unknown";
  const hasRegressSignals =
    context.workout_completed === false ||
    context.illness_or_pain_signal === true ||
    context.strong_fatigue_or_injury_signal === true ||
    context.failed_to_hold_controlled_effort === true ||
    rpe === "very_high";
  if (hasRegressSignals) {
    return {
      progression_family: entry.progression_family,
      decision: "regress_or_switch_to_easy_controlled",
      next_preferred_keys: [],
      rationale: "miss_or_health_or_effort_control_issue",
    };
  }

  const hasRepeatSignals =
    context.partial_completion === true ||
    context.unclear_recovery_feedback === true ||
    context.coach_review_blocker === true ||
    rpe === "high";
  if (hasRepeatSignals) {
    return {
      progression_family: entry.progression_family,
      decision: "repeat",
      next_preferred_keys: [entry.key],
      rationale: "completed_but_not_ready_for_progression",
    };
  }

  const isProgressReady = context.workout_completed === true && (rpe === "low" || rpe === "moderate" || rpe === "unknown");
  if (!isProgressReady) {
    return {
      progression_family: entry.progression_family,
      decision: "repeat",
      next_preferred_keys: [entry.key],
      rationale: "insufficient_progress_readiness_signals",
    };
  }

  return {
    progression_family: entry.progression_family,
    decision: "progress",
    next_preferred_keys: entry.next_preferred_keys ?? [],
    rationale: "completed_no_blockers_rpe_not_excessive",
  };
}

export function selectQualityMethodologyV0(input: {
  quality_count_cap: number | null;
  planned_run_count: number;
  has_active_illness_or_injury: boolean;
  has_race_context: boolean;
  recent_quality_diagnostic_available: boolean;
  found_20x1_candidate: boolean;
}): QualitySelectionResult {
  if ((input.quality_count_cap ?? 0) < 1 || input.planned_run_count < 3) {
    return {
      selected: false,
      reason: "draft_needs_quality_intent",
      selection_reason: "no_quality_slot_available",
    };
  }

  if (input.has_active_illness_or_injury || input.has_race_context) {
    return {
      selected: false,
      reason: "draft_needs_quality_intent",
      selection_reason: "quality_selection_blocked_by_context",
    };
  }

  if (input.recent_quality_diagnostic_available && input.found_20x1_candidate) {
    const selected = getQualityWorkoutCatalogEntry("vo2_10x2");
    return {
      selected: true,
      intent: selected.intent,
      workout_key: selected.key,
      structure: selected.structure,
      selection_reason:
        "recent_quality_session=20x1; continue_vo2_short_interval_progression; maintain_controlled_non_all_out_execution",
    };
  }

  return {
    selected: false,
    reason: "draft_needs_quality_intent",
    selection_reason: input.recent_quality_diagnostic_available
      ? "recent_quality_diagnostic_available_but_no_matching_rule"
      : "missing_recent_quality_diagnostic",
  };
}
