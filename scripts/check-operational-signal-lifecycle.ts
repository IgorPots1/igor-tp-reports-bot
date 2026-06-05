import process from "node:process";

import {
  classifyTpWorkoutEvidence,
  evaluateOperationalSignalLifecycle,
  type OperationalSignalLifecycleInput,
} from "@/features/trainingpeaks/operational-signal-lifecycle";

const LOG_PREFIX = "[check-operational-signal-lifecycle]";

type Fixture = {
  name: string;
  input: OperationalSignalLifecycleInput;
  expected: {
    proposedLifecycle: OperationalSignalLifecycleInput["currentLifecycle"];
    requiresCoachClose?: boolean;
    blockedByNegative?: boolean;
    hideFromTpSignals?: boolean;
  };
};

type ClassifierFixture = {
  name: string;
  input: Parameters<typeof classifyTpWorkoutEvidence>[0];
  expected: {
    sportClass: "running_like" | "strength_only" | "cross_training_or_other" | "unknown";
    runningCompletionClass:
      | "normal_planned_run"
      | "modified_or_easy_run"
      | "return_trial_run"
      | "uncertain_running_completion"
      | "not_running";
    confidence?: "high" | "medium" | "low";
  };
};

function mkInput(partial: Partial<OperationalSignalLifecycleInput>): OperationalSignalLifecycleInput {
  return {
    studentId: "student-test",
    signalClass: "unknown",
    currentLifecycle: "active_problem",
    openedAt: "2026-06-01T10:00:00.000Z",
    latestTpCompletionAfterOpen: null,
    negativeMessageAfterCompletion: null,
    explicitRecoveryMessage: null,
    missedOrSkippedReturnWorkout: false,
    ...partial,
  };
}

