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
      reason: null,
      sourceObservationId: null,
      evidenceLower: "",
      risks: ["expired_but_active"],
    });
    assert(allow.allowed, "3 failed: expire with expired_but_active should be allowed.");

    const deny = evaluateApplyEligibility({
      action: "expire",
      signalType: "pause_training",
      reason: null,
      sourceObservationId: null,
      evidenceLower: "",
      risks: ["visible_in_tp_signals"],
    });
    assert(!deny.allowed, "3 failed: expire without expired_but_active must be rejected.");
  }

  // 4) hide allowed for move candidate only with active_move_without_action
  {
    const allow = evaluateApplyEligibility({
      action: "hide",
      signalType: "move_workout_candidate",
      reason: null,
      sourceObservationId: null,
      evidenceLower: "",
      risks: ["active_move_without_action"],
    });
    assert(allow.allowed, "4 failed: hide with active_move_without_action should be allowed.");

    const deny = evaluateApplyEligibility({
      action: "hide",
      signalType: "move_workout_candidate",
      reason: null,
      sourceObservationId: null,
      evidenceLower: "",
      risks: ["expired_but_active"],
    });
    assert(!deny.allowed, "4 failed: hide without active_move_without_action must be rejected.");
  }

  // 5) duplicate_candidate alone is not apply-allowed
  {
    const expire = evaluateApplyEligibility({
      action: "expire",
      signalType: "pause_training",
      reason: null,
      sourceObservationId: null,
      evidenceLower: "",
      risks: ["duplicate_candidate"],
    });
    const hide = evaluateApplyEligibility({
      action: "hide",
      signalType: "move_workout_candidate",
      reason: null,
      sourceObservationId: null,
      evidenceLower: "",
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
      reason: null,
      sourceObservationId: null,
      evidenceLower: "",
      risks: ["missing_valid_until"],
    });
    const hide = evaluateApplyEligibility({
      action: "hide",
      signalType,
      reason: null,
      sourceObservationId: null,
      evidenceLower: "",
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

  // 8b) --apply --action hide without required reason -> rejected
  {
    const parsed = parseCleanupCliOptions([
      "--signal-id",
      "34333333-3333-4333-8333-333333333333",
      "--action",
      "hide",
      "--apply",
      "--confirm",
      "CLEANUP OPERATIONAL SIGNALS",
    ]);
    const err = validateApplyPrerequisites(parsed);
    assert(
      err?.includes("--reason false_positive_pause"),
      "8b failed: hide apply without false_positive_pause reason must be rejected."
    );
  }

  // 9) pause_training + false_positive_pause + one-off logistics evidence + explicit source -> allowed
  {
    const allow = evaluateApplyEligibility({
      action: "hide",
      signalType: "pause_training",
      reason: "false_positive_pause",
      sourceObservationId: "44444444-4444-4444-8444-444444444444",
      evidenceLower: "я в пятницу не побегу, у нас мероприятие в посольстве",
      risks: ["visible_in_tp_signals", "reviewed_false_positive_pause_candidate"],
    });
    assert(allow.allowed, "9 failed: reviewed false-positive pause hide apply should be allowed.");
  }

  // 10) pause_training without reason -> rejected
  {
    const deny = evaluateApplyEligibility({
      action: "hide",
      signalType: "pause_training",
      reason: null,
      sourceObservationId: "55555555-5555-4555-8555-555555555555",
      evidenceLower: "завтра не могу, в пятницу не побегу",
      risks: ["visible_in_tp_signals"],
    });
    assert(!deny.allowed, "10 failed: pause_training hide without false_positive_pause reason must be rejected.");
  }

  // 10b) pause_training with wrong reason string -> rejected at CLI parsing
  {
    let rejected = false;
    try {
      parseCleanupCliOptions([
        "--signal-id",
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "--action",
        "hide",
        "--reason",
        "wrong_reason",
      ]);
    } catch {
      rejected = true;
    }
    assert(rejected, "10b failed: unknown --reason must be rejected.");
  }

  // 11) pause_training with health evidence -> rejected
  {
    const deny = evaluateApplyEligibility({
      action: "hide",
      signalType: "pause_training",
      reason: "false_positive_pause",
      sourceObservationId: "66666666-6666-4666-8666-666666666666",
      evidenceLower: "в пятницу не побегу, температура и кашель",
      risks: ["visible_in_tp_signals"],
    });
    assert(!deny.allowed, "11 failed: pause_training hide with health cues must be rejected.");
  }

  // 12) pause_training with multi-day evidence -> rejected
  {
    const deny = evaluateApplyEligibility({
      action: "hide",
      signalType: "pause_training",
      reason: "false_positive_pause",
      sourceObservationId: "77777777-7777-4777-8777-777777777777",
      evidenceLower: "на этой неделе не буду бегать, в пятницу не побегу",
      risks: ["visible_in_tp_signals"],
    });
    assert(!deny.allowed, "12 failed: pause_training hide with multi-day cues must be rejected.");
  }

  // 13) pause_training duplicate_candidate alone -> rejected
  {
    const deny = evaluateApplyEligibility({
      action: "hide",
      signalType: "pause_training",
      reason: "false_positive_pause",
      sourceObservationId: "88888888-8888-4888-8888-888888888888",
      evidenceLower: "дубликат",
      risks: ["duplicate_candidate"],
    });
    assert(!deny.allowed, "13 failed: pause_training duplicate_candidate alone must be rejected.");
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
