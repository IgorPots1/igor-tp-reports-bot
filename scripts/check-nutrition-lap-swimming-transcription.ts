import assert from "node:assert/strict";

import { formatNutritionWorkoutLabelForAthlete } from "@/features/nutrition/narrative-composer";

// A SECOND, INDEPENDENT translation dictionary from the one fixed in fix-workout-titles-ru
// (formatAthleteWorkoutTitleRu, methodology.ts — used for the per-day card label). This one
// (TRAININGPEAKS_ACTIVITY_RU_MAP, narrative-composer.ts) is a token-by-token .replace() list
// used for the ATHLETE-FACING weekly-focus/key-workout text. It already translated "Swimming"
// and "Open Water Swimming", but had no rule for "Lap" — so "Lap Swimming" (Hoffman's real TP
// title) came out "Lap плавание": only the known token got replaced, the qualifier was left
// stranded in Latin. Fixed the same way "Open Water" was: a multi-word rule ahead of the bare
// \bSwim(ming)\b rule.

const label = (title: string) => formatNutritionWorkoutLabelForAthlete({ trainingLabel: title, trainingType: "cross_training" });

assert.equal(label("Lap Swimming"), "плавание");
assert.equal(label("Lap Swim"), "плавание");
assert.equal(label("Lap Swimming + Pilates"), "плавание + пилатес", "the combined label — Hoffman's real case");

// The multi-word ordering this mirrors: Open Water must still win over the bare Lap/Swim
// rules, and Lap must not swallow into Open Water's output.
assert.equal(label("Open Water Swimming"), "плавание (открытая вода)", "Open Water is unaffected by the new Lap rule");

// No leftover Latin token — the whole point of the fix.
const original = console.warn;
let warned = false;
console.warn = () => {
  warned = true;
};
label("Lap Swimming");
console.warn = original;
assert.equal(warned, false, "no more untranslated-token warning for Lap Swimming");

console.log("PASS check-nutrition-lap-swimming-transcription");
