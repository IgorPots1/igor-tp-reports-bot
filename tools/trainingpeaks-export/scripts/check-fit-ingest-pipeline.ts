// Hermetic checks for the FIT-ingest pipeline's pure building blocks
// (fit-hr-cleaning.ts, fit-lap-work-detection.ts, fit-ingest-outcome.ts). No
// network/browser/DB access — fixtures only, mirroring the repo's existing
// check-*.ts convention (e.g. check-trainingpeaks-recovery-summary.ts).

import process from "node:process";

import { cleanHeartRateSeries, computeCleanedMovingAverageHr } from "./lib/fit-hr-cleaning.ts";
import { detectWorkLaps, extractExpectedWorkStepCount } from "./lib/fit-lap-work-detection.ts";
import { buildDerivedMetricsFitFields } from "./lib/fit-ingest-outcome.ts";
import type { NormalizedFitLap, NormalizedFitRecord } from "./lib/fit-workout-normalization.ts";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

// ---------------------------------------------------------------------------
// Fixture 1: a "dirty" 7-minute HR stream exercising every cleaning step —
// a physiologically-impossible bounds spike, a slew spike that reverts, a
// gradual multi-sample bump for the Hampel filter, a sustained cadence-lock
// segment (HR pinned to cadence*2 well away from the true trend), and a
// stopped period that must be excluded from the moving average.
// ---------------------------------------------------------------------------
function buildDirtyHrFixture(): NormalizedFitRecord[] {
  const records: NormalizedFitRecord[] = [];
  const totalSeconds = 420;

  for (let t = 0; t < totalSeconds; t += 1) {
    let hr = 130 + Math.min(20, t / 10); // gradual real ramp, ~130 -> ~150
    let cadence = 82; // rpm -> spm 164, unrelated to HR under normal conditions
    let speed = 3.0; // m/s, moving

    if (t === 60) hr = 240; // bounds: above any plausible ceiling
    if (t === 120) hr = 178; // slew: single-sample spike that reverts next second

    // Small multi-sample bump, each step under the slew threshold (6 bpm/s)
    // but the peak deviates from the local median enough for Hampel to catch.
    if (t === 178) hr = 148 + 6;
    if (t === 179) hr = 148 + 12;
    if (t === 180) hr = 148 + 18;
    if (t === 181) hr = 148 + 12;
    if (t === 182) hr = 148 + 6;

    // Cadence-lock: sensor reads cadence*2 for 70s, clearly below the true
    // trend (~150) — the failure mode this step exists to catch.
    if (t >= 220 && t < 290) {
      cadence = 55; // rpm -> spm 110
      hr = 110;
    }

    // Stopped period (aid station) — must be excluded from the moving average.
    if (t >= 340 && t < 355) {
      speed = 0.2;
    }

    records.push({
      timeS: t,
      heartRate: Math.round(hr),
      cadenceRpm: cadence,
      speedMps: speed,
      distanceM: t * 3,
      altitudeM: 100,
      power: null,
    });
  }
  return records;
}

function checkHrCleaning(): void {
  const records = buildDirtyHrFixture();
  const observedMaxHr = 182; // -> ceiling = min(182+8, 220) = 190
  const result = cleanHeartRateSeries({ records, observedMaxHr });

  assert(result.pctHrCleaned !== null && result.pctHrCleaned > 0, "Expected some HR samples to be cleaned.");
  assert(
    result.cadenceLockCoveragePct !== null && result.cadenceLockCoveragePct > 15,
    `Expected cadence-lock coverage > 15%, got ${result.cadenceLockCoveragePct}.`
  );
  assert(result.hrQuality === "unreliable", `Expected hr_quality=unreliable, got ${result.hrQuality}.`);

  const boundsSample = result.records.find((r) => r.timeS === 60)!;
  assert(boundsSample.hrDropped, "Expected the t=60 bounds-violating spike (240bpm) to be dropped.");

  const slewSample = result.records.find((r) => r.timeS === 120)!;
  assert(slewSample.hrDropped, "Expected the t=120 slew spike (178bpm, reverts next sample) to be dropped.");

  const lockSample = result.records.find((r) => r.timeS === 250)!;
  assert(lockSample.hrCadenceLocked, "Expected t=250 (inside the 220-290s lock window) to be cadence-locked.");
  assert(lockSample.hrDropped, "Expected a cadence-locked sample's HR to be dropped from all HR scalars.");

  const rawAvg =
    records.reduce((sum, r) => sum + (r.heartRate ?? 0), 0) / records.filter((r) => r.heartRate !== null).length;
  const cleanedAvg = computeCleanedMovingAverageHr(result.records);
  assert(cleanedAvg !== null, "Expected a cleaned moving average to be computable.");
  assert(
    Math.abs(cleanedAvg! - rawAvg) > 3,
    `Expected cleaned avg_hr to differ meaningfully from raw device avg_hr (raw=${rawAvg.toFixed(1)}, cleaned=${cleanedAvg!.toFixed(1)}).`
  );
  assert(cleanedAvg! > rawAvg, "Expected the cleaned average to be HIGHER than the raw average (lock pulled raw down).");

  console.log(
    `  hr-cleaning: pct_hr_cleaned=${result.pctHrCleaned!.toFixed(1)}%, hr_quality=${result.hrQuality}, ` +
      `cadence_lock_coverage=${result.cadenceLockCoveragePct!.toFixed(1)}%, raw_avg=${rawAvg.toFixed(1)}, cleaned_avg=${cleanedAvg!.toFixed(1)}`
  );
}

