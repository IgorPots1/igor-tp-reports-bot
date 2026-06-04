import process from "node:process";

import { buildRecomputeDiff, parseRecomputeCliOptions } from "./recompute-trainingpeaks-operational-signal";

const LOG_PREFIX = "[check-trainingpeaks-operational-signal-recompute]";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function run(): void {
  // 1) source observation id required
  {
    let rejected = false;
    try {
      parseRecomputeCliOptions(["--dry-run"]);
    } catch {
      rejected = true;
    }
    assert(rejected, "1 failed: missing --source-observation-id must be rejected.");
  }

  // 2) --apply is rejected (dry-run only)
  {
    let rejected = false;
    try {
      parseRecomputeCliOptions([
        "--source-observation-id",
        "44ac8a84-60fc-448b-9a34-71da7a90461b",
        "--apply",
      ]);
    } catch {
      rejected = true;
    }
    assert(rejected, "2 failed: --apply must be rejected.");
  }

  // 3) diff detects planned_training_dates and planning_status additions
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
      "3 failed: diff must include planned_training_dates change."
    );
    assert(
      diff.some((line) => line.includes("planning_status")),
      "3 failed: diff must include planning_status change."
    );
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
