import { analyzeGroupWorkoutReport } from "@/features/trainingpeaks/group-workout-report-analyzer";
import { matchGroupWorkoutReportWorkoutFromCache } from "@/features/trainingpeaks/group-workout-report-matcher";
import {
  buildGroupWorkoutReportReplyDraftContext,
  type GroupWorkoutReportReplyDraftContext,
} from "@/features/trainingpeaks/group-workout-report-reply-draft-context";
import { generateGroupWorkoutReportReplyDraft } from "@/features/trainingpeaks/group-workout-report-reply-draft-generator";
import {
  extractGroupWorkoutReportDraftShortIdFromCoachText,
  formatGroupWorkoutReportReviewCardText,
  getGroupWorkoutReportReviewCardMarkup,
  type GroupWorkoutReportReviewCardAnalysis,
  type ParsedGroupWorkoutReportReviewCallback,
} from "@/features/trainingpeaks/group-workout-report-review-card";
import { getTrainingPeaksCoachChatIds } from "@/features/trainingpeaks/attention-telegram";
import {
  getTrainingPeaksGroupWorkoutReportReplyDraftBySourceMessage,
  getTrainingPeaksReplyDraftByIdPrefix,
  getTrainingPeaksStudentById,
  insertTrainingPeaksCoachActionTaken,
  insertTrainingPeaksGroupWorkoutReportReplyDraft,
  listTrainingPeaksWorkoutCacheForStudentDateRange,
  mergeTrainingPeaksReplyDraftMetadata,
  updateTrainingPeaksGroupWorkoutReportReplyDraftContent,
  updateTrainingPeaksReplyDraftOutcome,
  type TrainingPeaksGroupWorkoutReportIntake,
  type TrainingPeaksReplyDraft,
  type TrainingPeaksStudent,
  type TrainingPeaksWorkoutCacheRow,
} from "@/features/trainingpeaks/repository";
import { getTrainingPeaksReplyDraftModel } from "@/features/trainingpeaks/reply-draft-generator";
import { readTrainingPeaksCompletedWorkoutSummary } from "@/features/trainingpeaks/trainingpeaks-completed-workout-summary-reader";
import {
  editTelegramMessageText,
  sendTelegramMessageReturningId,
  type SendTelegramMessageResult,
} from "@/features/telegram/telegram-client";
import type { TelegramInlineKeyboardMarkup } from "@/features/telegram/types";

const TP_GWR_EDIT_WAITING_TTL_MS = 30 * 60 * 1000;
const SEND_DISABLED_MESSAGE = "Отправка в группу отключена флагом безопасности.";

export function isTrainingPeaksGroupWorkoutReportReviewEnabled(): boolean {
  return process.env.TRAININGPEAKS_GROUP_WORKOUT_REPORT_REVIEW_ENABLED?.trim() === "true";
}

export function isTrainingPeaksGroupWorkoutReportGenerateEnabled(): boolean {
  return process.env.TRAININGPEAKS_GROUP_WORKOUT_REPORT_GENERATE_ENABLED?.trim() === "true";
}

export function isTrainingPeaksGroupWorkoutReportSendEnabled(): boolean {
  return process.env.TRAININGPEAKS_GROUP_WORKOUT_REPORT_SEND_ENABLED?.trim() === "true";
}

type PendingGroupWorkoutReportEdit = {
  draftIdPrefix: string;
  expiresAt: number;
};

const pendingGroupWorkoutReportEditByCoachChatId = new Map<string, PendingGroupWorkoutReportEdit>();
const pendingGroupWorkoutReportRegenerateByDraftPrefix = new Map<string, number>();

export type GroupWorkoutReportReviewTelegramDeps = {
  getCoachChatIds?: () => string[];
  sendCoachMessage?: (
    chatId: string,
    text: string,
    markup?: TelegramInlineKeyboardMarkup
  ) => Promise<SendTelegramMessageResult | null>;
  sendGroupReply?: (input: {
    groupChatId: string;
    replyToMessageId: number;
    text: string;
  }) => Promise<SendTelegramMessageResult | null>;
  editCoachMessage?: (
    chatId: string,
    messageId: number,
    text: string,
    markup?: TelegramInlineKeyboardMarkup
  ) => Promise<void>;
  answerCallback?: (callbackQueryId: string, text?: string) => Promise<void>;
  generateDraft?: typeof generateGroupWorkoutReportReplyDraft;
  getDraftByIdPrefix?: (draftIdPrefix: string) => Promise<TrainingPeaksReplyDraft | null>;
  getStudentById?: (studentId: string) => Promise<TrainingPeaksStudent | null>;
  mergeDraftMetadata?: (
    draftId: string,
    metadataPatch: Record<string, unknown>
  ) => Promise<TrainingPeaksReplyDraft | null>;
  updateDraftContent?: (input: {
    draftId: string;
    draftText: string;
    aiModel?: string | null;
    metadataPatch?: Record<string, unknown>;
  }) => Promise<TrainingPeaksReplyDraft | null>;
  updateDraftOutcome?: (input: {
    draftId: string;
    outcome: "used" | "edited" | "ignored";
  }) => Promise<TrainingPeaksReplyDraft | null>;
  recordCoachAction?: (input: {
    studentId: string;
    actionKind: "reply_draft_used" | "reply_draft_ignored";
    actorTelegramChatId: string;
    metadata: Record<string, unknown>;
  }) => Promise<void>;
  now?: () => number;
};

