import {
  assignActiveSignalReviewBucket,
  type ActiveSignalReviewBucketItem,
  type ReviewBucketName,
} from "@/features/trainingpeaks/tp-signals-review-buckets-helpers";
import {
  resolveTpSignalReviewCardContext,
  type TpSignalReviewContextSource,
} from "@/features/trainingpeaks/tp-signals-review-coach-labels";
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
  | "needs_manual_followup"
  | "close_signal";

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

export type TelegramReviewQueueInclusion = {
  include: boolean;
  queueReason: string;
  exclusionReason: string | null;
};

export type TpSignalReviewQueueItem = {
  bucket: TpSignalReviewQueueBucket;
  item: ActiveSignalReviewBucketItem;
  signalShortId: string;
  queueState: "pending" | "hidden" | "keep_visible";
  latestDecision: TpSignalReviewDecisionRecord | null;
  queueReason: string;
  sourceSignalRecommendedState: string;
  isCloseCandidate: boolean;
  decisionSuppressionReason: string | null;
  category: string;
  hasActionableDates: boolean;
  validUntil: string | null;
  sourceObservationId: string | null;
  queueExclusionReason: string | null;
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
  includedBeforeLimit: number;
  excludedFromQueue: number;
  includedBeforeLimitByBucket: Record<TpSignalReviewQueueBucket, number>;
  includedBeforeLimitByCategory: Record<string, number>;
  selectedByCategory: Record<string, number>;
  excludedByReason: Record<string, number>;
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
    case "close_signal":
      return value;
    default:
      return null;
  }
}

export function isReviewDecisionQueueSuppressed(decision: TpSignalReviewDecisionName): boolean {
  return decision !== "keep_visible";
}

const HEALTH_PAIN_REVIEW_SIGNAL_TYPES = new Set([
  "health_issue_started",
  "health_issue_improving",
  "health_issue_resolved",
  "pause_training",
  "pain_injury",
]);

const SCHEDULE_PLAN_REVIEW_SIGNAL_TYPES = new Set([
  "plan_generation_constraint",
  "schedule_unavailability_window",
  "schedule_availability_window",
]);

const STRONG_TELEGRAM_REVIEW_REASON_TOKENS = new Set([
  "latest_negative_evidence",
  "recommended_state=needs_review",
  "recommended_state=stale_needs_review",
  "monitoring_after_return",
  "partial_or_stale_schedule_payload",
  "lifecycle_display=stale_needs_review",
  "suspected_bug",
]);

function parseReviewBucketReasonTokens(reason: string): Set<string> {
  const tokens = new Set<string>();
  for (const part of reason.split(";").map((entry) => entry.trim()).filter(Boolean)) {
    tokens.add(part);
    if (part.startsWith("suspected_bug=")) {
      tokens.add("suspected_bug");
    }
    if (part.startsWith("hidden=")) {
      tokens.add("hidden");
    }
    if (part.startsWith("lifecycle_display=")) {
      tokens.add(part);
    }
  }
  return tokens;
}

function resolveHiddenReasonToken(reason: string): string | null {
  const match = reason.match(/(?:^|;)\s*hidden=([^;]+)/u);
  return match?.[1]?.trim() ?? null;
}

function isHiddenDisplayOnlyReason(hiddenReason: string | null): boolean {
  if (!hiddenReason) {
    return false;
  }
  return /^(?:expired_|auto_hidden_|no_active_move_action|superseded_signal_hidden|stale_generic_schedule_unavailability)/u.test(
    hiddenReason
  );
}

function resolveHiddenDisplayQueueExclusion(
  item: ActiveSignalReviewBucketItem
): TelegramReviewQueueInclusion | null {
  const recommendedState = item.explainRecord.recommended_state;
  const hiddenReason = resolveHiddenReasonToken(item.reason);

  if (recommendedState === "hidden" || hiddenReason || !item.visible) {
    return {
      include: false,
      queueReason: "",
      exclusionReason: "hidden_display_state",
    };
  }

  return null;
}

