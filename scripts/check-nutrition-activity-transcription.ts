import assert from "node:assert/strict";

import { formatNutritionWorkoutLabelForAthlete, humanizeNutritionTrainingLabel } from "@/features/nutrition/narrative-composer";

// Task 10d: TrainingPeaks activity names arrive in English; in a Russian review
// they must read in Russian. Unknown activities are left as-is (never broken).

const ru = (label: string, trainingType = "cross_training") =>
  formatNutritionWorkoutLabelForAthlete({ trainingLabel: label, trainingType });

// --- known activities transcribe to Russian -----------------------------------
assert.equal(ru("Pilates"), "пилатес", "Pilates → пилатес");
assert.equal(ru("Yoga"), "йога", "Yoga → йога");
assert.equal(ru("Swim", "swim"), "плавание", "Swim → плавание");
assert.equal(ru("Strength", "strength"), "силовая", "Strength → силовая");
assert.equal(ru("Cycling"), "вело", "Cycling → вело");
assert.equal(ru("Padel Racket"), "падел", "Padel Racket → падел");
assert.equal(ru("Rowing"), "гребля", "Rowing → гребля");
assert.equal(ru("Hike"), "хайк", "Hike → хайк");
assert.equal(ru("Walk"), "ходьба", "Walk → ходьба");
assert.equal(ru("Tennis"), "теннис", "Tennis → теннис");
// D5: multi-word must win over bare Tennis (no stranded "Table теннис").
assert.equal(ru("Table Tennis"), "настольный теннис", "Table Tennis → настольный теннис");
assert.doesNotMatch(ru("Table Tennis"), /table/i, "no stranded English «Table»");
assert.equal(ru("Ping Pong"), "настольный теннис", "Ping Pong → настольный теннис");
assert.equal(ru("Yoga"), "йога");

// --- transcription works inside combined / passthrough labels ------------------
assert.match(humanizeNutritionTrainingLabel("бег + Pilates", "easy"), /пилатес/, "combined label transcribes Pilates");
assert.doesNotMatch(humanizeNutritionTrainingLabel("бег + Pilates", "easy"), /Pilates/i, "no English left in combined label");

// --- Russian text and numbers are untouched ------------------------------------
assert.equal(ru("6 х 5 мин", "hard"), "6 х 5 мин", "interval notation untouched");
assert.equal(ru("день отдыха", "rest"), "день отдыха", "rest label untouched");

// --- unknown activity is left as-is (not broken) -------------------------------
assert.match(ru("Frisbee"), /Frisbee/, "unknown activity kept verbatim (logged for later)");

console.log("PASS check-nutrition-activity-transcription");
