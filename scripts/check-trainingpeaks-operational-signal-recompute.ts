import process from "node:process";

import {
  buildPlannedRecomputeMutation,
  buildRecomputeDiff,
  buildRecomputeMetadata,
  parseRecomputeCliOptions,
  RECOMPUTE_BY_TASK,
  RECOMPUTE_CLASSIFIER_VERSION,
  RECOMPUTE_REQUIRED_CONFIRMATION,
  selectRecomputeCandidateForApply,
  validateActiveSignalsForApply,
  validateRecomputeApplyPrerequisites,
} from "./recompute-trainingpeaks-operational-signal";

const LOG_PREFIX = "[check-trainingpeaks-operational-signal-recompute]";
const OLGA_SOURCE_OBSERVATION_ID = "44ac8a84-60fc-448b-9a34-71da7a90461b";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function run(): void {
  // 1) default dry-run does not write (apply=false)
  {
    const options = parseRecomputeCliOptions([
      "--source-observation-id",
      OLGA_SOURCE_OBSERVATION_ID,
      "--dry-run",
    ]);
    assert(!options.apply, "1 failed: default dry-run path must not enable apply.");
  }

  // 2) missing --source-observation-id is rejected
  {
    let rejected = false;
    try {
      parseRecomputeCliOptions(["--dry-run"]);
    } catch {
      rejected = true;
    }
    assert(rejected, "2 failed: missing --source-observation-id must be rejected.");
  }

  // 3) invalid --source-observation-id is rejected
  {
    let rejected = false;
    try {
      parseRecomputeCliOptions(["--source-observation-id", "not-a-uuid"]);
    } catch {
      rejected = true;
    }
    assert(rejected, "3 failed: invalid --source-observation-id must be rejected.");
  }

  // 4) --apply without confirm is rejected
  {
    const options = parseRecomputeCliOptions([
      "--source-observation-id",
      OLGA_SOURCE_OBSERVATION_ID,
      "--apply",
    ]);
    const error = validateRecomputeApplyPrerequisites(options);
    assert(error !== null, "4 failed: --apply without confirm must be rejected.");
  }

  // 5) --apply --confirm "wrong" is rejected
  {
    const options = parseRecomputeCliOptions([
      "--source-observation-id",
      OLGA_SOURCE_OBSERVATION_ID,
      "--apply",
      "--confirm",
      "wrong",
    ]);
    const error = validateRecomputeApplyPrerequisites(options);
    assert(error !== null, "5 failed: wrong confirm string must be rejected.");
  }

  // 6) --dry-run --apply is rejected
  {
    let rejected = false;
    try {
      parseRecomputeCliOptions([
        "--source-observation-id",
        OLGA_SOURCE_OBSERVATION_ID,
        "--dry-run",
        "--apply",
      ]);
    } catch {
      rejected = true;
    }
    assert(rejected, "6 failed: --dry-run --apply must be rejected.");
  }

  // 7) apply path is single-observation only (requires exact source observation id)
  {
    const options = parseRecomputeCliOptions([
      "--source-observation-id",
      OLGA_SOURCE_OBSERVATION_ID,
      "--apply",
      "--confirm",
      RECOMPUTE_REQUIRED_CONFIRMATION,
    ]);
    assert(
      options.sourceObservationId === OLGA_SOURCE_OBSERVATION_ID,
      "7 failed: apply path must require exact --source-observation-id."
    );
    assert(
      validateRecomputeApplyPrerequisites(options) === null,
      "7 failed: valid apply prerequisites must pass with exact confirm."
    );
  }

  // 8) apply path refuses ambiguous multiple active signals
  {
    assert(
      validateActiveSignalsForApply(0) !== null,
      "8 failed: zero active signals must be rejected for apply."
    );
    assert(
      validateActiveSignalsForApply(1) === null,
      "8 failed: exactly one active signal must be allowed for apply."
    );
    assert(
      validateActiveSignalsForApply(2) !== null,
      "8 failed: multiple active signals must be rejected for apply."
    );
  }

  // 9) metadata marker is included in planned update
  {
    const metadata = buildRecomputeMetadata({
      existing: { follow_up_reason: "existing" },
      sourceObservationId: OLGA_SOURCE_OBSERVATION_ID,
      now: "2026-06-05T12:00:00.000Z",
    });
    assert(metadata.recomputed_at === "2026-06-05T12:00:00.000Z", "9 failed: recomputed_at missing.");
    assert(
      metadata.recompute_source_observation_id === OLGA_SOURCE_OBSERVATION_ID,
      "9 failed: recompute_source_observation_id missing."
    );
    assert(
      metadata.recompute_reason === "single_observation_guarded_recompute",
      "9 failed: recompute_reason missing."
    );
    assert(metadata.recompute_confirmed === true, "9 failed: recompute_confirmed missing.");
    assert(metadata.classifier_version === RECOMPUTE_CLASSIFIER_VERSION, "9 failed: classifier_version missing.");
    assert(metadata.recomputed_by_task === RECOMPUTE_BY_TASK, "9 failed: recomputed_by_task missing.");

    const planned = buildPlannedRecomputeMutation({
      sourceObservationId: OLGA_SOURCE_OBSERVATION_ID,
      existingPayload: {
        unavailable_dates: ["2026-06-04"],
        latest_summary: "недоступна: 04.06",
      },
      existingMetadata: {},
      candidate: {
        signalType: "schedule_unavailability_window",
        confidence: "high",
        payload: {
          unavailable_dates: ["2026-06-04"],
          planned_training_dates: ["2026-06-05", "2026-06-07"],
          planning_status: "athlete_intends_to_train",
          latest_summary: "недоступна: 04.06; планирует: 05.06, 07.06",
        },
      },
    });
    assert(
      planned.some((line) => line.includes("metadata.recomputed_by_task")),
      "9 failed: planned update must include recomputed_by_task marker."
    );
  }

  // 10) Olga dry-run diff still shows planned dates diff
  {
    const diff = buildRecomputeDiff(
      {
        unavailable_dates: ["2026-06-04"],
        latest_summary: "недоступна: 04.06",
      },
      {
        unavailable_dates: ["2026-06-04"],
        planned_training_dates: ["2026-06-05", "2026-06-07"],
        planning_status: "athlete_intends_to_train",
        latest_summary: "недоступна: 04.06; планирует: 05.06, 07.06",
      }
    );
    assert(
      diff.some((line) => line.includes("planned_training_dates")),
      "10 failed: diff must include planned_training_dates change."
    );
    assert(
      diff.some((line) => line.includes("planning_status")),
      "10 failed: diff must include planning_status change."
    );
  }

  // 11) single active signal uses primary classifier output when types differ
  {
    const candidate = selectRecomputeCandidateForApply(1, "schedule_unavailability_window", [
      {
        signalType: "plan_generation_constraint",
        confidence: "high",
        payload: {
          unavailable_dates: ["2026-06-04"],
          planned_training_dates: ["2026-06-05", "2026-06-07"],
          planning_status: "athlete_intends_to_train",
        },
      },
    ]);
    assert(candidate?.signalType === "plan_generation_constraint", "11 failed: primary candidate must be selected.");
  }

  console.log(`${LOG_PREFIX} PASS`);
}

try {
  run();
} catch (error) {
  console.error(`${LOG_PREFIX} FAIL`);
  console.error((error as Error).message);
  process.exit(1);
}
