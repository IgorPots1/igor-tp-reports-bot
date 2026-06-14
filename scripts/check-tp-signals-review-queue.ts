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
  TP_SIGNAL_REVIEW_CALLBACK_CLOSE_SIGNAL_PREFIX,
  TP_SIGNAL_REVIEW_CALLBACK_HIDE_PREFIX,
} from "@/features/trainingpeaks/tp-signals-review-card";
import {
  buildTpSignalReviewCardForQueueItem,
  buildTpSignalsReviewQueueLaunchMarkup,
  clearPendingTpSignalReviewStateForTest,
  getTrainingPeaksTpSignalReviewQueueFeatureFlags,
  getTrainingPeaksTpSignalReviewQueueManualLimit,
  handleTpSignalReviewCallback,
  handleTpSignalReviewQueueManualLaunch,
  isTrainingPeaksTpSignalReviewQueueButtonsEnabled,
  isTrainingPeaksTpSignalReviewQueueEnabled,
  isTrainingPeaksTpSignalReviewQueueManualSendEnabled,
  isTrainingPeaksTpSignalReviewQueueMutationsEnabled,
  isTrainingPeaksTpSignalReviewQueueSendEnabled,
  notifyCoachTpSignalReviewQueue,
  TP_SIGNALS_REVIEW_QUEUE_LAUNCH_BUTTON_TEXT,
  TP_SIGNALS_REVIEW_QUEUE_START_CALLBACK,
} from "@/features/trainingpeaks/tp-signals-review-flow";
import {
  assignActiveSignalReviewBucket,
  type ActiveSignalReviewBucketItem,
} from "@/features/trainingpeaks/tp-signals-review-buckets-helpers";
import {
  formatTpSignalCategoryLabel,
  formatTpSignalReviewWhatHappened,
  resolveTpSignalReviewCardContext,
  TP_SIGNAL_REVIEW_CONTEXT_FALLBACK,
} from "@/features/trainingpeaks/tp-signals-review-coach-labels";
import {
  isTpSignalReviewQueueBucket,
  resolveTelegramReviewQueueInclusion,
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
  signalId = SIGNAL_ID,
  overrides?: {
    signal?: Partial<TrainingPeaksStudentOperationalSignal>;
    item?: Partial<TrainingPeaksOperationalSignalsItem>;
    studentName?: string;
    asOfDate?: string;
  }
): ActiveSignalReviewBucketItem {
  const signal = makeSignal(
    bucket === "close_candidate_review"
      ? {
          id: signalId,
          requiresCoachClose: true,
          lifecycleState: "ready_for_coach_close",
          ...overrides?.signal,
        }
      : { id: signalId, ...overrides?.signal }
  );
  const item = makeDiagnosticItem({ signalId, ...overrides?.item });
  return assignActiveSignalReviewBucket({
    studentName: overrides?.studentName ?? "Test Athlete",
    signal,
    item,
    evidence: null,
    asOfDate: overrides?.asOfDate ?? "2026-06-13",
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
  const elenaCloseCandidate = makeActiveBucketItem("close_candidate_review", "e1e1e1e1-e1e1-e1e1-e1e1-e1e1e1e1e1e1", {
    signal: {
      id: "e1e1e1e1-e1e1-e1e1-e1e1-e1e1e1e1e1e1",
      signalType: "health_issue_improving",
      requiresCoachClose: false,
      lifecycleState: "ready_for_coach_close",
    },
    item: {
      signalId: "e1e1e1e1-e1e1-e1e1-e1e1-e1e1e1e1e1e1",
      section: "health",
      text: "самочувствие нормализовалось",
      lifecycleDisplayState: "ready_for_coach_close",
    },
    studentName: "Elena Vasileva",
    asOfDate: "2026-06-15",
  });
  const genericPlanConstraint = makeActiveBucketItem("review_required", "p1p1p1p1-p1p1-p1p1-p1p1-p1p1p1p1p1p1", {
    signal: {
      id: "p1p1p1p1-p1p1-p1p1-p1p1-p1p1p1p1p1p1",
      signalType: "plan_generation_constraint",
      metadata: { classifier_confidence: "medium" },
      structuredPayload: {
        planned_training_dates: ["2026-06-16"],
        valid_until: "2026-06-18",
      },
    },
    item: {
      signalId: "p1p1p1p1-p1p1-p1p1-p1p1-p1p1p1p1p1p1",
      section: "plan_constraints",
      text: "учесть в плане: вт, чт",
      lifecycleDisplayState: "active_problem",
    },
    studentName: "Aleksandra Tararova",
    asOfDate: "2026-06-15",
  });
  const healthNegativeReview = makeActiveBucketItem("review_required", "h1h1h1h1-h1h1-h1h1-h1h1-h1h1h1h1h1h1", {
    signal: {
      id: "h1h1h1h1-h1h1-h1h1-h1h1-h1h1h1h1h1h1",
      signalType: "health_issue_started",
      metadata: { classifier_confidence: "medium" },
    },
    item: {
      signalId: "h1h1h1h1-h1h1-h1h1-h1h1-h1h1h1h1h1h1",
      section: "health",
      text: "горло болит, кашель",
      lifecycleDisplayState: "active_problem",
    },
    studentName: "Health Negative Athlete",
    asOfDate: "2026-06-15",
  });
  const painAmbiguousReview = makeActiveBucketItem("review_required", "p2p2p2p2-p2p2-p2p2-p2p2-p2p2p2p2p2p2", {
    signal: {
      id: "p2p2p2p2-p2p2-p2p2-p2p2-p2p2p2p2p2p2",
      signalType: "pain_injury",
      metadata: { classifier_confidence: "medium" },
    },
    item: {
      signalId: "p2p2p2p2-p2p2-p2p2-p2p2-p2p2p2p2p2p2",
      section: "pain_injury",
      text: "самочувствие улучшается — уточнить, болит ли сейчас",
      lifecycleDisplayState: "needs_review",
    },
    studentName: "Pain Ambiguous Athlete",
    asOfDate: "2026-06-15",
  });
  const moveWithDates = makeActiveBucketItem("review_required", "m1m1m1m1-m1m1-m1m1-m1m1-m1m1m1m1m1m1", {
    signal: {
      id: "m1m1m1m1-m1m1-m1m1-m1m1-m1m1m1m1m1m1",
      signalType: "move_workout_candidate",
      sourceDate: "2026-06-13",
      targetDate: "2026-06-14",
      metadata: { classifier_confidence: "medium" },
    },
    item: {
      signalId: "m1m1m1m1-m1m1-m1m1-m1m1-m1m1m1m1m1m1",
      section: "moves",
      text: "кандидат переноса 2026-06-13 → 2026-06-14",
      lifecycleDisplayState: "needs_review",
    },
    studentName: "Demian Diachenko",
    asOfDate: "2026-06-15",
  });
  const moveMissingDates = makeActiveBucketItem("review_required", "m2m2m2m2-m2m2-m2m2-m2m2-m2m2m2m2m2m2", {
    signal: {
      id: "m2m2m2m2-m2m2-m2m2-m2m2-m2m2m2m2m2m2",
      signalType: "move_workout_candidate",
      sourceDate: null,
      targetDate: null,
      metadata: { classifier_confidence: "medium" },
    },
    item: {
      signalId: "m2m2m2m2-m2m2-m2m2-m2m2-m2m2m2m2m2m2",
      section: "moves",
      text: "кандидат переноса — → —",
      lifecycleDisplayState: "needs_review",
    },
    studentName: "Darya Khmelkova",
    asOfDate: "2026-06-15",
  });
  const hiddenRecoveryRun = makeActiveBucketItem("review_required", "h3h3h3h3-h3h3-h3h3-h3h3-h3h3h3h3h3h3", {
    signal: {
      id: "h3h3h3h3-h3h3-h3h3-h3h3-h3h3h3h3h3h3",
      signalType: "health_issue_improving",
      metadata: { classifier_confidence: "medium" },
    },
    item: {
      signalId: "h3h3h3h3-h3h3-h3h3-h3h3-h3h3h3h3h3h3",
      section: "health",
      text: "после болезни чистая пробежка",
      lifecycleDisplayState: "active_problem",
      hiddenReason: "auto_hidden_clean_recovery_run",
    },
    studentName: "Darya Khmelkova",
    asOfDate: "2026-06-15",
  });
  const supersededHidden = makeActiveBucketItem("review_required", "s1s1s1s1-s1s1-s1s1-s1s1-s1s1s1s1s1s1", {
    signal: {
      id: "s1s1s1s1-s1s1-s1s1-s1s1-s1s1s1s1s1s1",
      signalType: "pain_injury",
      metadata: { classifier_confidence: "medium" },
    },
    item: {
      signalId: "s1s1s1s1-s1s1-s1s1-s1s1-s1s1s1s1s1s1",
      section: "pain_injury",
      text: "старый сигнал заменён новым",
      lifecycleDisplayState: "active_problem",
      hiddenReason: "superseded_signal_hidden",
    },
    studentName: "slava Taranec",
    asOfDate: "2026-06-15",
  });
  const staleGenericScheduleHidden = makeActiveBucketItem("review_required", "s2s2s2s2-s2s2-s2s2-s2s2-s2s2s2s2s2s2", {
    signal: {
      id: "s2s2s2s2-s2s2-s2s2-s2s2-s2s2s2s2s2s2",
      signalType: "schedule_unavailability_window",
      metadata: { classifier_confidence: "medium" },
    },
    item: {
      signalId: "s2s2s2s2-s2s2-s2s2-s2s2-s2s2s2s2s2s2",
      section: "schedule",
      text: "не могу в среду",
      lifecycleDisplayState: "active_problem",
      hiddenReason: "stale_generic_schedule_unavailability",
    },
    studentName: "Sofia Vlasova",
    asOfDate: "2026-06-15",
  });
  const hiddenRecommendedReview = makeActiveBucketItem("review_required", "h4h4h4h4-h4h4-h4h4-h4h4-h4h4h4h4h4h4", {
    signal: {
      id: "h4h4h4h4-h4h4-h4h4-h4h4-h4h4h4h4h4h4",
      signalType: "health_issue_started",
      metadata: { classifier_confidence: "medium" },
    },
    item: {
      signalId: "h4h4h4h4-h4h4-h4h4-h4h4-h4h4h4h4h4h4",
      section: "health",
      text: "скрытый сигнал",
      lifecycleDisplayState: "active_problem",
      hiddenReason: "expired_schedule_window",
    },
    studentName: "Larionova",
    asOfDate: "2026-06-15",
  });
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

  const activeItems = [
    reviewRequiredItem,
    closeCandidateItem,
    elenaCloseCandidate,
    genericPlanConstraint,
    healthNegativeReview,
    painAmbiguousReview,
    moveWithDates,
    moveMissingDates,
    hiddenRecoveryRun,
    supersededHidden,
    staleGenericScheduleHidden,
    hiddenRecommendedReview,
    obviousAutoItem,
  ];
  const baseSelection = selectTpSignalReviewQueueItems({ activeItems });
  if (baseSelection.totalSelected !== 6) {
    failures.push(`expected 6 queue items after selector tightening, got ${baseSelection.totalSelected}`);
  }
  if (baseSelection.includedBeforeLimit !== 6) {
    failures.push(`expected 6 included before limit, got ${baseSelection.includedBeforeLimit}`);
  }
  if (baseSelection.excludedFromQueue < 4) {
    failures.push(`expected at least 4 hidden/generic exclusions, got ${baseSelection.excludedFromQueue}`);
  }
  if (baseSelection.byBucket.review_required !== 4 || baseSelection.byBucket.close_candidate_review !== 2) {
    failures.push("queue bucket counts mismatch after selector tightening");
  }
  if (baseSelection.items[0]?.bucket !== "close_candidate_review") {
    failures.push("close candidates should sort before review_required");
  }
  if (baseSelection.items.some((item) => item.item.signalId === genericPlanConstraint.signalId)) {
    failures.push("generic plan constraint should be excluded from Telegram queue");
  }
  if (baseSelection.items.some((item) => item.item.signalId === moveMissingDates.signalId)) {
    failures.push("move candidate with missing dates should be excluded from Telegram queue");
  }
  if (!baseSelection.items.some((item) => item.item.signalId === elenaCloseCandidate.signalId)) {
    failures.push("Elena-like close candidate should remain in Telegram queue");
  }
  if (!baseSelection.items.some((item) => item.item.signalId === healthNegativeReview.signalId)) {
    failures.push("health negative review_required should remain in Telegram queue");
  }
  if (!baseSelection.items.some((item) => item.item.signalId === painAmbiguousReview.signalId)) {
    failures.push("pain ambiguous review_required should remain in Telegram queue");
  }
  if (!baseSelection.items.some((item) => item.item.signalId === moveWithDates.signalId)) {
    failures.push("move candidate with actionable dates should remain in Telegram queue");
  }

  const genericPlanInclusion = resolveTelegramReviewQueueInclusion(genericPlanConstraint);
  if (genericPlanInclusion.include) {
    failures.push("generic plan constraint inclusion resolver should exclude");
  }
  if (genericPlanInclusion.exclusionReason !== "generic_schedule_or_plan_constraint") {
    failures.push(`expected generic_schedule_or_plan_constraint exclusion, got ${genericPlanInclusion.exclusionReason}`);
  }

  const moveMissingInclusion = resolveTelegramReviewQueueInclusion(moveMissingDates);
  if (moveMissingInclusion.include || moveMissingInclusion.exclusionReason !== "move_missing_dates") {
    failures.push("move missing dates inclusion resolver mismatch");
  }

  for (const [label, hiddenItem] of [
    ["hidden recovery run", hiddenRecoveryRun],
    ["superseded hidden", supersededHidden],
    ["stale generic schedule hidden", staleGenericScheduleHidden],
    ["hidden recommended review", hiddenRecommendedReview],
  ] as const) {
    const inclusion = resolveTelegramReviewQueueInclusion(hiddenItem);
    if (inclusion.include) {
      failures.push(`${label} should be excluded from Telegram queue`);
    }
    if (inclusion.exclusionReason !== "hidden_display_state") {
      failures.push(`${label} expected hidden_display_state exclusion, got ${inclusion.exclusionReason}`);
    }
    if (baseSelection.items.some((item) => item.item.signalId === hiddenItem.signalId)) {
      failures.push(`${label} leaked into selected queue items`);
    }
  }

  const limitOneSelection = selectTpSignalReviewQueueItems({
    activeItems: [
      reviewRequiredItem,
      healthNegativeReview,
      painAmbiguousReview,
      moveWithDates,
      closeCandidateItem,
    ],
    limit: 1,
  });
  if (limitOneSelection.totalSelected !== 1) {
    failures.push(`limit=1 should select one item, got ${limitOneSelection.totalSelected}`);
  }
  if (limitOneSelection.items[0]?.bucket !== "close_candidate_review") {
    failures.push("limit=1 should prioritize close_candidate_review over review_required");
  }

  const limitTwoSelection = selectTpSignalReviewQueueItems({
    activeItems: [reviewRequiredItem, closeCandidateItem, elenaCloseCandidate, healthNegativeReview],
    limit: 2,
  });
  if (
    limitTwoSelection.items.length !== 2 ||
    limitTwoSelection.items.every((item) => item.bucket !== "close_candidate_review")
  ) {
    failures.push("limit=2 with two close candidates should include both close candidates first");
  }

  if (baseSelection.items.some((item) => item.bucket === "obvious_auto_record" as never)) {
    failures.push("obvious_auto_record leaked into queue");
  }

  const hiddenSelection = selectTpSignalReviewQueueItems({
    activeItems,
    latestDecisionsBySignalId: new Map([[SIGNAL_ID, makeDecision("acknowledged")]]),
  });
  if (hiddenSelection.totalSelected !== 5) {
    failures.push(`acknowledged decision should suppress review_required card, got ${hiddenSelection.totalSelected}`);
  }

  const keepVisibleSelection = selectTpSignalReviewQueueItems({
    activeItems,
    latestDecisionsBySignalId: new Map([[SIGNAL_ID, makeDecision("keep_visible")]]),
  });
  if (keepVisibleSelection.wouldSendCount < 6) {
    failures.push("keep_visible should keep card visible in would-send count");
  }

  const previousDebugId = process.env.TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_SHOW_DEBUG_ID;
  process.env.TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_SHOW_DEBUG_ID = "false";

  const reviewCard = formatTpSignalReviewCardText({
    bucket: "review_required",
    studentName: "Test Athlete",
    category: "health_pause",
    reason: "ambiguous_or_non_high_confidence_active_signal",
    sourcePreview: "горло болит",
    state: "needs_review",
    signalShortId: SIGNAL_SHORT,
  });
  assert.match(reviewCard, /🟡 Проверить сигнал/u);
  assert.match(reviewCard, /👤 Test Athlete/u);
  assert.match(reviewCard, /Категория: болезнь \/ пауза/u);
  assert.match(reviewCard, /Что произошло:/u);
  assert.match(reviewCard, /Почему в очереди:/u);
  assert.match(reviewCard, /Состояние:\nТребует проверки/u);
  assert.doesNotMatch(reviewCard, /health_pause/u);
  assert.doesNotMatch(reviewCard, /needs_review/u);
  assert.doesNotMatch(reviewCard, /classifier_confidence/u);
  assert.doesNotMatch(reviewCard, /#a1b2c3d4/u);

  const closeCard = formatTpSignalReviewCardText({
    bucket: "close_candidate_review",
    studentName: "Test Athlete",
    category: "pain_injury",
    reason: "ready_for_coach_close",
    lifecycleReason: "ready_for_coach_close",
    sourcePreview: "боль / спин — свежий ответ: Есть парк — закрыть после проверки",
    state: "close_candidate",
    signalShortId: SIGNAL_SHORT,
  });
  assert.match(closeCard, /🔵 Можно закрыть после проверки/u);
  assert.match(closeCard, /Категория: боль \/ травма/u);
  assert.match(closeCard, /Состояние:\nКандидат на закрытие/u);
  assert.doesNotMatch(closeCard, /pain_injury/u);
  assert.doesNotMatch(closeCard, /ready_for_coach_close/u);

  const ivanovCard = formatTpSignalReviewCardText({
    bucket: "review_required",
    studentName: "Alexander Ivanov",
    category: "health_pause",
    reason: "classifier_confidence=medium",
    sourcePreview: "после болезни: пробежка 11.06 была — проверить самочувствие после пробежки.",
    state: "active_problem",
    signalShortId: "9b201054",
  });
  assert.match(ivanovCard, /👤 Alexander Ivanov/u);
  assert.match(ivanovCard, /Категория: болезнь \/ пауза/u);
  assert.match(ivanovCard, /После болезни была пробежка 11\.06 — нужно проверить самочувствие после пробежки\./u);
  assert.match(ivanovCard, /Сигнал не до конца однозначный, лучше проверить вручную\./u);
  assert.match(ivanovCard, /Состояние:\nАктивный вопрос/u);
  assert.doesNotMatch(ivanovCard, /health_pause|active_problem|classifier_confidence/u);

  const trofimovCard = formatTpSignalReviewCardText({
    bucket: "review_required",
    studentName: "Stepan Trofimov",
    category: "pain_injury",
    reason: "recommended_state=needs_review; latest_negative_evidence; classifier_confidence=medium",
    sourcePreview: "самочувствие улучшается — уточнить, болит ли сейчас и мешает ли тренировкам",
    state: "needs_review",
    signalShortId: "8dbd2492",
  });
  assert.match(trofimovCard, /👤 Stepan Trofimov/u);
  assert.match(trofimovCard, /Категория: боль \/ травма/u);
  assert.match(
    trofimovCard,
    /Есть жалоба или неясное самочувствие, нужно решение тренера\./u
  );
  assert.match(trofimovCard, /Состояние:\nТребует проверки/u);
  assert.doesNotMatch(
    trofimovCard,
    /pain_injury|needs_review|recommended_state|latest_negative_evidence|classifier_confidence/u
  );

  const planConstraintIncluded = makeActiveBucketItem("review_required", "pl1pl1pl-pl1p-pl1p-pl1p-pl1pl1pl1pl1", {
    signal: {
      id: "pl1pl1pl-pl1p-pl1p-pl1p-pl1pl1pl1pl1",
      signalType: "schedule_unavailability_window",
      structuredPayload: { unavailable_dates: ["2026-06-10"] },
    },
    item: {
      signalId: "pl1pl1pl-pl1p-pl1p-pl1p-pl1pl1pl1pl1",
      section: "schedule",
      text: "Ср не может тренироваться — учесть перенос/альтернативу",
      lifecycleDisplayState: "needs_review",
    },
    studentName: "Schedule Athlete",
    asOfDate: "2026-06-15",
  });
  const planConstraintInclusion = resolveTelegramReviewQueueInclusion(planConstraintIncluded);
  if (!planConstraintInclusion.include) {
    failures.push("schedule constraint with strong review reason should be includable for card test");
  }
  const planConstraintCard = formatTpSignalReviewCardText({
    bucket: "review_required",
    studentName: "Schedule Athlete",
    category: "schedule",
    signalType: "schedule_unavailability_window",
    reason: "recommended_state=needs_review; partial_or_stale_schedule_payload",
    sourcePreview: planConstraintIncluded.preview,
    explainRecord: planConstraintIncluded.explainRecord,
    state: "needs_review",
    signalShortId: "pl1pl1pl",
  });
  assert.match(planConstraintCard, /Что произошло:/u);
  assert.match(planConstraintCard, /Ограничение по плану: недоступна 2026-06-10/u);

  const schedulePreviewContext = resolveTpSignalReviewCardContext({
    bucket: "review_required",
    category: "schedule",
    signalType: "schedule_unavailability_window",
    preview: "Ср не может тренироваться — учесть перенос/альтернативу",
    explainRecord: {
      normalized_dates: {
        source_date: null,
        target_date: null,
        valid_until: null,
        planned_training_dates: [],
        unavailable_dates: [],
      },
      source_snippets: [],
      latest_positive_evidence: [],
      latest_negative_evidence: [],
      visible_output: "Ср не может тренироваться — учесть перенос/альтернативу",
    },
  });
  assert.match(schedulePreviewContext.text, /Ср не может тренироваться/u);

  const illnessCard = formatTpSignalReviewCardText({
    bucket: "review_required",
    studentName: "Illness Athlete",
    category: "health_pause",
    signalType: "health_issue_started",
    reason: "classifier_confidence=medium",
    sourcePreview: "болеет, кашель",
    state: "active_problem",
    signalShortId: "ill11111",
  });
  assert.match(illnessCard, /Что произошло:/u);
  assert.match(illnessCard, /болеет|кашель/iu);

  const closeCandidateCard = formatTpSignalReviewCardText({
    bucket: "close_candidate_review",
    studentName: "Elena Vasileva",
    category: "health_pause",
    signalType: "health_issue_improving",
    reason: "ready_for_coach_close",
    sourcePreview: "самочувствие нормализовалось — новых жалоб нет",
    explainRecord: {
      normalized_dates: {
        source_date: null,
        target_date: null,
        valid_until: null,
        planned_training_dates: [],
        unavailable_dates: [],
      },
      source_snippets: ["после болезни лёгкий выход"],
      latest_positive_evidence: ["новых жалоб нет"],
      latest_negative_evidence: [],
      visible_output: "самочувствие нормализовалось",
    },
    state: "close_candidate",
    signalShortId: "e1e1e1e1",
  });
  assert.match(closeCandidateCard, /Что произошло:/u);
  assert.match(closeCandidateCard, /лёгкий выход|новых жалоб нет/iu);

  const moveDatesCard = formatTpSignalReviewCardText({
    bucket: "review_required",
    studentName: "Demian Diachenko",
    category: "moves",
    signalType: "move_workout_candidate",
    reason: "move_with_actionable_dates",
    sourcePreview: moveWithDates.preview,
    explainRecord: moveWithDates.explainRecord,
    state: "needs_review",
    signalShortId: "m1m1m1m1",
  });
  assert.match(moveDatesCard, /Что произошло:/u);
  assert.match(moveDatesCard, /13\.06.*14\.06/u);

  const weakSummaryContext = resolveTpSignalReviewCardContext({
    bucket: "review_required",
    category: "plan_constraints",
    signalType: "plan_generation_constraint",
    preview: "учесть в плане",
    explainRecord: {
      normalized_dates: {
        source_date: null,
        target_date: null,
        valid_until: null,
        planned_training_dates: [],
        unavailable_dates: [],
      },
      source_snippets: ["В среду не могу тренироваться"],
      latest_positive_evidence: [],
      latest_negative_evidence: [],
      visible_output: "учесть в плане",
    },
  });
  if (weakSummaryContext.source !== "source_observation") {
    failures.push(`weak summary should use source_observation, got ${weakSummaryContext.source}`);
  }
  assert.match(weakSummaryContext.text, /Исходное сообщение/u);
  assert.match(weakSummaryContext.text, /среду не могу тренироваться/iu);

  const fallbackContext = resolveTpSignalReviewCardContext({
    bucket: "review_required",
    category: "other",
    signalType: "other",
    preview: null,
    explainRecord: {
      normalized_dates: {
        source_date: null,
        target_date: null,
        valid_until: null,
        planned_training_dates: [],
        unavailable_dates: [],
      },
      source_snippets: [],
      latest_positive_evidence: [],
      latest_negative_evidence: [],
      visible_output: "",
    },
  });
  if (fallbackContext.source !== "fallback_missing" || fallbackContext.hasContext) {
    failures.push("empty context should use fallback_missing");
  }
  assert.equal(fallbackContext.text, TP_SIGNAL_REVIEW_CONTEXT_FALLBACK);

  const technicalFreeCard = formatTpSignalReviewCardText({
    bucket: "review_required",
    studentName: "Clean Athlete",
    category: "health_pause",
    signalType: "health_issue_started",
    reason: "recommended_state=needs_review; latest_negative_evidence",
    sourcePreview: "горло болит",
    state: "needs_review",
    signalShortId: "clean111",
  });
  assert.doesNotMatch(
    technicalFreeCard,
    /health_pause|pain_injury|plan_generation_constraint|classifier_confidence|recommended_state|latest_negative_evidence|active_problem|needs_review|hidden=/iu
  );

  process.env.TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_SHOW_DEBUG_ID = "true";
  const debugCard = formatTpSignalReviewCardText({
    bucket: "review_required",
    studentName: "Test Athlete",
    category: "health_pause",
    reason: "classifier_confidence=medium",
    sourcePreview: "горло болит",
    state: "active_problem",
    signalShortId: "9b201054",
  });
  assert.match(debugCard, /ID: 9b201054/u);
  process.env.TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_SHOW_DEBUG_ID = previousDebugId;

  const reviewMarkup = getTpSignalReviewCardMarkup("review_required", SIGNAL_SHORT);
  assert.equal(reviewMarkup.inline_keyboard.length, 2);
  assert.equal(reviewMarkup.inline_keyboard[0]?.[0]?.text, "✅ Актуально");
  assert.equal(reviewMarkup.inline_keyboard[0]?.[1]?.text, "✅ Закрыть сигнал");
  assert.equal(reviewMarkup.inline_keyboard[1]?.[0]?.text, "🙈 Это шум");
  assert.equal(reviewMarkup.inline_keyboard[1]?.[1]?.text, "📝 Проверить позже");
  assert.equal(
    parseTpSignalReviewCallback(reviewMarkup.inline_keyboard[0]?.[0]?.callback_data ?? null)?.kind,
    "acknowledged"
  );
  assert.equal(
    parseTpSignalReviewCallback(reviewMarkup.inline_keyboard[0]?.[1]?.callback_data ?? null)?.kind,
    "close_signal"
  );
  assert.equal(
    mapTpSignalReviewCallbackToDecision(
      parseTpSignalReviewCallback(reviewMarkup.inline_keyboard[1]?.[0]?.callback_data ?? null)!
    ),
    "hide_from_queue"
  );

  const closeMarkup = getTpSignalReviewCardMarkup("close_candidate_review", SIGNAL_SHORT);
  assert.equal(closeMarkup.inline_keyboard.length, 2);
  assert.equal(closeMarkup.inline_keyboard[0]?.[0]?.text, "✅ Закрыть сигнал");
  assert.equal(closeMarkup.inline_keyboard[0]?.[1]?.text, "👀 Оставить активным");
  assert.equal(closeMarkup.inline_keyboard[1]?.[0]?.text, "📝 Проверю вручную");

  const parsedClose = parseTpSignalReviewCallback(`${TP_SIGNAL_REVIEW_CALLBACK_CLOSE_SIGNAL_PREFIX}${SIGNAL_SHORT}`);
  assert.equal(parsedClose?.kind, "close_signal");
  assert.equal(mapTpSignalReviewCallbackToDecision(parsedClose!), "close_signal");

  const parsedAck = parseTpSignalReviewCallback(`${TP_SIGNAL_REVIEW_CALLBACK_ACKNOWLEDGED_PREFIX}${SIGNAL_SHORT}`);
  assert.equal(parsedAck?.kind, "acknowledged");
  assert.equal(mapTpSignalReviewCallbackToDecision(parsedAck!), "acknowledged");

  const previousQueue = process.env.TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_ENABLED;
  const previousSend = process.env.TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_SEND_ENABLED;
  const previousManualSend = process.env.TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_MANUAL_SEND_ENABLED;
  const previousManualLimit = process.env.TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_MANUAL_LIMIT;
  const previousButtons = process.env.TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_BUTTONS_ENABLED;
  const previousMutations = process.env.TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_MUTATIONS_ENABLED;
  let insertedDecision: string | null = null;
  let mutationAttempted = false;
  let flags = getTrainingPeaksTpSignalReviewQueueFeatureFlags();

  const makeStudent = () => ({
    id: "student-1",
    studentId: "student-1",
    studentName: "Test Athlete",
    trainingPeaksAthleteUrl: null,
    telegramChatId: null,
    telegramUsername: null,
    telegramFormality: "ty" as const,
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
  });

  try {
    process.env.TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_ENABLED = "false";
    process.env.TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_SEND_ENABLED = "false";
    process.env.TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_MANUAL_SEND_ENABLED = "false";
    process.env.TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_BUTTONS_ENABLED = "false";
    process.env.TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_MUTATIONS_ENABLED = "false";

    assert.equal(isTrainingPeaksTpSignalReviewQueueEnabled(), false);
    assert.equal(isTrainingPeaksTpSignalReviewQueueSendEnabled(), false);
    assert.equal(isTrainingPeaksTpSignalReviewQueueButtonsEnabled(), false);
    assert.equal(isTrainingPeaksTpSignalReviewQueueMutationsEnabled(), false);

    const flagsOff = getTrainingPeaksTpSignalReviewQueueFeatureFlags();
    assert.equal(flagsOff.queueEnabled, false);
    assert.equal(flagsOff.sendEnabled, false);
    assert.equal(flagsOff.manualSendEnabled, false);
    assert.equal(flagsOff.buttonsEnabled, false);
    assert.equal(flagsOff.mutationsEnabled, false);
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
    mutationAttempted = false;
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
        getStudentById: async () => makeStudent(),
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
        dismissSignalByReviewQueue: async () => {
          mutationAttempted = true;
          return { updated: true, previousStatus: "active", newStatus: "dismissed" };
        },
      },
    });
    assert.equal(callbackResult, "handled");
    assert.equal(insertedDecision, null, "buttons disabled should not write review decision");
    assert.equal(mutationAttempted, false);

    process.env.TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_BUTTONS_ENABLED = "true";
    clearPendingTpSignalReviewStateForTest();
    signalStatusAtWrite = "active";
    insertedDecision = null;
    mutationAttempted = false;
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
        getStudentById: async () => makeStudent(),
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
        dismissSignalByReviewQueue: async () => {
          mutationAttempted = true;
          return { updated: true, previousStatus: "active", newStatus: "dismissed" };
        },
      },
    });
    assert.equal(insertedDecision, "hide_from_queue");
    assert.equal(signalStatusAtWrite, "active", "mutations off must not mutate operational signal status");
    assert.equal(mutationAttempted, false, "mutations off must not call dismiss mutation");

    clearPendingTpSignalReviewStateForTest();
    mutationAttempted = false;
    let resolvedMutationAttempted = false;
    process.env.TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_MUTATIONS_ENABLED = "true";
    await handleTpSignalReviewCallback({
      callback: parseTpSignalReviewCallback(`${TP_SIGNAL_REVIEW_CALLBACK_CLOSE_SIGNAL_PREFIX}${SIGNAL_SHORT}`)!,
      coachChatId: "coach-chat-no-pending",
      coachMessageId: 43,
      callbackQueryId: "cb-3",
      deps: {
        now: () => 1_700_000_000_000,
        answerCallback: async () => undefined,
        editCoachMessage: async () => undefined,
        getSignalByIdPrefix: async () => makeSignal({ status: "active" }),
        getStudentById: async () => makeStudent(),
        insertReviewDecision: async (input) => ({
          id: "decision-3",
          signalId: input.signalId,
          studentId: input.studentId ?? null,
          bucket: input.bucket,
          decision: input.decision,
          decisionSource: input.decisionSource,
          coachTelegramUserId: input.coachTelegramUserId ?? null,
          callbackShortId: input.callbackShortId ?? null,
          metadata: input.metadata ?? {},
          createdAt: "2026-06-13T10:00:00.000Z",
        }),
        markSignalResolvedByReviewQueue: async () => {
          resolvedMutationAttempted = true;
          return { updated: true, previousStatus: "active", newStatus: "dismissed" };
        },
        dismissSignalByReviewQueue: async () => {
          mutationAttempted = true;
          return { updated: false, previousStatus: "active", newStatus: "active", reason: "no_mutation_needed" };
        },
      },
    });
    assert.equal(resolvedMutationAttempted, true, "close_signal should resolve without pending map");
    assert.equal(mutationAttempted, false, "close_signal should not call dismiss mutation");

    clearPendingTpSignalReviewStateForTest();
    let staleAnswer: string | undefined;
    await handleTpSignalReviewCallback({
      callback: parseTpSignalReviewCallback(`${TP_SIGNAL_REVIEW_CALLBACK_ACKNOWLEDGED_PREFIX}${SIGNAL_SHORT}`)!,
      coachChatId: "coach-chat",
      coachMessageId: 44,
      callbackQueryId: "cb-4",
      deps: {
        now: () => 1_700_000_000_000,
        answerCallback: async (_id, text) => {
          staleAnswer = text;
        },
        editCoachMessage: async () => undefined,
        getSignalByIdPrefix: async () => makeSignal({ status: "dismissed" }),
        getStudentById: async () => makeStudent(),
        insertReviewDecision: async () => {
          throw new Error("stale signal must not write decision");
        },
      },
    });
    assert.match(staleAnswer ?? "", /Не нашёл активный сигнал/u);

    const launchMarkup = buildTpSignalsReviewQueueLaunchMarkup();
    assert.equal(launchMarkup.inline_keyboard.length, 1);
    assert.equal(launchMarkup.inline_keyboard[0]?.[0]?.text, TP_SIGNALS_REVIEW_QUEUE_LAUNCH_BUTTON_TEXT);
    assert.equal(launchMarkup.inline_keyboard[0]?.[0]?.callback_data, TP_SIGNALS_REVIEW_QUEUE_START_CALLBACK);
    assert.equal(TP_SIGNALS_REVIEW_QUEUE_START_CALLBACK, "tp:signals:review_queue:start");
    assert.equal(parseTpSignalReviewCallback(TP_SIGNALS_REVIEW_QUEUE_START_CALLBACK), null);

    delete process.env.TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_MANUAL_LIMIT;
    assert.equal(getTrainingPeaksTpSignalReviewQueueManualLimit(), 5);
    process.env.TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_MANUAL_LIMIT = "3";
    assert.equal(getTrainingPeaksTpSignalReviewQueueManualLimit(), 3);

    process.env.TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_ENABLED = "true";
    process.env.TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_MANUAL_SEND_ENABLED = "false";
    process.env.TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_SEND_ENABLED = "false";
    let manualLaunchAnswer: string | undefined;
    await handleTpSignalReviewQueueManualLaunch({
      coachChatId: "coach-chat",
      callbackQueryId: "manual-disabled",
      deps: {
        answerCallback: async (_id, text) => {
          manualLaunchAnswer = text;
        },
      },
    });
    assert.equal(manualLaunchAnswer, "Review Queue сейчас выключена.");

    process.env.TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_MANUAL_SEND_ENABLED = "true";
    let manualLaunchSentCount = 0;
    let manualLaunchDecisionWrites = 0;
    manualLaunchAnswer = undefined;
    await handleTpSignalReviewQueueManualLaunch({
      coachChatId: "coach-chat-manual",
      callbackQueryId: "manual-send",
      deps: {
        collectSelection: async () => baseSelection,
        answerCallback: async (_id, text) => {
          manualLaunchAnswer = text;
        },
        sendCoachMessage: async () => {
          manualLaunchSentCount += 1;
          return { messageId: manualLaunchSentCount, chatId: "coach-chat-manual" };
        },
        insertReviewDecision: async () => {
          manualLaunchDecisionWrites += 1;
          throw new Error("manual launch must not write review decisions");
        },
      },
    });
    assert.equal(manualLaunchDecisionWrites, 0, "manual launch must not mutate signals");
    assert.equal(manualLaunchSentCount, baseSelection.wouldSendCount);
    assert.match(manualLaunchAnswer ?? "", /Отправил .* на разбор/u);

    process.env.TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_MANUAL_SEND_ENABLED = "true";
    process.env.TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_SEND_ENABLED = "false";
    const manualOnlySendResult = await notifyCoachTpSignalReviewQueue({
      items: baseSelection.items,
      sendMode: "manual",
      targetCoachChatId: "coach-chat-manual-only",
      deps: {
        sendCoachMessage: async () => ({ messageId: 1, chatId: "coach-chat-manual-only" }),
      },
    });
    assert.equal(manualOnlySendResult.status, "sent");
    const autoSendBlockedResult = await notifyCoachTpSignalReviewQueue({
      items: baseSelection.items,
      sendMode: "auto",
    });
    assert.equal(autoSendBlockedResult.status, "send_disabled");

    process.env.TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_ENABLED = "false";
    manualLaunchAnswer = undefined;
    await handleTpSignalReviewQueueManualLaunch({
      coachChatId: "coach-chat",
      callbackQueryId: "manual-queue-disabled",
      deps: {
        answerCallback: async (_id, text) => {
          manualLaunchAnswer = text;
        },
      },
    });
    assert.equal(manualLaunchAnswer, "Review Queue сейчас выключена.");

    const emptySelection = selectTpSignalReviewQueueItems({
      activeItems: [],
      latestDecisionsBySignalId: new Map<string, TpSignalReviewDecisionRecord>(),
      limit: 5,
    });
    assert.equal(emptySelection.wouldSendCount, 0);
    process.env.TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_ENABLED = "true";
    process.env.TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_MANUAL_SEND_ENABLED = "true";
    manualLaunchAnswer = undefined;
    manualLaunchSentCount = 0;
    await handleTpSignalReviewQueueManualLaunch({
      coachChatId: "coach-chat-empty",
      callbackQueryId: "manual-empty",
      deps: {
        collectSelection: async () => emptySelection,
        answerCallback: async (_id, text) => {
          manualLaunchAnswer = text;
        },
        sendCoachMessage: async () => {
          manualLaunchSentCount += 1;
          return { messageId: 1, chatId: "coach-chat-empty" };
        },
      },
    });
    assert.equal(manualLaunchSentCount, 0);
    assert.equal(
      manualLaunchAnswer,
      "✅ Сейчас нет спорных TP Signals для разбора."
    );
  } finally {
    process.env.TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_ENABLED = previousQueue;
    process.env.TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_SEND_ENABLED = previousSend;
    process.env.TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_MANUAL_SEND_ENABLED = previousManualSend;
    process.env.TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_MANUAL_LIMIT = previousManualLimit;
    process.env.TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_BUTTONS_ENABLED = previousButtons;
    process.env.TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_MUTATIONS_ENABLED = previousMutations;
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
    queueReason: "health_pain_review_required",
    sourceSignalRecommendedState: "needs_review",
    isCloseCandidate: false,
    decisionSuppressionReason: null,
    category: reviewRequiredItem.category,
    hasActionableDates: false,
    validUntil: null,
    sourceObservationId: reviewRequiredItem.sourceObservationId,
    queueExclusionReason: null,
  });
  assert.match(queueCard.text, /🟡 Проверить сигнал/u);
  assert.match(queueCard.text, /Что произошло:/u);

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tp-signals-review-queue-no-write-"));
  const reportPath = path.join(tempRoot, "reports", "tp-signals-review-queue", "should-not-exist");
  if (fs.existsSync(reportPath)) {
    failures.push("unexpected report dir before no-write diagnostic");
  }

  console.log(`${LOG_PREFIX} cases=58`);
  console.log(`- review_required included: ${reviewRequiredItem.bucket}`);
  console.log(`- close_candidate_review included: ${closeCandidateItem.bucket}`);
  console.log(`- close candidates sort first: ${baseSelection.items[0]?.bucket === "close_candidate_review"}`);
  console.log(`- hidden rows excluded: ${baseSelection.excludedFromQueue}`);
  console.log(`- limit=1 close candidate wins: ${limitOneSelection.items[0]?.bucket === "close_candidate_review"}`);
  console.log(`- generic plan constraint excluded: ${!baseSelection.items.some((item) => item.item.signalId === genericPlanConstraint.signalId)}`);
  console.log(`- move missing dates excluded: ${!baseSelection.items.some((item) => item.item.signalId === moveMissingDates.signalId)}`);
  console.log(`- health/pain review_required retained: ${baseSelection.items.some((item) => item.item.signalId === healthNegativeReview.signalId) && baseSelection.items.some((item) => item.item.signalId === painAmbiguousReview.signalId)}`);
  console.log(`- move with dates retained: ${baseSelection.items.some((item) => item.item.signalId === moveWithDates.signalId)}`);
  console.log(`- obvious_auto_record excluded from queue: ${baseSelection.totalSelected}`);
  console.log(`- acknowledged suppresses card: ${hiddenSelection.totalSelected}`);
  console.log(`- keep_visible stays visible: ${keepVisibleSelection.wouldSendCount}`);
  console.log(`- callback resolves without pending map: close_signal`);
  console.log(`- stale inactive signal safe no-op: ok`);
  console.log(`- manual launch button callback: ${TP_SIGNALS_REVIEW_QUEUE_START_CALLBACK}`);
  console.log(`- manual send independent of auto send: ok`);
  console.log(`- manual launch no mutation on trigger: ok`);
  console.log(`- feature flags default off: queue=${String(flags.queueEnabled)} send=${String(flags.sendEnabled)} manual=${String(isTrainingPeaksTpSignalReviewQueueManualSendEnabled())} mutations=${String(flags.mutationsEnabled)}`);

  if (failures.length > 0) {
    console.error(`${LOG_PREFIX} FAIL`);
    for (const failure of failures) {
      console.error(`  • ${failure}`);
    }
    process.exit(1);
  }

  console.log(`${LOG_PREFIX} PASS (58/58)`);
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
