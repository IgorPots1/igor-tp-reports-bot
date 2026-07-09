// Classifies FIT laps as work (interval effort) vs jog/rest, per design doc
// section 5a: plan-structure is primary, wkt_step_index/lap_trigger confirm
// it, a pace-clustering heuristic is the last-resort fallback.
//
// The discriminating signal is PACE, not duration: work reps can be either
// shorter (sprint intervals: short hard / long recovery) or longer (tempo
// intervals: long hard / short recovery) than their recovery laps, but the
// work laps are reliably FASTER regardless of interval style.

import { lapPaceSecPerKm, type NormalizedFitLap } from "./fit-workout-normalization.ts";

export type WorkDetectionMethod = "structure" | "lap_trigger" | "heuristic" | "none";

export type WorkDetectionResult = {
  method: WorkDetectionMethod;
  // lapIndex -> is_work; missing entries / null values mean "undetermined"
  isWorkByLapIndex: Map<number, boolean | null>;
  expectedWorkStepCount: number | null;
  notes: string[];
};

// Minimum proportional pace gap (fast vs slow cluster) required to trust a
// bimodal split as real intervals rather than natural pace variation within
// one effort. Interval-vs-recovery pace gaps are typically much larger than
// this; 12% is a conservative floor.
const WORK_PACE_GAP_MIN_RATIO = 0.12;
// Each cluster needs at least this many laps to count as a real pattern.
const MIN_CLUSTER_SIZE = 2;
// Minimum total laps with a valid pace before the heuristic tier is trusted
// at all (too few laps makes any 2-cluster split coincidental).
const MIN_LAPS_FOR_HEURISTIC = 4;
// Tolerance (as a fraction of expectedWorkStepCount, floor 1) between the
// wkt_step_index "fast" group's lap count and the plan's expected work-step
// count before the structure tier is trusted.
const STRUCTURE_MATCH_TOLERANCE_RATIO = 0.3;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toPositiveInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    return null;
  }
  return value;
}

// source_snapshot.structure (as written by tp-workouts-cache-scan.ts's
// buildCompactSourceSnapshot) is either the parsed TP structure object
// ({structure: [...], polyline: [...], ...}), a bare array, or a
// {summaryOnly: true, ...} fallback when parsing/serialization failed. Only
// the first two are usable here.
function extractStructureArray(structureSnapshot: unknown): unknown[] | null {
  if (Array.isArray(structureSnapshot)) return structureSnapshot;
  if (isRecord(structureSnapshot) && Array.isArray(structureSnapshot.structure)) {
    return structureSnapshot.structure;
  }
  return null;
}

// Expands {type, length:{value}, steps:[...]} nodes into one occurrence per
// actual repetition, recursing into any nested repetition blocks.
function expandStructureToStepOccurrences(nodes: unknown[]): Array<{ intensityClass: string | null }> {
  const occurrences: Array<{ intensityClass: string | null }> = [];
  for (const node of nodes) {
    if (!isRecord(node)) continue;
    const repeatCount = toPositiveInt(isRecord(node.length) ? node.length.value : null) ?? 1;
    const innerSteps = Array.isArray(node.steps) ? node.steps : [];
    for (let cycle = 0; cycle < repeatCount; cycle += 1) {
      for (const inner of innerSteps) {
        if (!isRecord(inner)) continue;
        if (Array.isArray(inner.steps)) {
          occurrences.push(...expandStructureToStepOccurrences([inner]));
          continue;
        }
        occurrences.push({
          intensityClass: typeof inner.intensityClass === "string" ? inner.intensityClass : null,
        });
      }
    }
  }
  return occurrences;
}

export function extractExpectedWorkStepCount(structureSnapshot: unknown): number | null {
  const structureArray = extractStructureArray(structureSnapshot);
  if (!structureArray || structureArray.length === 0) return null;
  const occurrences = expandStructureToStepOccurrences(structureArray);
  if (occurrences.length === 0) return null;
  return occurrences.filter((o) => o.intensityClass?.toLowerCase() === "active").length;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

// Splits ascending-sorted items into a "fast" (low value) and "slow" (high
// value) cluster at the largest proportional gap. Returns null if no gap is
// wide enough to trust as a real bimodal split (minGapRatio).
function largestGapBipartition<T>(
  items: Array<{ value: number; ref: T }>,
  minGapRatio: number
): { fast: T[]; slow: T[] } | null {
  if (items.length < 2) return null;
  const sorted = [...items].sort((a, b) => a.value - b.value);
  let bestGapIdx = -1;
  let bestGapRatio = 0;
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1]!.value;
    const cur = sorted[i]!.value;
    if (prev <= 0) continue;
    const ratio = (cur - prev) / prev;
    if (ratio > bestGapRatio) {
      bestGapRatio = ratio;
      bestGapIdx = i;
    }
  }
  if (bestGapIdx < 1 || bestGapRatio < minGapRatio) return null;
  return {
    fast: sorted.slice(0, bestGapIdx).map((e) => e.ref),
    slow: sorted.slice(bestGapIdx).map((e) => e.ref),
  };
}

