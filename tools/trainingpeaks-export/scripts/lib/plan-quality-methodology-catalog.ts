export type QualityIntent = "vo2max_intervals" | "controlled_sub_threshold" | "threshold_tempo";

export type QualityWorkoutKey = "vo2_10x2" | "controlled_3x6" | "threshold_tempo_block";

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
  progression_examples?: string[];
  notes: string[];
};

export type QualityStructureValidationResult = {
  ok: boolean;
  reason: string | null;
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

const QUALITY_CATALOG: Record<QualityWorkoutKey, QualityWorkoutCatalogEntry> = {
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
    progression_examples: ["24x1", "10x2", "12x2", "6x3", "7x3", "4x4"],
    notes: [
      "VO2-oriented but controlled; avoid all-out sprint behavior.",
      "Recovery is easy jog and keeps a 1:1 work:recovery ratio.",
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
    notes: ["Continuous threshold-tempo variant. Detailed progression is coach-selected."],
  },
};

export function getQualityWorkoutCatalogEntry(key: QualityWorkoutKey): QualityWorkoutCatalogEntry {
  return QUALITY_CATALOG[key];
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
    if (repeats && repeats.work_minutes === 6 && repeats.recovery_minutes === 3) {
      return {
        ok: false,
        reason: "controlled_sub_threshold_6x3_not_allowed_as_v0_default",
      };
    }
  }

  return { ok: true, reason: null };
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
