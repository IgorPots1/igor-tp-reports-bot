import { loadEPredictorConstants } from "./e-predictor-constants.ts";
import {
  classifyNearDistanceAnchorEffort,
  nearDistanceAnchorBlocksTrainingImplied,
  type NearDistanceAnchorEffortClassification,
  type NearDistanceEffortCandidate,
} from "./e-predictor-near-distance-effort.ts";
import type { TrainingImpliedHalfAnchor } from "./e-predictor-training-implied-half.ts";
import {
  DISTANCE_PRESETS,
  formatDurationFromSeconds,
  formatPaceText,
  paceMinPerKmToSeconds,
  type DistanceKey,
} from "./race-distance.ts";

export type { NearDistanceAnchorEffortClassification } from "./e-predictor-near-distance-effort.ts";

export type NearDistanceAnchorKind =
  | "official_best"
  | "official_flagged"
  | "probable_best"
  | "clean_training_best";

export type NearDistanceHalfAnchor = {
  kind: NearDistanceAnchorKind;
  tier: 1;
  date: string;
  title: string | null;
  distance_km: number;
  pace_text: string;
  duration_text: string;
  implied_half_time_s: number;
  implied_half_pace_s_per_km: number;
  source_label: string;
  age_days: number;
};

export type TrainingImpliedAnchorConflictSeverity = "none" | "mild" | "strong" | "block";

export type TrainingImpliedAnchorSanityCheck = {
  near_distance_anchor: NearDistanceHalfAnchor | null;
  near_distance_anchor_effort_classification: NearDistanceAnchorEffortClassification | null;
  training_implied_half_time_s: number | null;
  training_implied_faster_pct: number | null;
  severity: TrainingImpliedAnchorConflictSeverity;
  block_automatic_likely: boolean;
  aerobic_near_distance_blend: boolean;
  flags: string[];
  notes: string[];
  source_quality_note_ru: string | null;
};

export type RaceResultAnchorCandidate = {
  kind: string;
  candidate: NearDistanceEffortCandidate & {
    duration_text: string;
    duration_min?: number;
    pace_text: string;
    distance_bucket?: DistanceKey;
    data_quality_status?: string;
    display_class?: string;
  };
};

function effortCandidateFromAnchor(entry: RaceResultAnchorCandidate): NearDistanceEffortCandidate {
  return {
    kind: entry.kind as NearDistanceAnchorKind,
    date: entry.candidate.date,
    title: entry.candidate.title,
    distance_km: entry.candidate.distance_km,
    pace_min_per_km: entry.candidate.pace_min_per_km,
    avg_hr: entry.candidate.avg_hr ?? null,
    personalRecordCount: entry.candidate.personalRecordCount ?? null,
    race_signals: entry.candidate.race_signals,
    same_day_event: entry.candidate.same_day_event,
    event_name: entry.candidate.event_name ?? null,
    event_confidence: entry.candidate.event_confidence,
    result_status: entry.candidate.result_status,
    display_class: entry.candidate.display_class,
    warnings: entry.candidate.warnings,
    heart_rate_peer_reference: entry.candidate.heart_rate_peer_reference,
  };
}

function daysBetween(from: string, to: string): number {
  const start = new Date(`${from}T12:00:00Z`).getTime();
  const end = new Date(`${to}T12:00:00Z`).getTime();
  return Math.round((end - start) / (24 * 60 * 60 * 1000));
}

function isCleanEnough(candidate: RaceResultAnchorCandidate["candidate"]): boolean {
  if (candidate.data_quality_status === "excluded") return false;
  if (candidate.result_status === "excluded") return false;
  if (candidate.display_class === "excluded") return false;
  return true;
}

function isNearHalfDistance(distanceKm: number, minKm: number, maxKm: number): boolean {
  return distanceKm >= minKm && distanceKm <= maxKm;
}

function impliedHalfSecondsFromAnchor(
  candidate: RaceResultAnchorCandidate["candidate"],
  targetDistanceKm: number,
): number | null {
  if (candidate.pace_min_per_km <= 0) return null;
  return paceMinPerKmToSeconds(candidate.pace_min_per_km, targetDistanceKm);
}

