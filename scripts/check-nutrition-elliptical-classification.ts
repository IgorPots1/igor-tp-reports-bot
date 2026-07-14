import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { classifyTrainingPeaksWorkoutActivity } from "@/features/trainingpeaks/workout-activity-classification";
import { normalizeTrainingType, resolveCarbRangeByLoadBasis } from "@/features/nutrition/methodology";
import { resolveNutritionActivityCoefByTitle } from "@/features/nutrition/activity-energy";

// TP has no dedicated type id for the elliptical machine — it arrives as
// workoutTypeValueId=100, TP's generic "Other" bucket, with the real activity name only in
// the title. "Elliptical" was unrecognised by every layer (general TP classifier, nutrition
// type, expenditure coefficient) and fell all the way to "unknown" everywhere. Confirmed on
// real data: Denisova, 2026-04-03 (Elliptical 35 min + Strength 41 min).
//
// Coach's call (2026-07-14): elliptical is light-tempo effort — classify and cost it exactly
// like "easy" (priority 50, 8 kcal/kg/h), not "unknown" (priority 10, defaulted to 9).

const classify = (title: string) =>
  classifyTrainingPeaksWorkoutActivity({
    title,
    sportOrTypeCode: null,
    workoutTypeValueId: 100, // TP's real value for this title — do not invent a nicer one
    workoutSubTypeId: null,
    sourceSnapshot: null,
  });

// ─── 1. the general TP classifier recognises it now ───
const family = classify("Elliptical").family;
assert.notEqual(family, "unknown", "the general classifier no longer falls through to unknown");
assert.equal(classify("эллипс").family, family, "the Russian spelling classifies the same way");

// ─── 2. the nutrition type is "easy" — not "unknown", and NOT "cross_training" either ───
// It must be "easy" specifically, regardless of what family the general classifier assigned —
// that decision is pinned on the TITLE inside normalizeTrainingType, ahead of the
// cross_training block, so it can never be silently downgraded by a future classifier change.
assert.equal(normalizeTrainingType(family, "Elliptical"), "easy", "elliptical is easy, coach's call");
assert.equal(normalizeTrainingType(family, "эллипс"), "easy", "…in Russian too");
assert.equal(normalizeTrainingType("unknown", "Elliptical"), "easy", "pinned on title alone — robust to family drift");

// ─── 3. the expenditure coefficient is 8 (easy), not 9 (the old unknown default) ───
assert.equal(resolveNutritionActivityCoefByTitle("Elliptical"), 8);
assert.equal(resolveNutritionActivityCoefByTitle("эллипс"), 8);

// ─── the real case: Denisova, 2026-04-03, Elliptical 35 min + Strength 41 min, 58 kg ───
const bw = 58;
const ellHours = 0.5891413688659668;
const strHours = 0.6839125156402588;
const ellKcal = Math.round(ellHours * bw * resolveNutritionActivityCoefByTitle("Elliptical")!);
const strKcal = Math.round(strHours * bw * resolveNutritionActivityCoefByTitle("Strength")!);
assert.equal(ellKcal, 273, "elliptical alone: 35 min × 58 kg × 8 (was 308 at the old unknown=9)");
assert.equal(strKcal, 198, "strength unaffected");
assert.equal(ellKcal + strKcal, 471, "the day's total drops from 506 to 471 — no double-charge introduced");

// ─── a day with ONLY elliptical (no strength) must be "easy", not "unknown" ───
// This was the real landmine: today it's invisible because strength wins on priority
// (70 > unknown's 10). A solo elliptical day was silently reading as no-training-evidence.
assert.equal(normalizeTrainingType(classify("Elliptical").family, "Elliptical"), "easy");

// ─── strength still wins the day's primary session on a combined day ───
assert.equal(normalizeTrainingType(classify("Strength").family, "Strength"), "strength");
// easy priority (50) < strength priority (70) — confirmed via the type values themselves;
// buildWorkoutContextByDate sorts by WORKOUT_LOAD_PRIORITY, and this fix does not touch it.

