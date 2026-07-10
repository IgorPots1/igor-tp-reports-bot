// Goal-vs-actual scalars (design doc section 2): pct_time_hr_target,
// pct_time_pace_target, target_source, time_in_zones, zone_basis.
//
// Corridor source chain (design doc, decision #1): plan-structure PRIMARY ->
// athlete_zones -> null. Athlete zones (a TP zones/profile lookup) are not
// implemented anywhere in this codebase yet — that's an explicit future
// hook, not a blocker for this stage — so in practice target_source is
// either 'plan' (when the plan gives a target we can resolve to an absolute
// corridor) or null (no plan, or the plan's targets are %-based and we have
// no threshold/zones to resolve them against).
//
// UNVERIFIED ASSUMPTION, flagged rather than hidden: every real
// plan-structure fixture seen so far (see tp-workouts-cache-scan.ts's
// buildCompactSourceSnapshot verification, and the design doc's own
// grounding) uses primaryIntensityMetric='percentOfThresholdPace' — a
// %-based metric this stage cannot resolve (no athlete threshold). The
// absolute-target code path below (primaryIntensityMetric='heartRate' or
// 'pace') is a documented best-guess at what TP would send for an
// absolute-target plan; it has not been verified against a real fixture of
// that kind. If TP's real absolute-target metric names/units differ, this
// will fall through to null (safe) rather than silently misclassify —
// resolveHrCorridorMetric/resolvePaceCorridorMetric only match exact,
// named strings, on purpose.

import { MOVING_SPEED_MIN_MPS } from "./fit-hr-cleaning-constants.ts";
import type { CleanedFitRecord, HrQuality } from "./fit-hr-cleaning.ts";
import { ZONE_MAX_HR_PCT_UPPER_BOUNDS } from "./fit-scalar-constants.ts";

export type TargetSource = "plan" | "athlete_zones" | null;
export type ZoneBasis = "threshold_hr" | "max_hr_pct" | null;

export type GoalVsActualResult = {
  pctTimeHrTarget: number | null;
  pctTimePaceTarget: number | null;
  targetSource: TargetSource;
  timeInZones: Record<string, number> | null;
  zoneBasis: ZoneBasis;
  warnings: string[];
};

type StepTargetWindow = {
  beginS: number;
  endS: number;
  minValue: number;
  maxValue: number;
  intensityClass: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toPositiveInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    return null;
  }
  return value;
}

// Mirrors the source_snapshot.structure shape documented in
// fit-lap-work-detection.ts's extractStructureArray, plus the sibling
// primaryIntensityMetric field that lives alongside the structure array in
// the same parsed object.
function extractStructureRoot(
  structureSnapshot: unknown
): { structureArray: unknown[]; primaryIntensityMetric: string | null } | null {
  if (isRecord(structureSnapshot) && Array.isArray(structureSnapshot.structure)) {
    return {
      structureArray: structureSnapshot.structure,
      primaryIntensityMetric:
        typeof structureSnapshot.primaryIntensityMetric === "string"
          ? structureSnapshot.primaryIntensityMetric
          : null,
    };
  }
  if (Array.isArray(structureSnapshot)) {
    return { structureArray: structureSnapshot, primaryIntensityMetric: null };
  }
  return null;
}

// Walks each top-level structure block's begin/end window and subdivides it
// by each inner step's own second-based duration (repeated length.value
// times for a repetition block), producing one absolute-time window per
// step occurrence that carries a target. Steps without a known
// second-based duration are skipped (not guessed) — everything after them
// in that block loses its time anchor too, so we bail out of that block
// rather than fabricate offsets.
function extractStepTargetWindows(structureArray: unknown[]): StepTargetWindow[] {
  const windows: StepTargetWindow[] = [];
  for (const node of structureArray) {
    if (!isRecord(node)) continue;
    const blockBegin = toFiniteNumber(node.begin);
    if (blockBegin === null) continue;
    const repeatCount = toPositiveInt(isRecord(node.length) ? node.length.value : null) ?? 1;
    const innerSteps = Array.isArray(node.steps) ? node.steps : [];

    let cursor = blockBegin;
    for (let cycle = 0; cycle < repeatCount; cycle += 1) {
      for (const inner of innerSteps) {
        if (!isRecord(inner)) break;
        const innerLength = isRecord(inner.length) ? inner.length : null;
        const unit = innerLength && typeof innerLength.unit === "string" ? innerLength.unit : null;
        const durationS = unit === "second" ? toFiniteNumber(innerLength?.value) : null;
        if (durationS === null || durationS <= 0) break;

        const targets = Array.isArray(inner.targets) ? inner.targets : [];
        const firstTarget = targets.find(isRecord);
        const minValue = firstTarget ? toFiniteNumber(firstTarget.minValue) : null;
        const maxValue = firstTarget ? toFiniteNumber(firstTarget.maxValue) : null;
        if (minValue !== null && maxValue !== null) {
          windows.push({
            beginS: cursor,
            endS: cursor + durationS,
            minValue,
            maxValue,
            intensityClass: typeof inner.intensityClass === "string" ? inner.intensityClass : null,
          });
        }
        cursor += durationS;
      }
    }
  }
  return windows;
}