function riegelEquivalentHalfSeconds(input: {
  sourceDistanceKm: number;
  sourceTimeSeconds: number;
  targetDistanceKm: number;
  exponent: number;
}): number {
  const ratio = input.targetDistanceKm / input.sourceDistanceKm;
  return Math.round(input.sourceTimeSeconds * ratio ** input.exponent);
}

function anchorTier1Score(kind: NearDistanceAnchorKind): number {
  switch (kind) {
    case "official_best":
      return 400;
    case "official_flagged":
      return 350;
    case "probable_best":
      return 300;
    case "clean_training_best":
      return 200;
    default:
      return 0;
  }
}

function resolveTier1NearHalfAnchor(input: {
  primary: RaceResultAnchorCandidate | null;
  alternates: RaceResultAnchorCandidate[];
  crossDistance: RaceResultAnchorCandidate[];
  raceDate: string;
  targetDistanceKm: number;
}): NearDistanceHalfAnchor | null {
  const cfg = loadEPredictorConstants().half_marathon.training_implied_anchor_sanity;
  const candidates: NearDistanceHalfAnchor[] = [];

  const considerHalfBucketAnchor = (entry: RaceResultAnchorCandidate) => {
    if (!isCleanEnough(entry.candidate)) return;
    const kind = entry.kind as NearDistanceAnchorKind;
    if (
      kind !== "clean_training_best" &&
      kind !== "probable_best" &&
      kind !== "official_best" &&
      kind !== "official_flagged"
    ) {
      return;
    }
    if (!isNearHalfDistance(entry.candidate.distance_km, cfg.near_half_distance_km_min, cfg.near_half_distance_km_max)) {
      return;
    }
    const impliedHalfTimeS = impliedHalfSecondsFromAnchor(entry.candidate, input.targetDistanceKm);
    if (impliedHalfTimeS === null) return;

    const sourceLabel =
      kind === "clean_training_best"
        ? "clean_training_best (near-half training simulation)"
        : kind === "probable_best"
          ? "probable_best (near-half race-like effort)"
          : `${kind} (near-half race result)`;

    candidates.push({
      kind,
      tier: 1,
      date: entry.candidate.date,
      title: entry.candidate.title,
      distance_km: entry.candidate.distance_km,
      pace_text: entry.candidate.pace_text,
      duration_text: entry.candidate.duration_text,
      implied_half_time_s: impliedHalfTimeS,
      implied_half_pace_s_per_km: Math.round(impliedHalfTimeS / input.targetDistanceKm),
      source_label: sourceLabel,
      age_days: daysBetween(entry.candidate.date, input.raceDate),
    });
  };

  if (input.primary) considerHalfBucketAnchor(input.primary);
  for (const alternate of input.alternates) considerHalfBucketAnchor(alternate);

  const exponent = loadEPredictorConstants().riegel.default_exponent;
  for (const entry of input.crossDistance) {
    if (!isCleanEnough(entry.candidate)) continue;
    const kind = entry.kind;
    if (kind !== "official_best" && kind !== "probable_best") continue;

    const distanceBucket = entry.candidate.distance_bucket;
    if (distanceBucket !== "10k" && distanceBucket !== "5k") continue;

    const freshnessDays = cfg.cross_distance_race_freshness_days[distanceBucket];
    const ageDays = daysBetween(entry.candidate.date, input.raceDate);
    if (ageDays > freshnessDays) continue;

    const sourceDistanceKm =
      entry.candidate.distance_km > 0
        ? entry.candidate.distance_km
        : DISTANCE_PRESETS[distanceBucket].target_km;
    const sourceTimeSeconds =
      entry.candidate.duration_min && entry.candidate.duration_min > 0
        ? Math.round(entry.candidate.duration_min * 60)
        : Math.round(entry.candidate.pace_min_per_km * 60 * sourceDistanceKm);
    const impliedHalfTimeS = riegelEquivalentHalfSeconds({
      sourceDistanceKm,
      sourceTimeSeconds,
      targetDistanceKm: input.targetDistanceKm,
      exponent,
    });

    candidates.push({
      kind: kind as NearDistanceAnchorKind,
      tier: 1,
      date: entry.candidate.date,
      title: entry.candidate.title,
      distance_km: entry.candidate.distance_km,
      pace_text: entry.candidate.pace_text,
      duration_text: entry.candidate.duration_text,
      implied_half_time_s: impliedHalfTimeS,
      implied_half_pace_s_per_km: Math.round(impliedHalfTimeS / input.targetDistanceKm),
      source_label: `${kind} (${DISTANCE_PRESETS[distanceBucket].label}, Riegel → half)`,
      age_days: ageDays,
    });
  }

  if (!candidates.length) return null;

  candidates.sort((left, right) => {
    const scoreDiff = anchorTier1Score(right.kind) - anchorTier1Score(left.kind);
    if (scoreDiff !== 0) return scoreDiff;
    return left.age_days - right.age_days;
  });

  return candidates[0] ?? null;
}

