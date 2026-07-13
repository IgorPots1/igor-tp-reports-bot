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

// ─── races are EXEMPT from the grid (coach decision, 2026-07-14) ───
// race still rides the "hard" load basis for everything else (protein, fat, EA), but its carb
// corridor ignores duration: floor 5 always. A race is maximal effort by definition and the short
// ones are the sharpest — a 25-min 5k needs carbs in full. Trimming the floor before a race would
// also fight the plan, which LOADS carbs into race day. Hence the isRaceDay flag on the corridor.
const race = (minutes: number | null) => resolveCarbRangeByLoadBasis("hard", minutes, undefined, true);

assert.equal(resolveCarbLoadBasis("race"), "hard", "race still shares the hard load basis");
assert.deepEqual(race(25), { rangeMinGPerKg: 5, rangeMaxGPerKg: 7 }, "short race (5k, 25 min) → 5-7, NOT the 4 floor");
assert.deepEqual(race(42), { rangeMinGPerKg: 5, rangeMaxGPerKg: 7 }, "42-min race → 5-7 (a hard day here would be 4-7)");
assert.deepEqual(race(90), { rangeMinGPerKg: 5, rangeMaxGPerKg: 7 }, "half-marathon → 5-7, unchanged");
assert.deepEqual(race(210), { rangeMinGPerKg: 5, rangeMaxGPerKg: 7 }, "marathon → 5-7, unchanged");
assert.deepEqual(race(null), { rangeMinGPerKg: 5, rangeMaxGPerKg: 7 }, "unknown-duration race → 5-7");
// The exemption is what separates them: same duration, same basis, different floor.
for (const minutes of [null, 20, 25, 42, 44, 60, 120]) {
  assert.equal(race(minutes).rangeMinGPerKg, 5, `race floor is 5 at every duration (minutes=${minutes})`);
  assert.equal(race(minutes).rangeMaxGPerKg, 7, `race ceiling is 7 at every duration (minutes=${minutes})`);
}
assert.notDeepEqual(race(25), hard(25), "a 25-min RACE and a 25-min hard session must NOT get the same corridor");

// ─── the race exemption must survive the plumbing, not just the pure function ───
const shortRace = calculateNutritionDayTypeTarget({ bodyweightKg: 60, dayType: "race", durationHours: 25 / 60 });
const shortHardSameLength = calculateNutritionDayTypeTarget({
  bodyweightKg: 60,
  dayType: "hard",
  durationHours: 25 / 60,
});
assert.equal(shortRace?.carbs_g, 360, "25-min race: 60 кг × 6.0 (midpoint of 5-7) = 360 г — the grid must not touch it");
assert.equal(shortHardSameLength?.carbs_g, 330, "25-min hard: 60 кг × 5.5 (midpoint of 4-7) = 330 г");
assert.ok(
  (shortRace?.carbs_g ?? 0) > (shortHardSameLength?.carbs_g ?? 0),
  "the plan asks MORE carbs for a race than for a hard session of the same length"
);

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
