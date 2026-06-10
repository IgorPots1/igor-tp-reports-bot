import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  calculateNutritionEnergyAvailabilityFacts,
  calculateNutritionEnergyFloorFacts,
} from "@/features/nutrition/methodology";

const root = process.cwd();
const source = readFileSync(join(root, "src/features/nutrition/methodology.ts"), "utf8");

assert.doesNotMatch(source, /from\s+["']openai["']/i, "EA screening must be deterministic");
assert.doesNotMatch(source, /sendTelegram|telegramSend|bot\.sendMessage/i, "EA screening must not send Telegram");
assert.doesNotMatch(source, /moveWorkout|executeMove|mutateTrainingPeaks/i, "EA screening must not mutate TrainingPeaks");

function ea(input: {
  sex: "female" | "male" | "unknown";
  intakeKcal: number | null;
  exerciseEnergyKcal: number | null;
  hasLoad: boolean;
}) {
  return calculateNutritionEnergyAvailabilityFacts({
    intakeKcal: input.intakeKcal,
    exerciseEnergyKcal: input.exerciseEnergyKcal,
    exerciseEnergySource: input.exerciseEnergyKcal === null ? "missing" : "trainingpeaks_workout_kcal",
    bodyweightKg: 60,
    sex: input.sex,
    hasLoad: input.hasLoad,
  });
}

const baseline = ea({ sex: "female", intakeKcal: 1400, exerciseEnergyKcal: 0, hasLoad: false });
assert.equal(baseline.fatFreeMassKg, 46.8);
assert.equal(baseline.ffmSource, "estimated_from_bodyweight");
assert.equal(baseline.ffmConfidence ?? "medium", "medium");
assert.equal(baseline.eaKcalPerKgFfm, 29.9);
assert.equal(baseline.eaZone, "red");
assert.ok(baseline.notes.includes("estimated_ffm_used"));

const red = ea({ sex: "female", intakeKcal: 1600, exerciseEnergyKcal: 600, hasLoad: true });
assert.equal(red.eaKcalPerKgFfm, 21.4);
assert.equal(red.eaZone, "red");

const amber = ea({ sex: "female", intakeKcal: 2200, exerciseEnergyKcal: 600, hasLoad: true });
assert.equal(amber.eaKcalPerKgFfm, 34.2);
assert.equal(amber.eaZone, "amber");

const green = ea({ sex: "female", intakeKcal: 2800, exerciseEnergyKcal: 600, hasLoad: true });
assert.equal(green.eaKcalPerKgFfm, 47);
assert.equal(green.eaZone, "green");

const male = ea({ sex: "male", intakeKcal: 2800, exerciseEnergyKcal: 600, hasLoad: true });
assert.equal(male.ffmCoefficient, 0.82);
assert.ok(male.notes.includes("male_ea_threshold_less_validated"));
assert.ok(["amber", "green", "red"].includes(male.eaZone), "male must use same conservative 30/45 screen");

const missingEee = ea({ sex: "female", intakeKcal: 1400, exerciseEnergyKcal: null, hasLoad: true });
assert.equal(missingEee.eaKcalPerKgFfm, null);
assert.equal(missingEee.eaZone, "unknown");
assert.equal(missingEee.confidence, "low");
assert.ok(missingEee.notes.includes("exercise_energy_missing"));

const floor = calculateNutritionEnergyFloorFacts({
  intakeKcal: 1400,
  bodyweightKg: 60,
  trainingType: "cross_training",
  hasLoad: true,
});
assert.equal(floor.restFloorKcal, 1500);
assert.equal(floor.loadFloorKcal, 1800);
assert.equal(floor.crossTrainingFloorKcal, 1800);
assert.equal(floor.hardFloorKcal, 2100);
assert.equal(floor.belowRestFloor, true);
assert.equal(floor.belowLoadFloor, true);
assert.equal(floor.belowCrossTrainingFloor, true);
assert.equal(floor.floorSource, "bodyweight_fallback");

console.log("PASS check-nutrition-energy-availability");