function classifyConflictSeverity(fasterPct: number): TrainingImpliedAnchorConflictSeverity {
  const cfg = loadEPredictorConstants().half_marathon.training_implied_anchor_sanity;
  if (fasterPct > cfg.block_automatic_likely_faster_pct) return "block";
  if (fasterPct > cfg.strong_conflict_faster_pct) return "strong";
  if (fasterPct > cfg.mild_conflict_faster_pct) return "mild";
  return "none";
}

export function assessTrainingImpliedHalfAnchorSanity(input: {
  primary: RaceResultAnchorCandidate | null;
  alternates: RaceResultAnchorCandidate[];
  crossDistance: RaceResultAnchorCandidate[];
  trainingImpliedAnchor: TrainingImpliedHalfAnchor;
  raceDate: string;
  targetDistanceKm?: number;
}): TrainingImpliedAnchorSanityCheck {
  const targetDistanceKm = input.targetDistanceKm ?? DISTANCE_PRESETS.half.target_km;
  const trainingImpliedHalfTimeS = input.trainingImpliedAnchor.implied_half_time_s;
  const nearDistanceAnchor = resolveTier1NearHalfAnchor({
    primary: input.primary,
    alternates: input.alternates,
    crossDistance: input.crossDistance,
    raceDate: input.raceDate,
    targetDistanceKm,
  });

  const primaryEntryForEffort =
    nearDistanceAnchor &&
    input.primary?.candidate.date === nearDistanceAnchor.date &&
    input.primary?.kind === nearDistanceAnchor.kind
      ? input.primary
      : nearDistanceAnchor
        ? (input.alternates.find(
            (entry) =>
              entry.candidate.date === nearDistanceAnchor.date &&
              entry.kind === nearDistanceAnchor.kind,
          ) ?? null)
        : null;
  const effortClassification = primaryEntryForEffort
    ? classifyNearDistanceAnchorEffort(effortCandidateFromAnchor(primaryEntryForEffort))
    : null;

  const base: TrainingImpliedAnchorSanityCheck = {
    near_distance_anchor: nearDistanceAnchor,
    near_distance_anchor_effort_classification: effortClassification,
    training_implied_half_time_s: trainingImpliedHalfTimeS,
    training_implied_faster_pct: null,
    severity: "none",
    block_automatic_likely: false,
    aerobic_near_distance_blend: false,
    flags: [],
    notes: [],
    source_quality_note_ru: null,
  };

  if (!input.trainingImpliedAnchor.available || trainingImpliedHalfTimeS === null || !nearDistanceAnchor) {
    return base;
  }

  const resolvedEffort = effortClassification!;

  const fasterPct =
    (nearDistanceAnchor.implied_half_time_s - trainingImpliedHalfTimeS) /
    nearDistanceAnchor.implied_half_time_s;
  const severity = classifyConflictSeverity(fasterPct);
  const blocksTrainingImplied = nearDistanceAnchorBlocksTrainingImplied(
    resolvedEffort.effort_class,
    nearDistanceAnchor.kind,
  );
  const blockAutomaticLikely = severity !== "none" && blocksTrainingImplied;
  const aerobicBlend =
    severity !== "none" &&
    !blocksTrainingImplied &&
    resolvedEffort.effort_class === "aerobic_near_distance_support";
  const flags: string[] = [];
  const notes: string[] = [
    `Near-distance Tier 1 anchor: ${nearDistanceAnchor.source_label}, ${nearDistanceAnchor.duration_text} (${nearDistanceAnchor.pace_text}) → half ~${formatDurationFromSeconds(nearDistanceAnchor.implied_half_time_s)}.`,
    `Near-distance effort: ${resolvedEffort.effort_class} — ${resolvedEffort.reason}`,
    `Training-implied half candidate: ${formatDurationFromSeconds(trainingImpliedHalfTimeS)} (${formatPaceText((input.trainingImpliedAnchor.implied_half_pace_s_per_km ?? 0) / 60)}).`,
    `Training-implied is ${Math.round(fasterPct * 1000) / 10}% faster than near-distance reference (${severity} conflict).`,
  ];

  if (resolvedEffort.effort_class === "aerobic_near_distance_support") {
    notes.push("Near-distance run is aerobic support, not race-like anchor.");
    notes.push(
      "Aerobic near-distance run clears durability support and sets a conservative floor; it does not cap tempo-implied half.",
    );
  }

  if (severity === "mild") {
    notes.push("Mild conflict: tempo blocks may reflect current shape but do not pass consistency check vs near-distance anchor.");
  }
  if ((severity === "strong" || severity === "block") && blocksTrainingImplied) {
    flags.push("training_implied_anchor_conflicts_with_near_distance_anchor");
    notes.push(
      "Strong conflict: automatic likely must not rely on training-implied half; conservative near-distance anchor drives prediction.",
    );
  }
  if ((severity === "strong" || severity === "block") && aerobicBlend) {
    flags.push("combined_evidence_requires_coach_review");
    notes.push(
      "Large gap vs aerobic near-distance support — manual-review range: conservative floor from long run, likely from capped tempo-implied current shape.",
    );
  }
  if (severity === "block") {
    flags.push("prediction_conflict_requires_coach_review");
    if (blocksTrainingImplied) {
      notes.push("Block threshold exceeded — coach review required before trusting aggressive tempo-implied half.");
    } else if (aerobicBlend) {
      notes.push("Block-sized gap with aerobic near-distance support — coach review required before trusting raw tempo-implied half.");
    }
  }

  const roundedPct = Math.round(fasterPct * 100);
  const anchorLabel =
    nearDistanceAnchor.kind === "clean_training_best"
      ? "clean_training_best"
      : nearDistanceAnchor.source_label;
  let sourceQualityNoteRu: string | null = null;
  if (severity !== "none" && blocksTrainingImplied) {
    sourceQualityNoteRu = `Быстрые темповые блоки указывают на высокий потенциал, но они сильно расходятся с ${anchorLabel} на ~21 км (~${roundedPct}%). Автоматический likely не должен опираться на них без тренерской проверки.`;
  } else if (severity !== "none" && aerobicBlend) {
    sourceQualityNoteRu = `Темповые блоки быстрее аэробной длительной ~21 км (~${roundedPct}%) — likely ограничен, требуется проверка тренером.`;
  }

  return {
    near_distance_anchor: nearDistanceAnchor,
    near_distance_anchor_effort_classification: resolvedEffort,
    training_implied_half_time_s: trainingImpliedHalfTimeS,
    training_implied_faster_pct: Math.round(fasterPct * 10000) / 10000,
    severity,
    block_automatic_likely: blockAutomaticLikely,
    aerobic_near_distance_blend: aerobicBlend,
    flags,
    notes,
    source_quality_note_ru: sourceQualityNoteRu,
  };
}