// A clean stream (no artifacts at all) must come back hr_quality='good' with
// ~0% cleaned — cleaning must not manufacture problems on healthy data.
function checkHrCleaningOnCleanStream(): void {
  const records: NormalizedFitRecord[] = [];
  for (let t = 0; t < 300; t += 1) {
    records.push({
      timeS: t,
      heartRate: 140 + Math.round(Math.sin(t / 40) * 3), // smooth, slow drift
      cadenceRpm: 82,
      speedMps: 3.0,
      distanceM: t * 3,
      altitudeM: 100,
      power: null,
    });
  }
  const result = cleanHeartRateSeries({ records, observedMaxHr: 182 });
  assert(result.hrQuality === "good", `Expected hr_quality=good on a clean stream, got ${result.hrQuality}.`);
  assert(
    result.pctHrCleaned !== null && result.pctHrCleaned <= 5,
    `Expected pct_hr_cleaned<=5% on a clean stream, got ${result.pctHrCleaned}.`
  );
  console.log(`  hr-cleaning (clean stream): pct_hr_cleaned=${result.pctHrCleaned!.toFixed(1)}%, hr_quality=${result.hrQuality}`);
}

// No HR data at all (e.g. no chest strap) -> null, not 0/false/'unreliable'.
// "No data" and "bad data" must stay distinguishable.
function checkHrCleaningNoData(): void {
  const records: NormalizedFitRecord[] = Array.from({ length: 50 }, (_, t) => ({
    timeS: t,
    heartRate: null,
    cadenceRpm: 82,
    speedMps: 3.0,
    distanceM: t * 3,
    altitudeM: 100,
    power: null,
  }));
  const result = cleanHeartRateSeries({ records, observedMaxHr: null });
  assert(result.hrQuality === null, `Expected hr_quality=null with no HR data at all, got ${result.hrQuality}.`);
  assert(result.pctHrCleaned === null, `Expected pct_hr_cleaned=null with no HR data at all, got ${result.pctHrCleaned}.`);
  assert(computeCleanedMovingAverageHr(result.records) === null, "Expected a null average with no HR data.");
  console.log("  hr-cleaning (no HR data): hr_quality=null, pct_hr_cleaned=null (not 0/unreliable) — OK");
}

// ---------------------------------------------------------------------------
// Fixture 2: an interval plan-structure (warmup + 4x hard/easy + cooldown)
// paired with FIT laps carrying wkt_step_index, to exercise the 'structure'
// detection tier end to end.
// ---------------------------------------------------------------------------
const INTERVAL_STRUCTURE_SNAPSHOT = {
  structure: [
    { type: "step", length: { value: 1, unit: "repetition" }, steps: [{ intensityClass: "warmUp" }] },
    {
      type: "repetition",
      length: { value: 4, unit: "repetition" },
      steps: [{ intensityClass: "active" }, { intensityClass: "rest" }],
    },
    { type: "step", length: { value: 1, unit: "repetition" }, steps: [{ intensityClass: "coolDown" }] },
  ],
};

function makeLap(input: Partial<NormalizedFitLap> & { lapIndex: number }): NormalizedFitLap {
  return {
    lapIndex: input.lapIndex,
    startOffsetS: input.startOffsetS ?? null,
    timerTimeS: input.timerTimeS ?? null,
    elapsedTimeS: input.elapsedTimeS ?? null,
    distanceM: input.distanceM ?? null,
    avgSpeedMps: input.avgSpeedMps ?? null,
    maxSpeedMps: input.maxSpeedMps ?? null,
    avgHr: input.avgHr ?? null,
    maxHr: input.maxHr ?? null,
    minHr: input.minHr ?? null,
    avgCadenceRpm: input.avgCadenceRpm ?? null,
    maxCadenceRpm: input.maxCadenceRpm ?? null,
    avgPower: input.avgPower ?? null,
    totalAscentM: input.totalAscentM ?? null,
    totalDescentM: input.totalDescentM ?? null,
    lapTrigger: input.lapTrigger ?? null,
    intensity: input.intensity ?? null,
    wktStepIndex: input.wktStepIndex ?? null,
  };
}

