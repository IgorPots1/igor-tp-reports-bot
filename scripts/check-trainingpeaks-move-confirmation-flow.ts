import assert from "node:assert/strict";
import {
  isCoachConfirmedSourceDateManualExecuteReady,
  isCoachConfirmedSourceWorkoutManualExecuteReady,
  validateDryRunLogReadiness,
} from "@/features/trainingpeaks/move-source-policy";
import {
  evaluateDryRunOutcome,
  shouldBypassConfidenceThresholdForCoachConfirmedRevalidation,
} from "../tools/trainingpeaks-export/scripts/tp-actions-once";

// REQUIRES the tools/trainingpeaks-export sub-package to be installed: evaluateDryRunOutcome
// lives in the runner, which imports playwright. A bare root install makes this check die with
// ERR_MODULE_NOT_FOUND ('playwright') BEFORE any assertion — which looks like a red check but
// says nothing about the flow. In CI, install the sub-package or skip this one deliberately.
//
// Fixture dates are RELATIVE TO TODAY and must never be pinned to a calendar date.
// The runner hard-rejects a source date in the past (past_source_date_rejected) — a
// deliberate safety gate, and the right behaviour: a workout that already happened must
// never be moved. A pinned date silently rots into the past, and the whole flow then
// collapses into "source date could not be resolved safely", making this check fail for
// a reason that has nothing to do with the flow it guards.
//
// That is exactly what happened: the fixture pinned 2026-05-31, went red weeks later,
// and nobody noticed — the check was not registered in package.json and never ran.
function isoDayFromToday(offsetDays: number): string {
  const now = new Date();
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  day.setUTCDate(day.getUTCDate() + offsetDays);
  return day.toISOString().slice(0, 10);
}

// Scenario 1 — source resolved by DATE (inferred, then coach-confirmed).
const SOURCE_DATE = isoDayFromToday(3);
const TARGET_DATE = isoDayFromToday(4);
// Scenario 2 — source resolved by WORKOUT ID (coach-confirmed workout).
const WORKOUT_SOURCE_DATE = isoDayFromToday(10);
const WORKOUT_TARGET_DATE = isoDayFromToday(11);

type ParsedPayload = {
  parsingDiagnostics?: {
    autoApprovedForDryRun?: boolean;
  };
};

function isMoveActionAutoApprovedForDryRun(parsedPayload: unknown): boolean {
  if (!parsedPayload || typeof parsedPayload !== "object") {
    return false;
  }
  const payload = parsedPayload as ParsedPayload;
  return payload.parsingDiagnostics?.autoApprovedForDryRun === true;
}

function formatMoveCompletionStudentReply(formality: "ty" | "vy" | "unknown" | null | undefined): string {
  return formality === "ty" ? "Готово, проверяй." : "Готово, проверяйте.";
}

function buildIdentityCheck(): {
  telegramUsername: string | null;
  telegramChatId: string | null;
  expectedTrainingPeaksName: string | null;
  visibleTrainingPeaksName: string | null;
  expectedAthleteId: string | null;
  currentAthleteId: string | null;
  expectedTrainingPeaksUrl: string | null;
  currentUrl: string | null;
  matchedBy: "athlete_id";
  warnings: string[];
} {
  return {
    telegramUsername: null,
    telegramChatId: "123",
    expectedTrainingPeaksName: "Test Athlete",
    visibleTrainingPeaksName: "Test Athlete",
    expectedAthleteId: "42",
    currentAthleteId: "42",
    expectedTrainingPeaksUrl: "https://app.trainingpeaks.com/athlete/42",
    currentUrl: "https://app.trainingpeaks.com/athlete/42",
    matchedBy: "athlete_id",
    warnings: [],
  };
}