function aerobicBlendCapPct(
  severity: TrainingImpliedAnchorConflictSeverity,
  map: Record<"mild" | "strong" | "block", number>,
): number {
  if (severity === "block") return map.block;
  if (severity === "strong") return map.strong;
  return map.mild;
}

export function boostTrainingImpliedEnduranceWithAerobicNearDistance(input: {
  trainingImpliedAnchor: TrainingImpliedHalfAnchor;
  nearDistanceAnchor: NearDistanceHalfAnchor;
  effort: NearDistanceAnchorEffortClassification;
}): TrainingImpliedHalfAnchor {
  if (input.effort.effort_class !== "aerobic_near_distance_support") {
    return input.trainingImpliedAnchor;
  }
  const cfg = loadEPredictorConstants().half_marathon.training_implied_anchor_sanity;
  if (
    input.nearDistanceAnchor.distance_km < cfg.near_half_distance_km_min ||
    input.nearDistanceAnchor.distance_km > cfg.near_half_distance_km_max
  ) {
    return input.trainingImpliedAnchor;
  }

  const anchor = input.trainingImpliedAnchor;
  if (anchor.endurance_gate.status === "cleared") {
    return {
      ...anchor,
      endurance_gate: {
        ...anchor.endurance_gate,
        notes: [
          ...anchor.endurance_gate.notes,
          `Aerobic near-distance ${input.nearDistanceAnchor.distance_km.toFixed(1)} km (${input.nearDistanceAnchor.date}) reinforces half durability.`,
        ],
      },
    };
  }

  const durabilityCfg =
    loadEPredictorConstants().half_marathon.training_implied_anchor.durability_penalty_seconds_per_km;
  const impliedHalfPaceSPerKm = anchor.implied_half_pace_s_per_km;
  const impliedHalfTimeS = anchor.implied_half_time_s;
  const newDurabilityPenalty = durabilityCfg.cleared;
  let adjustedImpliedHalfTimeS = impliedHalfTimeS;
  let adjustedImpliedHalfPaceSPerKm = impliedHalfPaceSPerKm;
  if (
    impliedHalfPaceSPerKm !== null &&
    impliedHalfTimeS !== null &&
    anchor.durability_penalty_s_per_km !== null &&
    anchor.durability_penalty_s_per_km > newDurabilityPenalty
  ) {
    const deltaPenalty = anchor.durability_penalty_s_per_km - newDurabilityPenalty;
    adjustedImpliedHalfPaceSPerKm = impliedHalfPaceSPerKm - deltaPenalty;
    adjustedImpliedHalfTimeS = Math.round(adjustedImpliedHalfPaceSPerKm * 21.0975);
  }

  return {
    ...anchor,
    implied_half_pace_s_per_km: adjustedImpliedHalfPaceSPerKm,
    implied_half_time_s: adjustedImpliedHalfTimeS,
    durability_penalty_s_per_km: newDurabilityPenalty,
    endurance_gate: {
      ...anchor.endurance_gate,
      passed: true,
      status: "cleared",
      longest_run_km: Math.max(anchor.endurance_gate.longest_run_km, input.nearDistanceAnchor.distance_km),
      notes: [
        ...anchor.endurance_gate.notes,
        `Aerobic near-distance ${input.nearDistanceAnchor.distance_km.toFixed(1)} km (${input.nearDistanceAnchor.date}) clears durability gate.`,
      ],
    },
    notes: [
      ...anchor.notes,
      "Near-distance aerobic long run used as endurance support (not race-like performance cap).",
    ],
  };
}