const fixtures: Fixture[] = [
  {
    name: "Confirmed illness + normal planned run -> monitoring",
    input: mkInput({
      signalClass: "confirmed_illness",
      latestTpCompletionAfterOpen: {
        workoutId: "101",
        workoutDate: "2026-06-04",
        title: "Easy Run",
        sportOrTypeCode: "run",
        sportClass: "running_like",
        runningCompletionClass: "normal_planned_run",
        classificationConfidence: "high",
        classificationReasonCodes: ["fixture_running_structured"],
        classificationInspectedFields: {},
        plannedVsCompletedDelta: "normal",
        evidenceFreshness: "ok",
      },
    }),
    expected: {
      proposedLifecycle: "monitoring_after_return",
      hideFromTpSignals: false,
    },
  },
  {
    name: "Ambiguous illness + clean normal run -> resolved",
    input: mkInput({
      signalClass: "ambiguous_illness",
      latestTpCompletionAfterOpen: {
        workoutId: "102",
        workoutDate: "2026-06-04",
        title: "Planned Run",
        sportOrTypeCode: "run",
        sportClass: "running_like",
        runningCompletionClass: "normal_planned_run",
        classificationConfidence: "high",
        classificationReasonCodes: ["fixture_running_structured"],
        classificationInspectedFields: {},
        plannedVsCompletedDelta: "normal",
        evidenceFreshness: "ok",
      },
    }),
    expected: {
      proposedLifecycle: "resolved",
      hideFromTpSignals: true,
    },
  },
  {
    name: "Injury + TP-only running completion -> monitoring and coach close required",
    input: mkInput({
      signalClass: "injury_pain",
      latestTpCompletionAfterOpen: {
        workoutId: "103",
        workoutDate: "2026-06-04",
        title: "Recovery Run",
        sportOrTypeCode: "run",
        sportClass: "running_like",
        runningCompletionClass: "modified_or_easy_run",
        classificationConfidence: "medium",
        classificationReasonCodes: ["fixture_modified_easy"],
        classificationInspectedFields: {},
        plannedVsCompletedDelta: "modified_easy",
        evidenceFreshness: "ok",
      },
    }),
    expected: {
      proposedLifecycle: "monitoring_after_return",
      requiresCoachClose: true,
      hideFromTpSignals: false,
    },
  },
  {
    name: "Pain worsened after completion -> active and blocked by negative",
    input: mkInput({
      signalClass: "injury_pain",
      currentLifecycle: "monitoring_after_return",
      latestTpCompletionAfterOpen: {
        workoutId: "104",
        workoutDate: "2026-06-04",
        title: "Easy Run",
        sportOrTypeCode: "run",
        sportClass: "running_like",
        runningCompletionClass: "normal_planned_run",
        classificationConfidence: "high",
        classificationReasonCodes: ["fixture_running_structured"],
        classificationInspectedFields: {},
        plannedVsCompletedDelta: "normal",
        evidenceFreshness: "ok",
      },
      negativeMessageAfterCompletion: {
        observationId: "obs-neg",
        observedAt: "2026-06-05T08:00:00.000Z",
        reason: "pain_worse",
      },
    }),
    expected: {
      proposedLifecycle: "active_problem",
      blockedByNegative: true,
      hideFromTpSignals: false,
    },
  },
  {
    name: "Strength-only completion does not resolve injury",
    input: mkInput({
      signalClass: "injury_pain",
      currentLifecycle: "active_problem",
      latestTpCompletionAfterOpen: {
        workoutId: "105",
        workoutDate: "2026-06-04",
        title: "Strength Session",
        sportOrTypeCode: "strength",
        sportClass: "strength_only",
        runningCompletionClass: "not_running",
        classificationConfidence: "high",
        classificationReasonCodes: ["fixture_strength_structured"],
        classificationInspectedFields: {},
        plannedVsCompletedDelta: "normal",
        evidenceFreshness: "ok",
      },
    }),
    expected: {
      proposedLifecycle: "active_problem",
      requiresCoachClose: true,
      hideFromTpSignals: false,
    },
  },
  {
    name: "Cross-training completion does not resolve confirmed illness",
    input: mkInput({
      signalClass: "confirmed_illness",
      currentLifecycle: "active_problem",
      latestTpCompletionAfterOpen: {
        workoutId: "105b",
        workoutDate: "2026-06-04",
        title: "Bike endurance",
        sportOrTypeCode: "bike",
        sportClass: "cross_training_or_other",
        runningCompletionClass: "not_running",
        classificationConfidence: "high",
        classificationReasonCodes: ["fixture_cross_structured"],
        classificationInspectedFields: {},
        plannedVsCompletedDelta: "normal",
        evidenceFreshness: "ok",
      },
    }),
    expected: {
      proposedLifecycle: "active_problem",
      hideFromTpSignals: false,
    },
  },
  {
    name: "Ambiguous illness + modified easy completion -> monitoring",
    input: mkInput({
      signalClass: "ambiguous_illness",
      latestTpCompletionAfterOpen: {
        workoutId: "106",
        workoutDate: "2026-06-04",
        title: "Short Easy",
        sportOrTypeCode: "run",
        sportClass: "running_like",
        runningCompletionClass: "modified_or_easy_run",
        classificationConfidence: "medium",
        classificationReasonCodes: ["fixture_modified_easy"],
        classificationInspectedFields: {},
        plannedVsCompletedDelta: "modified_easy",
        evidenceFreshness: "ok",
      },
    }),
    expected: {
      proposedLifecycle: "monitoring_after_return",
      hideFromTpSignals: false,
    },
  },
  {
    name: "Ambiguous illness + uncertain running completion -> monitoring",
    input: mkInput({
      signalClass: "ambiguous_illness",
      latestTpCompletionAfterOpen: {
        workoutId: "107",
        workoutDate: "2026-06-04",
        title: "Run",
        sportOrTypeCode: "run",
        sportClass: "running_like",
        runningCompletionClass: "uncertain_running_completion",
        classificationConfidence: "low",
        classificationReasonCodes: ["fixture_uncertain_running"],
        classificationInspectedFields: {},
        plannedVsCompletedDelta: "unknown",
        evidenceFreshness: "ok",
      },
    }),
    expected: {
      proposedLifecycle: "monitoring_after_return",
      hideFromTpSignals: false,
    },
  },
  {
    name: "Missed return workout blocks closure",
    input: mkInput({
      signalClass: "confirmed_illness",
      currentLifecycle: "return_trial_completed",
      missedOrSkippedReturnWorkout: true,
    }),
    expected: {
      proposedLifecycle: "return_planned",
      hideFromTpSignals: false,
    },
  },
  {
    name: "Explicit recovery without TP completion can close confirmed illness",
    input: mkInput({
      signalClass: "confirmed_illness",
      explicitRecoveryMessage: {
        observationId: "obs-rec",
        observedAt: "2026-06-05T09:00:00.000Z",
        reason: "all_ok",
      },
    }),
    expected: {
      proposedLifecycle: "resolved",
      hideFromTpSignals: true,
    },
  },
  {
    name: "No TP and no messages keeps active",
    input: mkInput({
      signalClass: "confirmed_illness",
      currentLifecycle: "active_problem",
    }),
    expected: {
      proposedLifecycle: "active_problem",
      hideFromTpSignals: false,
    },
  },
];

