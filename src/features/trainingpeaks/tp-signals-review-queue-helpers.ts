import {
  assignActiveSignalReviewBucket,
  type ActiveSignalReviewBucketItem,
  type ReviewBucketName,
} from "@/features/trainingpeaks/tp-signals-review-buckets-helpers";
import type { TrainingPeaksStudentOperationalSignal } from "@/features/trainingpeaks/repository";
import type {
  TrainingPeaksOperationalSignalDisplayEvidence,
  TrainingPeaksOperationalSignalsItem,
} from "@/features/trainingpeaks/service";

export type TpSignalReviewQueueBucket = "review_required" | "close_candidate_review";

export type TpSignalReviewDecisionName =
  | "acknowledged"
  | "keep_visible"
  | "hide_from_queue"
  | "close_candidate_seen"
  | "needs_manual_followup";

export type TpSignalReviewDecisionSource = "telegram_button" | "diagnostic" | "manual";

export type TpSignalReviewDecisionRecord = {
  signalId: string;
  studentId: string | null;
  bucket: TpSignalReviewQueueBucket;
  decision: TpSignalReviewDecisionName;
  decisionSource: TpSignalReviewDecisionSource;
  coachTelegramUserId: string | null;
  callbackShortId: string | null;
  createdAt: string;
  metadata: Record<string, unknown>;
};

export type TpSignalReviewQueueItem = {
  bucket: TpSignalReviewQueueBucket;
  item: ActiveSignalReviewBucketItem;
  signalShortId: string;
  queueState: "pending" | "hidden" | "keep_visible";
  latestDecision: TpSignalReviewDecisionRecord | null;
};

export type SelectTpSignalReviewQueueItemsInput = {
  activeItems: ActiveSignalReviewBucketItem[];
  latestDecisionsBySignalId?: Map<string, TpSignalReviewDecisionRecord>;
  includeReviewed?: boolean;
  limit?: number | null;
};

export type TpSignalReviewQueueSelectionSummary = {
  totalSelected: number;
  byBucket: Record<TpSignalReviewQueueBucket, number>;
  pendingCount: number;
  hiddenCount: number;
  keepVisibleCount: number;
  wouldSendCount: number;
  items: TpSignalReviewQueueItem[];
};

export const TP_SIGNAL_REVIEW_QUEUE_BUCKETS: readonly TpSignalReviewQueueBucket[] = [
  "review_required",
  "close_candidate_review",
] as const;

export const TP_SIGNAL_REVIEW_QUEUE_EXCLUDED_BUCKETS: readonly Exclude<
  ReviewBucketName,
  TpSignalReviewQueueBucket
>[] = ["obvious_auto_record", "silent_skip_with_cues"] as const;

export function isTpSignalReviewQueueBucket(
  bucket: ReviewBucketName
): bucket is TpSignalReviewQueueBucket {
  return bucket === "review_required" || bucket === "close_candidate_review";
}

export function normalizeTpSignalReviewDecisionName(
  value: string | null | undefined
): TpSignalReviewDecisionName | null {
  switch (value) {
    case "acknowledged":
    case "keep_visible":
    case "hide_from_queue":
    case "close_candidate_seen":
    case "needs_manual_followup":
      return value;
    default:
      return null;
  }
}

export function isReviewDecisionQueueSuppressed(decision: TpSignalReviewDecisionName): boolean {
  return decision !== "keep_visible";
}

export function resolveReviewQueueState(
  latestDecision: TpSignalReviewDecisionRecord | null | undefined
): "pending" | "hidden" | "keep_visible" {
  if (!latestDecision) {
    return "pending";
  }
  if (latestDecision.decision === "keep_visible") {
    return "keep_visible";
  }
  if (isReviewDecisionQueueSuppressed(latestDecision.decision)) {
    return "hidden";
  }
  return "pending";
}

export function buildActiveSignalReviewBucketItems(input: {
  signals: TrainingPeaksStudentOperationalSignal[];
  diagnosticItems: TrainingPeaksOperationalSignalsItem[];
  studentNameById: Map<string, string>;
  displayEvidenceBySignalId: Map<string, TrainingPeaksOperationalSignalDisplayEvidence>;
  asOfDate: string;
}): ActiveSignalReviewBucketItem[] {
  const diagnosticItemBySignalId = new Map(input.diagnosticItems.map((item) => [item.signalId, item]));
  const activeItems: ActiveSignalReviewBucketItem[] = [];

  for (const signal of input.signals) {
    const item = diagnosticItemBySignalId.get(signal.id);
    if (!item) {
      continue;
    }
    activeItems.push(
      assignActiveSignalReviewBucket({
        studentName: input.studentNameById.get(signal.studentId) ?? signal.studentId,
        signal,
        item,
        evidence: input.displayEvidenceBySignalId.get(signal.id) ?? null,
        asOfDate: input.asOfDate,
      })
    );
  }

  return activeItems;
}

