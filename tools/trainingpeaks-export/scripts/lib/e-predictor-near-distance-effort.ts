import type { NearDistanceAnchorKind } from "./e-predictor-training-implied-anchor-sanity.ts";

export type NearDistanceAnchorEffortClass =
  | "race_like_near_distance_anchor"
  | "hard_training_near_distance_anchor"
  | "aerobic_near_distance_support"
  | "unknown_near_distance_anchor";

export type NearDistanceAnchorHowUsed =
  | "race_anchor"
  | "endurance_support_only"
  | "conservative_floor"
  | "manual_review";

export type NearDistanceAnchorEffortClassification = {
  source: string;
  effort_class: NearDistanceAnchorEffortClass;
  avg_hr: number | null;
  title: string | null;
  reason: string;
  how_used: NearDistanceAnchorHowUsed[];
};

export type NearDistanceEffortCandidate = {
  kind: NearDistanceAnchorKind;
  date: string;
  title: string | null;
  distance_km: number;
  pace_min_per_km: number;
  avg_hr?: number | null;
  personalRecordCount?: number | null;
  race_signals?: string[];
  same_day_event?: boolean;
  event_name?: string | null;
  event_confidence?: number;
  result_status?: string;
  display_class?: string;
  warnings?: string[];
  heart_rate_peer_reference?: {
    peer_median_hr?: number | null;
    next_best_hr?: number | null;
    hr_gap_vs_median?: number;
    hr_gap_vs_next_best?: number | null;
  };
};

const AEROBIC_TITLE_PATTERN =
  /\b(long run|long\b|длительн|длинн|lsd|продолжительн|аэроб|aerobic|easy|recovery|легк|лёгк|восстанов|спокойн|разговорн|джог)\b|\b\d{2,3}\s*мин(?:ут)?\s+бег\b/i;
const RACE_TITLE_PATTERN =
  /\b(race|гонк|соревнован|старт|time trial|tt\b|тест|test run|пробег|контрольн(?:ый|ая|ое)?\s+(?:бег|темп)|half marathon|полумарафон|21\.1|hm\b)\b/i;

function candidateHasRaceKeyword(candidate: NearDistanceEffortCandidate): boolean {
  return (candidate.race_signals ?? []).some((signal) => signal === "race_keywords_in_text");
}

function candidateHasHardEffortHr(candidate: NearDistanceEffortCandidate): boolean {
  const hr = candidate.avg_hr ?? null;
  if (hr === null) return false;
  if (hr >= 178) return true;
  const peer = candidate.heart_rate_peer_reference;
  const baseline = peer?.next_best_hr ?? peer?.peer_median_hr ?? null;
  if (baseline === null) return hr >= 175;
  return hr >= baseline - 6;
}

function candidateHasAerobicHr(candidate: NearDistanceEffortCandidate): boolean {
  const hr = candidate.avg_hr ?? null;
  if (hr === null) return false;
  const peer = candidate.heart_rate_peer_reference;
  const baseline = peer?.peer_median_hr ?? peer?.next_best_hr ?? null;
  if (baseline !== null && baseline > 0) {
    return hr <= baseline - 12;
  }
  return hr <= 155;
}

function candidateHasStrongHrMismatch(candidate: NearDistanceEffortCandidate): boolean {
  const warnings = new Set(candidate.warnings ?? []);
  if (!warnings.has("heart_rate_mismatch")) return false;
  const ref = candidate.heart_rate_peer_reference;
  if (!ref) return false;
  const gap = Math.max(ref.hr_gap_vs_median ?? 0, ref.hr_gap_vs_next_best ?? 0);
  return gap >= 20;
}

function candidateHasAerobicTitle(candidate: NearDistanceEffortCandidate): boolean {
  const title = candidate.title ?? "";
  return AEROBIC_TITLE_PATTERN.test(title);
}

function candidateHasRaceTitle(candidate: NearDistanceEffortCandidate): boolean {
  const title = candidate.title ?? "";
  return RACE_TITLE_PATTERN.test(title);
}

function isOfficialOrProbableRaceKind(kind: NearDistanceAnchorKind): boolean {
  return kind === "official_best" || kind === "official_flagged" || kind === "probable_best";
}

function isCredibleSameDayEvent(candidate: NearDistanceEffortCandidate): boolean {
  return (
    Boolean(candidate.same_day_event) &&
    Boolean(candidate.event_name?.trim()) &&
    (candidate.event_confidence ?? 0) >= 0.45
  );
}

