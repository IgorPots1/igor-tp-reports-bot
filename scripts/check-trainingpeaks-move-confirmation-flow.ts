import assert from "node:assert/strict";
import {
  isCoachConfirmedSourceDateManualExecuteReady,
  validateDryRunLogReadiness,
} from "@/features/trainingpeaks/move-source-policy";
import { evaluateDryRunOutcome } from "../tools/trainingpeaks-export/scripts/tp-actions-once";

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
    target: { kind: "date", value: "2026-06-01" },
    workoutDescriptor: { raw: "Длительный бег по темпу", type: "run", confidence: 0.79 },
  };
  const coachConfirmedPayload = {
    ...inferredPayload,
    coach_confirmed_source_date: "2026-05-31",
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
        dateIso: "2026-05-31",
        title: "Длительный бег по темпу",
        workoutId: 3764963076,
        rawScore: 0.79,
        fingerprint: "student-1:2026-05-31:tempo-long-run",
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
        dateIso: "2026-05-31",
        title: "Длительный бег по темпу",
        workoutId: 3764963076,
        rawScore: 0.79,
        fingerprint: "student-1:2026-05-31:tempo-long-run",
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
    resolvedDates: { sourceDate: null, targetDate: "2026-06-01" },
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

  console.log("PASS check-trainingpeaks-move-confirmation-flow");
}

run();