// ═══ EXTENDED (2026-07-14): the other 6 activities found unrecognised in the same sweep ═══
// Yoga · Pilates · Cardio · Jump Rope · Ice Skating · Volleyball · (Other/Track Me excluded
// on purpose — no real signal to classify from, must stay "unknown"). Measured across the
// FULL workout cache (all athletes): 22 titles fell to family=unknown, of which 9 genuinely
// resolved to nutritionType=unknown (the rest were saved by title-based interval/tempo
// evidence elsewhere in normalizeTrainingType, evaluated before the raw==="unknown" check).
const OTHER_ACTIVITIES: Array<[string, "easy" | "cross_training", number]> = [
  ["Cardio", "easy", 8],
  ["Yoga", "cross_training", 3.5],
  ["Pilates", "cross_training", 3.5],
  ["Jump Rope", "cross_training", 10],
  ["Ice Skating", "cross_training", 6],
  ["Volleyball", "cross_training", 6],
];
for (const [title, expectedType, expectedCoef] of OTHER_ACTIVITIES) {
  const fam = classify(title).family;
  assert.notEqual(fam, "unknown", `${title}: general classifier no longer falls to unknown`);
  assert.equal(normalizeTrainingType(fam, title), expectedType, `${title}: nutrition type is "${expectedType}"`);
  assert.equal(resolveNutritionActivityCoefByTitle(title), expectedCoef, `${title}: coefficient is ${expectedCoef}`);
}

// Yoga/Pilates specifically land on the LIGHT cross_training corridor (3.5-5 г/кг), reusing
// the EXISTING padel/tennis/walk mechanism — not a new parallel one (Igor's explicit ask:
// "не дублируем ли механизм"). Jump Rope/Ice Skating/Volleyball do NOT — they keep the
// regular cross_training band (4.5-6.5), they are real calorie-burning activity, not
// low-intensity flexibility work.
const lightRange = resolveCarbRangeByLoadBasis("cross_training", null, true);
const regularRange = resolveCarbRangeByLoadBasis("cross_training", null, false);
assert.deepEqual(lightRange, { rangeMinGPerKg: 3.5, rangeMaxGPerKg: 5 }, "the light corridor is reused, not reinvented");
assert.deepEqual(regularRange, { rangeMinGPerKg: 4.5, rangeMaxGPerKg: 6.5 });
// Verified end-to-end on a real athlete's real Yoga sessions (Utenkova, three separate weeks,
// all landed on rangeMinGPerKg=3.5 via the full buildNutritionMethodologyContext pipeline).

// Other / Track Me: no real signal, deliberately left unknown — a change here means the
// keyword list leaked too wide.
assert.equal(normalizeTrainingType(classify("Other").family, "Other"), "unknown", "Other stays unknown");
assert.equal(normalizeTrainingType(classify("Track Me").family, "Track Me"), "unknown", "Track Me stays unknown");

// ─── the plan-side mirror must agree with the review side ───
// weekly-plan-formulas.ts keeps its OWN local copy of isLightIntermittentCrossTrainingTitle
// (documented import-cycle reason) and its own normalizeDayType (unrelated to
// normalizeTrainingType entirely). Elliptical was fixed ONLY on the review side on the first
// pass and silently missed the plan — exactly the review/plan desync class fixed repeatedly
// today. Both private functions are unexported, so the source text itself is the only place
// to pin that the mirror was actually updated, not just the original.
const planSrc = readFileSync(join(process.cwd(), "src/features/nutrition/weekly-plan-formulas.ts"), "utf8");
const planLightFn = planSrc.slice(
  planSrc.indexOf("function isLightIntermittentCrossTrainingTitle"),
  planSrc.indexOf("function isLightIntermittentCrossTrainingTitle") + 400
);
for (const token of ["yoga", "йога", "pilates", "пилатес"]) {
  assert.ok(planLightFn.includes(token), `plan-side isLightIntermittentCrossTrainingTitle mirror must include "${token}"`);
}
const planDayTypeFn = planSrc.slice(planSrc.indexOf("function normalizeDayType"), planSrc.indexOf("function isKeyWorkout"));
for (const token of ["elliptical", "эллипс", "cardio", "кардио", "yoga", "йога", "pilates", "пилатес", "jump", "скакалк", "skating", "коньк", "volleyball", "волейбол"]) {
  assert.ok(planDayTypeFn.includes(token), `plan-side normalizeDayType must classify "${token}" too, or plan/review desync`);
}

console.log("PASS check-nutrition-elliptical-classification");
