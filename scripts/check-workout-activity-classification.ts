// Sport classification: TrainingPeaks' own workoutTypeValueId is AUTHORITATIVE
// and must beat every title heuristic.
//
// The bug this pins down: only type ids 3 (run) and 9 (strength) were mapped, so
// a ride (type 2) fell through to the title heuristics -- where "длительный" is a
// RUNNING keyword. "Длительный вел" (a long BIKE ride) was classified as a run,
// passed the sport gate, and polluted aerobic_ef with cycling speeds (0.042-0.067
// against a genuine-run ceiling of 0.025). 11 of 33 rides were mislabelled.

import { classifyTrainingPeaksWorkoutActivity } from "@/features/trainingpeaks/workout-activity-classification";

let failed = 0;

function expectFamily(
  label: string,
  input: { title?: string | null; workoutTypeValueId?: number | null },
  expected: string
): void {
  const result = classifyTrainingPeaksWorkoutActivity(input);
  if (result.family === expected) {
    console.log(`  ok   - ${label} -> ${result.family}`);
  } else {
    failed += 1;
    console.log(`  FAIL - ${label} -> got ${result.family}, expected ${expected} (${result.reason})`);
  }
}

console.log("[check-workout-activity-classification] authoritative type id beats the title");
// THE regression: a Russian bike title containing a running keyword.
expectFamily('type=2 "Длительный вел"', { workoutTypeValueId: 2, title: "Длительный вел" }, "bike");
expectFamily('type=2 "Длительный вел по мощности"', { workoutTypeValueId: 2, title: "Длительный вел по мощности" }, "bike");
// Bike intervals whose titles look exactly like run intervals.
expectFamily('type=2 "6 х 5 минут"', { workoutTypeValueId: 2, title: "6 х 5 минут" }, "bike");
expectFamily('type=2 "2 х 18 / 3 мин"', { workoutTypeValueId: 2, title: "2 х 18 / 3 мин" }, "bike");
expectFamily('type=2 "Вел по пульсу (на улице)"', { workoutTypeValueId: 2, title: "Вел по пульсу (на улице)" }, "bike");
// Swim sets whose titles are bare numbers.
expectFamily('type=1 "1800 м"', { workoutTypeValueId: 1, title: "1800 м" }, "swim");
expectFamily('type=1 "2 x 1000"', { workoutTypeValueId: 1, title: "2 x 1000" }, "swim");

console.log("[check-workout-activity-classification] no regression on what already worked");
expectFamily('type=2 "Cycling"', { workoutTypeValueId: 2, title: "Cycling" }, "bike");
expectFamily('type=1 "Lap Swimming"', { workoutTypeValueId: 1, title: "Lap Swimming" }, "swim");
expectFamily('type=3 "Длительный бег"', { workoutTypeValueId: 3, title: "Длительный бег" }, "run");
expectFamily('type=3 "15 х 1,5 мин"', { workoutTypeValueId: 3, title: "15 х 1,5 мин" }, "run");
expectFamily('type=9 "Силовая"', { workoutTypeValueId: 9, title: "Силовая" }, "strength");
expectFamily('type=13 "Walking"', { workoutTypeValueId: 13, title: "Walking" }, "walk_hike");
expectFamily('type=13 "Indoor Walking"', { workoutTypeValueId: 13, title: "Indoor Walking" }, "walk_hike");

console.log("[check-workout-activity-classification] type 100 is TP's Other bucket -> title decides");
// 100 must NOT be mapped to one sport: it holds a grab-bag. The title heuristics
// still resolve these, exactly as before.
expectFamily('type=100 "Padel Racket"', { workoutTypeValueId: 100, title: "Padel Racket" }, "crosstrain");
expectFamily('type=100 "Stand Up Paddleboarding"', { workoutTypeValueId: 100, title: "Stand Up Paddleboarding" }, "paddle");
expectFamily('type=100 "Strength"', { workoutTypeValueId: 100, title: "Strength" }, "strength");

console.log("[check-workout-activity-classification] no type at all -> title fallback still works");
expectFamily('no type, "Длительный бег"', { workoutTypeValueId: null, title: "Длительный бег" }, "run");
expectFamily('no type, "Cycling"', { workoutTypeValueId: null, title: "Cycling" }, "bike");

if (failed > 0) {
  console.log(`\n[check-workout-activity-classification] FAILED (${failed})`);
  process.exitCode = 1;
} else {
  console.log("\n[check-workout-activity-classification] PASS");
}
