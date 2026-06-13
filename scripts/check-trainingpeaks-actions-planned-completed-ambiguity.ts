import process from "node:process";

import { buildCoachDryRunFailureNotificationLines } from "@/features/trainingpeaks/action-dry-run-telegram-copy";
import {
  detectPlannedVsCompletedAmbiguityHint,
  formatPlannedCompletedAmbiguityActionDetailLines,
  isEligibleForCoachSourceWorkoutConfirmation,
  truncateWorkoutTitleForButton,
} from "@/features/trainingpeaks/action-planned-completed-ambiguity";

const LOG_PREFIX = "[check-trainingpeaks-actions-planned-completed-ambiguity]";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const TP_PRIMARY_WORKOUT_CARD_SELECTOR =
  ".dayWidth.dayContainer.day .activities .MuiCard-root.activity.workout";

const gudkovaCandidates = [
  {
    title: "5 х 7 мин (на улице)",
    plannedDurationSec: 3600,
    rawTextSnippet: "5 х 7 мин (на улице) 01:00:00 92 TSS",
    sourceDate: "2026-06-13",
    score: 0.95,
    workoutId: 3777415862,
  },
  {
    title: "Other",
    plannedDurationSec: 5051,
    plannedDistance: 3.5,
    rawTextSnippet: "Other 01:24:11 3.50 km 139 hrTSS",
    selectorHint: ".activity.workout",
    sourceDate: "2026-06-13",
    score: 0.85,
    workoutId: 3788336312,
  },
];

/** Real dry-run log_json.debugCandidatesTopN shape from production (Gudkova 2026-06-13). */
const gudkovaDbShapedCandidates = [
  {
    title: "5 х 7 мин (на улице)",
    workoutId: 3777415862,
    plannedDurationSec: 3600,
    rawTextSnippet: "5 х 7 мин (на улице) 01:00:00 92 TSS",
    classHint:
      "MuiPaper-root MuiPaper-elevation MuiPaper-rounded MuiPaper-elevation1 MuiCard-root activity workout workoutNew Run css-3aosfq-MuiPaper-root-MuiCard-root",
    selectorHint: TP_PRIMARY_WORKOUT_CARD_SELECTOR,
    sourceDate: "2026-06-13",
    score: 0.95,
  },
  {
    title: "Other",
    workoutId: 3788336312,
    plannedDurationSec: 5051,
    plannedDistance: 3.5,
    rawTextSnippet: "Other 01:24:11 3.50 km 139 hrTSS",
    classHint:
      "MuiPaper-root MuiPaper-elevation MuiPaper-rounded MuiPaper-elevation1 MuiCard-root activity workout workoutNew Other css-3aosfq-MuiPaper-root-MuiCard-root",
    selectorHint: TP_PRIMARY_WORKOUT_CARD_SELECTOR,
    sourceDate: "2026-06-13",
    score: 0.85,
  },
];

function runAmbiguityCase(input: {
  label: string;
  candidates: typeof gudkovaCandidates;
}): NonNullable<ReturnType<typeof detectPlannedVsCompletedAmbiguityHint>> {
  const hint = detectPlannedVsCompletedAmbiguityHint({
    dryRunResult: "ambiguous",
    plausibleCandidates: input.candidates,
    canExecuteReasons: [
      "multiple candidates on selected source date",
      "top candidate margin too small",
      "confidence below threshold 0.8",
    ],
    identityMatchedBy: "name",
  });

  assert(hint !== null, `${input.label}: expected planned-vs-completed hint`);
  assert(hint!.suggestedSourceCandidate.title.includes("5 х 7 мин"), `${input.label}: expected planned candidate title`);
  assert(hint!.suggestedSourceCandidate.status === "planned", `${input.label}: expected planned status`);
  assert(hint!.otherSourceCandidates[0]?.title === "Other", `${input.label}: expected completed Other as secondary`);
  assert(hint!.suggestedSourceCandidate.workoutId === "3777415862", `${input.label}: expected planned workout id`);
  return hint!;
}

