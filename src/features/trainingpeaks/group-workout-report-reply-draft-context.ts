import {
  buildResolvedCommunicationProfilePromptLines,
  resolveStudentCommunicationProfile,
  type ResolvedStudentCommunicationProfile,
} from "@/features/trainingpeaks/communication-profile";
import type { GroupWorkoutReportWorkoutAnalysis } from "@/features/trainingpeaks/group-workout-report-analyzer";
import type { GroupWorkoutReportWorkoutMatchResult } from "@/features/trainingpeaks/group-workout-report-matcher";
import type {
  TrainingPeaksGroupWorkoutReportIntake,
  TrainingPeaksStudent,
  TrainingPeaksTelegramFormality,
  TrainingPeaksWorkoutCacheRow,
} from "@/features/trainingpeaks/repository";
import type { TrainingPeaksCompletedWorkoutSummaryDetails } from "@/features/trainingpeaks/trainingpeaks-completed-workout-summary-reader";
import { getTrainingPeaksReplyDraftFormalityInstruction } from "@/features/trainingpeaks/telegram-context";

const FORBIDDEN_CLAIMS_BASE: string[] = [
  "laps",
  "splits",
  "interval actuals",
  "per-repeat pace",
  "per-repeat HR",
  "repeat execution quality",
  "отрезки ровные",
  "каждый повтор по плану",
];

export type GroupWorkoutReportReplyDraftSourceMessage = {
  chatId: string;
  messageId: string;
  messageText: string;
  messageTimestamp: string;
  telegramUserId?: string | null;
};

export type GroupWorkoutReportReplyDraftContext = {
  studentId: string;
  studentName: string;
  source: {
    chatId: string;
    messageId: string;
    messageText: string;
    messageTimestamp: string;
    isGroup: true;
  };
  communication: {
    formality: TrainingPeaksTelegramFormality;
    formalitySource: string;
    instruction: string;
    notes: string[];
  };
  workout: {
    matchStatus: string;
    matchConfidence: string;
    workoutType: string;
    title?: string | null;
    date: string;
  };
  analysis: {
    confidence: "high" | "medium" | "low";
    executionStatus: string;
    summaryForCoach: string;
    planActualBullets: string[];
    riskFlags: string[];
    unavailableDataNotes: string[];
    recommendationForDraft: string;
    allowedClaims: string[];
    forbiddenClaims: string[];
  };
  promptContext: string;
};

export type BuildGroupWorkoutReportReplyDraftContextInput = {
  student: Pick<TrainingPeaksStudent, "id" | "studentName" | "telegramFormality" | "telegramContextNotes">;
  sourceMessage: GroupWorkoutReportReplyDraftSourceMessage;
  intake?: Pick<TrainingPeaksGroupWorkoutReportIntake, "id"> | null;
  match: GroupWorkoutReportWorkoutMatchResult;
  plannedWorkout?: TrainingPeaksWorkoutCacheRow | null;
  completedWorkout?: TrainingPeaksWorkoutCacheRow | null;
  completedWorkoutSummaryDetails?: TrainingPeaksCompletedWorkoutSummaryDetails | null;
  analysis: GroupWorkoutReportWorkoutAnalysis;
  detectedLabels?: string[];
  activeMemoryItems?: Parameters<typeof resolveStudentCommunicationProfile>[0]["activeMemoryItems"];
};

