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
  /**
   * Work laps merged into contiguous BLOCKS -- one block = one rep. Each entry
   * is that rep's lap indices, in order.
   *
   * A rep is not a lap. Watches auto-lap every kilometre, so a single 24-minute
   * effort arrives as ~5 consecutive work laps; counting laps reported "2 x 24
   * мин" as 10 reps. Counting BLOCKS reports 2. Everything rep-shaped
   * (reps_detected_count, rep_paces, rep_recovery_drops) must be derived from
   * this, never from the raw work-lap count.
   */
  workBlocks: number[][];
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
// k-medians converges in a handful of passes on data this small; the cap is a
// safety net, not a tuning knob.
const K_MEDIANS_MAX_ITERATIONS = 20;
// A rep lasts a while. Anything shorter is a watch lapping mid-stride or a GPS
// hiccup, not an effort -- dropped rather than allowed to inflate the rep count.
const MIN_REP_BLOCK_DURATION_S = 45;
// Faster than the men's 1500m world-record pace -- a GPS glitch, not a runner.
// Such a lap's pace would otherwise anchor the "fast" cluster and wreck the split.
const MIN_PLAUSIBLE_RUN_PACE_SEC_PER_KM = 150;
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

/**
 * Counts the `active` steps that are REPS -- i.e. those inside a block that
 * actually repeats (repetition count >= 2), recursing into nested repetition
 * blocks.
 *
 * Why not simply "every step with intensityClass=active": TrainingPeaks tags
 * the WARM-UP step `active` too (observed: the "15 х 1,5 мин" plan opens with
 * {name:"Active", intensityClass:"active", 600s} as a standalone step, while
 * the cool-down is correctly tagged `coolDown`). Counting every `active` step
 * therefore returned N+1 on almost every interval plan ("15x1,5"->16,
 * "8x4"->9), so the plan cross-check fired MISMATCH on nearly every workout --
 * and a warning that cries wolf is a warning nobody reads.
 *
 * Reps are, by definition, the thing that REPEATS. Warm-up / cool-down /
 * standalone steps carry a repetition count of 1 and are excluded on that basis
 * alone -- no name matching, no intensityClass guessing.
 *
 * Validated against every "N x ..." titled workout in 2026-06-22..07-13: the old
 * rule agreed with the title on 81/128 (63%), this one on 118/128 (92%). Of the
 * 10 remaining, 8 have no plan structure at all (-> null, cross-check stays
 * silent) and 2 are genuine coach typos where the title says 6 reps but the plan
 * really contains 5 -- there the structure is right and the title is wrong.
 */
function countRepeatedActiveSteps(nodes: unknown[]): number {
  let total = 0;
  for (const node of nodes) {
    if (!isRecord(node)) continue;
    const repeatCount = toPositiveInt(isRecord(node.length) ? node.length.value : null) ?? 1;
    if (repeatCount < 2) continue; // warm-up / cool-down / standalone -- never a rep

    const innerSteps = Array.isArray(node.steps) ? node.steps : [];
    let activePerCycle = 0;
    for (const inner of innerSteps) {
      if (!isRecord(inner)) continue;
      if (Array.isArray(inner.steps)) {
        activePerCycle += countRepeatedActiveSteps([inner]);
        continue;
      }
      const intensityClass = typeof inner.intensityClass === "string" ? inner.intensityClass.toLowerCase() : null;
      if (intensityClass === "active") activePerCycle += 1;
    }
    total += activePerCycle * repeatCount;
  }
  return total;
}

