import {
  getQualityWorkoutCatalogEntry,
  type QualityIntent,
  type QualityWorkoutKey,
} from "./plan-quality-methodology-catalog.ts";

export type ProgressionCompletionStatus = "completed" | "partial" | "missed" | "unknown";

export type ProgressionSelectorInput = {
  intent: QualityIntent;
  recentWorkoutPattern?: string | null;
  recentWorkoutKey?: string | null;
  completionStatus?: ProgressionCompletionStatus;
  fatigueOrHealthFlag?: boolean;
  noRaceGeneralDevelopment?: boolean;
};

export type ProgressionSelectionResult = {
  selectedKey: QualityWorkoutKey | null;
  action: "progress" | "repeat" | "regress" | "manual_review";
  reasonCodes: string[];
  confidence: "high" | "medium" | "low";
};

const RECENT_PATTERN_TO_KEY: Record<string, QualityWorkoutKey> = {
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

function normalizePattern(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replaceAll(" ", "")
    .replaceAll("×", "x")
    .replaceAll("х", "x")
    .replaceAll("сек", "sec")
    .replaceAll("мин", "min");
}

function resolveRecentWorkoutKey(input: ProgressionSelectorInput): QualityWorkoutKey | null {
  if (input.recentWorkoutKey && input.recentWorkoutKey in RECENT_PATTERN_TO_KEY) {
    return RECENT_PATTERN_TO_KEY[input.recentWorkoutKey];
  }
  const rawPattern = input.recentWorkoutPattern;
  if (!rawPattern) return null;

  const normalized = normalizePattern(rawPattern);
  const direct = RECENT_PATTERN_TO_KEY[normalized];
  if (direct) return direct;

  const intervalMatch = normalized.match(/(\d{1,2})x(\d{1,4}(?:[.,]\d+)?)(min|sec|m|km)?/i);
  if (!intervalMatch) return null;

  const repeatCount = Number(intervalMatch[1]);
  const work = Number(intervalMatch[2].replace(",", "."));
  const unit = (intervalMatch[3] ?? "min").toLowerCase();
  if (!Number.isFinite(repeatCount) || !Number.isFinite(work)) return null;

  if (repeatCount === 20 && unit === "min" && work === 1) return "vo2_20x1";
  if (repeatCount === 24 && unit === "min" && work === 1) return "vo2_24x1";
  if (repeatCount === 15 && (unit === "m" || unit === "km") && work === 400) return "vo2_15x400";
  if (repeatCount === 20 && ((unit === "sec" && work === 90) || (unit === "min" && work === 1.5))) {
    return "vo2_20x90sec";
  }
  if (repeatCount === 10 && unit === "min" && work === 2) return "vo2_10x2";
  if (repeatCount === 12 && unit === "min" && work === 2) return "vo2_12x2";
  if (repeatCount === 6 && unit === "min" && work === 3) return "vo2_6x3";
  if (repeatCount === 7 && unit === "min" && work === 3) return "vo2_7x3";
  if (repeatCount === 4 && unit === "min" && work === 4) return "vo2_4x4";

  return null;
}

function selectProgressionCandidate(recentKey: QualityWorkoutKey): QualityWorkoutKey | null {
  const entry = getQualityWorkoutCatalogEntry(recentKey);
  const candidates = entry.next_preferred_keys ?? [];
  if (candidates.length === 0) return null;

  if ((recentKey === "vo2_20x1" || recentKey === "vo2_24x1") && candidates.includes("vo2_10x2")) {
    return "vo2_10x2";
  }

  if (recentKey === "vo2_10x2") {
    return candidates.find((key) => key === "vo2_6x3" || key === "vo2_7x3") ?? null;
  }

  const currentStage = entry.progression_stage ?? 0;
  const higherStageCandidate = candidates.find((candidateKey) => {
    const candidate = getQualityWorkoutCatalogEntry(candidateKey);
    return (candidate.progression_stage ?? 0) > currentStage;
  });
  if (higherStageCandidate) return higherStageCandidate;

  return candidates[0] ?? null;
}

export function selectNextQualityWorkoutFromProgression(
  input: ProgressionSelectorInput,
): ProgressionSelectionResult {
  if (input.intent !== "vo2max_intervals") {
    return {
      selectedKey: null,
      action: "manual_review",
      reasonCodes: ["intent_not_supported_for_v0_progression_selector"],
      confidence: "low",
    };
  }

  if (input.noRaceGeneralDevelopment === false) {
    return {
      selectedKey: null,
      action: "manual_review",
      reasonCodes: ["race_or_specific_context_requires_manual_coach_selection"],
      confidence: "low",
    };
  }

  const recentKey = resolveRecentWorkoutKey(input);
  if (!recentKey) {
    return {
      selectedKey: null,
      action: "manual_review",
      reasonCodes: ["unknown_recent_quality_workout_pattern", "progression_action=manual_review"],
      confidence: "low",
    };
  }

  const completion = input.completionStatus ?? "unknown";
  if (input.fatigueOrHealthFlag === true) {
    return {
      selectedKey: recentKey,
      action: "repeat",
      reasonCodes: ["fatigue_or_health_flag=true", "progression_action=repeat"],
      confidence: "high",
    };
  }
  if (completion === "partial") {
    return {
      selectedKey: recentKey,
      action: "repeat",
      reasonCodes: ["recent_quality_completion=partial", "progression_action=repeat"],
      confidence: "high",
    };
  }
  if (completion === "missed") {
    return {
      selectedKey: null,
      action: "regress",
      reasonCodes: ["recent_quality_completion=missed", "progression_action=regress"],
      confidence: "high",
    };
  }

  if (recentKey === "vo2_6x3" || recentKey === "vo2_7x3" || recentKey === "vo2_4x4") {
    return {
      selectedKey: null,
      action: "manual_review",
      reasonCodes: [
        `recent_quality_session=${recentKey.replace("vo2_", "")}`,
        "final_vo2_progression_block_requires_manual_review_in_v0",
        "progression_action=manual_review",
      ],
      confidence: "medium",
    };
  }

  const selectedKey = selectProgressionCandidate(recentKey);
  if (!selectedKey) {
    return {
      selectedKey: null,
      action: "manual_review",
      reasonCodes: [`recent_quality_session=${recentKey.replace("vo2_", "")}`, "no_progression_candidate_found_in_catalog", "progression_action=manual_review"],
      confidence: "low",
    };
  }

  return {
    selectedKey,
    action: "progress",
    reasonCodes: [
      `recent_quality_session=${recentKey.replace("vo2_", "")}`,
      "continue_vo2_short_interval_progression",
      "progression_action=progress",
    ],
    confidence: "high",
  };
}