type ResolvedGroupWorkoutReportReviewDeps = {
  getCoachChatIds: () => string[];
  sendCoachMessage: (
    chatId: string,
    text: string,
    markup?: TelegramInlineKeyboardMarkup
  ) => Promise<SendTelegramMessageResult | null>;
  sendGroupReply: (input: {
    groupChatId: string;
    replyToMessageId: number;
    text: string;
  }) => Promise<SendTelegramMessageResult | null>;
  editCoachMessage: (
    chatId: string,
    messageId: number,
    text: string,
    markup?: TelegramInlineKeyboardMarkup
  ) => Promise<void>;
  answerCallback: (callbackQueryId: string, text?: string) => Promise<void>;
  generateDraft: typeof generateGroupWorkoutReportReplyDraft;
  getDraftByIdPrefix: (draftIdPrefix: string) => Promise<TrainingPeaksReplyDraft | null>;
  getStudentById: (studentId: string) => Promise<TrainingPeaksStudent | null>;
  mergeDraftMetadata: (
    draftId: string,
    metadataPatch: Record<string, unknown>
  ) => Promise<TrainingPeaksReplyDraft | null>;
  updateDraftContent: (input: {
    draftId: string;
    draftText: string;
    aiModel?: string | null;
    metadataPatch?: Record<string, unknown>;
  }) => Promise<TrainingPeaksReplyDraft | null>;
  updateDraftOutcome: (input: {
    draftId: string;
    outcome: "used" | "edited" | "ignored";
  }) => Promise<TrainingPeaksReplyDraft | null>;
  recordCoachAction: (input: {
    studentId: string;
    actionKind: "reply_draft_used" | "reply_draft_ignored";
    actorTelegramChatId: string;
    metadata: Record<string, unknown>;
  }) => Promise<void>;
  now: () => number;
};

function getDeps(input?: GroupWorkoutReportReviewTelegramDeps): ResolvedGroupWorkoutReportReviewDeps {
  return {
    getCoachChatIds: input?.getCoachChatIds ?? getTrainingPeaksCoachChatIds,
    sendCoachMessage:
      input?.sendCoachMessage ??
      (async (chatId, text, markup) =>
        sendTelegramMessageReturningId(chatId, text, { replyMarkup: markup })),
    sendGroupReply:
      input?.sendGroupReply ??
      (async ({ groupChatId, replyToMessageId, text }) =>
        sendTelegramMessageReturningId(groupChatId, text, {
          replyToMessageId,
        })),
    editCoachMessage:
      input?.editCoachMessage ??
      (async (chatId, messageId, text, markup) => {
        await editTelegramMessageText(chatId, messageId, text, { replyMarkup: markup });
      }),
    answerCallback: input?.answerCallback ?? (async () => undefined),
    generateDraft: input?.generateDraft ?? generateGroupWorkoutReportReplyDraft,
    getDraftByIdPrefix: input?.getDraftByIdPrefix ?? getTrainingPeaksReplyDraftByIdPrefix,
    getStudentById: input?.getStudentById ?? getTrainingPeaksStudentById,
    mergeDraftMetadata: input?.mergeDraftMetadata ?? mergeTrainingPeaksReplyDraftMetadata,
    updateDraftContent: input?.updateDraftContent ?? updateTrainingPeaksGroupWorkoutReportReplyDraftContent,
    updateDraftOutcome:
      input?.updateDraftOutcome ??
      (async ({ draftId, outcome }) => updateTrainingPeaksReplyDraftOutcome({ draftId, outcome })),
    recordCoachAction:
      input?.recordCoachAction ??
      (async (action) => {
        await insertTrainingPeaksCoachActionTaken({
          studentId: action.studentId,
          actionKind: action.actionKind,
          source: "telegram_command",
          actorTelegramChatId: action.actorTelegramChatId,
          metadata: action.metadata,
        });
      }),
    now: input?.now ?? (() => Date.now()),
  };
}

function cleanupExpiredPendingEdits(now: number): void {
  for (const [chatId, pending] of pendingGroupWorkoutReportEditByCoachChatId.entries()) {
    if (pending.expiresAt <= now) {
      pendingGroupWorkoutReportEditByCoachChatId.delete(chatId);
    }
  }
}

export function setPendingGroupWorkoutReportEditForTest(
  coachChatId: string,
  draftIdPrefix: string,
  expiresAt: number
): void {
  pendingGroupWorkoutReportEditByCoachChatId.set(coachChatId, { draftIdPrefix, expiresAt });
}

