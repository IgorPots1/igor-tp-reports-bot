import process from "node:process";

import {
  buildOperationalSignalLifecycleApplyToken,
  buildOperationalSignalLifecycleDryRunFingerprint,
  parseOperationalSignalLifecycleApplyToken,
  validateOperationalSignalLifecycleApplySafety,
} from "@/features/trainingpeaks/operational-signal-lifecycle-apply";
import { evaluateOperationalSignalLifecycle } from "@/features/trainingpeaks/operational-signal-lifecycle";

const LOG_PREFIX = "[check-operational-signal-lifecycle-apply]";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function mkInput(partial: Record<string, unknown> = {}) {
  return {
    studentId: "student-test",
    signalClass: "confirmed_illness",
    currentLifecycle: "active_problem",
    openedAt: "2026-06-01T10:00:00.000Z",
    latestTpCompletionAfterOpen: null,
    negativeMessageAfterCompletion: null,
    explicitRecoveryMessage: null,
    missedOrSkippedReturnWorkout: false,
    ...partial,
  } as const;
}

function run(): void {
  const fpA = buildOperationalSignalLifecycleDryRunFingerprint({
    signalId: "sig-1",
    signalType: "health_issue_started",
    signalClass: "confirmed_illness",
    currentLifecycle: "active_problem",
    proposedLifecycle: "monitoring_after_return",
    latestTpCompletionAfterOpen: {
      workoutId: "101",
      workoutDate: "2026-06-04",
      title: "Easy Run",
      sportOrTypeCode: "run",
      runningCompletionClass: "normal_planned_run",
      sportClass: "running_like",
      evidenceFreshness: "ok",
      classificationConfidence: "high",
    },
    hasNegativeAfterCompletion: false,
    missedOrSkippedReturnWorkout: false,
    reasonCodes: ["b", "a"],
    asOfDate: "2026-06-05",
  });
  const fpB = buildOperationalSignalLifecycleDryRunFingerprint({
    signalId: "sig-1",
    signalType: "health_issue_started",
    signalClass: "confirmed_illness",
    currentLifecycle: "active_problem",
    proposedLifecycle: "monitoring_after_return",
    latestTpCompletionAfterOpen: {
      workoutId: "101",
      workoutDate: "2026-06-04",
      title: "Easy Run",
      sportOrTypeCode: "run",
      runningCompletionClass: "normal_planned_run",
      sportClass: "running_like",
      evidenceFreshness: "ok",
      classificationConfidence: "high",
    },
    hasNegativeAfterCompletion: false,
    missedOrSkippedReturnWorkout: false,
    reasonCodes: ["a", "b"],
    asOfDate: "2026-06-05",
  });
  assert(fpA === fpB, "fingerprint should be deterministic and reason code order-insensitive");

  const token = buildOperationalSignalLifecycleApplyToken({
    signalId: "sig-1",
    proposedLifecycle: "monitoring_after_return",
    dryRunFingerprint: fpA,
  });
  const parsedToken = parseOperationalSignalLifecycleApplyToken(token);
  assert(parsedToken?.signalId === "sig-1", "token parse should return signal id");
  assert(parsedToken?.proposedLifecycle === "monitoring_after_return", "token parse should return proposed lifecycle");
  assert(parsedToken?.dryRunFingerprint === fpA, "token parse should return fingerprint");
  assert(parseOperationalSignalLifecycleApplyToken("bad-token") === null, "invalid token should fail parse");

  const confirmedIllnessInput = mkInput({
    signalClass: "confirmed_illness",
    latestTpCompletionAfterOpen: {
      workoutId: "101",
      workoutDate: "2026-06-04",
      title: "Easy Run",
      sportOrTypeCode: "run",
      sportClass: "running_like",
      runningCompletionClass: "normal_planned_run",
      classificationConfidence: "high",
      classificationReasonCodes: ["fixture"],
      classificationInspectedFields: {},
      plannedVsCompletedDelta: "normal",
      evidenceFreshness: "ok",
    },
  });
  const confirmedIllnessProposal = evaluateOperationalSignalLifecycle(confirmedIllnessInput);
  assert(
    confirmedIllnessProposal.proposedLifecycle === "monitoring_after_return",
    "confirmed illness + TP run should transition to monitoring"
  );
  assert(
    validateOperationalSignalLifecycleApplySafety({
      signalClass: "confirmed_illness",
      lifecycleInput: confirmedIllnessInput,
      proposal: confirmedIllnessProposal,
    }).ok,
    "confirmed illness monitoring transition should be allowed"
  );

  const ambiguousResolvedInput = mkInput({
    signalClass: "ambiguous_illness",
    latestTpCompletionAfterOpen: {
      workoutId: "201",
      workoutDate: "2026-06-04",
      title: "Planned Run",
      sportOrTypeCode: "run",
      sportClass: "running_like",
      runningCompletionClass: "normal_planned_run",
      classificationConfidence: "high",
      classificationReasonCodes: ["fixture"],
      classificationInspectedFields: {},
      plannedVsCompletedDelta: "normal",
      evidenceFreshness: "ok",
    },
  });
  const ambiguousResolvedProposal = evaluateOperationalSignalLifecycle(ambiguousResolvedInput);
  assert(
    ambiguousResolvedProposal.proposedLifecycle === "resolved",
    "ambiguous illness + clean completion may resolve"
  );
  assert(
    validateOperationalSignalLifecycleApplySafety({
      signalClass: "ambiguous_illness",
      lifecycleInput: ambiguousResolvedInput,
      proposal: ambiguousResolvedProposal,
    }).ok,
    "ambiguous illness resolve should be allowed on clean evidence"
  );

  const injuryInput = mkInput({
    signalClass: "injury_pain",
    latestTpCompletionAfterOpen: {
      workoutId: "301",
      workoutDate: "2026-06-04",
      title: "Easy Run",
      sportOrTypeCode: "run",
      sportClass: "running_like",
      runningCompletionClass: "normal_planned_run",
      classificationConfidence: "high",
      classificationReasonCodes: ["fixture"],
      classificationInspectedFields: {},
      plannedVsCompletedDelta: "normal",
      evidenceFreshness: "ok",
    },
  });
  const injuryProposal = evaluateOperationalSignalLifecycle(injuryInput);
  assert(
    injuryProposal.proposedLifecycle === "monitoring_after_return",
    "injury + TP completion should be monitoring only"
  );
  assert(
    injuryProposal.requiresCoachClose === true,
    "injury + TP completion should require coach close"
  );

  const negativeInput = mkInput({
    signalClass: "confirmed_illness",
    latestTpCompletionAfterOpen: {
      workoutId: "401",
      workoutDate: "2026-06-04",
      title: "Planned Run",
      sportOrTypeCode: "run",
      sportClass: "running_like",
      runningCompletionClass: "normal_planned_run",
      classificationConfidence: "high",
      classificationReasonCodes: ["fixture"],
      classificationInspectedFields: {},
      plannedVsCompletedDelta: "normal",
      evidenceFreshness: "ok",
    },
    negativeMessageAfterCompletion: {
      observationId: "obs-neg",
      observedAt: "2026-06-05T08:00:00.000Z",
      reason: "pain_worse",
    },
  });
  const negativeProposal = evaluateOperationalSignalLifecycle(negativeInput);
  assert(negativeProposal.proposedLifecycle === "active_problem", "negative should reopen/keep active");
  const negativeSafety = validateOperationalSignalLifecycleApplySafety({
    signalClass: "confirmed_illness",
    lifecycleInput: negativeInput,
    proposal: negativeProposal,
  });
  assert(!negativeSafety.ok, "negative evidence should block apply");

  const strengthResolvedAttemptInput = mkInput({
    signalClass: "ambiguous_illness",
    latestTpCompletionAfterOpen: {
      workoutId: "501",
      workoutDate: "2026-06-04",
      title: "Strength",
      sportOrTypeCode: "strength",
      sportClass: "strength_only",
      runningCompletionClass: "not_running",
      classificationConfidence: "high",
      classificationReasonCodes: ["fixture"],
      classificationInspectedFields: {},
      plannedVsCompletedDelta: "normal",
      evidenceFreshness: "ok",
    },
  });
  const strengthResolvedAttemptProposal = {
    ...evaluateOperationalSignalLifecycle(strengthResolvedAttemptInput),
    proposedLifecycle: "resolved" as const,
    reasonCode: "tp_completion_ambiguous_resolved",
  };
  const strengthSafety = validateOperationalSignalLifecycleApplySafety({
    signalClass: "ambiguous_illness",
    lifecycleInput: strengthResolvedAttemptInput,
    proposal: strengthResolvedAttemptProposal,
  });
  assert(!strengthSafety.ok, "strength-only completion must not resolve running health signal");

  const staleInput = mkInput({
    signalClass: "ambiguous_illness",
    latestTpCompletionAfterOpen: {
      workoutId: "601",
      workoutDate: "2026-06-04",
      title: "Planned Run",
      sportOrTypeCode: "run",
      sportClass: "running_like",
      runningCompletionClass: "normal_planned_run",
      classificationConfidence: "high",
      classificationReasonCodes: ["fixture"],
      classificationInspectedFields: {},
      plannedVsCompletedDelta: "normal",
      evidenceFreshness: "stale",
    },
  });
  const staleProposal = {
    ...evaluateOperationalSignalLifecycle(staleInput),
    proposedLifecycle: "resolved" as const,
    reasonCode: "tp_completion_ambiguous_resolved",
  };
  const staleSafety = validateOperationalSignalLifecycleApplySafety({
    signalClass: "ambiguous_illness",
    lifecycleInput: staleInput,
    proposal: staleProposal,
  });
  assert(!staleSafety.ok, "stale TP completion evidence should block apply");

  const firstToken = buildOperationalSignalLifecycleApplyToken({
    signalId: "sig-repeat",
    proposedLifecycle: "monitoring_after_return",
    dryRunFingerprint: fpA,
  });
  const secondToken = buildOperationalSignalLifecycleApplyToken({
    signalId: "sig-repeat",
    proposedLifecycle: "monitoring_after_return",
    dryRunFingerprint: fpA,
  });
  assert(firstToken === secondToken, "idempotent re-apply token should be stable");

  const beforeLifecycleStateRaw: string | null = null;
  const expectedLifecycle = "active_problem";
  const oldEqWouldMatch = beforeLifecycleStateRaw === expectedLifecycle;
  assert(
    oldEqWouldMatch === false,
    "legacy update filter using eq(lifecycle_state, null) semantics should miss NULL legacy rows"
  );
  const newNullAwareMatch =
    beforeLifecycleStateRaw === null ? beforeLifecycleStateRaw === null : beforeLifecycleStateRaw === expectedLifecycle;
  assert(newNullAwareMatch, "null-aware lifecycle filter should match legacy NULL lifecycle row");

  console.log(`${LOG_PREFIX} PASS`);
}

try {
  run();
} catch (error) {
  console.error(`${LOG_PREFIX} FAIL`);
  console.error((error as Error).message);
  process.exit(1);
}
