import assert from "node:assert/strict";

import { calculateNutritionDayTypeTarget } from "@/features/nutrition/weekly-plan-formulas";
import { resolveCarbLoadBasis, resolveCarbRangeByLoadBasis } from "@/features/nutrition/methodology";

// The hard-day carb corridor scales by the session's duration (coach-approved grid,
// 2026-07-13). Before this, hard was the only load basis judging 40 min of intervals
// and 2 h of tempo by one flat 5-7 g/kg — so a 39-min interval session was flagged
// "мало углеводов" at 4.97 g/kg against a floor meant for a two-hour tempo run.

// ─── the grid itself ───
const hard = (minutes: number | null) => resolveCarbRangeByLoadBasis("hard", minutes);

assert.deepEqual(hard(40), { rangeMinGPerKg: 4, rangeMaxGPerKg: 7 }, "short quality work (<45 min) → 4-7");
assert.deepEqual(hard(44), { rangeMinGPerKg: 4, rangeMaxGPerKg: 7 }, "44 min is still short");
assert.deepEqual(hard(45), { rangeMinGPerKg: 5, rangeMaxGPerKg: 7 }, "45 min → the validated 5.0 floor");
assert.deepEqual(hard(60), { rangeMinGPerKg: 5, rangeMaxGPerKg: 7 }, "hour-long intervals unchanged");
assert.deepEqual(hard(120), { rangeMinGPerKg: 5, rangeMaxGPerKg: 7 }, "long hard day NOT scaled up");
assert.deepEqual(hard(null), { rangeMinGPerKg: 5, rangeMaxGPerKg: 7 }, "unknown duration → validated default");

// The ceiling is 7 at every duration — the grid only ever lowers the floor.
for (const minutes of [null, 20, 44, 45, 60, 90, 150]) {
  assert.equal(hard(minutes).rangeMaxGPerKg, 7, `ceiling stays 7 (minutes=${minutes})`);
  assert.ok((hard(minutes).rangeMinGPerKg ?? 0) <= 5, `floor never rises above 5 (minutes=${minutes})`);
}

// Other load bases must not have picked up duration sensitivity.
assert.deepEqual(resolveCarbRangeByLoadBasis("easy", 40), resolveCarbRangeByLoadBasis("easy", 120), "easy is flat");
assert.deepEqual(resolveCarbRangeByLoadBasis("rest", 40), resolveCarbRangeByLoadBasis("rest", null), "rest is flat");
// long_run stays duration-scaled (regression guard on the pre-existing grid).
assert.notDeepEqual(
  resolveCarbRangeByLoadBasis("long_run", 90),
  resolveCarbRangeByLoadBasis("long_run", 160),
  "long_run still scales by duration"
);

// ─── races ride the same corridor, and that is deliberate ───
// resolveCarbLoadBasis collapses race into the "hard" basis, so the duration grid
// applies to race days too. Coach decision (2026-07-13): keep it. A 20-min parkrun
// does not warrant a 5 g/kg floor, and a real race (half/full) is >45 min anyway, so
// it keeps 5-7. Carb LOADING is untouched — it lives in the plan, not this corridor.
assert.equal(resolveCarbLoadBasis("race"), "hard", "race shares the hard load basis");
assert.deepEqual(hard(25), { rangeMinGPerKg: 4, rangeMaxGPerKg: 7 }, "short race (parkrun) → 4-7, on purpose");
assert.deepEqual(hard(90), { rangeMinGPerKg: 5, rangeMaxGPerKg: 7 }, "half-marathon race → 5-7, unchanged");

// ─── the plumbing: the duration must actually REACH the corridor ───
// The bug this guards against: the corridor scales by duration, but a caller gates the
// duration to long_run only. Then the displayed target says 5-7 while the ok/low status
// judges by 4-7 — the exact displayed-vs-status desync class. A 40-min hard day must
// land on the 4-7 midpoint (5.5 г/кг), not the 5-7 midpoint (6.0).
const shortHard = calculateNutritionDayTypeTarget({ bodyweightKg: 60, dayType: "hard", durationHours: 40 / 60 });
const hourHard = calculateNutritionDayTypeTarget({ bodyweightKg: 60, dayType: "hard", durationHours: 60 / 60 });

assert.equal(shortHard?.carbs_g, 330, "40-min hard day: 60 кг × 5.5 (midpoint of 4-7) = 330 г");
assert.equal(hourHard?.carbs_g, 360, "60-min hard day: 60 кг × 6.0 (midpoint of 5-7) = 360 г — unchanged");
assert.ok(
  (shortHard?.carbs_g ?? 0) < (hourHard?.carbs_g ?? 0),
  "the plan asks LESS for a shorter hard session — the anomaly this fixes"
);

// kcal must stay coherent with the macros after the corridor moved (kcal = 4P + 9F + 4C).
for (const target of [shortHard, hourHard]) {
  const fromMacros = target!.protein_g * 4 + target!.fat_g * 9 + target!.carbs_g * 4;
  assert.ok(
    Math.abs(fromMacros - target!.target_kcal) <= 25,
    `kcal stays reconciled with macros (${fromMacros} vs ${target!.target_kcal})`
  );
}

console.log("PASS check-nutrition-hard-carb-corridor-duration");
