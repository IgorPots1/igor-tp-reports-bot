import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import {
  formatTpSignalReviewCardText,
  getTpSignalReviewCardMarkup,
  mapTpSignalReviewCallbackToDecision,
  parseTpSignalReviewCallback,
  TP_SIGNAL_REVIEW_CALLBACK_ACKNOWLEDGED_PREFIX,
  TP_SIGNAL_REVIEW_CALLBACK_HIDE_PREFIX,
} from "@/features/trainingpeaks/tp-signals-review-card";
import {
  buildTpSignalReviewCardForQueueItem,
  clearPendingTpSignalReviewStateForTest,
  getTrainingPeaksTpSignalReviewQueueFeatureFlags,
  handleTpSignalReviewCallback,
  isTrainingPeaksTpSignalReviewQueueButtonsEnabled,
  isTrainingPeaksTpSignalReviewQueueEnabled,
  isTrainingPeaksTpSignalReviewQueueSendEnabled,
  notifyCoachTpSignalReviewQueue,
} from "@/features/trainingpeaks/tp-signals-review-flow";
import {
  assignActiveSignalReviewBucket,
  type ActiveSignalReviewBucketItem,
} from "@/features/trainingpeaks/tp-signals-review-buckets-helpers";
import {
  isTpSignalReviewQueueBucket,
  selectTpSignalReviewQueueItems,
  type TpSignalReviewDecisionRecord,
} from "@/features/trainingpeaks/tp-signals-review-queue-helpers";
import type { TrainingPeaksStudentOperationalSignal } from "@/features/trainingpeaks/repository";
import type { TrainingPeaksOperationalSignalsItem } from "@/features/trainingpeaks/service";

const LOG_PREFIX = "[check:tp-signals-review-queue]";
const SIGNAL_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const SIGNAL_SHORT = SIGNAL_ID.slice(0, 8);

function makeSignal(overrides: Partial<TrainingPeaksStudentOperationalSignal> = {}): TrainingPeaksStudentOperationalSignal {
  return {
    id: SIGNAL_ID,
    studentId: "student-1",
    signalType: "health_issue_started",
    status: "active",
    lifecycleState: null,
    lifecycleStateUpdatedAt: null,
    lifecycleAppliedAt: null,
    lifecycleMeta: {},
    resolvedAt: null,
    resolvedReason: null,
    requiresCoachClose: false,
    sourceType: "fixture",
    sourceObservationId: "obs-1",
    telegramChatId: null,
    telegramMessageId: null,
    telegramMessageThreadId: null,
    structuredPayload: {},
    confidence: null,
    validFrom: null,
    validUntil: null,
    sourceDate: null,
    targetDate: null,
    sourceDay: null,
    targetDay: null,
    linkedMemoryItemId: null,
    linkedCaseId: null,
    linkedActionId: null,
    dedupeKey: "fixture:signal",
    consumedAt: null,
    metadata: { classifier_confidence: "medium" },
    createdAt: "2026-06-08T08:00:00.000Z",
    updatedAt: "2026-06-08T08:00:00.000Z",
    ...overrides,
  };
}

function makeDiagnosticItem(overrides: Partial<TrainingPeaksOperationalSignalsItem> = {}): TrainingPeaksOperationalSignalsItem {
  return {
    signalId: SIGNAL_ID,
    studentId: "student-1",
    studentName: "Test Athlete",
    section: "health",
    text: "горло болит",
    hiddenReason: null,
    ...overrides,
  };
}

const CLOSE_SIGNAL_ID = "b2c3d4e5-f6a7-8901-bcde-f12345678901";

function makeActiveBucketItem(
  bucket: "review_required" | "close_candidate_review",
  signalId = SIGNAL_ID
): ActiveSignalReviewBucketItem {
  const signal = makeSignal(
    bucket === "close_candidate_review"
      ? {
          id: signalId,
          requiresCoachClose: true,
          lifecycleState: "ready_for_coach_close",
        }
      : { id: signalId }
  );
  const item = makeDiagnosticItem({ signalId });
  return assignActiveSignalReviewBucket({
    studentName: "Test Athlete",
    signal,
    item,
    evidence: null,
    asOfDate: "2026-06-13",
  });
}

