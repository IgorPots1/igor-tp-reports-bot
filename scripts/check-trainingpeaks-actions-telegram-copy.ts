import { readFileSync } from "node:fs";
import process from "node:process";

import {
  buildCoachActionsListText,
  classifyCoachActionListBucket,
  COACH_REPLY_BUTTON_SIGNALS,
  formatCoachActionReasonForDisplay,
  formatCoachActionRunSummary,
  type CoachActionListItem,
} from "@/features/trainingpeaks/action-list-telegram-copy";
import {
  buildCoachDryRunFailureNotificationLines,
  formatCoachDryRunCandidateLine,
} from "@/features/trainingpeaks/action-dry-run-telegram-copy";
import {
  getCoachReplyKeyboardLayoutForTest,
  getCoachReplyKeyboardRouteForTest,
} from "@/features/telegram/trainingpeaks";

const LOG_PREFIX = "[check-trainingpeaks-actions-telegram-copy]";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function makeAction(input: Partial<CoachActionListItem> & Pick<CoachActionListItem, "id">): CoachActionListItem {
  return {
    studentName: "Test Athlete",
    status: "pending_coach",
    executionStatus: "not_started",
    executionMode: null,
    actionType: "move_workout",
    parsedPayload: {
      sourceDate: "2026-05-31",
      target: { kind: "date", value: "2026-06-02" },
    },
    createdAt: "2026-06-01T10:00:00.000Z",
    updatedAt: "2026-06-01T10:00:00.000Z",
    latestRunContext: null,
    ...input,
  };
}

