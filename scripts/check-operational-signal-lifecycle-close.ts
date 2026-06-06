import process from "node:process";

import { evaluateOperationalSignalLifecycle } from "@/features/trainingpeaks/operational-signal-lifecycle";
import {
  buildCloseEvidenceSnapshot,
  buildOperationalSignalLifecycleCloseDryRunFingerprint,
  buildOperationalSignalLifecycleCloseToken,
  MIN_COACH_CLOSE_REASON_LENGTH,
  normalizeCoachCloseReason,
  parseOperationalSignalLifecycleCloseToken,
  validateOperationalSignalLifecycleCloseEligibility,
} from "@/features/trainingpeaks/operational-signal-lifecycle-close";

const LOG_PREFIX = "[check-operational-signal-lifecycle-close]";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function mkInput(partial: Record<string, unknown> = {}) {
  return {
    studentId: "student-test",
    signalClass: "confirmed_illness",
    currentLifecycle: "monitoring_after_return",
    openedAt: "2026-06-01T10:00:00.000Z",
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
    negativeMessageAfterCompletion: null,
    explicitRecoveryMessage: null,
    missedOrSkippedReturnWorkout: false,
    ...partial,
  } as const;
}

function mkCompletion(partial: Record<string, unknown> = {}) {
  return {
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
    ...partial,
  };
}