export function blendScenariosWithAerobicNearDistanceFloor(input: {
  floorHalfTimeS: number;
  trainingImpliedHalfTimeS: number;
  severity: TrainingImpliedAnchorConflictSeverity;
  v3LikelySeconds: number;
  v3OptimisticSeconds: number;
  v3ConservativeSeconds: number;
  targetDistanceKm: number;
}): {
  conservative: { seconds: number; time_text: string; pace_text: string };
  likely: { seconds: number; time_text: string; pace_text: string };
  optimistic: { seconds: number; time_text: string; pace_text: string };
  notes: string[];
} {
  const cfg = loadEPredictorConstants().half_marathon.training_implied_anchor_sanity;
  const likelyCapPct = aerobicBlendCapPct(
    input.severity,
    cfg.aerobic_blend_likely_max_faster_than_floor_pct,
  );
  const optimisticCapPct = aerobicBlendCapPct(
    input.severity,
    cfg.aerobic_blend_optimistic_max_faster_than_floor_pct,
  );

  const likelyFastestAllowed = Math.round(input.floorHalfTimeS * (1 - likelyCapPct));
  const optimisticFastestAllowed = Math.round(input.floorHalfTimeS * (1 - optimisticCapPct));
  let likelySeconds = Math.max(input.v3LikelySeconds, likelyFastestAllowed);
  let optimisticSeconds = Math.max(
    input.v3OptimisticSeconds,
    optimisticFastestAllowed,
    input.trainingImpliedHalfTimeS,
  );
  const conservativeSeconds = Math.max(
    input.v3ConservativeSeconds,
    Math.round(input.floorHalfTimeS * 1.02),
  );

  if (optimisticSeconds >= likelySeconds) {
    optimisticSeconds = Math.max(likelyFastestAllowed, likelySeconds - 1);
  }
  if (likelySeconds >= conservativeSeconds) {
    likelySeconds = Math.min(likelySeconds, conservativeSeconds - 1);
  }

  const build = (seconds: number) => ({
    seconds,
    time_text: formatDurationFromSeconds(seconds),
    pace_text: formatPaceText(seconds / 60 / input.targetDistanceKm),
  });

  return {
    conservative: build(conservativeSeconds),
    likely: build(likelySeconds),
    optimistic: build(optimisticSeconds),
    notes: [
      `Aerobic near-distance floor ~${formatDurationFromSeconds(input.floorHalfTimeS)}; likely not faster than ${formatDurationFromSeconds(likelyFastestAllowed)} (${Math.round(likelyCapPct * 1000) / 10}% vs floor).`,
      `Optimistic not faster than ${formatDurationFromSeconds(optimisticSeconds)} (raw training-implied ${formatDurationFromSeconds(input.trainingImpliedHalfTimeS)}).`,
    ],
  };
}

