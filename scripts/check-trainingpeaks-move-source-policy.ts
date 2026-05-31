import {
  isEligibleForCoachSourceDateConfirmation,
  validateMoveSourceForExecution,
  INFERRED_MOVE_SOURCE_EXECUTION_BLOCK_MESSAGE_RU,
} from "@/features/trainingpeaks/move-source-policy";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const parsedPayloadBase = {
  actionType: "move_workout",
  target: { kind: "date", value: "2026-05-28" },
};

const inferredBlocked = validateMoveSourceForExecution({
  selectedSourceDatePolicy: "nearest_prior_within_3_days",
  parsedPayload: parsedPayloadBase,
  dryRunLog: {
    resolvedDates: {
      sourceDate: "2026-05-27",
      targetDate: "2026-05-28",
    },
    selectedSourceDatePolicy: "nearest_prior_within_3_days",
  },
});
assert(!inferredBlocked.ok, "inferred source date must remain blocked");
if (!inferredBlocked.ok) {
  assert(
    inferredBlocked.reason === INFERRED_MOVE_SOURCE_EXECUTION_BLOCK_MESSAGE_RU,
    "inferred block reason must be explicit and stable"
  );
}

const coachConfirmedTrusted = validateMoveSourceForExecution({
  selectedSourceDatePolicy: "coach_confirmed_source_date",
  parsedPayload: {
    ...parsedPayloadBase,
    coach_confirmed_source_date: "2026-05-27",
    source_date_policy_override: "coach_confirmed_source_date",
  },
  dryRunLog: {
    resolvedDates: {
      sourceDate: "2026-05-27",
      targetDate: "2026-05-28",
    },
    selectedSourceDatePolicy: "coach_confirmed_source_date",
  },
});
assert(coachConfirmedTrusted.ok, "coach-confirmed source date with exact match must be trusted");

const coachConfirmedMismatched = validateMoveSourceForExecution({
  selectedSourceDatePolicy: "coach_confirmed_source_date",
  parsedPayload: {
    ...parsedPayloadBase,
    coach_confirmed_source_date: "2026-05-26",
    source_date_policy_override: "coach_confirmed_source_date",
  },
  dryRunLog: {
    resolvedDates: {
      sourceDate: "2026-05-27",
      targetDate: "2026-05-28",
    },
    selectedSourceDatePolicy: "coach_confirmed_source_date",
  },
});
assert(!coachConfirmedMismatched.ok, "mismatched coach-confirmed source date must be blocked");

const explicitTrusted = validateMoveSourceForExecution({
  selectedSourceDatePolicy: "explicit_source_date",
  parsedPayload: {
    ...parsedPayloadBase,
    sourceDate: "2026-05-27",
  },
  dryRunLog: {
    resolvedDates: {
      sourceDate: "2026-05-27",
      targetDate: "2026-05-28",
    },
    selectedSourceDatePolicy: "explicit_source_date",
  },
});
assert(explicitTrusted.ok, "explicit source date must remain trusted");

const noSourceBlocked = validateMoveSourceForExecution({
  selectedSourceDatePolicy: "no_candidate",
  parsedPayload: parsedPayloadBase,
  dryRunLog: {
    resolvedDates: {
      sourceDate: null,
      targetDate: "2026-05-28",
    },
    selectedSourceDatePolicy: "no_candidate",
  },
});
assert(!noSourceBlocked.ok, "missing source date must remain blocked");

const coachConfirmEligibleWithConfidenceBlock = isEligibleForCoachSourceDateConfirmation({
  dryRunResult: "candidate_found",
  canExecute: false,
  canExecuteReasons: [
    "confidence below threshold 0.8",
    "source date inferred; real execution blocked",
  ],
  resolvedDates: {
    sourceDate: "2026-05-31",
    targetDate: "2026-06-01",
  },
  selectedSourceDatePolicy: "nearest_prior_within_3_days",
});
assert(
  coachConfirmEligibleWithConfidenceBlock === true,
  "coach source confirmation should remain eligible when confidence is below execute threshold"
);

const coachConfirmIneligibleAmbiguous = isEligibleForCoachSourceDateConfirmation({
  dryRunResult: "ambiguous",
  canExecute: false,
  canExecuteReasons: [
    "source date inferred; real execution blocked",
  ],
  resolvedDates: {
    sourceDate: "2026-05-31",
    targetDate: "2026-06-01",
  },
  selectedSourceDatePolicy: "nearest_prior_within_3_days",
});
assert(coachConfirmIneligibleAmbiguous === false, "ambiguous dry run must not allow source confirmation");

const coachConfirmIneligibleMissingSourceDate = isEligibleForCoachSourceDateConfirmation({
  dryRunResult: "candidate_found",
  canExecute: false,
  canExecuteReasons: [
    "source date inferred; real execution blocked",
  ],
  resolvedDates: {
    sourceDate: null,
    targetDate: "2026-06-01",
  },
  selectedSourceDatePolicy: "nearest_prior_within_3_days",
});
assert(
  coachConfirmIneligibleMissingSourceDate === false,
  "missing source date must block source confirmation eligibility"
);

console.log("check-trainingpeaks-move-source-policy: ok");