function paceItemsForLaps(laps: NormalizedFitLap[]): Array<{ value: number; ref: number }> {
  return laps
    .map((lap) => ({ value: lapPaceSecPerKm(lap), ref: lap.lapIndex }))
    .filter((entry): entry is { value: number; ref: number } => entry.value !== null);
}

function tryStructureTier(
  laps: NormalizedFitLap[],
  expectedWorkStepCount: number,
  notes: string[]
): Map<number, boolean | null> | null {
  const withStepIndex = laps.filter((l) => l.wktStepIndex !== null);
  if (withStepIndex.length < 2) return null;

  const groups = new Map<number, NormalizedFitLap[]>();
  for (const lap of withStepIndex) {
    const key = lap.wktStepIndex!;
    const bucket = groups.get(key) ?? [];
    bucket.push(lap);
    groups.set(key, bucket);
  }
  if (groups.size < 2) return null;

  const groupItems = [...groups.entries()]
    .map(([stepIndex, groupLaps]) => ({
      stepIndex,
      laps: groupLaps,
      medianPace: median(groupLaps.map(lapPaceSecPerKm).filter((v): v is number => v !== null)),
    }))
    .filter((g): g is { stepIndex: number; laps: NormalizedFitLap[]; medianPace: number } => g.medianPace !== null);
  if (groupItems.length < 2) return null;

  const split = largestGapBipartition(
    groupItems.map((g) => ({ value: g.medianPace, ref: g })),
    WORK_PACE_GAP_MIN_RATIO
  );
  if (!split) return null;

  const workLapCount = split.fast.reduce((sum, g) => sum + g.laps.length, 0);
  const tolerance = Math.max(1, Math.round(expectedWorkStepCount * STRUCTURE_MATCH_TOLERANCE_RATIO));
  if (Math.abs(workLapCount - expectedWorkStepCount) > tolerance) {
    notes.push(
      `structure tier rejected: wkt_step_index fast-group lap count=${workLapCount} vs expected work steps=${expectedWorkStepCount} (tolerance=${tolerance})`
    );
    return null;
  }

  const result = new Map<number, boolean | null>();
  for (const g of split.fast) {
    for (const lap of g.laps) result.set(lap.lapIndex, true);
  }
  for (const g of split.slow) {
    for (const lap of g.laps) result.set(lap.lapIndex, false);
  }
  return result;
}

function trySplitTier(
  laps: NormalizedFitLap[],
  candidateLapIndices: Set<number> | null
): Map<number, boolean | null> | null {
  const candidateLaps = candidateLapIndices ? laps.filter((l) => candidateLapIndices.has(l.lapIndex)) : laps;
  const items = paceItemsForLaps(candidateLaps);
  const split = largestGapBipartition(items, WORK_PACE_GAP_MIN_RATIO);
  if (!split || split.fast.length < MIN_CLUSTER_SIZE || split.slow.length < MIN_CLUSTER_SIZE) {
    return null;
  }
  const result = new Map<number, boolean | null>();
  for (const lapIndex of split.fast) result.set(lapIndex, true);
  for (const lapIndex of split.slow) result.set(lapIndex, false);
  return result;
}

export function detectWorkLaps(input: {
  laps: NormalizedFitLap[];
  // source_snapshot.structure from trainingpeaks_workout_cache for this workout
  structureSnapshot: unknown;
}): WorkDetectionResult {
  const { laps } = input;
  const notes: string[] = [];
  const expectedWorkStepCount = extractExpectedWorkStepCount(input.structureSnapshot);

  // Tier 1: structure + wkt_step_index.
  if (expectedWorkStepCount !== null && expectedWorkStepCount > 0) {
    const structureResult = tryStructureTier(laps, expectedWorkStepCount, notes);
    if (structureResult) {
      return { method: "structure", isWorkByLapIndex: structureResult, expectedWorkStepCount, notes };
    }
  }

  // Tier 2: athlete-marked (manual) laps.
  const manualLapIndices = new Set(laps.filter((l) => l.lapTrigger === "manual").map((l) => l.lapIndex));
  if (manualLapIndices.size >= MIN_CLUSTER_SIZE * 2) {
    const lapTriggerResult = trySplitTier(laps, manualLapIndices);
    if (lapTriggerResult) {
      return { method: "lap_trigger", isWorkByLapIndex: lapTriggerResult, expectedWorkStepCount, notes };
    }
  }

  // Tier 3: bimodal pace clustering across all laps.
  if (paceItemsForLaps(laps).length >= MIN_LAPS_FOR_HEURISTIC) {
    const heuristicResult = trySplitTier(laps, null);
    if (heuristicResult) {
      return { method: "heuristic", isWorkByLapIndex: heuristicResult, expectedWorkStepCount, notes };
    }
  }

  notes.push("no tier produced a confident work/rest split");
  return { method: "none", isWorkByLapIndex: new Map(), expectedWorkStepCount, notes };
}
