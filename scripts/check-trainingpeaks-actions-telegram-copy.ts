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
    updatedAt: "2026-06-01T10:00:00.000Z",
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