const classifierFixtures: ClassifierFixture[] = [
  {
    name: "Structured running type id -> running_like high confidence",
    input: {
      workoutTypeValueId: 3,
      title: "Anything",
      isCompleted: true,
      isPlanned: true,
      plannedVsCompletedDelta: "normal",
    },
    expected: {
      sportClass: "running_like",
      runningCompletionClass: "normal_planned_run",
      confidence: "high",
    },
  },
  {
    name: "Unknown structured + Russian running title -> running_like medium",
    input: {
      sportOrTypeCode: "unknown code",
      title: "Легкий бег 40 мин",
      isCompleted: true,
      isPlanned: true,
      plannedVsCompletedDelta: "unknown",
    },
    expected: {
      sportClass: "running_like",
      runningCompletionClass: "modified_or_easy_run",
      confidence: "medium",
    },
  },
  {
    name: "Unknown structured + English running title -> running_like medium",
    input: {
      sportOrTypeCode: "unknown code",
      title: "Easy Run 30 min",
      isCompleted: true,
      isPlanned: false,
      plannedVsCompletedDelta: "unknown",
    },
    expected: {
      sportClass: "running_like",
      runningCompletionClass: "modified_or_easy_run",
      confidence: "medium",
    },
  },
  {
    name: "Structured strength should not be overridden by generic title",
    input: {
      sportOrTypeCode: "strength",
      title: "Warmup",
      isCompleted: true,
      isPlanned: true,
      plannedVsCompletedDelta: "normal",
    },
    expected: {
      sportClass: "strength_only",
      runningCompletionClass: "not_running",
      confidence: "high",
    },
  },
  {
    name: "Known strength type id 9 remains not running",
    input: {
      workoutTypeValueId: 9,
      title: "Strength",
      isCompleted: true,
      isPlanned: false,
      plannedVsCompletedDelta: "unknown",
    },
    expected: {
      sportClass: "strength_only",
      runningCompletionClass: "not_running",
      confidence: "medium",
    },
  },
  {
    name: "Known other type id 100 remains conservative unknown",
    input: {
      workoutTypeValueId: 100,
      title: "Hiit",
      isCompleted: true,
      isPlanned: false,
      plannedVsCompletedDelta: "unknown",
    },
    expected: {
      sportClass: "unknown",
      runningCompletionClass: "not_running",
      confidence: "low",
    },
  },
  {
    name: "Strength title only -> strength_only",
    input: {
      title: "Gym mobility core",
      isCompleted: true,
      plannedVsCompletedDelta: "unknown",
    },
    expected: {
      sportClass: "strength_only",
      runningCompletionClass: "not_running",
    },
  },
  {
    name: "Cross-training title only -> not running",
    input: {
      title: "Bike endurance ride",
      isCompleted: true,
      plannedVsCompletedDelta: "unknown",
    },
    expected: {
      sportClass: "cross_training_or_other",
      runningCompletionClass: "not_running",
    },
  },
];

function run(): void {
  const failures: string[] = [];
  for (const fixture of classifierFixtures) {
    const actual = classifyTpWorkoutEvidence(fixture.input);
    if (actual.sportClass !== fixture.expected.sportClass) {
      failures.push(`${fixture.name}: sportClass=${actual.sportClass} expected=${fixture.expected.sportClass}`);
    }
    if (actual.runningCompletionClass !== fixture.expected.runningCompletionClass) {
      failures.push(
        `${fixture.name}: runningCompletionClass=${actual.runningCompletionClass} expected=${fixture.expected.runningCompletionClass}`
      );
    }
    if (fixture.expected.confidence && actual.confidence !== fixture.expected.confidence) {
      failures.push(`${fixture.name}: confidence=${actual.confidence} expected=${fixture.expected.confidence}`);
    }
  }

  for (const fixture of fixtures) {
    const actual = evaluateOperationalSignalLifecycle(fixture.input);
    if (actual.proposedLifecycle !== fixture.expected.proposedLifecycle) {
      failures.push(
        `${fixture.name}: proposedLifecycle=${actual.proposedLifecycle} expected=${fixture.expected.proposedLifecycle}`
      );
    }
    if (
      fixture.expected.requiresCoachClose !== undefined &&
      Boolean(actual.requiresCoachClose) !== fixture.expected.requiresCoachClose
    ) {
      failures.push(
        `${fixture.name}: requiresCoachClose=${String(actual.requiresCoachClose)} expected=${String(fixture.expected.requiresCoachClose)}`
      );
    }
    if (
      fixture.expected.blockedByNegative !== undefined &&
      Boolean(actual.blockedByNegative) !== fixture.expected.blockedByNegative
    ) {
      failures.push(
        `${fixture.name}: blockedByNegative=${String(actual.blockedByNegative)} expected=${String(fixture.expected.blockedByNegative)}`
      );
    }
    if (
      fixture.expected.hideFromTpSignals !== undefined &&
      Boolean(actual.hideFromTpSignals) !== fixture.expected.hideFromTpSignals
    ) {
      failures.push(
        `${fixture.name}: hideFromTpSignals=${String(actual.hideFromTpSignals)} expected=${String(fixture.expected.hideFromTpSignals)}`
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

  console.log(`${LOG_PREFIX} PASS fixtures=${fixtures.length} classifier_fixtures=${classifierFixtures.length}`);
}

run();