function buildCandidate(input: {
  dateIso: string;
  title: string;
  workoutId: number;
  rawScore: number;
  fingerprint: string;
}): {
  rawTextSnippet: string;
  selectorHint: string | null;
  classHint: string | null;
  title: string;
  type: "run";
  plannedDurationSec: number;
  plannedDistance: number | null;
  startTimeLocal: string;
  dateIso: string;
  workoutId: number;
  rawScore: number;
  reasons: string[];
  fromFallback: false;
  fingerprint: string;
} {
  return {
    rawTextSnippet: input.title,
    selectorHint: ".activities .MuiCard-root.activity.workout",
    classHint: "Run",
    title: input.title,
    type: "run",
    plannedDurationSec: 5400,
    plannedDistance: 16,
    startTimeLocal: "07:00",
    dateIso: input.dateIso,
    workoutId: input.workoutId,
    rawScore: input.rawScore,
    reasons: [],
    fromFallback: false,
    fingerprint: input.fingerprint,
  };
}

function run(): void {
  assert.equal(
    isMoveActionAutoApprovedForDryRun({
      parsingDiagnostics: {
        autoApprovedForDryRun: true,
      },
    }),
    true
  );
  assert.equal(isMoveActionAutoApprovedForDryRun({ parsingDiagnostics: {} }), false);
  assert.equal(isMoveActionAutoApprovedForDryRun(null), false);

  assert.equal(formatMoveCompletionStudentReply("ty"), "Готово, проверяй.");
  assert.equal(formatMoveCompletionStudentReply("vy"), "Готово, проверяйте.");
  assert.equal(formatMoveCompletionStudentReply("unknown"), "Готово, проверяйте.");
  assert.equal(formatMoveCompletionStudentReply(undefined), "Готово, проверяйте.");

  const inferredPayload = {
    actionType: "move_workout",
    target: { kind: "date", value: TARGET_DATE },
    workoutDescriptor: { raw: "Длительный бег по темпу", type: "run", confidence: 0.79 },
  };
  const coachConfirmedPayload = {
    ...inferredPayload,
    coach_confirmed_source_date: SOURCE_DATE,
    source_date_policy_override: "coach_confirmed_source_date",
  };
  const inferredEvaluation = evaluateDryRunOutcome({
    action: {
      id: "action-1",
      student_id: "student-1",
      action_type: "move_workout",
      status: "approved",
      raw_text: "перенеси длительный бег по темпу на завтра",
      parsed_payload: inferredPayload,
      coach_chat_id: "coach-chat",
      decided_by_chat_id: "coach-chat",
      execution_status: "dry_run_completed",
      execution_mode: "dry_run",
      claimed_by: null,
      claimed_at: null,
      last_run_id: "run-1",
      execution_requested_at: null,
    },
    student: {
      id: "student-1",
      student_id: "athlete-1",
      student_name: "Test Athlete",
      telegram_chat_id: "123",
      trainingpeaks_athlete_url: "https://app.trainingpeaks.com/athlete/42",
    },
    pageMeta: {
      loginRequired: false,
      athletePageLikelyReachable: true,
      trainingPeaksContextLikely: true,
    },
    candidates: [
      buildCandidate({
        dateIso: SOURCE_DATE,
        title: "Длительный бег по темпу",
        workoutId: 3764963076,
        rawScore: 0.79,
        fingerprint: `student-1:${SOURCE_DATE}:tempo-long-run`,
      }),
    ],
    extraction: {
      candidates: [],
      parseWarnings: [],
      extractionError: null,
      domDebug: {
        enabled: false,
        calendarRootClass: null,
        selectorCounts: {
          calendarRoots: 1,
          dayCells: 1,
          primaryWorkoutCards: 1,
          fallbackWorkoutDivCards: 0,
        },
        checkpoints: [],
        cardSnippets: [],
        extractionError: null,
      },
      dateAttributionDebug: {
        selectedStrategy: "day_cell_label",
        sourceDateVisibleInDayCellLabels: true,
        targetDateVisibleInDayCellLabels: true,
        cardsVisible: 1,
        cardsWithDateIso: 1,
        cardsWithoutDateIso: 0,
        rawDayCellSamples: [],
        cardSamplesBeforeFiltering: [],
      },
      readiness: {
        waitForCalendarRootAttempted: false,
        waitForCalendarRootTimedOut: false,
        waitForDayCellsAttempted: false,
        waitForDayCellsTimedOut: false,
        waitForWorkoutCardAttempted: false,
        waitForWorkoutCardTimedOut: false,
      },
    },
    identityCheck: buildIdentityCheck(),
  });
  assert.equal(inferredEvaluation.dryRunResult, "candidate_found");
  assert.equal(inferredEvaluation.canExecute, false);
  assert.deepEqual(inferredEvaluation.canExecuteReasons, [
    "confidence below threshold 0.8",
    "source date inferred; real execution blocked",
  ]);

  const coachConfirmedEvaluation = evaluateDryRunOutcome({
    action: {
      id: "action-1",
      student_id: "student-1",
      action_type: "move_workout",
      status: "approved",
      raw_text: "перенеси длительный бег по темпу на завтра",
      parsed_payload: coachConfirmedPayload,
      coach_chat_id: "coach-chat",
      decided_by_chat_id: "coach-chat",
      execution_status: "dry_run_completed",
      execution_mode: "dry_run",
      claimed_by: null,
      claimed_at: null,
      last_run_id: "run-2",
      execution_requested_at: null,
    },
    student: {
      id: "student-1",
      student_id: "athlete-1",
      student_name: "Test Athlete",
      telegram_chat_id: "123",
      trainingpeaks_athlete_url: "https://app.trainingpeaks.com/athlete/42",
    },
    pageMeta: {
      loginRequired: false,
      athletePageLikelyReachable: true,
      trainingPeaksContextLikely: true,
    },
    candidates: [
      buildCandidate({
        dateIso: SOURCE_DATE,
        title: "Длительный бег по темпу",
        workoutId: 3764963076,
        rawScore: 0.79,
        fingerprint: `student-1:${SOURCE_DATE}:tempo-long-run`,
      }),
    ],
    extraction: {
      candidates: [],
      parseWarnings: [],
      extractionError: null,
      domDebug: {
        enabled: false,
        calendarRootClass: null,
        selectorCounts: {
          calendarRoots: 1,
          dayCells: 1,
          primaryWorkoutCards: 1,
          fallbackWorkoutDivCards: 0,
        },
        checkpoints: [],
        cardSnippets: [],
        extractionError: null,
      },
      dateAttributionDebug: {
        selectedStrategy: "day_cell_label",
        sourceDateVisibleInDayCellLabels: true,
        targetDateVisibleInDayCellLabels: true,
        cardsVisible: 1,
        cardsWithDateIso: 1,
        cardsWithoutDateIso: 0,
        rawDayCellSamples: [],
        cardSamplesBeforeFiltering: [],
      },
      readiness: {
        waitForCalendarRootAttempted: false,
        waitForCalendarRootTimedOut: false,
        waitForDayCellsAttempted: false,
        waitForDayCellsTimedOut: false,
        waitForWorkoutCardAttempted: false,
        waitForWorkoutCardTimedOut: false,
      },
    },
    identityCheck: buildIdentityCheck(),
  });
  assert.equal(coachConfirmedEvaluation.selectedSourceDatePolicy, "coach_confirmed_source_date");
  assert.equal(coachConfirmedEvaluation.dryRunResult, "candidate_found");
  assert.equal(coachConfirmedEvaluation.canExecute, true);
  assert.deepEqual(coachConfirmedEvaluation.canExecuteReasons, []);

  const coachConfirmedLog = {
    dryRunResult: coachConfirmedEvaluation.dryRunResult,
    canExecute: coachConfirmedEvaluation.canExecute,
    canExecuteReasons: coachConfirmedEvaluation.canExecuteReasons,
    confidence: coachConfirmedEvaluation.confidence,
    candidate: coachConfirmedEvaluation.candidate,
    resolvedDates: coachConfirmedEvaluation.resolvedDates,
    identityCheck: coachConfirmedEvaluation.identityCheck,
    selectedSourceDatePolicy: coachConfirmedEvaluation.selectedSourceDatePolicy,
    selectedSourceDate: coachConfirmedEvaluation.selectedSourceDate,
    candidateAlternativesCount: coachConfirmedEvaluation.candidateAlternativesCount,
  };
  assert.equal(
    isCoachConfirmedSourceDateManualExecuteReady(coachConfirmedLog, coachConfirmedPayload),
    true
  );
  assert.equal(validateDryRunLogReadiness(coachConfirmedLog, coachConfirmedPayload).ok, true);

  const noCandidateLog = {
    dryRunResult: "not_found",
    canExecute: false,
    canExecuteReasons: ["Карточки тренировок не найдены в календаре"],
    confidence: 0.2,
    candidate: null,
    resolvedDates: { sourceDate: null, targetDate: TARGET_DATE },
    identityCheck: buildIdentityCheck(),
    selectedSourceDatePolicy: "coach_confirmed_source_date",
    selectedSourceDate: null,
    candidateAlternativesCount: 0,
  };
  assert.equal(
    isCoachConfirmedSourceDateManualExecuteReady(noCandidateLog, coachConfirmedPayload),
    false
  );
  assert.equal(validateDryRunLogReadiness(noCandidateLog, coachConfirmedPayload).ok, false);

  const coachConfirmedWorkoutPayload = {
    actionType: "move_workout",
    source: { kind: "date", value: WORKOUT_SOURCE_DATE },
    target: { kind: "date", value: WORKOUT_TARGET_DATE },
    sourceDate: WORKOUT_SOURCE_DATE,
    coach_confirmed_source_workout_id: 3777415862,
  };
  const coachConfirmedWorkoutLog = {
    dryRunResult: "candidate_found",
    canExecute: true,
    canExecuteReasons: [],
    confidence: 0.65,
    candidate: {
      title: "5 х 7 мин (на улице)",
      type: "run",
      workoutId: 3777415862,
      fingerprint: `student-1:${WORKOUT_SOURCE_DATE}:interval-outdoor`,
    },
    resolvedDates: { sourceDate: WORKOUT_SOURCE_DATE, targetDate: WORKOUT_TARGET_DATE },
    identityCheck: buildIdentityCheck(),
    selectedSourceDatePolicy: "explicit_source_date",
    selectedSourceDate: WORKOUT_SOURCE_DATE,
    candidateAlternativesCount: 0,
  };
  assert.equal(
    isCoachConfirmedSourceWorkoutManualExecuteReady(coachConfirmedWorkoutLog, coachConfirmedWorkoutPayload),
    true
  );
  assert.equal(
    validateDryRunLogReadiness(coachConfirmedWorkoutLog, coachConfirmedWorkoutPayload).ok,
    true,
    "runner-approved canExecute=true dry-run must queue even when confidence is below threshold"
  );

  const coachConfirmedBypassAllowed = shouldBypassConfidenceThresholdForCoachConfirmedRevalidation({
    parsedPayload: coachConfirmedPayload,
    trustedSelectedSourceDatePolicy: "coach_confirmed_source_date",
    currentSelectedSourceDatePolicy: "coach_confirmed_source_date",
    trustedSourceDate: SOURCE_DATE,
    trustedTargetDate: TARGET_DATE,
    currentSourceDate: SOURCE_DATE,
    currentTargetDate: TARGET_DATE,
    actionStatus: "approved",
    actionExecutionStatus: "running_local",
  });
  assert.equal(
    coachConfirmedBypassAllowed,
    true,
    "coach-confirmed source date should allow confidence bypass in real-mode revalidation"
  );

  const inferredBypassBlocked = shouldBypassConfidenceThresholdForCoachConfirmedRevalidation({
    parsedPayload: inferredPayload,
    trustedSelectedSourceDatePolicy: "nearest_prior_within_3_days",
    currentSelectedSourceDatePolicy: "nearest_prior_within_3_days",
    trustedSourceDate: SOURCE_DATE,
    trustedTargetDate: TARGET_DATE,
    currentSourceDate: SOURCE_DATE,
    currentTargetDate: TARGET_DATE,
    actionStatus: "approved",
    actionExecutionStatus: "running_local",
  });
  assert.equal(
    inferredBypassBlocked,
    false,
    "inferred source moves without coach confirmation must remain confidence-gated"
  );

  console.log("PASS check-trainingpeaks-move-confirmation-flow");
}

run();