function resolveTelegramReviewQueueSortPriority(queueItem: TpSignalReviewQueueItem): number {
  if (queueItem.bucket === "close_candidate_review") {
    return 0;
  }

  const tokens = parseReviewBucketReasonTokens(queueItem.item.reason);
  const signalType = queueItem.item.signalType;

  if (HEALTH_PAIN_REVIEW_SIGNAL_TYPES.has(signalType)) {
    if (tokens.has("latest_negative_evidence")) {
      return 1;
    }
    return 2;
  }

  if (signalType === "move_workout_candidate") {
    return 3;
  }

  return 4;
}

function compareTpSignalReviewQueueItems(
  left: TpSignalReviewQueueItem,
  right: TpSignalReviewQueueItem
): number {
  const priorityDiff =
    resolveTelegramReviewQueueSortPriority(left) - resolveTelegramReviewQueueSortPriority(right);
  if (priorityDiff !== 0) {
    return priorityDiff;
  }
  return left.item.studentName.localeCompare(right.item.studentName, "ru");
}

function hasStrongTelegramReviewReason(
  tokens: Set<string>,
  item: ActiveSignalReviewBucketItem
): boolean {
  for (const token of STRONG_TELEGRAM_REVIEW_REASON_TOKENS) {
    if (tokens.has(token)) {
      return true;
    }
  }
  if (item.explainRecord.suspected_bug_class || item.suspectedBugClass) {
    return true;
  }
  const hiddenReason = resolveHiddenReasonToken(item.reason);
  if (tokens.has("hidden") && hiddenReason && !isHiddenDisplayOnlyReason(hiddenReason)) {
    return true;
  }
  return false;
}

function hasMeaningfulMoveDates(item: ActiveSignalReviewBucketItem): boolean {
  const { source_date: sourceDate, target_date: targetDate } = item.explainRecord.normalized_dates;
  const hasSource = Boolean(sourceDate?.trim());
  const hasTarget = Boolean(targetDate?.trim());
  if (hasSource && hasTarget) {
    return true;
  }
  if (hasSource) {
    return true;
  }
  const preview = item.preview ?? "";
  if (/—\s*→\s*—/u.test(preview)) {
    return false;
  }
  return false;
}

function resolveDecisionSuppressionReason(
  latestDecision: TpSignalReviewDecisionRecord | null | undefined
): string | null {
  if (!latestDecision) {
    return null;
  }
  if (latestDecision.decision === "keep_visible") {
    return null;
  }
  if (isReviewDecisionQueueSuppressed(latestDecision.decision)) {
    return latestDecision.decision;
  }
  return null;
}