export function selectTpSignalReviewQueueItems(
  input: SelectTpSignalReviewQueueItemsInput
): TpSignalReviewQueueSelectionSummary {
  const latestDecisionsBySignalId = input.latestDecisionsBySignalId ?? new Map();
  const queueItems: TpSignalReviewQueueItem[] = [];

  for (const item of input.activeItems) {
    if (!isTpSignalReviewQueueBucket(item.bucket)) {
      continue;
    }

    const latestDecision = latestDecisionsBySignalId.get(item.signalId) ?? null;
    const queueState = resolveReviewQueueState(latestDecision);
    if (!input.includeReviewed && queueState === "hidden") {
      continue;
    }

    queueItems.push({
      bucket: item.bucket,
      item,
      signalShortId: item.signalId.slice(0, 8).toLowerCase(),
      queueState,
      latestDecision,
    });
  }

  queueItems.sort((left, right) => {
    const bucketOrder =
      (left.bucket === "review_required" ? 0 : 1) - (right.bucket === "review_required" ? 0 : 1);
    if (bucketOrder !== 0) {
      return bucketOrder;
    }
    return left.item.studentName.localeCompare(right.item.studentName, "ru");
  });

  const limitedItems =
    input.limit && input.limit > 0 ? queueItems.slice(0, input.limit) : queueItems;

  const byBucket: Record<TpSignalReviewQueueBucket, number> = {
    review_required: limitedItems.filter((entry) => entry.bucket === "review_required").length,
    close_candidate_review: limitedItems.filter((entry) => entry.bucket === "close_candidate_review").length,
  };

  const pendingCount = limitedItems.filter((entry) => entry.queueState === "pending").length;
  const hiddenCount = limitedItems.filter((entry) => entry.queueState === "hidden").length;
  const keepVisibleCount = limitedItems.filter((entry) => entry.queueState === "keep_visible").length;

  return {
    totalSelected: limitedItems.length,
    byBucket,
    pendingCount,
    hiddenCount,
    keepVisibleCount,
    wouldSendCount: pendingCount + keepVisibleCount,
    items: limitedItems,
  };
}

export function formatTpSignalReviewQueueSummaryMarkdown(input: {
  generatedAt: string;
  asOfDate: string;
  scopeLabel: string;
  featureFlags: {
    queueEnabled: boolean;
    sendEnabled: boolean;
    buttonsEnabled: boolean;
  };
  selection: TpSignalReviewQueueSelectionSummary;
  sampleCards: string[];
}): string {
  const lines: string[] = [
    "# TP Signals Review Queue Diagnostic",
    "",
    `- Generated at: ${input.generatedAt}`,
    `- As-of date: ${input.asOfDate}`,
    `- Scope: ${input.scopeLabel}`,
    "",
    "## Feature flags",
    "",
    `- TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_ENABLED=${String(input.featureFlags.queueEnabled)}`,
    `- TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_SEND_ENABLED=${String(input.featureFlags.sendEnabled)}`,
    `- TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_BUTTONS_ENABLED=${String(input.featureFlags.buttonsEnabled)}`,
    "",
    "## Queue selection",
    "",
    `- total_selected: ${input.selection.totalSelected}`,
    `- review_required: ${input.selection.byBucket.review_required}`,
    `- close_candidate_review: ${input.selection.byBucket.close_candidate_review}`,
    `- pending: ${input.selection.pendingCount}`,
    `- hidden: ${input.selection.hiddenCount}`,
    `- keep_visible: ${input.selection.keepVisibleCount}`,
    `- would_send: ${input.selection.wouldSendCount}`,
    "",
    "## Safety",
    "",
    "- Includes only persisted active signals in `review_required` and `close_candidate_review`.",
    "- Excludes `obvious_auto_record` and all `silent_skip` buckets from Telegram v1.",
    "- Review decisions are append-only and do not mutate operational signal status.",
    "",
  ];

  if (input.sampleCards.length > 0) {
    lines.push("## Sample cards", "");
    for (const card of input.sampleCards) {
      lines.push("```text", card, "```", "");
    }
  }

  return lines.join("\n");
}