export function buildGroupWorkoutReportDraftSafeClaims(
  analysis: GroupWorkoutReportWorkoutAnalysis
): { allowedClaims: string[]; forbiddenClaims: string[] } {
  const allowedClaims: string[] = [];
  const forbiddenClaims = [...FORBIDDEN_CLAIMS_BASE];

  if (analysis.dataAvailability.hasCompletedDuration) {
    allowedClaims.push("duration");
  }
  if (analysis.dataAvailability.hasCompletedDistance) {
    allowedClaims.push("distance");
  }
  if (analysis.dataAvailability.hasAveragePace) {
    allowedClaims.push("average pace");
  }
  if (analysis.dataAvailability.hasAverageHeartRate) {
    allowedClaims.push("average HR");
  }
  if (analysis.planActualBullets.some((bullet) => bullet.startsWith("Max HR:"))) {
    allowedClaims.push("max HR");
  }
  if (analysis.planActualBullets.some((bullet) => bullet.includes("Planned structure present"))) {
    allowedClaims.push("planned structure present");
  }
  if (analysis.planActualBullets.some((bullet) => bullet.includes("Target pace/HR present"))) {
    allowedClaims.push("target pace/HR present");
  }
  if (analysis.planActualBullets.some((bullet) => bullet.includes("Coach comments present"))) {
    allowedClaims.push("coach comments present");
  }
  if (
    analysis.workoutType === "quality_interval" ||
    analysis.planActualBullets.some((bullet) => bullet.includes("Planned structure present")) ||
    analysis.unavailableDataNotes.some(
      (note) =>
        note.includes("фактические отрезки") ||
        note.includes("planned interval/step structure") ||
        note.includes("interval actuals are unavailable")
    )
  ) {
    forbiddenClaims.push("interval repeat-level execution claims");
  }

  return { allowedClaims, forbiddenClaims };
}

export function buildGroupWorkoutReportReplyDraftIdempotencyKey(input: {
  sourceChatId: string;
  sourceMessageId: string;
}): string {
  return `group_workout_report:${input.sourceChatId.trim()}:${input.sourceMessageId.trim()}`;
}

function buildCommunicationNotes(profile: ResolvedStudentCommunicationProfile): string[] {
  const notes: string[] = [];
  if (profile.notes) {
    notes.push(profile.notes);
  }
  if (profile.conflictFlags.length > 0) {
    notes.push(`conflict_flags: ${profile.conflictFlags.join(", ")}`);
  }
  return notes;
}

function buildDraftRecommendation(input: {
  analysis: GroupWorkoutReportWorkoutAnalysis;
  detectedLabels: string[];
  allowedClaims: string[];
  forbiddenClaims: string[];
}): string {
  const parts: string[] = [input.analysis.recommendationForDraft];

  const hasHealthSignal =
    input.detectedLabels.includes("pain_or_health") ||
    input.analysis.riskFlags.includes("pain_or_health_signal_in_report");

  if (hasHealthSignal) {
    parts.push(
      "Есть сигнал по самочувствию/боли: не начинай с «отлично/молодец», сначала коротко отметь симптом, без диагноза, с осторожностью и без давления на нагрузку."
    );
  } else if (input.analysis.executionStatus === "good") {
    parts.push("Можно коротко поддержать выполнение, но без перегиба и без недоступных деталей.");
  }

  parts.push(`Разрешённые упоминания: ${input.allowedClaims.join(", ") || "только общий контекст"}.`);
  parts.push(`Запрещённые упоминания: ${input.forbiddenClaims.join(", ")}.`);

  return parts.join(" ");
}