function makeDecision(
  decision: TpSignalReviewDecisionRecord["decision"]
): TpSignalReviewDecisionRecord {
  return {
    signalId: SIGNAL_ID,
    studentId: "student-1",
    bucket: "review_required",
    decision,
    decisionSource: "manual",
    coachTelegramUserId: null,
    callbackShortId: SIGNAL_SHORT,
    createdAt: "2026-06-13T10:00:00.000Z",
    metadata: {},
  };
}

async function run(): Promise<void> {
  const failures: string[] = [];

  const reviewRequiredItem = makeActiveBucketItem("review_required", SIGNAL_ID);
  const closeCandidateItem = makeActiveBucketItem("close_candidate_review", CLOSE_SIGNAL_ID);
  const obviousAutoItem = assignActiveSignalReviewBucket({
    studentName: "Auto Athlete",
    signal: makeSignal({
      id: "11111111-1111-1111-1111-111111111111",
      metadata: { classifier_confidence: "high" },
    }),
    item: makeDiagnosticItem({
      signalId: "11111111-1111-1111-1111-111111111111",
      studentName: "Auto Athlete",
      text: "болею",
      hiddenReason: null,
    }),
    evidence: null,
    asOfDate: "2026-06-13",
  });

  if (reviewRequiredItem.bucket !== "review_required") {
    failures.push(`expected review_required bucket, got ${reviewRequiredItem.bucket}`);
  }
  if (closeCandidateItem.bucket !== "close_candidate_review") {
    failures.push(`expected close_candidate_review bucket, got ${closeCandidateItem.bucket}`);
  }
  if (obviousAutoItem.bucket !== "obvious_auto_record") {
    failures.push(`expected obvious_auto_record bucket, got ${obviousAutoItem.bucket}`);
  }

  const activeItems = [reviewRequiredItem, closeCandidateItem, obviousAutoItem];
  const baseSelection = selectTpSignalReviewQueueItems({ activeItems });
  if (baseSelection.totalSelected !== 2) {
    failures.push(`expected 2 queue items, got ${baseSelection.totalSelected}`);
  }
  if (baseSelection.byBucket.review_required !== 1 || baseSelection.byBucket.close_candidate_review !== 1) {
    failures.push("queue bucket counts mismatch");
  }
  if (baseSelection.items.some((item) => item.bucket === "obvious_auto_record" as never)) {
    failures.push("obvious_auto_record leaked into queue");
  }

  const hiddenSelection = selectTpSignalReviewQueueItems({
    activeItems,
    latestDecisionsBySignalId: new Map([[SIGNAL_ID, makeDecision("acknowledged")]]),
  });
  if (hiddenSelection.totalSelected !== 1) {
    failures.push(`acknowledged decision should suppress review_required card, got ${hiddenSelection.totalSelected}`);
  }

  const keepVisibleSelection = selectTpSignalReviewQueueItems({
    activeItems,
    latestDecisionsBySignalId: new Map([[SIGNAL_ID, makeDecision("keep_visible")]]),
  });
  if (keepVisibleSelection.wouldSendCount < 2) {
    failures.push("keep_visible should keep card visible in would-send count");
  }

  const reviewCard = formatTpSignalReviewCardText({
    bucket: "review_required",
    studentName: "Test Athlete",
    category: "health",
    reason: "ambiguous_or_non_high_confidence_active_signal",
    sourcePreview: "горло болит",
    state: "needs_review",
    signalShortId: SIGNAL_SHORT,
  });
  assert.match(reviewCard, /🟡 Проверить сигнал/u);
  assert.match(reviewCard, /Атлет: Test Athlete/u);
  assert.match(reviewCard, /#a1b2c3d4/u);

  const closeCard = formatTpSignalReviewCardText({
    bucket: "close_candidate_review",
    studentName: "Test Athlete",
    category: "health",
    reason: "ready_for_coach_close",
    lifecycleReason: "ready_for_coach_close",
    state: "close_candidate",
    signalShortId: SIGNAL_SHORT,
  });
  assert.match(closeCard, /🔵 Можно закрыть после проверки/u);

  const reviewMarkup = getTpSignalReviewCardMarkup("review_required", SIGNAL_SHORT);
  assert.equal(reviewMarkup.inline_keyboard.length, 2);
  const closeMarkup = getTpSignalReviewCardMarkup("close_candidate_review", SIGNAL_SHORT);
  assert.equal(closeMarkup.inline_keyboard.length, 2);

  const parsedAck = parseTpSignalReviewCallback(`${TP_SIGNAL_REVIEW_CALLBACK_ACKNOWLEDGED_PREFIX}${SIGNAL_SHORT}`);
  assert.equal(parsedAck?.kind, "acknowledged");
  assert.equal(mapTpSignalReviewCallbackToDecision(parsedAck!), "acknowledged");

  const previousQueue = process.env.TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_ENABLED;
  const previousSend = process.env.TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_SEND_ENABLED;
  const previousButtons = process.env.TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_BUTTONS_ENABLED;
  let insertedDecision: string | null = null;
  let flags = getTrainingPeaksTpSignalReviewQueueFeatureFlags();

  try {
    process.env.TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_ENABLED = "false";
    process.env.TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_SEND_ENABLED = "false";
    process.env.TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_BUTTONS_ENABLED = "false";

    assert.equal(isTrainingPeaksTpSignalReviewQueueEnabled(), false);
    assert.equal(isTrainingPeaksTpSignalReviewQueueSendEnabled(), false);
    assert.equal(isTrainingPeaksTpSignalReviewQueueButtonsEnabled(), false);

    const flagsOff = getTrainingPeaksTpSignalReviewQueueFeatureFlags();
    assert.equal(flagsOff.queueEnabled, false);
    assert.equal(flagsOff.sendEnabled, false);
    assert.equal(flagsOff.buttonsEnabled, false);
    flags = flagsOff;

    const sendResult = await notifyCoachTpSignalReviewQueue({
      items: baseSelection.items,
    });
    assert.equal(sendResult.status, "queue_disabled");

    process.env.TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_ENABLED = "true";
    const sendDisabledResult = await notifyCoachTpSignalReviewQueue({
      items: baseSelection.items,
    });
    assert.equal(sendDisabledResult.status, "send_disabled");

    clearPendingTpSignalReviewStateForTest();
    let signalStatusAtWrite = "active";
    insertedDecision = null;
    const callbackResult = await handleTpSignalReviewCallback({
      callback: parseTpSignalReviewCallback(`${TP_SIGNAL_REVIEW_CALLBACK_HIDE_PREFIX}${SIGNAL_SHORT}`)!,
      coachChatId: "coach-chat",
      coachMessageId: 42,
      callbackQueryId: "cb-1",
      deps: {
        now: () => 1_700_000_000_000,
        answerCallback: async () => undefined,
        editCoachMessage: async () => undefined,
        getSignalByIdPrefix: async () => makeSignal({ status: signalStatusAtWrite as "active" }),
        getStudentById: async () => ({
          id: "student-1",
          studentId: "student-1",
          studentName: "Test Athlete",
          trainingPeaksAthleteUrl: null,
          telegramChatId: null,
          telegramUsername: null,
          telegramFormality: "ty",
          telegramContextNotes: null,
          telegramDeliveryEnabled: true,
          isActive: true,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          weeklyReportsEnabled: true,
          telegramLinkedAt: null,
          telegramLinkCode: null,
          telegramLinkCodeExpiresAt: null,
          billingClientId: null,
          nutritionTargetsJson: null,
          coachNotesJson: {},
          metadata: {},
        }),
        insertReviewDecision: async (input) => {
          insertedDecision = input.decision;
          signalStatusAtWrite = "dismissed";
          return {
            id: "decision-1",
            signalId: input.signalId,
            studentId: input.studentId ?? null,
            bucket: input.bucket,
            decision: input.decision,
            decisionSource: input.decisionSource,
            coachTelegramUserId: input.coachTelegramUserId ?? null,
            callbackShortId: input.callbackShortId ?? null,
            metadata: input.metadata ?? {},
            createdAt: "2026-06-13T10:00:00.000Z",
          };
        },
      },
    });
    assert.equal(callbackResult, "handled");
    assert.equal(insertedDecision, null, "buttons disabled should not write review decision");

    process.env.TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_BUTTONS_ENABLED = "true";
    clearPendingTpSignalReviewStateForTest();
    signalStatusAtWrite = "active";
    insertedDecision = null;
    await handleTpSignalReviewCallback({
      callback: parseTpSignalReviewCallback(`${TP_SIGNAL_REVIEW_CALLBACK_HIDE_PREFIX}${SIGNAL_SHORT}`)!,
      coachChatId: "coach-chat",
      coachMessageId: 42,
      callbackQueryId: "cb-2",
      deps: {
        now: () => 1_700_000_000_000,
        answerCallback: async () => undefined,
        editCoachMessage: async () => undefined,
        getSignalByIdPrefix: async () => makeSignal({ status: signalStatusAtWrite as "active" }),
        getStudentById: async () => ({
          id: "student-1",
          studentId: "student-1",
          studentName: "Test Athlete",
          trainingPeaksAthleteUrl: null,
          telegramChatId: null,
          telegramUsername: null,
          telegramFormality: "ty",
          telegramContextNotes: null,
          telegramDeliveryEnabled: true,
          isActive: true,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          weeklyReportsEnabled: true,
          telegramLinkedAt: null,
          telegramLinkCode: null,
          telegramLinkCodeExpiresAt: null,
          billingClientId: null,
          nutritionTargetsJson: null,
          coachNotesJson: {},
          metadata: {},
        }),
        insertReviewDecision: async (input) => {
          insertedDecision = input.decision;
          return {
            id: "decision-2",
            signalId: input.signalId,
            studentId: input.studentId ?? null,
            bucket: input.bucket,
            decision: input.decision,
            decisionSource: input.decisionSource,
            coachTelegramUserId: input.coachTelegramUserId ?? null,
            callbackShortId: input.callbackShortId ?? null,
            metadata: input.metadata ?? {},
            createdAt: "2026-06-13T10:00:00.000Z",
          };
        },
      },
    });
    assert.equal(insertedDecision, "hide_from_queue");
    assert.equal(signalStatusAtWrite, "active", "callback decision must not mutate operational signal status");
  } finally {
    process.env.TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_ENABLED = previousQueue;
    process.env.TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_SEND_ENABLED = previousSend;
    process.env.TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_BUTTONS_ENABLED = previousButtons;
    clearPendingTpSignalReviewStateForTest();
  }

  for (const bucket of ["silent_skip_with_cues", "obvious_auto_record"] as const) {
    if (isTpSignalReviewQueueBucket(bucket)) {
      failures.push(`${bucket} should be excluded from Telegram v1 queue buckets`);
    }
  }

  const queueCard = buildTpSignalReviewCardForQueueItem({
    bucket: "review_required",
    item: reviewRequiredItem,
    signalShortId: SIGNAL_SHORT,
    queueState: "pending",
    latestDecision: null,
  });
  assert.match(queueCard.text, /🟡 Проверить сигнал/u);

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tp-signals-review-queue-no-write-"));
  const reportPath = path.join(tempRoot, "reports", "tp-signals-review-queue", "should-not-exist");
  if (fs.existsSync(reportPath)) {
    failures.push("unexpected report dir before no-write diagnostic");
  }

  console.log(`${LOG_PREFIX} cases=12`);
  console.log(`- review_required included: ${reviewRequiredItem.bucket}`);
  console.log(`- close_candidate_review included: ${closeCandidateItem.bucket}`);
  console.log(`- obvious_auto_record excluded from queue: ${baseSelection.totalSelected}`);
  console.log(`- acknowledged suppresses card: ${hiddenSelection.totalSelected}`);
  console.log(`- keep_visible stays visible: ${keepVisibleSelection.wouldSendCount}`);
  console.log(`- callback writes review decision only: ${insertedDecision ?? "n/a"}`);
  console.log(`- feature flags default off: queue=${String(flags.queueEnabled)} send=${String(flags.sendEnabled)}`);

  if (failures.length > 0) {
    console.error(`${LOG_PREFIX} FAIL`);
    for (const failure of failures) {
      console.error(`  • ${failure}`);
    }
    process.exit(1);
  }

  console.log(`${LOG_PREFIX} PASS (12/12)`);
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
