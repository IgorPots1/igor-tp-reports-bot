import process from "node:process";

import {
  evaluateApplyEligibility,
  parseCleanupCliOptions,
  validateApplyPrerequisites,
} from "./cleanup-trainingpeaks-operational-signals";
import type { TrainingPeaksOperationalSignalType } from "@/features/trainingpeaks/repository";

const LOG_PREFIX = "[check-trainingpeaks-operational-signals-cleanup]";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function run(): void {
  // 1) apply without confirm -> rejected
  {
    const parsed = parseCleanupCliOptions([
      "--signal-id",
      "11111111-1111-4111-8111-111111111111",
      "--action",
      "expire",
      "--apply",
    ]);
    const err = validateApplyPrerequisites(parsed);
    assert(
      err?.includes("--confirm"),
      "1 failed: apply without exact confirmation must be rejected."
    );
  }

  // 2) apply without explicit IDs -> rejected
  {
    let rejected = false;
    try {
      parseCleanupCliOptions(["--action", "expire", "--apply", "--confirm", "CLEANUP OPERATIONAL SIGNALS"]);
    } catch {
      rejected = true;
    }
    assert(rejected, "2 failed: apply without explicit --signal-id must be rejected.");
  }

  // 3) expire allowed only for expired_but_active
  {
    const allow = evaluateApplyEligibility({
      action: "expire",
      signalType: "pause_training",
      risks: ["expired_but_active"],
    });
    assert(allow.allowed, "3 failed: expire with expired_but_active should be allowed.");

    const deny = evaluateApplyEligibility({
      action: "expire",
      signalType: "pause_training",
      risks: ["visible_in_tp_signals"],
    });
    assert(!deny.allowed, "3 failed: expire without expired_but_active must be rejected.");
  }

  // 4) hide allowed only for active_move_without_action
  {
    const allow = evaluateApplyEligibility({
      action: "hide",
      signalType: "move_workout_candidate",
      risks: ["active_move_without_action"],
    });
    assert(allow.allowed, "4 failed: hide with active_move_without_action should be allowed.");

    const deny = evaluateApplyEligibility({
      action: "hide",
      signalType: "move_workout_candidate",
      risks: ["expired_but_active"],
    });
    assert(!deny.allowed, "4 failed: hide without active_move_without_action must be rejected.");
  }

  // 5) duplicate_candidate alone is not apply-allowed
  {
    const expire = evaluateApplyEligibility({
      action: "expire",
      signalType: "pause_training",
      risks: ["duplicate_candidate"],
    });
    const hide = evaluateApplyEligibility({
      action: "hide",
      signalType: "move_workout_candidate",
      risks: ["duplicate_candidate"],
    });
    assert(!expire.allowed && !hide.allowed, "5 failed: duplicate_candidate alone must not be apply-allowed.");
  }

  // 6) health missing_valid_until alone is not apply-allowed
  {
    const signalType: TrainingPeaksOperationalSignalType = "health_issue_started";
    const expire = evaluateApplyEligibility({
      action: "expire",
      signalType,
      risks: ["missing_valid_until"],
    });
    const hide = evaluateApplyEligibility({
      action: "hide",
      signalType,
      risks: ["missing_valid_until"],
    });
    assert(
      !expire.allowed && !hide.allowed,
      "6 failed: health missing_valid_until alone must not be apply-allowed."
    );
  }

  // 7) dry-run with manual_review is allowed
  {
    const parsed = parseCleanupCliOptions([
      "--signal-id",
      "22222222-2222-4222-8222-222222222222",
      "--action",
      "review-only",
    ]);
    const err = validateApplyPrerequisites(parsed);
    assert(err === null, "7 failed: dry-run review-only should be allowed.");
  }

  // 8) --apply unknown action rejected
  {
    let rejected = false;
    try {
      parseCleanupCliOptions([
        "--signal-id",
        "33333333-3333-4333-8333-333333333333",
        "--action",
        "delete",
        "--apply",
      ]);
    } catch {
      rejected = true;
    }
    assert(rejected, "8 failed: unknown action must be rejected.");
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