// duration 300s + distance implies pace_sec_per_km = 300/(distanceKm)
function lapWithPace(lapIndex: number, paceSecPerKm: number, extra: Partial<NormalizedFitLap> = {}): NormalizedFitLap {
  const durationS = 300;
  const distanceM = (durationS / paceSecPerKm) * 1000;
  return makeLap({ lapIndex, timerTimeS: durationS, distanceM, ...extra });
}

function checkStructureTier(): void {
  const expected = extractExpectedWorkStepCount(INTERVAL_STRUCTURE_SNAPSHOT);
  assert(expected === 4, `Expected 4 active steps from the interval structure, got ${expected}.`);

  const laps: NormalizedFitLap[] = [
    lapWithPace(0, 340, { wktStepIndex: 0 }), // warmup
    lapWithPace(1, 240, { wktStepIndex: 1, lapTrigger: "manual" }), // hard 1
    lapWithPace(2, 360, { wktStepIndex: 2, lapTrigger: "manual" }), // easy 1
    lapWithPace(3, 240, { wktStepIndex: 1, lapTrigger: "manual" }), // hard 2
    lapWithPace(4, 360, { wktStepIndex: 2, lapTrigger: "manual" }), // easy 2
    lapWithPace(5, 240, { wktStepIndex: 1, lapTrigger: "manual" }), // hard 3
    lapWithPace(6, 360, { wktStepIndex: 2, lapTrigger: "manual" }), // easy 3
    lapWithPace(7, 240, { wktStepIndex: 1, lapTrigger: "manual" }), // hard 4
    lapWithPace(8, 360, { wktStepIndex: 2, lapTrigger: "manual" }), // easy 4
    lapWithPace(9, 340, { wktStepIndex: 3 }), // cooldown
  ];

  const result = detectWorkLaps({ laps, structureSnapshot: INTERVAL_STRUCTURE_SNAPSHOT });
  assert(result.method === "structure", `Expected method=structure, got ${result.method}.`);

  const workLapIndices = [1, 3, 5, 7];
  const restLapIndices = [0, 2, 4, 6, 8, 9];
  for (const idx of workLapIndices) {
    assert(result.isWorkByLapIndex.get(idx) === true, `Expected lap ${idx} (hard) to be is_work=true.`);
  }
  for (const idx of restLapIndices) {
    assert(result.isWorkByLapIndex.get(idx) === false, `Expected lap ${idx} (warmup/easy/cooldown) to be is_work=false.`);
  }
  console.log(
    `  lap-work-detection (structure tier): method=${result.method}, work_laps=[${workLapIndices.join(",")}], expected_work_steps=${result.expectedWorkStepCount}`
  );
}

function checkLapTriggerTier(): void {
  // Same hard/easy pace pattern, but no wkt_step_index and no plan structure —
  // only the athlete's manual lap presses to go on.
  const laps: NormalizedFitLap[] = [
    lapWithPace(0, 235, { lapTrigger: "manual" }),
    lapWithPace(1, 355, { lapTrigger: "manual" }),
    lapWithPace(2, 240, { lapTrigger: "manual" }),
    lapWithPace(3, 360, { lapTrigger: "manual" }),
    lapWithPace(4, 245, { lapTrigger: "manual" }),
    lapWithPace(5, 365, { lapTrigger: "manual" }),
  ];
  const result = detectWorkLaps({ laps, structureSnapshot: null });
  assert(result.method === "lap_trigger", `Expected method=lap_trigger, got ${result.method}.`);
  for (const idx of [0, 2, 4]) {
    assert(result.isWorkByLapIndex.get(idx) === true, `Expected fast manual lap ${idx} to be is_work=true.`);
  }
  for (const idx of [1, 3, 5]) {
    assert(result.isWorkByLapIndex.get(idx) === false, `Expected slow manual lap ${idx} to be is_work=false.`);
  }
  console.log(`  lap-work-detection (lap_trigger tier): method=${result.method}`);
}

