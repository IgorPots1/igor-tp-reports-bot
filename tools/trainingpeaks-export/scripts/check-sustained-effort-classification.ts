import process from "node:process";

import {
  buildSustainedEffortCandidate,
  type SustainedEffortCandidate,
  type SustainedEffortWorkoutLike,
} from "./lib/e-predictor-sustained-effort.ts";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function assertThresholdEligibleRole(role: SustainedEffortCandidate["evidence_role"]): boolean {
  return role === "half_specific_sustained" || role === "threshold_tempo_sustained";
}

function buildFixtureCandidate(
  label: string,
  workout: SustainedEffortWorkoutLike,
): SustainedEffortCandidate {
  const candidate = buildSustainedEffortCandidate({
    workout,
    fitLaps: null,
    fitRecords: null,
  });
  assert(candidate?.available, `${label}: expected sustained-effort candidate to be available.`);
  return candidate!;
}

function runOlgaPlannedContinuousFixture(): void {
  const candidate = buildFixtureCandidate("olga-planned-continuous", {
    date: "2026-05-12",
    title: "50 мин",
    role: "half-specific sustained tempo",
    completed_duration_minutes: 52,
    distance_km: 9.28,
    avg_pace_min_per_km: 5.38,
    avg_hr: 171,
    segment_comparison: [
      {
        segment_type: "main",
        is_rest: false,
        planned_duration_minutes: 50,
        actual: {
          duration_minutes: 50,
          distance_km: 9.28,
          avg_pace_min_per_km: 5.38,
          avg_pace_text: "5:23/км",
          avg_hr: 171,
        },
      },
    ],
  });

  assert(
    assertThresholdEligibleRole(candidate.evidence_role),
    `olga-planned-continuous: expected threshold-eligible sustained role, got ${candidate.evidence_role}.`,
  );
  assert(candidate.threshold_eligible === true, "olga-planned-continuous: expected threshold_eligible=true.");
  assert(
    candidate.excluded_from_training_implied_reason == null,
    `olga-planned-continuous: expected no training-implied exclusion, got ${candidate.excluded_from_training_implied_reason ?? "null"}.`,
  );
  assert(
    candidate.prediction_eligible === true,
    "olga-planned-continuous: expected prediction_eligible=true so block may anchor training-implied shape.",
  );
  assert(candidate.duration_seconds === 3000, "olga-planned-continuous: expected 50-minute sustained block.");

  console.log(
    `[olga-planned-continuous] role=${candidate.evidence_role} threshold_eligible=${candidate.threshold_eligible} prediction_eligible=${candidate.prediction_eligible}`,
  );
}

function runValentinLongRunFixture(): void {
  const candidate = buildFixtureCandidate("valentin-long-run", {
    date: "2026-05-04",
    title: "110 мин бег",
    role: "key workout",
    completed_duration_minutes: 110,
    distance_km: 20.25,
    avg_pace_min_per_km: 5.43,
    avg_hr: 144,
    segment_comparison: [
      {
        segment_type: "main",
        is_rest: false,
        planned_duration_minutes: 50,
        actual: {
          duration_minutes: 50,
          distance_km: 9.03,
          avg_pace_min_per_km: 5.53,
          avg_pace_text: "5:32/км",
          avg_hr: 144,
        },
      },
    ],
  });

  assert(
    candidate.evidence_role === "long_run_endurance_support",
    `valentin-long-run: expected long_run_endurance_support, got ${candidate.evidence_role}.`,
  );
  assert(candidate.threshold_eligible === false, "valentin-long-run: expected threshold_eligible=false.");
  assert(
    candidate.excluded_from_training_implied_reason === "long_run_endurance_support_only",
    `valentin-long-run: expected long_run_endurance_support_only exclusion, got ${candidate.excluded_from_training_implied_reason ?? "null"}.`,
  );
  assert(
    candidate.prediction_eligible === false,
    "valentin-long-run: expected prediction_eligible=false so block must not define training-implied threshold pace.",
  );
  assert(candidate.duration_seconds === 3000, "valentin-long-run: expected extracted 50-minute window.");

  console.log(
    `[valentin-long-run] role=${candidate.evidence_role} threshold_eligible=${candidate.threshold_eligible} excluded=${candidate.excluded_from_training_implied_reason}`,
  );
}

function runProgressiveLongRunFixture(label: string, title: string): void {
  const candidate = buildFixtureCandidate(label, {
    date: "2026-05-04",
    title,
    role: "key workout",
    completed_duration_minutes: 110,
    distance_km: 20.25,
    avg_pace_min_per_km: 5.43,
    avg_hr: 144,
    segment_comparison: [
      {
        segment_type: "main",
        is_rest: false,
        planned_duration_minutes: 50,
        actual: {
          duration_minutes: 50,
          distance_km: 9.03,
          avg_pace_min_per_km: 5.53,
          avg_pace_text: "5:32/км",
          avg_hr: 144,
        },
      },
    ],
  });

  assert(
    candidate.evidence_role !== "easy_long_run_support",
    `${label}: progressive/tempo long run must not be blindly classified as easy_long_run_support (got ${candidate.evidence_role}).`,
  );

  console.log(`[${label}] role=${candidate.evidence_role}`);
}

function run(): void {
  runOlgaPlannedContinuousFixture();
  runValentinLongRunFixture();
  runProgressiveLongRunFixture("progressive-long-run-ru", "110 мин бег с ускорением");
  runProgressiveLongRunFixture("progressive-long-run-en", "110 мин с HM pace block");
  console.log("[check-sustained-effort-classification] OK");
}

try {
  run();
} catch (error) {
  console.error("[check-sustained-effort-classification] FAIL");
  console.error((error as Error).message);
  process.exit(1);
}