export function extractExpectedWorkStepCount(structureSnapshot: unknown): number | null {
  const structureArray = extractStructureArray(structureSnapshot);
  if (!structureArray || structureArray.length === 0) return null;
  const reps = countRepeatedActiveSteps(structureArray);
  // No repeating block => this plan has no reps to expect. Return null (not 0)
  // so the cross-check stays SILENT rather than asserting "expected 0 reps".
  return reps > 0 ? reps : null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/**
 * Splits laps into a "fast" (work) and "slow" (recovery) cluster by 1-D
 * k-medians on pace, then only trusts the split if the two clusters are
 * genuinely separated.
 *
 * REPLACES a "cut at the single widest proportional gap" bipartition, which was
 * structurally wrong: it assumes EXACTLY two clusters. Real interval sessions
 * have at least three (work / recovery jog / the odd near-stop), and one outlier
 * on either end hijacks the cut. Both failure directions were seen live:
 *
 *   - a junk 8.2m lap clocked at 225.7 s/km (faster than every real rep) broke
 *     off alone as the "fast" cluster -> tier bailed, is_work=null on all 19 laps;
 *   - two crawling recoveries at 639/655 s/km opened a +29.9% gap, WIDER than the
 *     true work/recovery boundary at +15.8% -> work AND recovery both landed in
 *     the "fast" cluster, so a 15x1,5 session reported 30 reps.
 *
 * Medians (not means) as centroids make the outliers inert: they simply sit in
 * the slow cluster without dragging the boundary. Separation is then judged
 * between the two cluster MEDIANS, not across a single adjacent pair, so no lone
 * lap can manufacture or destroy a split.
 */
function kMediansBipartition<T>(
  items: Array<{ value: number; ref: T }>,
  minSeparationRatio: number,
  // Laps need >=2 per side before a split means anything. The structure tier
  // clusters wkt_step_index GROUPS instead (a session has only a handful:
  // warm-up / hard / easy), so it passes 1.
  minClusterSize: number
): { fast: T[]; slow: T[] } | null {
  if (items.length < minClusterSize * 2) return null;

  const values = items.map((i) => i.value);
  const sorted = [...values].sort((a, b) => a - b);
  const half = Math.floor(sorted.length / 2);
  let fastCentroid = median(sorted.slice(0, half));
  let slowCentroid = median(sorted.slice(half));
  if (fastCentroid === null || slowCentroid === null) return null;

  const assign = (): { fast: typeof items; slow: typeof items } => {
    const fast: typeof items = [];
    const slow: typeof items = [];
    for (const item of items) {
      const toFast = Math.abs(item.value - fastCentroid!);
      const toSlow = Math.abs(item.value - slowCentroid!);
      (toFast <= toSlow ? fast : slow).push(item);
    }
    return { fast, slow };
  };

  for (let iter = 0; iter < K_MEDIANS_MAX_ITERATIONS; iter += 1) {
    const { fast, slow } = assign();
    if (fast.length === 0 || slow.length === 0) return null;
    const nextFast = median(fast.map((i) => i.value));
    const nextSlow = median(slow.map((i) => i.value));
    if (nextFast === null || nextSlow === null) return null;
    if (nextFast === fastCentroid && nextSlow === slowCentroid) break;
    fastCentroid = nextFast;
    slowCentroid = nextSlow;
  }

  const { fast, slow } = assign();
  if (fast.length < minClusterSize || slow.length < minClusterSize) return null;

  // Gate: is this actually an interval session, or one continuous effort that
  // k-medians has arbitrarily halved? A steady run separates by ~3%; real
  // work/recovery by 15-30%.
  if (fastCentroid <= 0) return null;
  const separation = (slowCentroid - fastCentroid) / fastCentroid;
  if (separation < minSeparationRatio) return null;

  return { fast: fast.map((i) => i.ref), slow: slow.map((i) => i.ref) };
}

/**
 * True for laps whose pace cannot be trusted: watch-emitted fragments too small
 * to mean anything, and laps clocked faster than any human runs. Both are
 * excluded from clustering and left undetermined (is_work=null) -- never forced
 * into work or rest.
 */
function isMeaninglessFragmentLap(lap: NormalizedFitLap): boolean {
  const distanceM = lap.distanceM;
  const durationS = lapDurationSeconds(lap);
  if (distanceM !== null && distanceM < MIN_MEANINGFUL_LAP_DISTANCE_M) return true;
  if (durationS !== null && durationS < MIN_MEANINGFUL_LAP_DURATION_S) return true;
  const pace = lapPaceSecPerKm(lap);
  if (pace !== null && pace < MIN_PLAUSIBLE_RUN_PACE_SEC_PER_KM) return true;
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

  const split = kMediansBipartition(
    groupItems.map((g) => ({ value: g.medianPace, ref: g })),
    WORK_PACE_GAP_MIN_RATIO,
    1 // clustering step-index groups, not laps -- a session has only a few
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
  const split = kMediansBipartition(items, WORK_PACE_GAP_MIN_RATIO, MIN_CLUSTER_SIZE);
  if (!split) {
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

/**
 * Merge consecutive work laps into rep BLOCKS. One block = one rep.
 *
 * Laps that are undetermined (fragments, warm-up/cool-down) do NOT break a
 * block -- a junk 8m lap recorded mid-rep must not split that rep in two. Only
 * a genuine rest lap (is_work === false) ends a block.
 */
function buildWorkBlocks(laps: NormalizedFitLap[], isWorkByLapIndex: Map<number, boolean | null>): number[][] {
  const blocks: number[][] = [];
  let current: number[] = [];

  for (const lap of laps) {
    const verdict = isWorkByLapIndex.get(lap.lapIndex);
    if (verdict === true) {
      current.push(lap.lapIndex);
      continue;
    }
    if (verdict === false && current.length > 0) {
      blocks.push(current);
      current = [];
    }
    // undetermined (null/missing): neither extends nor breaks the block
  }
  if (current.length > 0) blocks.push(current);

  const durationOf = (block: number[]): number =>
    block.reduce((sum, lapIndex) => {
      const lap = laps.find((l) => l.lapIndex === lapIndex);
      return sum + (lap ? (lapDurationSeconds(lap) ?? 0) : 0);
    }, 0);

  return blocks.filter((block) => durationOf(block) >= MIN_REP_BLOCK_DURATION_S);
}

export function detectWorkLaps(input: {
  laps: NormalizedFitLap[];
  // source_snapshot.structure from trainingpeaks_workout_cache for this workout
  structureSnapshot: unknown;
}): WorkDetectionResult {
  const { laps } = input;
  const notes: string[] = [];
  const expectedWorkStepCount = extractExpectedWorkStepCount(input.structureSnapshot);

  const finish = (method: WorkDetectionMethod, isWorkByLapIndex: Map<number, boolean | null>): WorkDetectionResult => {
    const workBlocks = buildWorkBlocks(laps, isWorkByLapIndex);
    const workLapCount = [...isWorkByLapIndex.values()].filter((v) => v === true).length;
    if (workBlocks.length > 0 && workLapCount > workBlocks.length) {
      notes.push(
        `${workLapCount} work lap(s) merged into ${workBlocks.length} rep block(s) — the watch auto-lapped inside reps`
      );
    }
    // Cross-check the plan against REPS (blocks), not laps.
    notePlanCrossCheck(workBlocks.length, expectedWorkStepCount, notes);
    return { method, isWorkByLapIndex, workBlocks, expectedWorkStepCount, notes };
  };

  // Tier 1: structure + wkt_step_index.
  if (expectedWorkStepCount !== null && expectedWorkStepCount > 0) {
    const structureResult = tryStructureTier(laps, expectedWorkStepCount, notes);
    if (structureResult) return finish("structure", structureResult);
  }

  // Tier 2: athlete-marked (manual) laps.
  const manualLapIndices = new Set(laps.filter((l) => l.lapTrigger === "manual").map((l) => l.lapIndex));
  if (manualLapIndices.size >= MIN_CLUSTER_SIZE * 2) {
    const lapTriggerResult = trySplitTier(laps, manualLapIndices, notes);
    if (lapTriggerResult) return finish("lap_trigger", lapTriggerResult);
  }

  // Tier 3: pace clustering across all laps.
  if (paceItemsForLaps(laps).length >= MIN_LAPS_FOR_HEURISTIC) {
    const heuristicResult = trySplitTier(laps, null, notes);
    if (heuristicResult) return finish("heuristic", heuristicResult);
  }

  notes.push("no tier produced a confident work/rest split");
  return { method: "none", isWorkByLapIndex: new Map(), workBlocks: [], expectedWorkStepCount, notes };
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
  detected: number,
  expectedWorkStepCount: number | null,
  notes: string[]
): void {
  if (expectedWorkStepCount === null || expectedWorkStepCount <= 0) return;
  if (detected === expectedWorkStepCount) {
    notes.push(`plan cross-check ok: detected ${detected} work lap(s), plan expected ${expectedWorkStepCount}`);
    return;
  }
  notes.push(
    `plan cross-check MISMATCH: detected ${detected} work lap(s) but the plan expected ${expectedWorkStepCount} — split kept (diagnostic only, not a gate)`
  );
}