function checkHeuristicTier(): void {
  // No structure, no manual laps (auto distance-triggered laps) — only the
  // pace pattern itself to go on.
  const laps: NormalizedFitLap[] = [
    lapWithPace(0, 230, { lapTrigger: "distance" }),
    lapWithPace(1, 350, { lapTrigger: "distance" }),
    lapWithPace(2, 235, { lapTrigger: "distance" }),
    lapWithPace(3, 355, { lapTrigger: "distance" }),
  ];
  const result = detectWorkLaps({ laps, structureSnapshot: null });
  assert(result.method === "heuristic", `Expected method=heuristic, got ${result.method}.`);
  assert(result.isWorkByLapIndex.get(0) === true && result.isWorkByLapIndex.get(2) === true, "Expected fast laps is_work=true.");
  assert(result.isWorkByLapIndex.get(1) === false && result.isWorkByLapIndex.get(3) === false, "Expected slow laps is_work=false.");
  console.log(`  lap-work-detection (heuristic tier): method=${result.method}`);
}

function checkNoneTier(): void {
  // Near-uniform pace, no structure, no manual laps, too few laps for any
  // tier to trust a split — must degrade to 'none' with every is_work
  // undetermined (not a fabricated guess).
  const laps: NormalizedFitLap[] = [
    lapWithPace(0, 300, { lapTrigger: "time" }),
    lapWithPace(1, 305, { lapTrigger: "time" }),
    lapWithPace(2, 298, { lapTrigger: "time" }),
  ];
  const result = detectWorkLaps({ laps, structureSnapshot: null });
  assert(result.method === "none", `Expected method=none on ambiguous data, got ${result.method}.`);
  assert(result.isWorkByLapIndex.size === 0, "Expected no lap to be classified when no tier is confident.");
  console.log(`  lap-work-detection (no signal): method=${result.method}, classified=${result.isWorkByLapIndex.size}`);
}

// ---------------------------------------------------------------------------
// Fixture 3: the no-FIT fallback contract — every unknown field must be
// null, never 0/false-as-unknown, and fallback_level must reflect exactly
// how far the pipeline got (no /details at all vs /details-but-no-file).
// ---------------------------------------------------------------------------
function checkFallbackPaths(): void {
  const noDetails = buildDerivedMetricsFitFields({ kind: "no_details" });
  assert(noDetails.has_fit === false, "Expected has_fit=false with no /details response.");
  assert(noDetails.fallback_level === "summary_only", `Expected fallback_level=summary_only, got ${noDetails.fallback_level}.`);
  for (const key of ["source_fit_file_id", "match_confidence", "hr_quality", "pct_hr_cleaned", "avg_hr"] as const) {
    assert(noDetails[key] === null, `Expected ${key}=null on the no_details fallback, got ${JSON.stringify(noDetails[key])}.`);
  }

  const noFitFile = buildDerivedMetricsFitFields({ kind: "no_fit_file" });
  assert(noFitFile.has_fit === false, "Expected has_fit=false with /details but no FIT file.");
  assert(noFitFile.fallback_level === "details_only", `Expected fallback_level=details_only, got ${noFitFile.fallback_level}.`);
  for (const key of ["source_fit_file_id", "match_confidence", "hr_quality", "pct_hr_cleaned", "avg_hr"] as const) {
    assert(noFitFile[key] === null, `Expected ${key}=null on the no_fit_file fallback, got ${JSON.stringify(noFitFile[key])}.`);
  }

  const fitParsed = buildDerivedMetricsFitFields({
    kind: "fit_parsed",
    sourceFitFileId: "12345.fit",
    hrQuality: "good",
    pctHrCleaned: 1.2,
    avgHr: 148.3,
  });
  assert(fitParsed.has_fit === true, "Expected has_fit=true when a FIT file parsed successfully.");
  assert(fitParsed.fallback_level === "fit_full", `Expected fallback_level=fit_full, got ${fitParsed.fallback_level}.`);
  assert(fitParsed.match_confidence === 1, "Expected match_confidence=1 (direct fileId, no fuzzy matching).");

  console.log("  fallback contract: no_details -> summary_only, no_fit_file -> details_only, fit_parsed -> fit_full — all unknowns null, none fabricated");
}

function run(): void {
  console.log("[check-fit-ingest-pipeline] HR cleaning");
  checkHrCleaning();
  checkHrCleaningOnCleanStream();
  checkHrCleaningNoData();

  console.log("[check-fit-ingest-pipeline] Lap work detection");
  checkStructureTier();
  checkLapTriggerTier();
  checkHeuristicTier();
  checkNoneTier();

  console.log("[check-fit-ingest-pipeline] No-FIT fallback contract");
  checkFallbackPaths();

  console.log("[check-fit-ingest-pipeline] PASS");
}

try {
  run();
} catch (error) {
  console.error("[check-fit-ingest-pipeline] FAIL");
  console.error((error as Error).message);
  process.exit(1);
}
