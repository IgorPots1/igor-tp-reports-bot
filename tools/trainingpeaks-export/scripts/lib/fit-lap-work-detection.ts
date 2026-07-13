// Classifies FIT laps as work (interval effort) vs jog/rest, per design doc
// section 5a: plan-structure is primary, wkt_step_index/lap_trigger confirm
// it, a pace-clustering heuristic is the last-resort fallback.
//
// The discriminating signal is PACE, not duration: work reps can be either
// shorter (sprint intervals: short hard / long recovery) or longer (tempo
// intervals: long hard / short recovery) than their recovery laps, but the
// work laps are reliably FASTER regardless of interval style.

import { lapDurationSeconds, lapPaceSecPerKm, type NormalizedFitLap } from "./fit-workout-normalization.ts";

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
// Watches emit tiny junk laps at stops/segment boundaries (live example: an
// 8.2m lap and a 12.2m lap inside a clean 7x5min interval session). Their pace
// is numerically meaningless -- the 8.2m lap reported 225.7 s/km, FASTER than
// every real work rep -- and because largestGapBipartition splits at the single
// widest proportional gap, ONE such outlier hijacks the split: it broke off
// alone as the "fast" cluster (gap 225.7->295.6 = +31%, wider than the true
// work/recovery boundary 310.4->382.8 = +23%), the fast cluster then failed
// MIN_CLUSTER_SIZE, and the whole tier returned "none" on perfectly bimodal
// data. So: drop laps below these floors BEFORE clustering and leave them
// is_work=null (undetermined), never forcing them into work or rest.
//
// Floors are deliberately tiny -- only true fragments are excluded. A short
// stride (~100m / ~20s) still survives and gets classified.
const MIN_MEANINGFUL_LAP_DISTANCE_M = 50;
const MIN_MEANINGFUL_LAP_DURATION_S = 10;
// How much larger than the median inter-rep recovery an edge lap may be while
// still counting as a recovery rather than a warm-up/cool-down. 2x is generous
// enough for a slightly long final jog but nowhere near a real cool-down (live
// example: recoveries ~194m median, cool-down 758m = 3.9x).
const EDGE_RECOVERY_SCALE_MAX_RATIO = 2;
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

/**
 * True for watch-emitted fragments too small for their pace to mean anything.
 * These are excluded from clustering and left undetermined (is_work=null).
 */
function isMeaninglessFragmentLap(lap: NormalizedFitLap): boolean {
  const distanceM = lap.distanceM;
  const durationS = lapDurationSeconds(lap);
  if (distanceM !== null && distanceM < MIN_MEANINGFUL_LAP_DISTANCE_M) return true;
  if (durationS !== null && durationS < MIN_MEANINGFUL_LAP_DURATION_S) return true;
  return false;
}