export function resolveTelegramReviewQueueInclusion(
  item: ActiveSignalReviewBucketItem
): TelegramReviewQueueInclusion {
  if (item.bucket === "close_candidate_review") {
    return {
      include: true,
      queueReason: "close_candidate_review",
      exclusionReason: null,
    };
  }

  const hiddenExclusion = resolveHiddenDisplayQueueExclusion(item);
  if (hiddenExclusion) {
    return hiddenExclusion;
  }

  const tokens = parseReviewBucketReasonTokens(item.reason);
  const signalType = item.signalType;

  if (HEALTH_PAIN_REVIEW_SIGNAL_TYPES.has(signalType)) {
    return {
      include: true,
      queueReason: item.reason || "health_pain_review_required",
      exclusionReason: null,
    };
  }

  if (signalType === "move_workout_candidate") {
    const hiddenReason = resolveHiddenReasonToken(item.reason);
    if (isHiddenDisplayOnlyReason(hiddenReason)) {
      return {
        include: false,
        queueReason: "",
        exclusionReason: "stale_hidden_move_candidate",
      };
    }
    if (hasMeaningfulMoveDates(item)) {
      return {
        include: true,
        queueReason: item.reason || "move_with_actionable_dates",
        exclusionReason: null,
      };
    }
    return {
      include: false,
      queueReason: "",
      exclusionReason: "move_missing_dates",
    };
  }

  if (SCHEDULE_PLAN_REVIEW_SIGNAL_TYPES.has(signalType)) {
    const hiddenReason = resolveHiddenReasonToken(item.reason);
    if (isHiddenDisplayOnlyReason(hiddenReason) && !hasStrongTelegramReviewReason(tokens, item)) {
      return {
        include: false,
        queueReason: "",
        exclusionReason: "hidden_expired_schedule_or_plan_constraint",
      };
    }
    if (hasStrongTelegramReviewReason(tokens, item)) {
      return {
        include: true,
        queueReason: item.reason,
        exclusionReason: null,
      };
    }
    return {
      include: false,
      queueReason: "",
      exclusionReason: "generic_schedule_or_plan_constraint",
    };
  }

  if (signalType === "resume_training") {
    if (hasStrongTelegramReviewReason(tokens, item)) {
      return {
        include: true,
        queueReason: item.reason,
        exclusionReason: null,
      };
    }
    return {
      include: false,
      queueReason: "",
      exclusionReason: "generic_resume_signal",
    };
  }

  if (hasStrongTelegramReviewReason(tokens, item)) {
    return {
      include: true,
      queueReason: item.reason,
      exclusionReason: null,
    };
  }

  if (
    tokens.has("ambiguous_or_non_high_confidence_active_signal") ||
    tokens.has("classifier_confidence=medium") ||
    tokens.has("classifier_confidence=low")
  ) {
    return {
      include: false,
      queueReason: "",
      exclusionReason: "generic_ambiguous_review_required",
    };
  }

  return {
    include: true,
    queueReason: item.reason || "review_required",
    exclusionReason: null,
  };
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

export type TelegramReviewQueueDiagnosticRow = {
  studentName: string;
  signalId: string;
  bucket: ReviewBucketName;
  category: string;
  signalType: string;
  includedInQueue: boolean;
  queueReason: string | null;
  queueExclusionReason: string | null;
  sourceSignalRecommendedState: string;
  isCloseCandidate: boolean;
  hasActionableDates: boolean;
  validUntil: string | null;
  sourceObservationId: string | null;
  reviewBucketReason: string;
  cardHasContext?: boolean;
  contextSource?: TpSignalReviewContextSource | null;
  whatHappenedPreview?: string | null;
};

export type TpSignalReviewQueueSelectedDiagnostic = {
  studentName: string;
  bucket: TpSignalReviewQueueBucket;
  category: string;
  signalId: string;
  cardHasContext: boolean;
  contextSource: TpSignalReviewContextSource;
  whatHappenedPreview: string;
  queueReason: string;
  queueExclusionReason: string | null;
};

export function buildTpSignalReviewQueueSelectedDiagnostics(
  items: TpSignalReviewQueueItem[]
): TpSignalReviewQueueSelectedDiagnostic[] {
  return items.map((queueItem) => {
    const context = resolveTpSignalReviewCardContext({
      bucket: queueItem.bucket,
      category: queueItem.category,
      signalType: queueItem.item.signalType,
      preview: queueItem.item.preview,
      explainRecord: queueItem.item.explainRecord,
    });

    return {
      studentName: queueItem.item.studentName,
      bucket: queueItem.bucket,
      category: queueItem.category,
      signalId: queueItem.item.signalId,
      cardHasContext: context.hasContext,
      contextSource: context.source,
      whatHappenedPreview: context.text,
      queueReason: queueItem.queueReason,
      queueExclusionReason: queueItem.queueExclusionReason,
    };
  });
}

export function enrichTelegramReviewQueueDiagnosticRow(
  item: ActiveSignalReviewBucketItem,
  inclusion: TelegramReviewQueueInclusion
): Pick<TelegramReviewQueueDiagnosticRow, "cardHasContext" | "contextSource" | "whatHappenedPreview"> {
  if (!inclusion.include || !isTpSignalReviewQueueBucket(item.bucket)) {
    return {
      cardHasContext: false,
      contextSource: null,
      whatHappenedPreview: null,
    };
  }

  const context = resolveTpSignalReviewCardContext({
    bucket: item.bucket,
    category: item.category,
    signalType: item.signalType,
    preview: item.preview,
    explainRecord: item.explainRecord,
  });

  return {
    cardHasContext: context.hasContext,
    contextSource: context.source,
    whatHappenedPreview: context.text,
  };
}

export function buildTelegramReviewQueueDiagnosticRows(
  activeItems: ActiveSignalReviewBucketItem[]
): TelegramReviewQueueDiagnosticRow[] {
  const rows: TelegramReviewQueueDiagnosticRow[] = [];

  for (const item of activeItems) {
    if (!isTpSignalReviewQueueBucket(item.bucket)) {
      continue;
    }
    const inclusion = resolveTelegramReviewQueueInclusion(item);
    const { source_date: sourceDate, target_date: targetDate, valid_until: validUntil } =
      item.explainRecord.normalized_dates;
    const contextFields = enrichTelegramReviewQueueDiagnosticRow(item, inclusion);

    rows.push({
      studentName: item.studentName,
      signalId: item.signalId,
      bucket: item.bucket,
      category: item.category,
      signalType: item.signalType,
      includedInQueue: inclusion.include,
      queueReason: inclusion.include ? inclusion.queueReason : null,
      queueExclusionReason: inclusion.exclusionReason,
      sourceSignalRecommendedState: item.explainRecord.recommended_state,
      isCloseCandidate: item.bucket === "close_candidate_review",
      hasActionableDates: Boolean(sourceDate?.trim() || targetDate?.trim()),
      validUntil: validUntil ?? null,
      sourceObservationId: item.sourceObservationId,
      reviewBucketReason: item.reason,
      ...contextFields,
    });
  }

  rows.sort((left, right) => {
    if (left.includedInQueue !== right.includedInQueue) {
      return left.includedInQueue ? -1 : 1;
    }
    const leftPriority =
      left.bucket === "close_candidate_review"
        ? 0
        : left.bucket === "review_required" && left.reviewBucketReason.includes("latest_negative_evidence")
          ? 1
          : left.bucket === "review_required"
            ? 2
            : 3;
    const rightPriority =
      right.bucket === "close_candidate_review"
        ? 0
        : right.bucket === "review_required" && right.reviewBucketReason.includes("latest_negative_evidence")
          ? 1
          : right.bucket === "review_required"
            ? 2
            : 3;
    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }
    return left.studentName.localeCompare(right.studentName, "ru");
  });

  return rows;
}

