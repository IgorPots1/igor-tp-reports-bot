import process from "node:process";

import {
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
    name: "Viktoria confirmed illness + running completion -> monitoring",
    input: mkInput({
      signalClass: "confirmed_illness",
      latestTpCompletionAfterOpen: {
        workoutId: "101",
        workoutDate: "2026-06-04",
        title: "Easy Run",
        sportOrTypeCode: "run",
        isRunningLike: true,
        isStrengthLike: false,
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
    name: "Stepan ambiguous illness + clean next run -> resolved",
    input: mkInput({
      signalClass: "ambiguous_illness",
      latestTpCompletionAfterOpen: {
        workoutId: "102",
        workoutDate: "2026-06-04",
        title: "Planned Run",
        sportOrTypeCode: "run",
        isRunningLike: true,
        isStrengthLike: false,
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
    name: "Injury + one easy return run -> monitoring and coach close required",
    input: mkInput({
      signalClass: "injury_pain",
      latestTpCompletionAfterOpen: {
        workoutId: "103",
        workoutDate: "2026-06-04",
        title: "Recovery Run",
        sportOrTypeCode: "run",
        isRunningLike: true,
        isStrengthLike: false,
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
        isRunningLike: true,
        isStrengthLike: false,
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
        isRunningLike: false,
        isStrengthLike: true,
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
    name: "Modified easy completion for ambiguous illness is capped at monitoring",
    input: mkInput({
      signalClass: "ambiguous_illness",
      latestTpCompletionAfterOpen: {
        workoutId: "106",
        workoutDate: "2026-06-04",
        title: "Short Easy",
        sportOrTypeCode: "run",
        isRunningLike: true,
        isStrengthLike: false,
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

function run(): void {
  const failures: string[] = [];
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

  console.log(`${LOG_PREFIX} PASS fixtures=${fixtures.length}`);
}

run();