function isProbableRaceResult(candidate: NearDistanceEffortCandidate): boolean {
  return candidate.result_status === "probable_result" || candidate.result_status === "official_event";
}

export function nearDistanceAnchorBlocksTrainingImplied(
  effortClass: NearDistanceAnchorEffortClass,
  kind: NearDistanceAnchorKind,
): boolean {
  if (isOfficialOrProbableRaceKind(kind)) return true;
  return (
    effortClass === "race_like_near_distance_anchor" ||
    effortClass === "hard_training_near_distance_anchor"
  );
}

export function classifyNearDistanceAnchorEffort(
  candidate: NearDistanceEffortCandidate,
): NearDistanceAnchorEffortClassification {
  const source = `${candidate.kind} · ${candidate.date} · ${candidate.distance_km.toFixed(2)} km`;
  const avgHr = candidate.avg_hr ?? null;
  const title = candidate.title;
  const howUsed: NearDistanceAnchorHowUsed[] = [];

  if (isOfficialOrProbableRaceKind(candidate.kind)) {
    howUsed.push("race_anchor");
    return {
      source,
      effort_class: "race_like_near_distance_anchor",
      avg_hr: avgHr,
      title,
      reason: "Official or probable near-distance race result.",
      how_used: howUsed,
    };
  }

  if (isCredibleSameDayEvent(candidate) || isProbableRaceResult(candidate)) {
    howUsed.push("race_anchor");
    return {
      source,
      effort_class: "race_like_near_distance_anchor",
      avg_hr: avgHr,
      title,
      reason: "Same-day event or probable race result on near-half distance.",
      how_used: howUsed,
    };
  }

  const raceTitle = candidateHasRaceTitle(candidate);
  const raceKeyword = candidateHasRaceKeyword(candidate);
  const hardHr = candidateHasHardEffortHr(candidate);
  const aerobicHr = candidateHasAerobicHr(candidate);
  const aerobicTitle = candidateHasAerobicTitle(candidate);
  const strongHrMismatch = candidateHasStrongHrMismatch(candidate);
  const prCount = candidate.personalRecordCount ?? 0;

  if (raceTitle || raceKeyword) {
    howUsed.push("race_anchor");
    return {
      source,
      effort_class: "race_like_near_distance_anchor",
      avg_hr: avgHr,
      title,
      reason: "Title or workout text indicates race, test, or time trial.",
      how_used: howUsed,
    };
  }

  if (aerobicTitle && aerobicHr && !hardHr) {
    howUsed.push("endurance_support_only", "conservative_floor");
    return {
      source,
      effort_class: "aerobic_near_distance_support",
      avg_hr: avgHr,
      title,
      reason:
        "Long-run/aerobic title with clearly aerobic HR — near-distance support, not race-equivalent anchor.",
      how_used: howUsed,
    };
  }

  if (aerobicHr && strongHrMismatch && !hardHr) {
    howUsed.push("endurance_support_only", "conservative_floor");
    return {
      source,
      effort_class: "aerobic_near_distance_support",
      avg_hr: avgHr,
      title,
      reason: "HR is much lower than peer hard efforts — aerobic near-distance support.",
      how_used: howUsed,
    };
  }

  if (hardHr && prCount > 0) {
    howUsed.push("race_anchor");
    return {
      source,
      effort_class: "race_like_near_distance_anchor",
      avg_hr: avgHr,
      title,
      reason: "High HR with personal-record markers supports race-like near-distance effort.",
      how_used: howUsed,
    };
  }

  if (hardHr) {
    howUsed.push("race_anchor", "manual_review");
    return {
      source,
      effort_class: "hard_training_near_distance_anchor",
      avg_hr: avgHr,
      title,
      reason: "HR supports hard training effort on near-half distance (not confirmed race).",
      how_used: howUsed,
    };
  }

  if (aerobicTitle || aerobicHr) {
    howUsed.push("endurance_support_only", "conservative_floor");
    return {
      source,
      effort_class: "aerobic_near_distance_support",
      avg_hr: avgHr,
      title,
      reason: "Steady pace with aerobic signals — endurance support, not race-like cap.",
      how_used: howUsed,
    };
  }

  howUsed.push("manual_review");
  return {
    source,
    effort_class: "unknown_near_distance_anchor",
    avg_hr: avgHr,
    title,
    reason: "Near-distance anchor effort unclear — treat cautiously until coach review.",
    how_used: howUsed,
  };
}
