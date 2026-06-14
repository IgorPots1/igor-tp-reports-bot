import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
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
  formatTrainingPeaksExecuteQueuedMessage,
} from "@/features/trainingpeaks/action-execute-telegram-copy";
import {
  evaluateActionExecuteRetryEligibility,
} from "@/features/trainingpeaks/action-execute-retry-policy";
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

function assertRunnerDryRunCopyImportSmoke(): void {
  const output = execFileSync(
    "npx",
    ["tsx", "scripts/check-action-dry-run-telegram-copy-import.ts"],
    {
      cwd: path.join(process.cwd(), "tools/trainingpeaks-export"),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  assert(
    output.includes("check-action-dry-run-telegram-copy-import: ok"),
    "tp-actions-once dry-run telegram copy import smoke failed"
  );
}

function run(): void {
  assertRunnerDryRunCopyImportSmoke();

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

  assert(ambiguousDryRunNotification.includes("Перенос требует выбора"), "ambiguous dry-run missing choice header");
  assert(
    ambiguousDryRunNotification.includes("найдено несколько вариантов"),
    "ambiguous dry-run missing specific reason"
  );
  assert(
    ambiguousDryRunNotification.includes("Похоже, нужно перенести:"),
    "ambiguous dry-run missing planned candidate hint"
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
    ambiguousDryRunNotification.includes("подтверди planned тренировку"),
    "ambiguous dry-run missing planned confirmation hint"
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
  assert(trainingPeaksSource.includes("tp:ta:rx:"), "retry execute callback prefix missing");
  assert(trainingPeaksSource.includes("tp:ta:sw:"), "select workout callback prefix missing");
  assert(trainingPeaksSource.includes("🔁 Повторить выполнение"), "retry execute button label missing");
  assert(trainingPeaksSource.includes('data === "tp:actions:list"'), "actions list callback changed");
  assert(trainingPeaksSource.includes('data === TP_CALLBACK_SIGNALS'), "signals callback missing");

  const retryEligible = evaluateActionExecuteRetryEligibility({
    actionType: "move_workout",
    status: "approved",
    executionStatus: "failed",
    parsedPayload: {
      sourceDate: "2026-06-13",
      target: { kind: "date", value: "2026-06-14" },
      coach_confirmed_source_workout_id: 3777415862,
    },
    latestRunContext: {
      latestDryRun: {
        runId: "dry-1",
        runType: "dry_run",
        status: "completed",
        dryRunResult: "candidate_found",
        canExecute: true,
        logJson: {
          dryRunResult: "candidate_found",
          canExecute: true,
          candidate: { fingerprint: "abc", workoutId: 3777415862 },
          resolvedDates: { sourceDate: "2026-06-13", targetDate: "2026-06-14" },
          selectedSourceDatePolicy: "explicit_source_date",
          identityCheck: { matchedBy: "athlete_id" },
        },
      },
      latestExecute: {
        runId: "real-1",
        runType: "real",
        status: "failed",
        failureReason: "Revalidation failed: current confidence below threshold: 0.77",
      },
    },
  });
  assert(retryEligible.safeToRetryExecute, "failed action with executable dry-run should allow retry");
  assert(retryEligible.latestExecuteFailed, "latest execute failed flag missing");

  const retryBlocked = evaluateActionExecuteRetryEligibility({
    actionType: "move_workout",
    status: "approved",
    executionStatus: "failed",
    parsedPayload: {
      sourceDate: "2026-06-13",
      target: { kind: "date", value: "2026-06-14" },
    },
    latestRunContext: {
      latestDryRun: {
        runId: "dry-2",
        runType: "dry_run",
        status: "completed",
        dryRunResult: "not_found",
        canExecute: false,
        logJson: { dryRunResult: "not_found", canExecute: false },
      },
      latestExecute: {
        runId: "real-2",
        runType: "real",
        status: "failed",
        failureReason: "candidate not found",
      },
    },
  });
  assert(!retryBlocked.safeToRetryExecute, "failed action with non-executable dry-run must block retry");
  assert(Boolean(retryBlocked.reasonIfNo), "blocked retry should expose reason");

  const failedExecuteReason = formatCoachActionReasonForDisplay({
    latestExecute: {
      failureReason: "Revalidation failed: current confidence below threshold: 0.77",
    },
    latestDryRun: {
      status: "completed",
      dryRunResult: "candidate_found",
      canExecute: true,
    },
  });
  assert(
    failedExecuteReason.includes("недостаточно уверенности при повторной проверке"),
    "failed execute reason should not fall back to generic manual review"
  );

  const executeFailedSummary = formatCoachActionRunSummary(
    {
      status: "failed",
      failureReason: "Revalidation failed: current confidence below threshold: 0.77",
    },
    "execute"
  );
  assert(executeFailedSummary.includes("ошибка выполнения"), "execute summary missing failure header");
  assert(
    executeFailedSummary.includes("недостаточно уверенности при повторной проверке"),
    "execute summary missing specific failure reason"
  );

  const retryQueuedMessage = formatTrainingPeaksExecuteQueuedMessage({
    studentName: "Gudkova Ekaterina",
    parsedPayload: {
      sourceDate: "2026-06-13",
      target: { kind: "date", value: "2026-06-14" },
    },
    actionId: "a886b2cb-4d75-40f0-966a-b9905b8af350",
    retry: true,
  });
  assert(retryQueuedMessage.includes("Повторное выполнение поставлено в очередь"), "retry queued header missing");
  assert(retryQueuedMessage.includes("Gudkova Ekaterina: 13.06 → 14.06"), "retry queued route missing");
  assert(
    retryQueuedMessage.includes("--action-id=a886b2cb-4d75-40f0-966a-b9905b8af350"),
    "retry queued command missing action id"
  );
  assert(retryQueuedMessage.includes("Если в течение 1–2 минут"), "queued copy missing conditional runner hint");
  assert(retryQueuedMessage.includes("Cursor Terminal"), "queued copy missing Cursor Terminal hint");
  assert(
    retryQueuedMessage.includes("npm run tp-actions-execute-once -- --action-id="),
    "queued copy missing action-id execute command"
  );
  assert(!retryQueuedMessage.includes("Теперь запусти:"), "queued copy must not use mandatory runner wording");
  assert(
    retryQueuedMessage.includes("TrainingPeaks пока не изменён: перенос выполнит runner."),
    "queued copy missing runner responsibility note"
  );
  assert(!retryQueuedMessage.includes("TP_ACTIONS_USE_API_MOVE=truenpm"), "queued copy malformed env string");
  assert(!retryQueuedMessage.includes("TP_ACTIONS_USE_API_MOVE=truetsx"), "queued copy malformed env string");
  assert(
    !retryQueuedMessage.includes("TP_ACTIONS_REAL_EXECUTION=trueTP_ACTIONS_USE_API_MOVE=true"),
    "queued copy malformed env string"
  );

  const elenaBackwardsQueuedMessage = formatTrainingPeaksExecuteQueuedMessage({
    studentName: "Elena Yarulina",
    parsedPayload: {
      sourceDate: "2026-06-15",
      target: { kind: "date", value: "2026-06-14" },
    },
    trustedSourceDate: "2026-06-15",
    trustedTargetDate: "2026-06-14",
    actionId: "elena-backwards-move-action-id",
  });
  assert(elenaBackwardsQueuedMessage.includes("Elena Yarulina: 15.06 → 14.06."), "backwards queued route missing");
  assert(
    elenaBackwardsQueuedMessage.includes("⚠️ Перенос на более раннюю дату: 15.06 → 14.06."),
    "backwards queued warning missing"
  );
  assert(
    elenaBackwardsQueuedMessage.includes("Проверь, что это действительно нужно."),
    "backwards queued confirmation hint missing"
  );
  assert(
    elenaBackwardsQueuedMessage.includes("--action-id=elena-backwards-move-action-id"),
    "backwards queued command missing action id"
  );

  console.log(`${LOG_PREFIX} PASS`);
}

try {
  run();
} catch (error) {
  console.error(`${LOG_PREFIX} FAIL`);
  console.error((error as Error).message);
  process.exit(1);
}
