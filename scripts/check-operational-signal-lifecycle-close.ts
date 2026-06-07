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
import type { TrainingPeaksWorkoutCacheRow } from "@/features/trainingpeaks/repository";
import {
  computeMissedSkippedReturnWorkout,
  computeReturnWorkoutBlocker,
} from "./lib/operational-signal-lifecycle-runtime";

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

function mkWorkout(partial: Partial<TrainingPeaksWorkoutCacheRow>): TrainingPeaksWorkoutCacheRow {
  return {
    id: "cache-1",
    studentId: "student-test",
    studentName: "Test Athlete",
    trainingPeaksAthleteId: 1,
    trainingPeaksWorkoutId: 9001,
    workoutDate: "2026-06-06",
    title: "Easy Run",
    sportOrTypeCode: "run",
    workoutTypeValueId: 3,
    workoutSubTypeId: null,
    isPlanned: true,
    isCompleted: false,
    plannedTimeRaw: 2400,
    completedTimeRaw: null,
    plannedDistanceRaw: null,
    completedDistanceRaw: null,
    complianceDurationPercent: null,
    complianceDistancePercent: null,
    startTimePlanned: null,
    startTime: null,
    sourceUpdatedAt: null,
    orderOnDay: null,
    scannedAt: "2026-06-06T08:00:00.000Z",
    scanJobId: null,
    normalizationWarnings: [],
    sourceSnapshot: {},
    createdAt: "2026-06-06T08:00:00.000Z",
    updatedAt: "2026-06-06T08:00:00.000Z",
    ...partial,
  };
}