function resolveHrCorridorMetric(primaryIntensityMetric: string | null): boolean {
  return primaryIntensityMetric === "heartRate";
}

function resolvePaceCorridorMetric(primaryIntensityMetric: string | null): boolean {
  return primaryIntensityMetric === "pace";
}

// Moving-only, matching the moving-sample convention already used for
// avg_hr (fit-hr-cleaning.ts's computeCleanedMovingAverageHr). Counts
// samples rather than time-weighting by delta — records run near 1Hz
// (parser config: elapsedRecordField:true), the same approximation already
// used throughout this pipeline for "seconds" via sample count.
function computePctTimeInCorridor(
  windows: StepTargetWindow[],
  records: CleanedFitRecord[],
  metric: "hr" | "pace"
): number | null {
  let inCorridor = 0;
  let totalWithTarget = 0;
  for (const r of records) {
    if (r.speedMps === null || r.speedMps <= MOVING_SPEED_MIN_MPS) continue;
    const window = windows.find((w) => r.timeS >= w.beginS && r.timeS < w.endS);
    if (!window) continue;
    const value = metric === "hr" ? r.heartRateCleaned : r.speedMps > 0 ? 1000 / r.speedMps : null;
    if (value === null) continue;
    totalWithTarget += 1;
    if (value >= window.minValue && value <= window.maxValue) inCorridor += 1;
  }
  return totalWithTarget > 0 ? (inCorridor / totalWithTarget) * 100 : null;
}

// %max-HR fallback zone bucketing (no threshold-HR profile exists in this
// codebase yet — zone_basis is always 'max_hr_pct', never 'threshold_hr',
// until that profile exists).
function computeTimeInZonesByMaxHrPct(records: CleanedFitRecord[], observedMaxHr: number): Record<string, number> {
  const zones: Record<string, number> = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 };
  for (const r of records) {
    if (r.speedMps === null || r.speedMps <= MOVING_SPEED_MIN_MPS) continue;
    if (r.heartRateCleaned === null) continue;
    const pct = (r.heartRateCleaned / observedMaxHr) * 100;
    let zoneIdx = ZONE_MAX_HR_PCT_UPPER_BOUNDS.findIndex((bound) => pct < bound);
    if (zoneIdx === -1) zoneIdx = ZONE_MAX_HR_PCT_UPPER_BOUNDS.length;
    zones[`z${zoneIdx + 1}`] = (zones[`z${zoneIdx + 1}`] ?? 0) + 1;
  }
  return zones;
}

export function computeGoalVsActual(input: {
  structureSnapshot: unknown;
  cleanedRecords: CleanedFitRecord[];
  hrQuality: HrQuality | null;
  observedMaxHr: number | null;
}): GoalVsActualResult {
  const warnings: string[] = [];
  const root = extractStructureRoot(input.structureSnapshot);

  let pctTimeHrTarget: number | null = null;
  let pctTimePaceTarget: number | null = null;
  let targetSource: TargetSource = null;

  if (root) {
    const windows = extractStepTargetWindows(root.structureArray);
    if (windows.length > 0) {
      const hrAbsolute = resolveHrCorridorMetric(root.primaryIntensityMetric);
      const paceAbsolute = resolvePaceCorridorMetric(root.primaryIntensityMetric);

      if (hrAbsolute) {
        if (input.hrQuality === "unreliable") {
          warnings.push("pct_time_hr_target null: hr_quality=unreliable");
        } else {
          pctTimeHrTarget = computePctTimeInCorridor(windows, input.cleanedRecords, "hr");
        }
      }
      if (paceAbsolute) {
        pctTimePaceTarget = computePctTimeInCorridor(windows, input.cleanedRecords, "pace");
      }

      if (hrAbsolute || paceAbsolute) {
        targetSource = "plan";
      } else {
        warnings.push(
          `pct_time_*_target null: plan targets are not absolute (primaryIntensityMetric=${root.primaryIntensityMetric ?? "unknown"}), athlete zones not available`
        );
      }
    } else {
      warnings.push("pct_time_*_target null: plan structure present but no per-step targets with known second-based durations");
    }
  } else {
    warnings.push("pct_time_*_target null: no usable plan structure and athlete zones not available");
  }

  let timeInZones: Record<string, number> | null = null;
  let zoneBasis: ZoneBasis = null;
  if (input.observedMaxHr !== null && input.observedMaxHr > 0 && input.hrQuality !== null && input.hrQuality !== "unreliable") {
    timeInZones = computeTimeInZonesByMaxHrPct(input.cleanedRecords, input.observedMaxHr);
    zoneBasis = "max_hr_pct";
  } else {
    warnings.push("time_in_zones null: no observed max HR history yet, or hr_quality unreliable/absent");
  }

  return { pctTimeHrTarget, pctTimePaceTarget, targetSource, timeInZones, zoneBasis, warnings };
}
