// Hermetic checks for FIT data sanity (наряд fit-data-sanity): the FIT "unset"
// sentinel rejection and (below) the workout-metric sanity gate. No network/DB —
// fixtures only, mirroring check-fit-ingest-pipeline.ts.

import process from "node:process";

import { normalizeFitLaps, normalizeFitRecords } from "./lib/fit-workout-normalization.ts";
import { rejectFitSentinel, U16_INVALID, U16_SPEED_MPS, U32_DIST_M, U32_INVALID, U32_TIME_S, U8_INVALID } from "./lib/fit-sentinel.ts";
import { assessWorkoutDataSanity } from "./lib/fit-data-sanity.ts";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

// ── rejectFitSentinel: markers rejected, real values kept ────────────────────
// uint32 time sentinel (ms/1000) and its raw form
assert(rejectFitSentinel(U32_TIME_S, U32_INVALID, U32_TIME_S) === null, "4294967.295s must be rejected");
assert(rejectFitSentinel(4294967295, U32_INVALID, U32_TIME_S) === null, "raw 0xFFFFFFFF must be rejected");
// uint32 distance sentinel (cm/100); observed 42949672.1 (scale rounding) must still match
assert(rejectFitSentinel(42949672.1, U32_INVALID, U32_DIST_M) === null, "42949672.1m (distance sentinel) must be rejected");
// uint16 speed sentinel
assert(rejectFitSentinel(U16_SPEED_MPS, U16_INVALID, U16_SPEED_MPS) === null, "65.535 m/s must be rejected");
// uint8 HR/cadence sentinel
assert(rejectFitSentinel(255, U8_INVALID) === null, "255 (uint8 max) must be rejected");

// real values must survive — field-aware markers must NOT collide with them
assert(rejectFitSentinel(2.55, U16_INVALID, U16_SPEED_MPS) === 2.55, "2.55 m/s is a real speed, keep");
assert(rejectFitSentinel(65, U32_INVALID, U32_TIME_S) === 65, "a 65-second lap timer is real, keep (65.535 is a SPEED marker, not applied here)");
assert(rejectFitSentinel(3.2767, U16_INVALID, U16_SPEED_MPS) === 3.2767, "3.28 m/s (3:18/km) is real, keep");
assert(rejectFitSentinel(11000, U32_INVALID, U32_DIST_M) === 11000, "11km distance is real, keep");
assert(rejectFitSentinel(180, U8_INVALID) === 180, "180 bpm is real, keep");
assert(rejectFitSentinel(null, U32_INVALID) === null, "null passes through");

// ── normalizeFitLaps drops a sentinel lap's fields ───────────────────────────
{
  const laps = normalizeFitLaps(
    [
      { total_timer_time: 300, total_distance: 1000, avg_heart_rate: 150 },
      { total_timer_time: 4294967295, total_distance: 4294967295, avg_heart_rate: 255 }, // FIT unset row
    ],
    null
  );
  assert(laps[0]!.timerTimeS === 300 && laps[0]!.distanceM === 1000 && laps[0]!.avgHr === 150, "normal lap survives");
  assert(laps[1]!.timerTimeS === null, "sentinel lap timer → null");
  assert(laps[1]!.distanceM === null, "sentinel lap distance → null");
  assert(laps[1]!.avgHr === null, "sentinel lap HR (255) → null");
  // the whole point: summing must not be poisoned by the sentinel lap
  const totalTime = laps.reduce((s, l) => s + (l.timerTimeS ?? 0), 0);
  assert(totalTime === 300, `lap-sum time must exclude the sentinel (got ${totalTime})`);
}

// ── normalizeFitRecords drops a sentinel record's fields (feeds aerobic_ef) ───
{
  const recs = normalizeFitRecords([
    { timestamp: "2026-01-01T00:00:00Z", speed: 3.0, distance: 100, heart_rate: 150 },
    { timestamp: "2026-01-01T00:00:01Z", speed: 65.535, distance: 4294967295, heart_rate: 255 }, // unset
  ]);
  assert(recs[0]!.speedMps === 3.0 && recs[0]!.distanceM === 100, "normal record survives");
  assert(recs[1]!.speedMps === null, "sentinel record speed → null (won't poison aerobic_ef)");
  assert(recs[1]!.distanceM === null, "sentinel record distance → null");
  assert(recs[1]!.heartRate === null, "sentinel record HR → null");
}

// ── assessWorkoutDataSanity: the gate ────────────────────────────────────────
{
  // normal steady run — everything trusted, nothing nulled
  const s = assessWorkoutDataSanity({ overallPaceSecPerKm: 330, aerobicEf: 0.018, repPeakHrs: [178, 180, 181] });
  assert(s.paceTrusted === true && s.distanceTrusted === true, "normal pace trusted");
  assert(s.aerobicEfSane === true && s.maxHrSane === true, "normal ef/hr sane");
  assert(s.warnings.length === 0, "normal workout has no warnings");
}
{
  // impossible overall pace (GPS spike) — pace/distance untrusted; ef nulled because distance untrusted
  const s = assessWorkoutDataSanity({ overallPaceSecPerKm: 32, aerobicEf: 0.02, repPeakHrs: null });
  assert(s.paceTrusted === false && s.distanceTrusted === false, "impossible pace → untrusted");
  assert(s.aerobicEfSane === false, "ef untrusted when distance untrusted");
  assert(s.warnings.some((w) => w.startsWith("implausible_pace")), "pace warning present");
}
{
  // too-slow fragment
  const s = assessWorkoutDataSanity({ overallPaceSecPerKm: 700, aerobicEf: null, repPeakHrs: null });
  assert(s.paceTrusted === false, "700 s/km fragment untrusted");
}
{
  // impossible aerobic_ef alone
  const s = assessWorkoutDataSanity({ overallPaceSecPerKm: 330, aerobicEf: 0.25, repPeakHrs: null });
  assert(s.aerobicEfSane === false && s.paceTrusted === true, "ef out of range nulled, pace still fine");
}
{
  // max rep HR range is [130, 205] (наряд fix-maxhr-threshold: floor was 165,
  // which mislabelled genuine low-intensity peaks). Boundary tests:
  const sane = (peaks: number[]) => assessWorkoutDataSanity({ overallPaceSecPerKm: 330, aerobicEf: 0.018, repPeakHrs: peaks }).maxHrSane;
  assert(sane([120, 129]) === false, "max 129 → below floor, not sane");
  assert(sane([120, 130]) === true, "max 130 → at floor, sane");
  assert(sane([150, 162]) === true, "max 162 → real low-intensity peak, sane (was wrongly flagged at floor 165)");
  assert(sane([150, 205]) === true, "max 205 → at ceiling, sane");
  assert(sane([150, 206]) === false, "max 206 → above ceiling, not sane");
  assert(sane([150, 240]) === false, "max 240 → glitch, not sane");
  assert(sane([95, 110]) === false, "max 110 → strap under-read, not sane");
}
{
  // no FIT distance/time → not computable, not "untrusted"
  const s = assessWorkoutDataSanity({ overallPaceSecPerKm: null, aerobicEf: null, repPeakHrs: null });
  assert(s.paceTrusted === null && s.distanceTrusted === null, "no pace → null, not false");
}

console.log("[check-fit-data-sanity] PASS");
process.exit(0);