function run(): void {
  const pending = makeAction({ id: "a-pending", status: "pending_coach" });
  const ready = makeAction({
    id: "a-ready",
    status: "approved",
    executionStatus: "dry_run_completed",
    latestRunContext: {
      latestDryRun: {
        status: "completed",
        dryRunResult: "candidate_found",
        canExecute: true,
      },
    },
  });
  const notFound = makeAction({
    id: "a-not-found",
    status: "approved",
    executionStatus: "dry_run_completed",
    updatedAt: "2026-06-13T10:00:00.000Z",
    latestRunContext: {
      latestDryRun: {
        status: "completed",
        dryRunResult: "not_found",
        canExecute: false,
        blockedReason: "confidence below threshold 0.8",
      },
    },
  });
  const ambiguous = makeAction({
    id: "a-ambiguous",
    status: "approved",
    executionStatus: "dry_run_completed",
    updatedAt: "2026-06-13T10:00:00.000Z",
    latestRunContext: {
      latestDryRun: {
        status: "completed",
        dryRunResult: "ambiguous",
        canExecute: false,
        blockedReason: "multiple candidates",
      },
    },
  });
  const inProgress = makeAction({
    id: "a-progress",
    status: "approved",
    executionStatus: "dry_run_running",
  });
  const staleNotFound = makeAction({
    id: "a-stale",
    status: "approved",
    executionStatus: "dry_run_completed",
    updatedAt: "2026-05-20T10:00:00.000Z",
    latestRunContext: {
      latestDryRun: {
        status: "completed",
        dryRunResult: "not_found",
        canExecute: false,
        blockedReason: "confidence below threshold 0.8",
      },
    },
  });

  const listText = buildCoachActionsListText([
    pending,
    ready,
    notFound,
    ambiguous,
    inProgress,
    staleNotFound,
  ]);

  const forbiddenPatterns = [
    "approved/dry-run",
    "completed/not_found",
    "confidence below threshold",
    "dry_run_completed",
    "candidate_found",
    "not_started",
    "Dry-run",
    "TrainingPeaks Actions",
  ];
  for (const pattern of forbiddenPatterns) {
    assert(!listText.includes(pattern), `raw string leaked to list: ${pattern}`);
  }

  assert(listText.includes("ждёт решения"), "pending label missing");
  assert(listText.includes("готово к выполнению"), "ready-to-execute label missing");
  assert(listText.includes("тренировка не найдена"), "not_found label missing");
  assert(listText.includes("Нужно решение"), "pending section missing");
  assert(listText.includes("Готово к выполнению"), "ready section missing");
  assert(listText.includes("Нужно проверить"), "review section missing");
  assert(listText.includes("⚠️ Нужно проверить\n\n"), "review section needs blank line after header");
  assert(listText.includes("   перенос:"), "move line should use перенос label on separate line");
  assert(listText.includes("   причина:"), "review items should expose причина on separate line");
  assert(!/\d+\. [^\n]+ — /.test(listText), "list items must not glue name and route on one line");
  assert(listText.includes("Старые проблемы скрыты"), "stale summary missing");

  assert(classifyCoachActionListBucket(pending) === "pending_decision", "pending bucket mismatch");
  assert(classifyCoachActionListBucket(ready) === "ready_to_execute", "ready bucket mismatch");
  assert(classifyCoachActionListBucket(staleNotFound) === "stale_review", "stale bucket mismatch");

  const dryRunSummary = formatCoachActionRunSummary(
    {
      status: "completed",
      dryRunResult: "not_found",
      blockedReason: "confidence below threshold 0.8",
    },
    "dry_run"
  );
  assert(dryRunSummary.includes("тренировка не найдена"), "dry-run summary missing not_found label");
  assert(dryRunSummary.includes("недостаточно уверенности"), "dry-run summary missing confidence label");
  assert(!dryRunSummary.includes("completed/not_found"), "dry-run summary leaked raw status");

  const reason = formatCoachActionReasonForDisplay({
    latestDryRun: {
      blockedReason: "confidence below threshold 0.8",
    },
  });
  assert(reason.includes("недостаточно уверенности"), "reason translation missing");

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
    candidates: [
      {
        title: "5 х 7 мин (на улице)",
        plannedDurationSec: 3600,
        rawTextSnippet: "5 х 7 мин (на улице) 01:00:00 92 TSS",
        sourceDate: "2026-06-13",
        score: 0.95,
      },
      {
        title: "Other",
        plannedDurationSec: 5051,
        plannedDistance: 3.5,
        rawTextSnippet: "Other 01:24:11 3.50 km 139 hrTSS",
        selectorHint: ".activity.workout",
        sourceDate: "2026-06-13",
        score: 0.85,
      },
    ],
  }).join("\n");

  assert(ambiguousDryRunNotification.includes("Перенос не выполнен"), "ambiguous dry-run missing failure header");
  assert(
    ambiguousDryRunNotification.includes("найдено несколько вариантов"),
    "ambiguous dry-run missing specific reason"
  );
  assert(
    ambiguousDryRunNotification.includes("нужен выбор тренера"),
    "ambiguous dry-run missing coach choice hint"
  );
  assert(
    ambiguousDryRunNotification.includes("5 х 7 мин (на улице)"),
    "ambiguous dry-run missing top candidate title"
  );
  assert(ambiguousDryRunNotification.includes("Other"), "ambiguous dry-run missing second candidate title");
  assert(
    ambiguousDryRunNotification.includes("TrainingPeaks не изменён"),
    "ambiguous dry-run missing unchanged TP note"
  );
  assert(
    !ambiguousDryRunNotification.includes("Можно выполнить перенос"),
    "ambiguous dry-run must not imply execution is possible"
  );
  assert(
    !/Проверь заявку в \/tp_actions\.\s*$/.test(ambiguousDryRunNotification),
    "ambiguous dry-run must not use generic-only fallback copy"
  );

  const notFoundDryRunNotification = buildCoachDryRunFailureNotificationLines({
    studentName: "Test Athlete",
    route: "13.06 → 14.06",
    dryRunResult: "not_found",
    sourceDate: "2026-06-13",
  }).join("\n");
  assert(notFoundDryRunNotification.includes("не нашёл подходящую тренировку на 13.06"), "not_found copy missing");

  const candidateLine = formatCoachDryRunCandidateLine({
    title: "5 х 7 мин (на улице)",
    plannedDurationSec: 3600,
    rawTextSnippet: "5 х 7 мин (на улице) 01:00:00 92 TSS",
  });
  assert(candidateLine.includes("planned"), "candidate line missing planned status");
  assert(candidateLine.includes("92 TSS"), "candidate line missing TSS");

  const layout = getCoachReplyKeyboardLayoutForTest().flat();
  assert(layout.includes(COACH_REPLY_BUTTON_SIGNALS), "Signals button missing from reply keyboard");
  assert(getCoachReplyKeyboardRouteForTest(COACH_REPLY_BUTTON_SIGNALS) === "signals", "Signals button route mismatch");

  const trainingPeaksSource = readFileSync("src/features/telegram/trainingpeaks.ts", "utf8");
  assert(trainingPeaksSource.includes("tp:ta:a:"), "approve callback prefix changed");
  assert(trainingPeaksSource.includes("tp:ta:r:"), "reject callback prefix changed");
  assert(trainingPeaksSource.includes("tp:ta:x:"), "execute callback prefix changed");
  assert(trainingPeaksSource.includes('data === "tp:actions:list"'), "actions list callback changed");
  assert(trainingPeaksSource.includes('data === TP_CALLBACK_SIGNALS'), "signals callback missing");

  console.log(`${LOG_PREFIX} PASS`);
}

try {
  run();
} catch (error) {
  console.error(`${LOG_PREFIX} FAIL`);
  console.error((error as Error).message);
  process.exit(1);
}