function run(): void {
  const hint = runAmbiguityCase({ label: "fixture-shaped", candidates: gudkovaCandidates });
  const dbHint = runAmbiguityCase({ label: "db-shaped", candidates: gudkovaDbShapedCandidates });

  const expectedButtonLabel = `✅ Перенести ${truncateWorkoutTitleForButton(dbHint.suggestedSourceCandidate.title)}`;
  const dryRunLogJson = {
    dryRunResult: "ambiguous",
    canExecute: false,
    identityCheck: { matchedBy: "name" },
    plannedVsCompletedHint: dbHint,
  };
  assert(
    isEligibleForCoachSourceWorkoutConfirmation(dryRunLogJson),
    "db-shaped hint must be eligible for confirm-source-workout button"
  );
  assert(
    isEligibleForCoachSourceWorkoutConfirmation({
      dryRunResult: "ambiguous",
      canExecute: false,
      identityCheck: { matchedBy: "name" },
      debugCandidatesTopN: gudkovaDbShapedCandidates,
      selectedSourceDate: "2026-06-13",
      canExecuteReasons: [
        "multiple candidates on selected source date",
        "top candidate margin too small",
        "confidence below threshold 0.8",
      ],
    }),
    "db-shaped dry-run log without stored hint must resolve hint for button eligibility"
  );
  assert(expectedButtonLabel.includes("5 х 7 мин"), "expected planned workout button label");

  const ambiguousDryRunNotification = buildCoachDryRunFailureNotificationLines({
    studentName: "Gudkova Ekaterina",
    route: "13.06 → 14.06",
    dryRunResult: "ambiguous",
    sourceDate: "2026-06-13",
    canExecuteReasons: [
      "multiple candidates on selected source date",
      "top candidate margin too small",
      "confidence below threshold 0.8",
    ],
    candidates: gudkovaCandidates,
    plannedVsCompletedHint: hint,
  }).join("\n");

  assert(ambiguousDryRunNotification.includes("Перенос требует выбора"), "expected choice-required header");
  assert(ambiguousDryRunNotification.includes("Похоже, нужно перенести:"), "expected planned hint header");
  assert(ambiguousDryRunNotification.includes("5 х 7 мин (на улице)"), "expected planned candidate in copy");
  assert(ambiguousDryRunNotification.includes("planned"), "expected planned label");
  assert(ambiguousDryRunNotification.includes("Также найдено:"), "expected secondary candidates header");
  assert(ambiguousDryRunNotification.includes("Other"), "expected completed Other in copy");
  assert(ambiguousDryRunNotification.includes("completed"), "expected completed label");
  assert(ambiguousDryRunNotification.includes("TrainingPeaks не изменён"), "expected unchanged TP note");
  assert(
    ambiguousDryRunNotification.includes("подтверди planned тренировку"),
    "expected explicit planned confirmation hint"
  );
  assert(
    !ambiguousDryRunNotification.includes("Можно выполнить перенос"),
    "ambiguous planned-vs-completed copy must not imply auto execution"
  );

  const actionDetailLines = formatPlannedCompletedAmbiguityActionDetailLines(dbHint);
  assert(actionDetailLines.some((line) => line.includes("Рекомендация:")), "action detail missing recommendation");
  assert(actionDetailLines.some((line) => line.includes("5 х 7 мин (на улице)")), "action detail missing planned title");
  assert(
    actionDetailLines.some((line) => line.includes("completed Other")),
    "action detail missing completed Other explanation"
  );

  const blockedByMismatch = detectPlannedVsCompletedAmbiguityHint({
    dryRunResult: "ambiguous",
    plausibleCandidates: gudkovaDbShapedCandidates,
    identityMatchedBy: "mismatch",
  });
  assert(blockedByMismatch === null, "identity mismatch must not produce hint");

  const notAmbiguous = detectPlannedVsCompletedAmbiguityHint({
    dryRunResult: "candidate_found",
    plausibleCandidates: gudkovaDbShapedCandidates,
  });
  assert(notAmbiguous === null, "non-ambiguous dry-run must not produce hint");

  console.log(`${LOG_PREFIX} PASS (button=${expectedButtonLabel})`);
}

try {
  run();
} catch (error) {
  console.error(`${LOG_PREFIX} FAIL`);
  console.error((error as Error).message);
  process.exit(1);
}