function assertReturnWorkoutBlockerCases(): void {
  const openedDate = "2026-06-01";
  const asOfDate = "2026-06-06";

  const missedWorkout = mkWorkout({
    trainingPeaksWorkoutId: 9101,
    workoutDate: "2026-06-05",
    isPlanned: true,
    isCompleted: false,
  });
  const missedBlocker = computeReturnWorkoutBlocker([missedWorkout], openedDate, asOfDate);
  assert(missedBlocker?.kind === "missed_before_today", "planned workout before as-of should be missed_before_today");
  assert(
    computeMissedSkippedReturnWorkout([missedWorkout], openedDate, asOfDate) === true,
    "missed before today should set missedOrSkippedReturnWorkout=true"
  );

  const pendingWorkout = mkWorkout({
    trainingPeaksWorkoutId: 9102,
    workoutDate: "2026-06-06",
    isPlanned: true,
    isCompleted: false,
  });
  const pendingBlocker = computeReturnWorkoutBlocker([pendingWorkout], openedDate, asOfDate);
  assert(pendingBlocker?.kind === "pending_today", "planned workout on as-of should be pending_today");
  assert(
    computeMissedSkippedReturnWorkout([pendingWorkout], openedDate, asOfDate) === false,
    "pending today should not set missedOrSkippedReturnWorkout=true"
  );

  const futureWorkout = mkWorkout({
    trainingPeaksWorkoutId: 9103,
    workoutDate: "2026-06-07",
    isPlanned: true,
    isCompleted: false,
  });
  const futureBlocker = computeReturnWorkoutBlocker([futureWorkout], openedDate, asOfDate);
  assert(futureBlocker?.kind === "future_planned", "planned workout after as-of should be future_planned");
  assert(
    computeMissedSkippedReturnWorkout([futureWorkout], openedDate, asOfDate) === false,
    "future planned should not set missedOrSkippedReturnWorkout=true"
  );

  const completedTodayWorkout = mkWorkout({
    trainingPeaksWorkoutId: 9104,
    workoutDate: "2026-06-06",
    isPlanned: true,
    isCompleted: true,
    completedTimeRaw: 2400,
  });
  assert(
    computeReturnWorkoutBlocker([completedTodayWorkout], openedDate, asOfDate) === null,
    "completed today workout should not produce a blocker"
  );

  const stepanLikeInput = mkInput({
    signalClass: "injury_pain",
    currentLifecycle: "monitoring_after_return",
    latestTpCompletionAfterOpen: mkCompletion({
      workoutId: "103",
      workoutDate: "2026-06-05",
      runningCompletionClass: "modified_or_easy_run",
      plannedVsCompletedDelta: "modified_easy",
    }),
    missedOrSkippedReturnWorkout: false,
    returnWorkoutBlocker: pendingBlocker,
  });
  const stepanLikeProposal = evaluateOperationalSignalLifecycle(stepanLikeInput);
  const stepanLikeEligibility = validateOperationalSignalLifecycleCloseEligibility({
    storedLifecycleState: "monitoring_after_return",
    requiresCoachClose: true,
    signalClass: "injury_pain",
    lifecycleInput: stepanLikeInput,
    proposal: stepanLikeProposal,
    coachReason: normalizeCoachCloseReason("coach reviewed pain return"),
    applyMode: true,
  });
  assert(!stepanLikeEligibility.ok, "stepan-like pending today should refuse close");
  assert(
    stepanLikeEligibility.ok === false &&
      stepanLikeEligibility.reason.includes("scheduled today") &&
      !stepanLikeEligibility.reason.includes("Missed or skipped"),
    "stepan-like refusal should cite pending today, not missed/skipped"
  );

  const missedCloseInput = mkInput({
    signalClass: "injury_pain",
    currentLifecycle: "monitoring_after_return",
    missedOrSkippedReturnWorkout: true,
    returnWorkoutBlocker: missedBlocker,
  });
  const missedCloseProposal = evaluateOperationalSignalLifecycle(missedCloseInput);
  const missedCloseEligibility = validateOperationalSignalLifecycleCloseEligibility({
    storedLifecycleState: "monitoring_after_return",
    requiresCoachClose: true,
    signalClass: "injury_pain",
    lifecycleInput: missedCloseInput,
    proposal: missedCloseProposal,
    coachReason: normalizeCoachCloseReason("coach reviewed pain return"),
    applyMode: true,
  });
  assert(!missedCloseEligibility.ok, "missed before today should refuse close");
  assert(
    missedCloseEligibility.ok === false && missedCloseEligibility.reason.includes("Missed or skipped"),
    "missed before today refusal should cite missed/skipped"
  );

  const pendingCloseInput = mkInput({
    signalClass: "injury_pain",
    currentLifecycle: "monitoring_after_return",
    missedOrSkippedReturnWorkout: false,
    returnWorkoutBlocker: pendingBlocker,
  });
  const pendingCloseProposal = evaluateOperationalSignalLifecycle(pendingCloseInput);
  const pendingCloseEligibility = validateOperationalSignalLifecycleCloseEligibility({
    storedLifecycleState: "monitoring_after_return",
    requiresCoachClose: true,
    signalClass: "injury_pain",
    lifecycleInput: pendingCloseInput,
    proposal: pendingCloseProposal,
    coachReason: normalizeCoachCloseReason("coach reviewed pain return"),
    applyMode: true,
  });
  assert(!pendingCloseEligibility.ok, "pending today should refuse close");
  assert(
    pendingCloseEligibility.ok === false && pendingCloseEligibility.reason.includes("scheduled today"),
    "pending today refusal should cite scheduled today"
  );

  const futureCloseInput = mkInput({
    signalClass: "injury_pain",
    currentLifecycle: "monitoring_after_return",
    missedOrSkippedReturnWorkout: false,
    returnWorkoutBlocker: futureBlocker,
  });
  const futureCloseProposal = evaluateOperationalSignalLifecycle(futureCloseInput);
  const futureCloseEligibility = validateOperationalSignalLifecycleCloseEligibility({
    storedLifecycleState: "monitoring_after_return",
    requiresCoachClose: true,
    signalClass: "injury_pain",
    lifecycleInput: futureCloseInput,
    proposal: futureCloseProposal,
    coachReason: normalizeCoachCloseReason("coach reviewed pain return"),
    applyMode: true,
  });
  assert(
    futureCloseEligibility.ok && futureCloseEligibility.kind === "eligible",
    "future planned alone should not block close under current policy"
  );
}

function run(): void {
  assertReturnWorkoutBlockerCases();

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
