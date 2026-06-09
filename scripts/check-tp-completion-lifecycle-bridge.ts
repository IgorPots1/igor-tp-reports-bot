import process from "node:process";

import type { OperationalSignalLifecycleInput } from "@/features/trainingpeaks/operational-signal-lifecycle";
import { evaluateOperationalSignalLifecycle } from "@/features/trainingpeaks/operational-signal-lifecycle";
import {
  detectPendingTpCache,
  detectPossibleMisclassifiedRun,
  isCleanRunningCompletion,
  resolveBridgeRecommendedAction,
  type BridgeRecommendedAction,
} from "@/features/trainingpeaks/tp-completion-lifecycle-bridge";

const LOG_PREFIX = "[check-tp-completion-lifecycle-bridge]";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function mkCompletion(
  partial: Partial<NonNullable<OperationalSignalLifecycleInput["latestTpCompletionAfterOpen"]>>
): NonNullable<OperationalSignalLifecycleInput["latestTpCompletionAfterOpen"]> {
  return {
    workoutId: "w-1",
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

function mkInput(partial: Partial<OperationalSignalLifecycleInput>): OperationalSignalLifecycleInput {
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
  };
}

type BridgeFixture = {
  name: string;
  input: BridgeDiagnosticInputLike;
  expectedAction: BridgeRecommendedAction;
  expectedReasonIncludes?: string;
};

type BridgeDiagnosticInputLike = {
  signalId: string;
  signalType: string;
  signalClass: OperationalSignalLifecycleInput["signalClass"];
  currentLifecycle: OperationalSignalLifecycleInput["currentLifecycle"];
  lifecycleInput: OperationalSignalLifecycleInput;
  proposal: ReturnType<typeof evaluateOperationalSignalLifecycle>;
  asOfDate: string;
  duplicateClusterSize?: number;
  cleanRunningCompletionCount?: number;
};

function run(): void {
  assert(
    detectPossibleMisclassifiedRun({
      title: "Легкий бег 30 мин",
      sportClass: "cross_training_or_other",
      runningCompletionClass: "not_running",
      classificationConfidence: "high",
    }),
    "cross-training class with running title should be flagged"
  );
  assert(
    !detectPossibleMisclassifiedRun({
      title: "Bike endurance",
      sportClass: "cross_training_or_other",
      runningCompletionClass: "not_running",
      classificationConfidence: "high",
    }),
    "true cross-training title should not be flagged"
  );
  assert(
    detectPossibleMisclassifiedRun({
      title: "Длительный вел по мощности",
      sportClass: "running_like",
      runningCompletionClass: "uncertain_running_completion",
      classificationConfidence: "high",
    }),
    "bike title classified as running should be flagged"
  );
  assert(
    !detectPossibleMisclassifiedRun({
      title: "Длительный вел по мощности",
      sportClass: "cross_training_or_other",
      runningCompletionClass: "not_running",
      classificationConfidence: "high",
    }),
    "bike title correctly classified as cross-training should not be flagged"
  );
  assert(
    isCleanRunningCompletion({
      sportClass: "running_like",
      runningCompletionClass: "normal_planned_run",
      classificationConfidence: "high",
    }),
    "normal planned run should count as clean"
  );
  assert(
    !isCleanRunningCompletion({
      sportClass: "running_like",
      runningCompletionClass: "uncertain_running_completion",
      classificationConfidence: "low",
    }),
    "uncertain completion should not count as clean"
  );
  assert(
    detectPendingTpCache({
      asOfDate: "2026-06-08",
      currentLifecycle: "return_planned",
      completion: null,
      returnWorkoutBlockerKind: "pending_today",
      expectsRunOnAsOfDate: true,
    }),
    "pending today without completion should be pending_tp_cache"
  );
  assert(
    detectPendingTpCache({
      asOfDate: "2026-06-08",
      currentLifecycle: "return_planned",
      completion: mkCompletion({ workoutDate: "2026-06-08", evidenceFreshness: "stale" }),
      returnWorkoutBlockerKind: null,
      expectsRunOnAsOfDate: false,
    }),
    "stale evidence should be pending_tp_cache"
  );

  const fixtures: BridgeFixture[] = [
    {
      name: "active_problem illness + completed run -> apply_monitoring_after_return",
      input: (() => {
        const lifecycleInput = mkInput({
          signalClass: "confirmed_illness",
          currentLifecycle: "active_problem",
          latestTpCompletionAfterOpen: mkCompletion({}),
        });
        return {
          signalId: "sig-1",
          signalType: "health_issue_started",
          signalClass: "confirmed_illness",
          currentLifecycle: "active_problem",
          lifecycleInput,
          proposal: evaluateOperationalSignalLifecycle(lifecycleInput),
          asOfDate: "2026-06-08",
        };
      })(),
      expectedAction: "apply_monitoring_after_return",
    },
    {
      name: "return_planned illness + completed run -> apply_monitoring_after_return",
      input: (() => {
        const lifecycleInput = mkInput({
          signalClass: "confirmed_illness",
          currentLifecycle: "return_planned",
          latestTpCompletionAfterOpen: mkCompletion({ workoutDate: "2026-06-07" }),
        });
        return {
          signalId: "sig-2",
          signalType: "health_issue_improving",
          signalClass: "confirmed_illness",
          currentLifecycle: "return_planned",
          lifecycleInput,
          proposal: evaluateOperationalSignalLifecycle(lifecycleInput),
          asOfDate: "2026-06-08",
        };
      })(),
      expectedAction: "apply_monitoring_after_return",
    },
    {
      name: "monitoring_after_return + second clean run -> coach_close_candidate",
      input: (() => {
        const lifecycleInput = mkInput({
          signalClass: "confirmed_illness",
          currentLifecycle: "monitoring_after_return",
          latestTpCompletionAfterOpen: mkCompletion({ workoutDate: "2026-06-08" }),
        });
        const proposal = evaluateOperationalSignalLifecycle(lifecycleInput);
        return {
          signalId: "sig-3",
          signalType: "health_issue_started",
          signalClass: "confirmed_illness",
          currentLifecycle: "monitoring_after_return",
          lifecycleInput,
          proposal,
          asOfDate: "2026-06-08",
          cleanRunningCompletionCount: 2,
        };
      })(),
      expectedAction: "coach_close_candidate",
    },
    {
      name: "monitoring_after_return illness + one clean run + recovery message -> coach_close_candidate",
      input: (() => {
        const lifecycleInput = mkInput({
          signalClass: "confirmed_illness",
          currentLifecycle: "monitoring_after_return",
          latestTpCompletionAfterOpen: mkCompletion({
            workoutDate: "2026-06-07",
            runningCompletionClass: "modified_or_easy_run",
          }),
          explicitRecoveryMessage: {
            observationId: "obs-recovery",
            observedAt: "2026-06-07T09:00:00.000Z",
            reason: "matched_recovery_pattern",
          },
        });
        const proposal = evaluateOperationalSignalLifecycle(lifecycleInput);
        return {
          signalId: "sig-3b",
          signalType: "health_issue_improving",
          signalClass: "confirmed_illness",
          currentLifecycle: "monitoring_after_return",
          lifecycleInput,
          proposal,
          asOfDate: "2026-06-09",
          cleanRunningCompletionCount: 1,
        };
      })(),
      expectedAction: "coach_close_candidate",
    },
    {
      name: "pain/injury monitoring + one clean run uses injury coach-close path, not illness one-run rule",
      input: (() => {
        const lifecycleInput = mkInput({
          signalClass: "injury_pain",
          currentLifecycle: "monitoring_after_return",
          latestTpCompletionAfterOpen: mkCompletion({ workoutDate: "2026-06-08" }),
        });
        const proposal = evaluateOperationalSignalLifecycle(lifecycleInput);
        return {
          signalId: "sig-3c",
          signalType: "pain_injury",
          signalClass: "injury_pain",
          currentLifecycle: "monitoring_after_return",
          lifecycleInput,
          proposal,
          asOfDate: "2026-06-09",
          cleanRunningCompletionCount: 1,
        };
      })(),
      expectedAction: "coach_close_candidate",
      expectedReasonIncludes: "Injury/pain monitoring",
    },
    {
      name: "completed run + later temperature -> blocked_by_negative",
      input: (() => {
        const lifecycleInput = mkInput({
          signalClass: "confirmed_illness",
          currentLifecycle: "monitoring_after_return",
          latestTpCompletionAfterOpen: mkCompletion({ workoutDate: "2026-06-07" }),
          negativeMessageAfterCompletion: {
            observationId: "obs-temp",
            observedAt: "2026-06-08T08:00:00.000Z",
            reason: "matched_negative_pattern",
          },
        });
        const proposal = evaluateOperationalSignalLifecycle(lifecycleInput);
        return {
          signalId: "sig-3d",
          signalType: "health_issue_improving",
          signalClass: "confirmed_illness",
          currentLifecycle: "active_problem",
          lifecycleInput,
          proposal,
          asOfDate: "2026-06-09",
          cleanRunningCompletionCount: 1,
        };
      })(),
      expectedAction: "blocked_by_negative",
    },
    {
      name: "injury + completed run -> monitoring apply with coach close later",
      input: (() => {
        const lifecycleInput = mkInput({
          signalClass: "injury_pain",
          currentLifecycle: "active_problem",
          latestTpCompletionAfterOpen: mkCompletion({ runningCompletionClass: "modified_or_easy_run", classificationConfidence: "medium" }),
        });
        return {
          signalId: "sig-4",
          signalType: "pain_injury",
          signalClass: "injury_pain",
          currentLifecycle: "active_problem",
          lifecycleInput,
          proposal: evaluateOperationalSignalLifecycle(lifecycleInput),
          asOfDate: "2026-06-08",
        };
      })(),
      expectedAction: "apply_monitoring_after_return",
    },
    {
      name: "strength-only completion -> no_action",
      input: (() => {
        const lifecycleInput = mkInput({
          signalClass: "confirmed_illness",
          currentLifecycle: "active_problem",
          latestTpCompletionAfterOpen: mkCompletion({
            title: "Strength",
            sportOrTypeCode: "strength",
            sportClass: "strength_only",
            runningCompletionClass: "not_running",
          }),
        });
        return {
          signalId: "sig-5",
          signalType: "health_issue_started",
          signalClass: "confirmed_illness",
          currentLifecycle: "active_problem",
          lifecycleInput,
          proposal: evaluateOperationalSignalLifecycle(lifecycleInput),
          asOfDate: "2026-06-08",
        };
      })(),
      expectedAction: "no_action",
    },
    {
      name: "misclassified running workout -> fix_tp_workout_classification",
      input: (() => {
        const lifecycleInput = mkInput({
          signalClass: "confirmed_illness",
          currentLifecycle: "return_planned",
          latestTpCompletionAfterOpen: mkCompletion({
            title: "Легкий бег",
            sportOrTypeCode: "other",
            sportClass: "cross_training_or_other",
            runningCompletionClass: "not_running",
          }),
        });
        return {
          signalId: "sig-6",
          signalType: "health_issue_improving",
          signalClass: "confirmed_illness",
          currentLifecycle: "return_planned",
          lifecycleInput,
          proposal: evaluateOperationalSignalLifecycle(lifecycleInput),
          asOfDate: "2026-06-08",
        };
      })(),
      expectedAction: "fix_tp_workout_classification",
    },
    {
      name: "negative after completion -> blocked_by_negative",
      input: (() => {
        const lifecycleInput = mkInput({
          signalClass: "confirmed_illness",
          currentLifecycle: "return_planned",
          latestTpCompletionAfterOpen: mkCompletion({}),
          negativeMessageAfterCompletion: {
            observationId: "obs-neg",
            observedAt: "2026-06-08T08:00:00.000Z",
            reason: "pain_worse",
          },
        });
        return {
          signalId: "sig-7",
          signalType: "health_issue_started",
          signalClass: "confirmed_illness",
          currentLifecycle: "return_planned",
          lifecycleInput,
          proposal: evaluateOperationalSignalLifecycle(lifecycleInput),
          asOfDate: "2026-06-08",
        };
      })(),
      expectedAction: "blocked_by_negative",
    },
    {
      name: "pending today without cache completion -> pending_tp_cache",
      input: (() => {
        const lifecycleInput = mkInput({
          signalClass: "confirmed_illness",
          currentLifecycle: "return_planned",
          latestTpCompletionAfterOpen: null,
          returnWorkoutBlocker: {
            kind: "pending_today",
            workoutId: "planned-1",
            workoutDate: "2026-06-08",
            title: "Easy Run",
            reason: "pending",
          },
        });
        return {
          signalId: "sig-8",
          signalType: "health_issue_improving",
          signalClass: "confirmed_illness",
          currentLifecycle: "return_planned",
          lifecycleInput,
          proposal: evaluateOperationalSignalLifecycle(lifecycleInput),
          asOfDate: "2026-06-08",
        };
      })(),
      expectedAction: "pending_tp_cache",
    },
  ];

  const failures: string[] = [];
  for (const fixture of fixtures) {
    const result = resolveBridgeRecommendedAction(fixture.input);
    if (result.recommendedAction !== fixture.expectedAction) {
      failures.push(
        `${fixture.name}: action=${result.recommendedAction} expected=${fixture.expectedAction}`
      );
    }
    if (
      fixture.expectedReasonIncludes &&
      !result.reason.includes(fixture.expectedReasonIncludes)
    ) {
      failures.push(
        `${fixture.name}: reason="${result.reason}" expected to include "${fixture.expectedReasonIncludes}"`
      );
    }
  }

  if (failures.length > 0) {
    console.error(`${LOG_PREFIX} FAIL`);
    for (const failure of failures) {
      console.error(` - ${failure}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`${LOG_PREFIX} PASS fixtures=${fixtures.length}`);
}

run();