export function clearPendingGroupWorkoutReportStateForTest(): void {
  pendingGroupWorkoutReportEditByCoachChatId.clear();
  pendingGroupWorkoutReportRegenerateByDraftPrefix.clear();
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

export function buildGroupWorkoutReportReviewCardAnalysisFromDraft(
  draft: TrainingPeaksReplyDraft
): GroupWorkoutReportReviewCardAnalysis {
  const analysisJson = draft.workoutAnalysisJson ?? {};
  const metadataAnalysis =
    draft.metadata.review_analysis &&
    typeof draft.metadata.review_analysis === "object" &&
    !Array.isArray(draft.metadata.review_analysis)
      ? (draft.metadata.review_analysis as Record<string, unknown>)
      : {};

  return {
    planActualBullets: asStringArray(analysisJson.planActualBullets ?? metadataAnalysis.planActualBullets),
    summaryForCoach:
      typeof analysisJson.summaryForCoach === "string"
        ? analysisJson.summaryForCoach
        : typeof metadataAnalysis.summaryForCoach === "string"
          ? metadataAnalysis.summaryForCoach
          : "Недостаточно данных для краткого вывода.",
    riskFlags: asStringArray(analysisJson.riskFlags ?? metadataAnalysis.riskFlags),
    allowedClaims: asStringArray(
      draft.metadata.allowed_claims ?? analysisJson.allowedClaims ?? metadataAnalysis.allowedClaims
    ),
    forbiddenClaims: asStringArray(
      draft.metadata.forbidden_claims ?? analysisJson.forbiddenClaims ?? metadataAnalysis.forbiddenClaims
    ),
  };
}

function getDraftReviewStatus(draft: TrainingPeaksReplyDraft): string | null {
  const status = draft.metadata.review_status;
  return typeof status === "string" ? status : null;
}

function hasCoachReviewNotification(draft: TrainingPeaksReplyDraft): boolean {
  const reviewStatus = getDraftReviewStatus(draft);
  if (reviewStatus === "coach_notified" || reviewStatus === "awaiting_edit") {
    return true;
  }
  return typeof draft.metadata.coach_review_message_id === "number";
}

function byWorkoutId(rows: TrainingPeaksWorkoutCacheRow[], id: string | null): TrainingPeaksWorkoutCacheRow | null {
  if (!id) {
    return null;
  }
  return rows.find((row) => String(row.trainingPeaksWorkoutId) === id) ?? null;
}

function parseAthleteIdFromUrl(url: string): number | null {
  const match = url.match(/\/athletes\/(\d+)/i);
  if (!match?.[1]) {
    return null;
  }
  const parsed = Number(match[1]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function rebuildGroupWorkoutReportReplyDraftContextFromDraft(input: {
  draft: TrainingPeaksReplyDraft;
  student: TrainingPeaksStudent | null;
  studentName: string;
  studentMessage: string;
  promptContext: string;
}): GroupWorkoutReportReplyDraftContext {
  const analysisJson = input.draft.workoutAnalysisJson ?? {};
  const confidence =
    analysisJson.confidence === "high" ||
    analysisJson.confidence === "medium" ||
    analysisJson.confidence === "low"
      ? analysisJson.confidence
      : "medium";

  return {
    studentId: input.draft.studentId,
    studentName: input.studentName,
    source: {
      chatId: input.draft.sourceChatId ?? "",
      messageId: input.draft.sourceMessageId ?? "",
      messageText: input.studentMessage,
      messageTimestamp: input.draft.sourceMessageTimestamp ?? new Date().toISOString(),
      isGroup: true,
    },
    communication: {
      formality: input.student?.telegramFormality ?? "unknown",
      formalitySource: "stored_draft",
      instruction:
        input.student?.telegramFormality === "vy"
          ? "Обращайся на «вы»."
          : input.student?.telegramFormality === "ty"
            ? "Обращайся на «ты»."
            : "Используй нейтральные формулировки без рискованных окончаний.",
      notes: [],
    },
    workout: {
      matchStatus: input.draft.workoutMatchStatus ?? "not_found",
      matchConfidence: input.draft.workoutMatchConfidence ?? "low",
      workoutType:
        typeof analysisJson.workoutType === "string" ? analysisJson.workoutType : "easy",
      title:
        typeof analysisJson.workoutTitle === "string"
          ? analysisJson.workoutTitle
          : typeof input.draft.metadata.workout_title === "string"
            ? input.draft.metadata.workout_title
            : null,
      date:
        typeof analysisJson.workoutDate === "string"
          ? analysisJson.workoutDate
          : typeof input.draft.metadata.workout_date === "string"
            ? input.draft.metadata.workout_date
            : new Date().toISOString().slice(0, 10),
    },
    analysis: {
      confidence,
      executionStatus:
        typeof analysisJson.executionStatus === "string"
          ? analysisJson.executionStatus
          : "good",
      summaryForCoach:
        typeof analysisJson.summaryForCoach === "string" ? analysisJson.summaryForCoach : "",
      planActualBullets: asStringArray(analysisJson.planActualBullets),
      riskFlags: asStringArray(analysisJson.riskFlags),
      unavailableDataNotes: [],
      recommendationForDraft:
        typeof analysisJson.recommendationForDraft === "string"
          ? analysisJson.recommendationForDraft
          : "",
      allowedClaims: asStringArray(
        input.draft.metadata.allowed_claims ?? analysisJson.allowedClaims
      ),
      forbiddenClaims: asStringArray(
        input.draft.metadata.forbidden_claims ?? analysisJson.forbiddenClaims
      ),
    },
    promptContext: input.promptContext,
  };
}

function buildWorkoutAnalysisJson(
  context: GroupWorkoutReportReplyDraftContext
): Record<string, unknown> {
  return {
    confidence: context.analysis.confidence,
    executionStatus: context.analysis.executionStatus,
    summaryForCoach: context.analysis.summaryForCoach,
    planActualBullets: context.analysis.planActualBullets,
    riskFlags: context.analysis.riskFlags,
    allowedClaims: context.analysis.allowedClaims,
    forbiddenClaims: context.analysis.forbiddenClaims,
    recommendationForDraft: context.analysis.recommendationForDraft,
    workoutType: context.workout.workoutType,
    workoutTitle: context.workout.title ?? null,
    workoutDate: context.workout.date,
  };
}

export type BuildGroupWorkoutReportReviewCardForDraftResult = {
  text: string;
  markup: TelegramInlineKeyboardMarkup;
  draftShortId: string;
  includeSend: boolean;
};

export function buildGroupWorkoutReportReviewCardForDraft(
  draft: TrainingPeaksReplyDraft,
  studentName: string
): BuildGroupWorkoutReportReviewCardForDraftResult {
  const analysis = buildGroupWorkoutReportReviewCardAnalysisFromDraft(draft);
  const draftShortId = draft.id.slice(0, 8);
  const blockedReason =
    typeof draft.metadata.generation_blocked_reason === "string"
      ? draft.metadata.generation_blocked_reason
      : null;
  const generationWarnings = asStringArray(draft.metadata.generation_warnings);
  const draftText = draft.draftText?.trim() || null;
  const includeSend = Boolean(draftText) && draft.outcome === "generated";

  const text = formatGroupWorkoutReportReviewCardText({
    studentName,
    workoutTitle:
      typeof draft.metadata.workout_title === "string"
        ? draft.metadata.workout_title
        : typeof draft.workoutAnalysisJson?.workoutTitle === "string"
          ? draft.workoutAnalysisJson.workoutTitle
          : null,
    workoutDate:
      typeof draft.metadata.workout_date === "string"
        ? draft.metadata.workout_date
        : typeof draft.workoutAnalysisJson?.workoutDate === "string"
          ? draft.workoutAnalysisJson.workoutDate
          : "—",
    workoutType:
      typeof draft.workoutAnalysisJson?.workoutType === "string"
        ? draft.workoutAnalysisJson.workoutType
        : "run",
    matchStatus: draft.workoutMatchStatus ?? "unknown",
    matchConfidence: draft.workoutMatchConfidence ?? "unknown",
    draftText,
    draftShortId,
    analysis,
    blockedReason,
    generationWarnings,
  });

  return {
    text,
    markup: getGroupWorkoutReportReviewCardMarkup(draftShortId, { includeSend }),
    draftShortId,
    includeSend,
  };
}

export type NotifyCoachGroupWorkoutReportDraftResult =
  | { status: "sent"; coachChatIds: string[]; draftId: string }
  | { status: "review_disabled" }
  | { status: "duplicate"; draftId: string }
  | { status: "no_coach_chat"; draftId: string }
  | { status: "failed"; draftId: string; reason: string };

export async function notifyCoachGroupWorkoutReportDraft(input: {
  draft: TrainingPeaksReplyDraft;
  studentName: string;
  deps?: GroupWorkoutReportReviewTelegramDeps;
}): Promise<NotifyCoachGroupWorkoutReportDraftResult> {
  const deps = getDeps(input.deps);

  if (!isTrainingPeaksGroupWorkoutReportReviewEnabled()) {
    await deps.mergeDraftMetadata(input.draft.id, {
      review_status: "review_disabled",
    });
    return { status: "review_disabled" };
  }

  if (hasCoachReviewNotification(input.draft)) {
    return { status: "duplicate", draftId: input.draft.id };
  }

  const coachChatIds = deps.getCoachChatIds();
  if (coachChatIds.length === 0) {
    await deps.mergeDraftMetadata(input.draft.id, {
      review_status: "coach_chat_missing",
    });
    return { status: "no_coach_chat", draftId: input.draft.id };
  }

  const card = buildGroupWorkoutReportReviewCardForDraft(input.draft, input.studentName);
  const sentCoachChatIds: string[] = [];
  let firstCoachMessageId: number | null = null;
  let firstCoachChatId: string | null = null;

  try {
    for (const coachChatId of coachChatIds) {
      const sendResult = await deps.sendCoachMessage(coachChatId, card.text, card.markup);
      sentCoachChatIds.push(coachChatId);
      if (firstCoachMessageId === null && sendResult?.messageId) {
        firstCoachMessageId = sendResult.messageId;
        firstCoachChatId = coachChatId;
      }
    }
  } catch (error) {
    return {
      status: "failed",
      draftId: input.draft.id,
      reason: error instanceof Error ? error.message : "coach notification failed",
    };
  }

  await deps.mergeDraftMetadata(input.draft.id, {
    review_status: "coach_notified",
    coach_review_chat_id: firstCoachChatId,
    coach_review_message_id: firstCoachMessageId,
    coach_review_sent_at: new Date(deps.now()).toISOString(),
    coach_review_chat_ids: sentCoachChatIds,
  });

  return {
    status: "sent",
    coachChatIds: sentCoachChatIds,
    draftId: input.draft.id,
  };
}

export type ProcessGroupWorkoutReportReviewPipelineInput = {
  intake: Pick<
    TrainingPeaksGroupWorkoutReportIntake,
    | "id"
    | "studentId"
    | "messageText"
    | "sourceChatId"
    | "sourceMessageId"
    | "sourceMessageTimestamp"
    | "sourceTelegramUserId"
    | "detectedLabels"
  >;
  student: TrainingPeaksStudent;
  messageDateUnixSeconds: number;
  deps?: GroupWorkoutReportReviewTelegramDeps;
};

export type ProcessGroupWorkoutReportReviewPipelineResult =
  | { status: "generation_disabled" }
  | { status: "review_disabled"; draftId?: string }
  | { status: "duplicate"; draftId: string }
  | { status: "blocked"; reason: string; draftId?: string }
  | { status: "notified"; draftId: string }
  | { status: "stored_no_notify"; draftId: string }
  | { status: "failed"; reason: string };

export async function processGroupWorkoutReportReviewPipeline(
  input: ProcessGroupWorkoutReportReviewPipelineInput
): Promise<ProcessGroupWorkoutReportReviewPipelineResult> {
  if (!isTrainingPeaksGroupWorkoutReportGenerateEnabled()) {
    return { status: "generation_disabled" };
  }

  const existingDraft = await getTrainingPeaksGroupWorkoutReportReplyDraftBySourceMessage(
    input.intake.sourceChatId,
    input.intake.sourceMessageId
  );
  if (existingDraft) {
    if (isTrainingPeaksGroupWorkoutReportReviewEnabled() && !hasCoachReviewNotification(existingDraft)) {
      const student = await getTrainingPeaksStudentById(existingDraft.studentId);
      const notifyResult = await notifyCoachGroupWorkoutReportDraft({
        draft: existingDraft,
        studentName: student?.studentName ?? input.student.studentName,
        deps: input.deps,
      });
      if (notifyResult.status === "sent") {
        return { status: "notified", draftId: existingDraft.id };
      }
    }
    return { status: "duplicate", draftId: existingDraft.id };
  }

  const referenceDate = new Date(input.messageDateUnixSeconds * 1000);
  const dateIso = referenceDate.toISOString().slice(0, 10);
  const rows = await listTrainingPeaksWorkoutCacheForStudentDateRange({
    studentId: input.student.id,
    from: dateIso,
    to: dateIso,
  });

  const match = matchGroupWorkoutReportWorkoutFromCache({
    messageText: input.intake.messageText,
    messageDateUnixSeconds: input.messageDateUnixSeconds,
    workouts: rows,
  });

  const athleteId = parseAthleteIdFromUrl(input.student.trainingPeaksAthleteUrl);
  let liveSummary = null;
  if (athleteId !== null) {
    const summaryReader = await readTrainingPeaksCompletedWorkoutSummary({
      athleteId,
      date: dateIso,
      workoutId: match.selectedCompletedWorkoutId ?? match.selectedPlannedWorkoutId ?? undefined,
      bearerToken: process.env.TRAININGPEAKS_API_BEARER,
    });
    liveSummary = summaryReader.status === "success" ? summaryReader.details : null;
  }

  const analysis = analyzeGroupWorkoutReport({
    match,
    plannedWorkout: byWorkoutId(rows, match.selectedPlannedWorkoutId),
    completedWorkout: byWorkoutId(rows, match.selectedCompletedWorkoutId),
    completedWorkoutSummaryDetails: liveSummary,
    reportText: input.intake.messageText,
    detectedLabels: input.intake.detectedLabels,
  });

  const context = buildGroupWorkoutReportReplyDraftContext({
    student: {
      id: input.student.id,
      studentName: input.student.studentName,
      telegramFormality: input.student.telegramFormality,
      telegramContextNotes: input.student.telegramContextNotes,
    },
    sourceMessage: {
      chatId: input.intake.sourceChatId,
      messageId: input.intake.sourceMessageId,
      messageText: input.intake.messageText,
      messageTimestamp: input.intake.sourceMessageTimestamp,
      telegramUserId: input.intake.sourceTelegramUserId,
    },
    intake: { id: input.intake.id },
    match,
    plannedWorkout: byWorkoutId(rows, match.selectedPlannedWorkoutId),
    completedWorkout: byWorkoutId(rows, match.selectedCompletedWorkoutId),
    completedWorkoutSummaryDetails: liveSummary,
    analysis,
    detectedLabels: input.intake.detectedLabels,
  });

  const deps = getDeps(input.deps);
  const generation = await deps.generateDraft({ context });
  const workoutAnalysisJson = buildWorkoutAnalysisJson(context);

  if (generation.status === "blocked") {
    const placeholderDraft = await insertTrainingPeaksGroupWorkoutReportReplyDraft({
      studentId: input.student.id,
      sourceChatId: input.intake.sourceChatId,
      sourceMessageId: input.intake.sourceMessageId,
      sourceMessageTimestamp: input.intake.sourceMessageTimestamp,
      sourceTelegramUserId: input.intake.sourceTelegramUserId,
      groupWorkoutReportIntakeId: input.intake.id,
      studentMessageText: input.intake.messageText,
      promptContext: context.promptContext,
      draftText: "— автогенерация заблокирована —",
      aiModel: "blocked",
      workoutMatchStatus: match.status,
      workoutMatchConfidence: match.confidence,
      plannedWorkoutCacheId: byWorkoutId(rows, match.selectedPlannedWorkoutId)?.id ?? null,
      completedWorkoutCacheId: byWorkoutId(rows, match.selectedCompletedWorkoutId)?.id ?? null,
      workoutAnalysisJson,
      metadata: {
        generation_blocked_reason: generation.reason,
        generation_warnings: generation.warnings,
        allowed_claims: context.analysis.allowedClaims,
        forbidden_claims: context.analysis.forbiddenClaims,
        workout_title: context.workout.title ?? null,
        workout_date: context.workout.date,
        review_analysis: workoutAnalysisJson,
      },
    });

    if (!placeholderDraft) {
      return { status: "duplicate", draftId: "unknown" };
    }

    if (!isTrainingPeaksGroupWorkoutReportReviewEnabled()) {
      await mergeTrainingPeaksReplyDraftMetadata(placeholderDraft.id, {
        review_status: "review_disabled",
      });
      return { status: "review_disabled", draftId: placeholderDraft.id };
    }

    const notifyResult = await notifyCoachGroupWorkoutReportDraft({
      draft: placeholderDraft,
      studentName: input.student.studentName,
      deps: input.deps,
    });
    if (notifyResult.status === "sent") {
      return { status: "notified", draftId: placeholderDraft.id };
    }
    return { status: "blocked", reason: generation.reason, draftId: placeholderDraft.id };
  }

  const storedDraft = await insertTrainingPeaksGroupWorkoutReportReplyDraft({
    studentId: input.student.id,
    sourceChatId: input.intake.sourceChatId,
    sourceMessageId: input.intake.sourceMessageId,
    sourceMessageTimestamp: input.intake.sourceMessageTimestamp,
    sourceTelegramUserId: input.intake.sourceTelegramUserId,
    groupWorkoutReportIntakeId: input.intake.id,
    studentMessageText: input.intake.messageText,
    promptContext: context.promptContext,
    draftText: generation.draftText,
    aiModel: generation.model ?? getTrainingPeaksReplyDraftModel(),
    workoutMatchStatus: match.status,
    workoutMatchConfidence: match.confidence,
    plannedWorkoutCacheId: byWorkoutId(rows, match.selectedPlannedWorkoutId)?.id ?? null,
    completedWorkoutCacheId: byWorkoutId(rows, match.selectedCompletedWorkoutId)?.id ?? null,
    workoutAnalysisJson,
    metadata: {
      generation_warnings: generation.warnings,
      allowed_claims: context.analysis.allowedClaims,
      forbidden_claims: context.analysis.forbiddenClaims,
      workout_title: context.workout.title ?? null,
      workout_date: context.workout.date,
      review_analysis: workoutAnalysisJson,
      prompt_context: context.promptContext,
      student_message: input.intake.messageText,
    },
  });

  if (!storedDraft) {
    return { status: "duplicate", draftId: "unknown" };
  }

  if (!isTrainingPeaksGroupWorkoutReportReviewEnabled()) {
    await mergeTrainingPeaksReplyDraftMetadata(storedDraft.id, {
      review_status: "review_disabled",
    });
    return { status: "review_disabled", draftId: storedDraft.id };
  }

  const notifyResult = await notifyCoachGroupWorkoutReportDraft({
    draft: storedDraft,
    studentName: input.student.studentName,
    deps: input.deps,
  });

  if (notifyResult.status === "sent") {
    return { status: "notified", draftId: storedDraft.id };
  }
  if (notifyResult.status === "duplicate") {
    return { status: "duplicate", draftId: storedDraft.id };
  }

  return { status: "stored_no_notify", draftId: storedDraft.id };
}

export type SendGroupWorkoutReportDraftToGroupResult =
  | { status: "sent"; groupChatId: string; groupMessageId: number | null; draftId: string }
  | { status: "send_disabled" }
  | { status: "not_found" }
  | { status: "not_group_draft" }
  | { status: "already_final"; outcome: string }
  | { status: "missing_draft_text" }
  | { status: "missing_source_message" }
  | { status: "delivery_failed"; message: string };

export async function sendGroupWorkoutReportDraftToGroup(input: {
  draftIdPrefix: string;
  actorTelegramChatId: string;
  deps?: GroupWorkoutReportReviewTelegramDeps;
}): Promise<SendGroupWorkoutReportDraftToGroupResult> {
  if (!isTrainingPeaksGroupWorkoutReportSendEnabled()) {
    return { status: "send_disabled" };
  }

  const deps = getDeps(input.deps);
  const draft = await deps.getDraftByIdPrefix(input.draftIdPrefix);
  if (!draft) {
    return { status: "not_found" };
  }
  if (draft.source !== "group_workout_report") {
    return { status: "not_group_draft" };
  }
  if (draft.outcome !== "generated") {
    return { status: "already_final", outcome: draft.outcome };
  }

  const draftText = draft.draftText?.trim() ?? "";
  if (!draftText || draftText === "— автогенерация заблокирована —") {
    return { status: "missing_draft_text" };
  }

  const sourceChatId = draft.sourceChatId?.trim();
  const sourceMessageId = draft.sourceMessageId?.trim();
  if (!sourceChatId || !sourceMessageId) {
    return { status: "missing_source_message" };
  }

  const replyToMessageId = Number(sourceMessageId);
  if (!Number.isFinite(replyToMessageId)) {
    return { status: "missing_source_message" };
  }

  const student = await deps.getStudentById(draft.studentId);
  if (student?.telegramChatId === sourceChatId) {
    return { status: "delivery_failed", message: "Refusing DM delivery for group workout report draft." };
  }

  try {
    const sendResult = await deps.sendGroupReply({
      groupChatId: sourceChatId,
      replyToMessageId,
      text: draftText,
    });

    const updatedDraft = await deps.updateDraftOutcome({
      draftId: draft.id,
      outcome: "used",
    });
    if (!updatedDraft) {
      return { status: "already_final", outcome: "unknown" };
    }

    await deps.mergeDraftMetadata(draft.id, {
      review_status: "sent",
      group_reply_message_id: sendResult?.messageId ?? null,
      group_reply_sent_at: new Date(deps.now()).toISOString(),
      group_reply_actor_chat_id: input.actorTelegramChatId,
    });

    await deps.recordCoachAction({
      studentId: draft.studentId,
      actionKind: "reply_draft_used",
      actorTelegramChatId: input.actorTelegramChatId,
      metadata: {
        draft_id: draft.id,
        delivery: "group_reply",
        source_chat_id: sourceChatId,
        source_message_id: sourceMessageId,
      },
    });

    return {
      status: "sent",
      groupChatId: sourceChatId,
      groupMessageId: sendResult?.messageId ?? null,
      draftId: draft.id,
    };
  } catch (error) {
    return {
      status: "delivery_failed",
      message: error instanceof Error ? error.message : "group send failed",
    };
  }
}

async function refreshCoachReviewCardMessage(input: {
  draft: TrainingPeaksReplyDraft;
  studentName: string;
  deps?: GroupWorkoutReportReviewTelegramDeps;
}): Promise<void> {
  const coachChatId = input.draft.metadata.coach_review_chat_id;
  const coachMessageId = input.draft.metadata.coach_review_message_id;
  if (typeof coachChatId !== "string" || typeof coachMessageId !== "number") {
    return;
  }

  const card = buildGroupWorkoutReportReviewCardForDraft(input.draft, input.studentName);
  const deps = getDeps(input.deps);
  await deps.editCoachMessage(coachChatId, coachMessageId, card.text, card.markup);
}

export async function handleGroupWorkoutReportReviewCallback(input: {
  callback: ParsedGroupWorkoutReportReviewCallback;
  coachChatId: string;
  coachMessageId: number;
  callbackQueryId: string;
  deps?: GroupWorkoutReportReviewTelegramDeps;
}): Promise<"handled" | "ignored"> {
  const deps = getDeps(input.deps);
  const draft = await deps.getDraftByIdPrefix(input.callback.draftIdPrefix);
  if (!draft || draft.source !== "group_workout_report") {
    await deps.answerCallback(input.callbackQueryId, "Черновик не найден");
    return "handled";
  }

  const student = await deps.getStudentById(draft.studentId);
  const studentName = student?.studentName ?? "ученик";

  if (input.callback.kind === "send") {
    const sendResult = await sendGroupWorkoutReportDraftToGroup({
      draftIdPrefix: input.callback.draftIdPrefix,
      actorTelegramChatId: input.coachChatId,
      deps: input.deps,
    });

    if (sendResult.status === "send_disabled") {
      await deps.answerCallback(input.callbackQueryId, SEND_DISABLED_MESSAGE);
      return "handled";
    }
    if (sendResult.status === "sent") {
      await deps.answerCallback(input.callbackQueryId, "Отправлено в группу");
      await deps.editCoachMessage(
        input.coachChatId,
        input.coachMessageId,
        ["✅ Ответ отправлен в группу как reply.", `Ученик: ${studentName}`, `#${draft.id.slice(0, 8)}`].join(
          "\n"
        ),
        getGroupWorkoutReportReviewCardMarkup(draft.id.slice(0, 8), { includeSend: false })
      );
      return "handled";
    }

    await deps.answerCallback(
      input.callbackQueryId,
      sendResult.status === "missing_draft_text"
        ? "Нет текста для отправки"
        : "Не удалось отправить"
    );
    return "handled";
  }

  if (input.callback.kind === "edit") {
    cleanupExpiredPendingEdits(deps.now());
    pendingGroupWorkoutReportEditByCoachChatId.set(input.coachChatId, {
      draftIdPrefix: input.callback.draftIdPrefix,
      expiresAt: deps.now() + TP_GWR_EDIT_WAITING_TTL_MS,
    });
    await deps.mergeDraftMetadata(draft.id, {
      review_status: "awaiting_edit",
    });
    await deps.answerCallback(input.callbackQueryId, "Жду новый текст");
    await deps.sendCoachMessage(
      input.coachChatId,
      ["Пришли новую версию ответа одним сообщением.", `Черновик: #${draft.id.slice(0, 8)}`].join("\n")
    );
    return "handled";
  }

  if (input.callback.kind === "regenerate") {
    if (!isTrainingPeaksGroupWorkoutReportGenerateEnabled()) {
      await deps.answerCallback(input.callbackQueryId, "Генерация отключена флагом");
      return "handled";
    }

    const inFlightUntil = pendingGroupWorkoutReportRegenerateByDraftPrefix.get(input.callback.draftIdPrefix);
    if (inFlightUntil && inFlightUntil > deps.now()) {
      await deps.answerCallback(input.callbackQueryId, "Уже пересобираю…");
      return "handled";
    }
    pendingGroupWorkoutReportRegenerateByDraftPrefix.set(
      input.callback.draftIdPrefix,
      deps.now() + 15_000
    );

    const promptContext =
      typeof draft.metadata.prompt_context === "string" ? draft.metadata.prompt_context : null;
    const studentMessage =
      typeof draft.metadata.student_message === "string"
        ? draft.metadata.student_message
        : draft.studentMessagePreview;
    if (!promptContext || !studentMessage) {
      await deps.answerCallback(input.callbackQueryId, "Нет контекста для пересборки");
      pendingGroupWorkoutReportRegenerateByDraftPrefix.delete(input.callback.draftIdPrefix);
      return "handled";
    }

    const context = rebuildGroupWorkoutReportReplyDraftContextFromDraft({
      draft,
      student,
      studentName,
      studentMessage,
      promptContext,
    });

    const generation = await deps.generateDraft({ context });
    pendingGroupWorkoutReportRegenerateByDraftPrefix.delete(input.callback.draftIdPrefix);

    if (generation.status === "blocked") {
      await deps.answerCallback(input.callbackQueryId, "Пересборка заблокирована");
      return "handled";
    }

    const updatedDraft = await deps.updateDraftContent({
      draftId: draft.id,
      draftText: generation.draftText,
      aiModel: generation.model ?? getTrainingPeaksReplyDraftModel(),
      metadataPatch: {
        review_status: "coach_notified",
        regenerated_at: new Date(deps.now()).toISOString(),
        regeneration_count:
          (typeof draft.metadata.regeneration_count === "number"
            ? draft.metadata.regeneration_count
            : 0) + 1,
        superseded_draft_sha256: draft.draftSha256,
        generation_warnings: generation.warnings,
      },
    });

    if (!updatedDraft) {
      await deps.answerCallback(input.callbackQueryId, "Не удалось обновить черновик");
      return "handled";
    }

    await refreshCoachReviewCardMessage({
      draft: updatedDraft,
      studentName,
      deps: input.deps,
    });
    await deps.answerCallback(input.callbackQueryId, "Черновик пересобран");
    return "handled";
  }

  if (input.callback.kind === "skip") {
    if (draft.outcome !== "generated") {
      await deps.answerCallback(input.callbackQueryId, "Черновик уже обработан");
      return "handled";
    }

    const updatedDraft = await deps.updateDraftOutcome({
      draftId: draft.id,
      outcome: "ignored",
    });
    if (!updatedDraft) {
      await deps.answerCallback(input.callbackQueryId, "Не удалось пропустить");
      return "handled";
    }

    await deps.mergeDraftMetadata(draft.id, {
      review_status: "skipped",
      skipped_at: new Date(deps.now()).toISOString(),
      skipped_by_chat_id: input.coachChatId,
    });
    await deps.recordCoachAction({
      studentId: draft.studentId,
      actionKind: "reply_draft_ignored",
      actorTelegramChatId: input.coachChatId,
      metadata: {
        draft_id: draft.id,
        review_flow: "group_workout_report",
      },
    });
    await deps.answerCallback(input.callbackQueryId, "Пропущено");
    await deps.editCoachMessage(
      input.coachChatId,
      input.coachMessageId,
      ["🙈 Черновик пропущен.", `Ученик: ${studentName}`, "В группу ничего не отправлено."].join("\n"),
      getGroupWorkoutReportReviewCardMarkup(draft.id.slice(0, 8), { includeSend: false })
    );
    return "handled";
  }

  return "ignored";
}

export async function tryHandleGroupWorkoutReportCoachEditMessage(input: {
  coachChatId: string;
  text: string;
  deps?: GroupWorkoutReportReviewTelegramDeps;
}): Promise<"handled" | "ignored"> {
  const trimmed = input.text.trim();
  if (!trimmed || trimmed.startsWith("/")) {
    return "ignored";
  }

  const deps = getDeps(input.deps);
  cleanupExpiredPendingEdits(deps.now());

  const explicitDraftShortId = extractGroupWorkoutReportDraftShortIdFromCoachText(trimmed);
  const pending = pendingGroupWorkoutReportEditByCoachChatId.get(input.coachChatId);
  const draftIdPrefix = explicitDraftShortId ?? pending?.draftIdPrefix ?? null;
  if (!draftIdPrefix) {
    return "ignored";
  }

  const draft = await deps.getDraftByIdPrefix(draftIdPrefix);
  if (!draft || draft.source !== "group_workout_report" || draft.outcome !== "generated") {
    return "ignored";
  }

  const editedText = explicitDraftShortId
    ? trimmed.replace(/#[0-9a-f]{8}\b/i, "").trim()
    : trimmed;
  if (!editedText) {
    await deps.sendCoachMessage(input.coachChatId, "Текст пустой. Пришли новую версию ответа одним сообщением.");
    return "handled";
  }

  const updatedDraft = await deps.updateDraftContent({
    draftId: draft.id,
    draftText: editedText,
    metadataPatch: {
      review_status: "coach_notified",
      edited_by_chat_id: input.coachChatId,
      edited_via: explicitDraftShortId ? "hashtag_message" : "awaiting_edit_message",
    },
  });
  if (!updatedDraft) {
    await deps.sendCoachMessage(input.coachChatId, "Не удалось сохранить правку черновика.");
    return "handled";
  }

  pendingGroupWorkoutReportEditByCoachChatId.delete(input.coachChatId);

  const student = await deps.getStudentById(draft.studentId);
  await refreshCoachReviewCardMessage({
    draft: updatedDraft,
    studentName: student?.studentName ?? "ученик",
    deps: input.deps,
  });
  await deps.sendCoachMessage(
    input.coachChatId,
    ["✏️ Черновик обновлён.", `Черновик: #${draft.id.slice(0, 8)}`].join("\n")
  );
  return "handled";
}
