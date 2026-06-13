import process from "node:process";

import { buildCoachDryRunFailureNotificationLines } from "@/features/trainingpeaks/action-dry-run-telegram-copy";
import {
  detectPlannedVsCompletedAmbiguityHint,
  formatPlannedCompletedAmbiguityActionDetailLines,
} from "@/features/trainingpeaks/action-planned-completed-ambiguity";

const LOG_PREFIX = "[check-trainingpeaks-actions-planned-completed-ambiguity]";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

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

function run(): void {
  const hint = detectPlannedVsCompletedAmbiguityHint({
    dryRunResult: "ambiguous",
    plausibleCandidates: gudkovaCandidates,
    canExecuteReasons: [
      "multiple candidates on selected source date",
      "top candidate margin too small",
      "confidence below threshold 0.8",
    ],
    identityMatchedBy: "name",
  });

  assert(hint !== null, "expected planned-vs-completed hint for Gudkova-like case");
  assert(hint!.suggestedSourceCandidate.title.includes("5 х 7 мин"), "expected planned candidate title");
  assert(hint!.suggestedSourceCandidate.status === "planned", "expected planned status");
  assert(hint!.otherSourceCandidates[0]?.title === "Other", "expected completed Other as secondary");
  assert(hint!.suggestedSourceCandidate.workoutId === "3777415862", "expected planned workout id");

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

  const actionDetailLines = formatPlannedCompletedAmbiguityActionDetailLines(hint!);
  assert(actionDetailLines.some((line) => line.includes("Рекомендация:")), "action detail missing recommendation");
  assert(actionDetailLines.some((line) => line.includes("5 х 7 мин (на улице)")), "action detail missing planned title");
  assert(
    actionDetailLines.some((line) => line.includes("completed Other")),
    "action detail missing completed Other explanation"
  );

  const blockedByMismatch = detectPlannedVsCompletedAmbiguityHint({
    dryRunResult: "ambiguous",
    plausibleCandidates: gudkovaCandidates,
    identityMatchedBy: "mismatch",
  });
  assert(blockedByMismatch === null, "identity mismatch must not produce hint");

  const notAmbiguous = detectPlannedVsCompletedAmbiguityHint({
    dryRunResult: "candidate_found",
    plausibleCandidates: gudkovaCandidates,
  });
  assert(notAmbiguous === null, "non-ambiguous dry-run must not produce hint");

  console.log(`${LOG_PREFIX} PASS`);
}

try {
  run();
} catch (error) {
  console.error(`${LOG_PREFIX} FAIL`);
  console.error((error as Error).message);
  process.exit(1);
}