function buildPromptContext(input: {
  studentName: string;
  sourceMessage: GroupWorkoutReportReplyDraftSourceMessage;
  profile: ResolvedStudentCommunicationProfile;
  formalityInstruction: string;
  match: GroupWorkoutReportWorkoutMatchResult;
  workoutTitle: string | null;
  workoutDate: string;
  workoutType: string;
  analysis: GroupWorkoutReportWorkoutAnalysis;
  recommendationForDraft: string;
  allowedClaims: string[];
  forbiddenClaims: string[];
  detectedLabels: string[];
}): string {
  const profileLines = buildResolvedCommunicationProfilePromptLines(input.profile);
  const lines = [
    "Контекст: публичный ответ в групповом Telegram-чате.",
    "Не упоминай скрытые/внутренние поля, служебные метки и недоступные данные.",
    "Не утверждай laps/splits/фактические интервалы/ровность отрезков/каждый повтор по плану.",
    "Используй ty/vy строго из resolved communication profile.",
    "Если formality unknown — нейтральные формулировки, без рискованных окончаний глаголов.",
    "Ответ короткий (1–4 предложения), естественный, без markdown и без технического отчёта.",
    "",
    `Ученик: ${input.studentName}`,
    `Сообщение ученика: ${input.sourceMessage.messageText.trim()}`,
    `Дата тренировки (reference): ${input.workoutDate}`,
    `Тип тренировки: ${input.workoutType}`,
    ...(input.workoutTitle ? [`Название: ${input.workoutTitle}`] : []),
    "",
    "Сопоставление тренировки:",
    `- status: ${input.match.status}`,
    `- confidence: ${input.match.confidence}`,
    `- reference_date_policy: ${input.match.referenceDatePolicy}`,
    "",
    "Анализ plan-vs-actual:",
    `- execution_status: ${input.analysis.executionStatus}`,
    `- confidence: ${input.analysis.confidence}`,
    `- summary: ${input.analysis.summaryForCoach}`,
    ...input.analysis.planActualBullets.map((bullet) => `- ${bullet}`),
    "",
    "Риски:",
    ...(input.analysis.riskFlags.length > 0
      ? input.analysis.riskFlags.map((flag) => `- ${flag}`)
      : ["- none"]),
    "",
    "Метки сообщения:",
    ...(input.detectedLabels.length > 0
      ? input.detectedLabels.map((label) => `- ${label}`)
      : ["- none"]),
    "",
    "Рекомендация для черновика:",
    input.recommendationForDraft,
    "",
    "Разрешённые утверждения:",
    ...input.allowedClaims.map((claim) => `- ${claim}`),
    "",
    "Запрещённые утверждения:",
    ...input.forbiddenClaims.map((claim) => `- ${claim}`),
    "",
    ...profileLines,
    "",
    "Formality instruction:",
    input.formalityInstruction,
  ];

  return lines.join("\n");
}

export function buildGroupWorkoutReportReplyDraftContext(
  input: BuildGroupWorkoutReportReplyDraftContextInput
): GroupWorkoutReportReplyDraftContext {
  const detectedLabels = input.detectedLabels ?? [];
  const resolvedProfile = resolveStudentCommunicationProfile({
    telegramFormality: input.student.telegramFormality,
    telegramContextNotes: input.student.telegramContextNotes,
    activeMemoryItems: input.activeMemoryItems ?? [],
  });
  const formalityInstruction = getTrainingPeaksReplyDraftFormalityInstruction(resolvedProfile.formality);
  const { allowedClaims, forbiddenClaims } = buildGroupWorkoutReportDraftSafeClaims(input.analysis);
  const recommendationForDraft = buildDraftRecommendation({
    analysis: input.analysis,
    detectedLabels,
    allowedClaims,
    forbiddenClaims,
  });

  const workoutRow = input.completedWorkout ?? input.plannedWorkout ?? null;

  const promptContext = buildPromptContext({
    studentName: input.student.studentName,
    sourceMessage: input.sourceMessage,
    profile: resolvedProfile,
    formalityInstruction,
    match: input.match,
    workoutTitle: workoutRow?.title ?? null,
    workoutDate: input.match.referenceDate,
    workoutType: input.analysis.workoutType,
    analysis: input.analysis,
    recommendationForDraft,
    allowedClaims,
    forbiddenClaims,
    detectedLabels,
  });

  return {
    studentId: input.student.id,
    studentName: input.student.studentName,
    source: {
      chatId: input.sourceMessage.chatId,
      messageId: input.sourceMessage.messageId,
      messageText: input.sourceMessage.messageText,
      messageTimestamp: input.sourceMessage.messageTimestamp,
      isGroup: true,
    },
    communication: {
      formality: resolvedProfile.formality,
      formalitySource: resolvedProfile.formalitySource,
      instruction: formalityInstruction,
      notes: buildCommunicationNotes(resolvedProfile),
    },
    workout: {
      matchStatus: input.match.status,
      matchConfidence: input.match.confidence,
      workoutType: input.analysis.workoutType,
      title: workoutRow?.title ?? null,
      date: input.match.referenceDate,
    },
    analysis: {
      confidence: input.analysis.confidence,
      executionStatus: input.analysis.executionStatus,
      summaryForCoach: input.analysis.summaryForCoach,
      planActualBullets: input.analysis.planActualBullets,
      riskFlags: input.analysis.riskFlags,
      unavailableDataNotes: input.analysis.unavailableDataNotes,
      recommendationForDraft,
      allowedClaims,
      forbiddenClaims,
    },
    promptContext,
  };
}