function paceItemsForLaps(laps: NormalizedFitLap[]): Array<{ value: number; ref: number }> {
  return laps
    .filter((lap) => !isMeaninglessFragmentLap(lap))
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
  candidateLapIndices: Set<number> | null,
  notes: string[]
): Map<number, boolean | null> | null {
  const candidateLaps = candidateLapIndices ? laps.filter((l) => candidateLapIndices.has(l.lapIndex)) : laps;
  const items = paceItemsForLaps(candidateLaps);
  const split = largestGapBipartition(items, WORK_PACE_GAP_MIN_RATIO);
  if (!split || split.fast.length < MIN_CLUSTER_SIZE || split.slow.length < MIN_CLUSTER_SIZE) {
    return null;
  }

  const result = new Map<number, boolean | null>();
  for (const lapIndex of split.fast) result.set(lapIndex, true);

  // A slow lap BETWEEN two work reps is definitionally an inter-rep recovery
  // (is_work=false). Slow laps OUTSIDE the work block are ambiguous: they are
  // either a warm-up / cool-down, or the recovery that closes the final rep.
  // Distance tells them apart -- a cool-down is on a completely different scale
  // from a recovery jog (live example: recoveries ~140-210m, cool-down 758m,
  // warm-up 1000m). So we compare each edge lap to the median inner recovery
  // and only call it a recovery when it is the same order of size. Anything
  // bigger stays is_work=null with a note: we do not guess a verdict we cannot
  // justify.
  const workIndices = [...split.fast].sort((a, b) => a - b);
  const firstWork = workIndices[0]!;
  const lastWork = workIndices[workIndices.length - 1]!;
  const lapByIndex = new Map(candidateLaps.map((l) => [l.lapIndex, l]));
  const lapScale = (lapIndex: number): number | null => {
    const lap = lapByIndex.get(lapIndex);
    if (!lap) return null;
    return lap.distanceM ?? lapDurationSeconds(lap);
  };

  const innerSlow = [...split.slow].filter((i) => i > firstWork && i < lastWork);
  const outerSlow = [...split.slow].filter((i) => i < firstWork || i > lastWork);
  for (const lapIndex of innerSlow) result.set(lapIndex, false);

  const innerRecoveryScale = median(innerSlow.map(lapScale).filter((v): v is number => v !== null));

  const undeterminedEdges: number[] = [];
  for (const lapIndex of outerSlow) {
    const scale = lapScale(lapIndex);
    const looksLikeRecovery =
      innerRecoveryScale !== null &&
      innerRecoveryScale > 0 &&
      scale !== null &&
      scale <= innerRecoveryScale * EDGE_RECOVERY_SCALE_MAX_RATIO;
    if (looksLikeRecovery) {
      result.set(lapIndex, false); // recovery adjacent to the work block
    } else {
      result.set(lapIndex, null); // warm-up / cool-down -- undetermined
      undeterminedEdges.push(lapIndex);
    }
  }
  if (undeterminedEdges.length > 0) {
    notes.push(
      `is_work=null on ${undeterminedEdges.length} edge lap(s) outside the work block and too large to be a recovery (warm-up/cool-down, not classified): [${undeterminedEdges
        .sort((a, b) => a - b)
        .join(",")}]`
    );
  }

  // Fragments were excluded from clustering entirely, so they are absent from
  // the split. Record them EXPLICITLY as null rather than leaving them missing:
  // "undetermined" should be a stated verdict, not an accident of omission.
  const fragmentLapIndices = candidateLaps.filter(isMeaninglessFragmentLap).map((l) => l.lapIndex);
  for (const lapIndex of fragmentLapIndices) {
    result.set(lapIndex, null);
  }
  if (fragmentLapIndices.length > 0) {
    notes.push(
      `is_work=null on ${fragmentLapIndices.length} fragment lap(s) below ${MIN_MEANINGFUL_LAP_DISTANCE_M}m/${MIN_MEANINGFUL_LAP_DURATION_S}s (excluded from clustering): [${fragmentLapIndices.join(",")}]`
    );
  }

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
    const lapTriggerResult = trySplitTier(laps, manualLapIndices, notes);
    if (lapTriggerResult) {
      notePlanCrossCheck(lapTriggerResult, expectedWorkStepCount, notes);
      return { method: "lap_trigger", isWorkByLapIndex: lapTriggerResult, expectedWorkStepCount, notes };
    }
  }

  // Tier 3: bimodal pace clustering across all laps.
  if (paceItemsForLaps(laps).length >= MIN_LAPS_FOR_HEURISTIC) {
    const heuristicResult = trySplitTier(laps, null, notes);
    if (heuristicResult) {
      notePlanCrossCheck(heuristicResult, expectedWorkStepCount, notes);
      return { method: "heuristic", isWorkByLapIndex: heuristicResult, expectedWorkStepCount, notes };
    }
  }

  notes.push("no tier produced a confident work/rest split");
  return { method: "none", isWorkByLapIndex: new Map(), expectedWorkStepCount, notes };
}

/**
 * Compare a confident split against what the PLAN said to expect (e.g. "7x5min"
 * -> 7 work steps). DIAGNOSTIC ONLY -- deliberately not a gate: a trustworthy
 * pace split that finds 6 or 8 reps against a plan of 7 is still the best
 * evidence we have (the athlete may have cut a rep short, or the watch merged
 * two). We surface the discrepancy for the coach instead of throwing the split
 * away and falling back to "no detection at all", which is strictly worse.
 */
function notePlanCrossCheck(
  isWorkByLapIndex: Map<number, boolean | null>,
  expectedWorkStepCount: number | null,
  notes: string[]
): void {
  if (expectedWorkStepCount === null || expectedWorkStepCount <= 0) return;
  const detected = [...isWorkByLapIndex.values()].filter((v) => v === true).length;
  if (detected === expectedWorkStepCount) {
    notes.push(`plan cross-check ok: detected ${detected} work lap(s), plan expected ${expectedWorkStepCount}`);
    return;
  }
  notes.push(
    `plan cross-check MISMATCH: detected ${detected} work lap(s) but the plan expected ${expectedWorkStepCount} — split kept (diagnostic only, not a gate)`
  );
}