export function selectTpSignalReviewQueueItems(
  input: SelectTpSignalReviewQueueItemsInput
): TpSignalReviewQueueSelectionSummary {
  const latestDecisionsBySignalId = input.latestDecisionsBySignalId ?? new Map();
  const queueItems: TpSignalReviewQueueItem[] = [];
  const excludedByReason = new Map<string, number>();

  for (const item of input.activeItems) {
    if (!isTpSignalReviewQueueBucket(item.bucket)) {
      continue;
    }

    const inclusion = resolveTelegramReviewQueueInclusion(item);
    if (!inclusion.include) {
      const reason = inclusion.exclusionReason ?? "unknown";
      excludedByReason.set(reason, (excludedByReason.get(reason) ?? 0) + 1);
      continue;
    }

    const latestDecision = latestDecisionsBySignalId.get(item.signalId) ?? null;
    const queueState = resolveReviewQueueState(latestDecision);
    if (!input.includeReviewed && queueState === "hidden") {
      excludedByReason.set("decision_suppressed", (excludedByReason.get("decision_suppressed") ?? 0) + 1);
      continue;
    }

    const { source_date: sourceDate, target_date: targetDate, valid_until: validUntil } =
      item.explainRecord.normalized_dates;

    queueItems.push({
      bucket: item.bucket,
      item,
      signalShortId: item.signalId.slice(0, 8).toLowerCase(),
      queueState,
      latestDecision,
      queueReason: inclusion.queueReason,
      sourceSignalRecommendedState: item.explainRecord.recommended_state,
      isCloseCandidate: item.bucket === "close_candidate_review",
      decisionSuppressionReason: resolveDecisionSuppressionReason(latestDecision),
      category: item.category,
      hasActionableDates: Boolean(sourceDate?.trim() || targetDate?.trim()),
      validUntil: validUntil ?? null,
      sourceObservationId: item.sourceObservationId,
      queueExclusionReason: inclusion.exclusionReason,
    });
  }

  queueItems.sort(compareTpSignalReviewQueueItems);

  const includedBeforeLimitByBucket: Record<TpSignalReviewQueueBucket, number> = {
    review_required: queueItems.filter((entry) => entry.bucket === "review_required").length,
    close_candidate_review: queueItems.filter((entry) => entry.bucket === "close_candidate_review").length,
  };
  const includedBeforeLimitByCategory = new Map<string, number>();
  for (const entry of queueItems) {
    includedBeforeLimitByCategory.set(
      entry.category,
      (includedBeforeLimitByCategory.get(entry.category) ?? 0) + 1
    );
  }

  const limitedItems =
    input.limit && input.limit > 0 ? queueItems.slice(0, input.limit) : queueItems;

  const byBucket: Record<TpSignalReviewQueueBucket, number> = {
    review_required: limitedItems.filter((entry) => entry.bucket === "review_required").length,
    close_candidate_review: limitedItems.filter((entry) => entry.bucket === "close_candidate_review").length,
  };
  const selectedByCategory = new Map<string, number>();
  for (const entry of limitedItems) {
    selectedByCategory.set(entry.category, (selectedByCategory.get(entry.category) ?? 0) + 1);
  }

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
    includedBeforeLimit: queueItems.length,
    excludedFromQueue: [...excludedByReason.values()].reduce((sum, count) => sum + count, 0),
    includedBeforeLimitByBucket,
    includedBeforeLimitByCategory: Object.fromEntries(includedBeforeLimitByCategory.entries()),
    selectedByCategory: Object.fromEntries(selectedByCategory.entries()),
    excludedByReason: Object.fromEntries(excludedByReason.entries()),
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
    manualSendEnabled: boolean;
    buttonsEnabled: boolean;
    mutationsEnabled: boolean;
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
    `- TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_MANUAL_SEND_ENABLED=${String(input.featureFlags.manualSendEnabled)}`,
    `- TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_BUTTONS_ENABLED=${String(input.featureFlags.buttonsEnabled)}`,
    `- TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_MUTATIONS_ENABLED=${String(input.featureFlags.mutationsEnabled)}`,
    "",
    "## Queue candidates before limit",
    "",
    `- included_before_limit: ${input.selection.includedBeforeLimit}`,
    `- excluded_from_queue: ${input.selection.excludedFromQueue}`,
    `- review_required: ${input.selection.includedBeforeLimitByBucket.review_required}`,
    `- close_candidate_review: ${input.selection.includedBeforeLimitByBucket.close_candidate_review}`,
    "",
    "## Selected for send after limit",
    "",
    `- total_selected: ${input.selection.totalSelected}`,
    `- review_required: ${input.selection.byBucket.review_required}`,
    `- close_candidate_review: ${input.selection.byBucket.close_candidate_review}`,
    `- pending: ${input.selection.pendingCount}`,
    `- hidden: ${input.selection.hiddenCount}`,
    `- keep_visible: ${input.selection.keepVisibleCount}`,
    `- would_send: ${input.selection.wouldSendCount}`,
    "",
  ];

  const includedCategoryEntries = Object.entries(input.selection.includedBeforeLimitByCategory).sort(
    (left, right) => left[0].localeCompare(right[0], "ru")
  );
  if (includedCategoryEntries.length > 0) {
    lines.push("### Included before limit by category", "");
    for (const [category, count] of includedCategoryEntries) {
      lines.push(`- ${category}: ${count}`);
    }
    lines.push("");
  }

  const selectedCategoryEntries = Object.entries(input.selection.selectedByCategory).sort((left, right) =>
    left[0].localeCompare(right[0], "ru")
  );
  if (selectedCategoryEntries.length > 0) {
    lines.push("### Selected by category", "");
    for (const [category, count] of selectedCategoryEntries) {
      lines.push(`- ${category}: ${count}`);
    }
    lines.push("");
  }

  const excludedReasonEntries = Object.entries(input.selection.excludedByReason).sort((left, right) =>
    left[0].localeCompare(right[0])
  );
  if (excludedReasonEntries.length > 0) {
    lines.push("### Excluded by reason", "");
    for (const [reason, count] of excludedReasonEntries) {
      lines.push(`- ${reason}: ${count}`);
    }
    lines.push("");
  }

  lines.push(
    "## Safety",
    "",
    "- Includes close candidates and review_required signals that need a coach decision.",
    "- Excludes passive plan/schedule constraints, move candidates without dates, and generic ambiguous rows.",
    "- Excludes hidden/superseded/stale display rows and `obvious_auto_record` / `silent_skip` buckets from Telegram v1.",
    "- Review decisions are append-only; operational signal status changes require TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_MUTATIONS_ENABLED=true.",
    "",
  );

  if (input.sampleCards.length > 0) {
    lines.push("## Sample cards", "");
    for (const card of input.sampleCards) {
      lines.push("```text", card, "```", "");
    }
  }

  return lines.join("\n");
}