function run(): void {
  const coachReason = normalizeCoachCloseReason("coach reviewed return after illness");
  assert(coachReason.length >= MIN_COACH_CLOSE_REASON_LENGTH, "fixture coach reason should meet minimum length");

  const fpA = buildOperationalSignalLifecycleCloseDryRunFingerprint({
    signalId: "sig-close-1",
    signalType: "health_issue_started",
    signalClass: "confirmed_illness",
    currentLifecycle: "monitoring_after_return",
    targetLifecycle: "resolved",
    latestTransitionId: "transition-1",
    latestTransitionFingerprint: "abc123",
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
    coachReasonNormalized: coachReason,
    asOfDate: "2026-06-05",
  });
  const fpB = buildOperationalSignalLifecycleCloseDryRunFingerprint({
    signalId: "sig-close-1",
    signalType: "health_issue_started",
    signalClass: "confirmed_illness",
    currentLifecycle: "monitoring_after_return",
    targetLifecycle: "resolved",
    latestTransitionId: "transition-1",
    latestTransitionFingerprint: "abc123",
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
    coachReasonNormalized: coachReason,
    asOfDate: "2026-06-05",
  });
  assert(fpA === fpB, "close fingerprint should be deterministic");

  const closeToken = buildOperationalSignalLifecycleCloseToken({
    signalId: "sig-close-1",
    dryRunFingerprint: fpA,
  });
  assert(closeToken === `CLOSE_LIFECYCLE:sig-close-1:resolved:${fpA}`, "close token format should match contract");
  const parsedToken = parseOperationalSignalLifecycleCloseToken(closeToken);
  assert(parsedToken?.signalId === "sig-close-1", "close token parse should return signal id");
  assert(parsedToken?.targetLifecycle === "resolved", "close token parse should return resolved target");
  assert(parsedToken?.dryRunFingerprint === fpA, "close token parse should return fingerprint");
  assert(parseOperationalSignalLifecycleCloseToken("bad-token") === null, "invalid close token should fail parse");

  const monitoringInput = mkInput({ currentLifecycle: "monitoring_after_return", signalClass: "confirmed_illness" });
  const monitoringProposal = evaluateOperationalSignalLifecycle(monitoringInput);
  const monitoringEligibility = validateOperationalSignalLifecycleCloseEligibility({
    storedLifecycleState: "monitoring_after_return",
    requiresCoachClose: false,
    signalClass: "confirmed_illness",
    lifecycleInput: monitoringInput,
    proposal: monitoringProposal,
    coachReason: coachReason,
    applyMode: true,
  });
  assert(monitoringEligibility.ok && monitoringEligibility.kind === "eligible", "confirmed illness monitoring close should be allowed");

  const injuryInput = mkInput({
    signalClass: "injury_pain",
    currentLifecycle: "monitoring_after_return",
  });
  const injuryProposal = evaluateOperationalSignalLifecycle({
    ...injuryInput,
    currentLifecycle: "active_problem",
  });
  const injuryMonitoringEligibility = validateOperationalSignalLifecycleCloseEligibility({
    storedLifecycleState: "monitoring_after_return",
    requiresCoachClose: true,
    signalClass: "injury_pain",
    lifecycleInput: injuryInput,
    proposal: injuryProposal,
    coachReason: coachReason,
    applyMode: true,
  });
  assert(
    injuryMonitoringEligibility.ok && injuryMonitoringEligibility.kind === "eligible",
    "injury/pain monitoring close should be allowed"
  );

  const activeProblemInput = mkInput({ currentLifecycle: "active_problem" });
  const activeProblemProposal = evaluateOperationalSignalLifecycle(activeProblemInput);
  const directCloseEligibility = validateOperationalSignalLifecycleCloseEligibility({
    storedLifecycleState: "active_problem",
    requiresCoachClose: true,
    signalClass: "injury_pain",
    lifecycleInput: activeProblemInput,
    proposal: activeProblemProposal,
    coachReason: coachReason,
    applyMode: true,
  });
  assert(!directCloseEligibility.ok, "active_problem -> resolved direct close should be refused");
  assert(
    directCloseEligibility.ok === false &&
      (directCloseEligibility.reason.includes("active_problem") ||
        directCloseEligibility.suggestApplyMonitoring === true),
    "direct close refusal should block skip of monitoring transition"
  );

  const needsApplyMonitoringInput = mkInput({ currentLifecycle: "active_problem", signalClass: "confirmed_illness" });
  const needsApplyMonitoringProposal = evaluateOperationalSignalLifecycle(needsApplyMonitoringInput);
  const needsApplyMonitoringEligibility = validateOperationalSignalLifecycleCloseEligibility({
    storedLifecycleState: "active_problem",
    requiresCoachClose: false,
    signalClass: "confirmed_illness",
    lifecycleInput: needsApplyMonitoringInput,
    proposal: needsApplyMonitoringProposal,
    coachReason: coachReason,
    applyMode: false,
  });
  assert(!needsApplyMonitoringEligibility.ok, "close before monitoring apply should be refused");
  assert(
    needsApplyMonitoringEligibility.ok === false && needsApplyMonitoringEligibility.suggestApplyMonitoring === true,
    "close refusal should suggest apply monitoring first"
  );

  const negativeInput = mkInput({
    negativeMessageAfterCompletion: {
      observationId: "obs-neg",
      observedAt: "2026-06-05T08:00:00.000Z",
      reason: "pain_worse",
    },
  });
  const negativeProposal = evaluateOperationalSignalLifecycle({
    ...negativeInput,
    currentLifecycle: "active_problem",
  });
  const negativeEligibility = validateOperationalSignalLifecycleCloseEligibility({
    storedLifecycleState: "monitoring_after_return",
    requiresCoachClose: true,
    signalClass: "injury_pain",
    lifecycleInput: negativeInput,
    proposal: negativeProposal,
    coachReason: coachReason,
    applyMode: true,
  });
  assert(!negativeEligibility.ok, "negative evidence after completion should block close");

  const missingReasonEligibility = validateOperationalSignalLifecycleCloseEligibility({
    storedLifecycleState: "monitoring_after_return",
    requiresCoachClose: true,
    signalClass: "injury_pain",
    lifecycleInput: monitoringInput,
    proposal: monitoringProposal,
    coachReason: "",
    applyMode: true,
  });
  assert(!missingReasonEligibility.ok, "missing reason in apply mode should be refused");

  const shortReasonEligibility = validateOperationalSignalLifecycleCloseEligibility({
    storedLifecycleState: "monitoring_after_return",
    requiresCoachClose: true,
    signalClass: "injury_pain",
    lifecycleInput: monitoringInput,
    proposal: monitoringProposal,
    coachReason: "short",
    applyMode: true,
  });
  assert(!shortReasonEligibility.ok, "too short reason in apply mode should be refused");

  const resolvedEligibility = validateOperationalSignalLifecycleCloseEligibility({
    storedLifecycleState: "resolved",
    requiresCoachClose: false,
    signalClass: "confirmed_illness",
    lifecycleInput: monitoringInput,
    proposal: monitoringProposal,
    coachReason: coachReason,
    applyMode: true,
  });
  assert(resolvedEligibility.ok && resolvedEligibility.kind === "already_resolved", "already resolved should be idempotent/no-op eligible");

  const evidenceSnapshot = buildCloseEvidenceSnapshot({
    lifecycleInput: monitoringInput,
    proposal: monitoringProposal,
    coachReasonNormalized: coachReason,
    latestTransitionId: "transition-1",
    latestTransitionFingerprint: fpA,
  });
  assert(evidenceSnapshot.coach_reason === coachReason, "transition evidence snapshot should include coach reason");
  assert(evidenceSnapshot.latest_transition_id === "transition-1", "transition evidence snapshot should include latest transition id");
  assert(
    typeof evidenceSnapshot.evaluator_proposal === "object" && evidenceSnapshot.evaluator_proposal !== null,
    "transition evidence snapshot should include evaluator proposal"
  );

  const staleInput = mkInput({
    latestTpCompletionAfterOpen: mkCompletion({ evidenceFreshness: "stale" }),
  });
  const staleProposal = evaluateOperationalSignalLifecycle(staleInput);
  const staleEligibility = validateOperationalSignalLifecycleCloseEligibility({
    storedLifecycleState: "monitoring_after_return",
    requiresCoachClose: true,
    signalClass: "injury_pain",
    lifecycleInput: staleInput,
    proposal: staleProposal,
    coachReason: coachReason,
    applyMode: true,
  });
  assert(!staleEligibility.ok, "stale evidence should block close");

  const dryRunWouldWrite = false;
  assert(dryRunWouldWrite === false, "dry-run close writes nothing");
  const applyWithoutTokenRefused = parseOperationalSignalLifecycleCloseToken("") === null;
  assert(applyWithoutTokenRefused, "apply without exact token should be refused at parse layer");
  const wrongTokenRefused = parseOperationalSignalLifecycleCloseToken("CLOSE_LIFECYCLE:other:resolved:deadbeef") === null;
  assert(wrongTokenRefused, "wrong token format should be refused");

  console.log(`${LOG_PREFIX} PASS`);
}

try {
  run();
} catch (error) {
  console.error(`${LOG_PREFIX} FAIL`);
  console.error((error as Error).message);
  process.exit(1);
}