export function resolveSelectedAnchorForNearDistance(
  nearDistance: NearDistanceHalfAnchor,
  fallback: RaceResultAnchorCandidate | null,
): RaceResultAnchorCandidate {
  if (
    fallback &&
    fallback.candidate.date === nearDistance.date &&
    fallback.kind === nearDistance.kind
  ) {
    return fallback;
  }

  const paceMinPerKm = nearDistance.implied_half_pace_s_per_km / 60;
  return {
    kind: nearDistance.kind,
    candidate: {
      date: nearDistance.date,
      title: nearDistance.title,
      distance_km: nearDistance.distance_km,
      duration_text: nearDistance.duration_text,
      pace_text: nearDistance.pace_text,
      pace_min_per_km: paceMinPerKm,
      data_quality_status: "clean",
    },
  };
}

export function applyTrainingImpliedSanityToSustainedBlocks(input: {
  segmentKeyWorkouts: Array<{
    sustained_effort_candidate?: {
      available: boolean;
      evidence_role: string;
      used_for_training_implied_anchor?: boolean;
      prediction_evidence_status?: string;
      sanity_flags?: string[];
      notes: string[];
    };
  }>;
  sanity: TrainingImpliedAnchorSanityCheck;
}): void {
  if (input.sanity.severity === "none") return;

  const blocksTrainingImplied =
    input.sanity.near_distance_anchor !== null &&
    input.sanity.near_distance_anchor_effort_classification !== null &&
    nearDistanceAnchorBlocksTrainingImplied(
      input.sanity.near_distance_anchor_effort_classification.effort_class,
      input.sanity.near_distance_anchor.kind,
    );
  const aerobicSupport =
    input.sanity.near_distance_anchor_effort_classification?.effort_class ===
    "aerobic_near_distance_support";

  for (const workout of input.segmentKeyWorkouts) {
    const sustained = workout.sustained_effort_candidate;
    if (!sustained?.available) continue;
    if (
      sustained.evidence_role !== "threshold_tempo_sustained" &&
      sustained.evidence_role !== "half_specific_sustained"
    ) {
      continue;
    }

    if (blocksTrainingImplied) {
      sustained.sanity_flags = [...(sustained.sanity_flags ?? []), "overaggressive_vs_near_distance_anchor"];
    } else if (aerobicSupport && (input.sanity.severity === "strong" || input.sanity.severity === "block")) {
      sustained.sanity_flags = [...(sustained.sanity_flags ?? []), "conflicts_with_aerobic_near_distance_support"];
    }

    if (sustained.used_for_training_implied_anchor) {
      if (blocksTrainingImplied) {
        sustained.prediction_evidence_status =
          input.sanity.severity === "block" || input.sanity.severity === "strong"
            ? "report_only_until_coach_review"
            : "low_confidence";
        sustained.notes.push(
          "Tempo/threshold sustained block supports current shape, but conflicts with near-distance anchor — report-only until coach review.",
        );
      } else if (aerobicSupport && (input.sanity.severity === "strong" || input.sanity.severity === "block")) {
        sustained.prediction_evidence_status = "report_only_until_coach_review";
        sustained.notes.push(
          "Tempo/threshold sustained block supports current shape, but exceeds aerobic near-distance support — report-only until coach review.",
        );
      } else {
        sustained.prediction_evidence_status = "low_confidence";
      }
    } else {
      sustained.prediction_evidence_status = "supports_current_shape";
    }
  }
}
