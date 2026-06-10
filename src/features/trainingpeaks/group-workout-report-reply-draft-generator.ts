import type { GroupWorkoutReportReplyDraftContext } from "@/features/trainingpeaks/group-workout-report-reply-draft-context";
import {
  getTrainingPeaksReplyDraftModel,
  type GenerateTrainingPeaksReplyDraftResult,
} from "@/features/trainingpeaks/reply-draft-generator";

const OPENAI_API_URL = process.env.OPENAI_API_URL?.trim() || "https://api.openai.com/v1/chat/completions";

export type GroupWorkoutReportReplyDraftGenerationBlockedReason =
  | "match_not_confident"
  | "analysis_insufficient"
  | "health_requires_manual_review"
  | "missing_communication_profile"
  | "generator_unavailable";

export type GroupWorkoutReportReplyDraftGenerationResult =
  | {
      status: "generated";
      draftText: string;
      model?: string;
      warnings: string[];
    }
  | {
      status: "blocked";
      reason: GroupWorkoutReportReplyDraftGenerationBlockedReason;
      warnings: string[];
    };

export type EvaluateGroupWorkoutReportReplyDraftGenerationGateInput = {
  context: GroupWorkoutReportReplyDraftContext;
  requireKnownFormality?: boolean;
};

export function evaluateGroupWorkoutReportReplyDraftGenerationGate(
  input: EvaluateGroupWorkoutReportReplyDraftGenerationGateInput
): GroupWorkoutReportReplyDraftGenerationResult | null {
  const warnings: string[] = [];
  const { context } = input;

  if (context.workout.matchStatus === "ambiguous" || context.workout.matchStatus === "not_found") {
    return {
      status: "blocked",
      reason: "match_not_confident",
      warnings: [`workout match status is ${context.workout.matchStatus}`],
    };
  }

  if (context.workout.matchConfidence === "low") {
    return {
      status: "blocked",
      reason: "match_not_confident",
      warnings: ["workout match confidence is low"],
    };
  }

  if (context.analysis.riskFlags.includes("workout_match_ambiguous")) {
    return {
      status: "blocked",
      reason: "match_not_confident",
      warnings: ["analysis flagged ambiguous workout match"],
    };
  }

  if (
    context.analysis.confidence === "low" ||
    context.analysis.executionStatus === "insufficient_data" ||
    context.analysis.executionStatus === "ambiguous"
  ) {
    return {
      status: "blocked",
      reason: "analysis_insufficient",
      warnings: [
        `analysis confidence=${context.analysis.confidence}, execution_status=${context.analysis.executionStatus}`,
      ],
    };
  }

  if (input.requireKnownFormality && context.communication.formality === "unknown") {
    return {
      status: "blocked",
      reason: "missing_communication_profile",
      warnings: ["communication formality is unknown and strict mode is enabled"],
    };
  }

  if (context.analysis.riskFlags.includes("pain_or_health_signal_in_report")) {
    warnings.push("health/pain signal present: use cautious tone, no celebratory opener");
  }

  return null;
}

export type GenerateGroupWorkoutReportReplyDraftInput = {
  context: GroupWorkoutReportReplyDraftContext;
  generateDraft?: (input: {
    studentMessage: string;
    promptContext: string;
    formalityInstruction: string;
  }) => Promise<GenerateTrainingPeaksReplyDraftResult>;
};

function buildGroupWorkoutReportSystemPrompt(formalityInstruction: string): string {
  return [
    "Ты помогаешь тренеру по бегу подготовить короткий черновик ответа ученику в публичном групповом Telegram-чате.",
    formalityInstruction,
    "Ответ: 1–4 коротких предложения, без markdown, без списков и без технического отчёта.",
    "Пиши естественно, по-русски, в стиле тренера Игоря: спокойно, по делу, без канцелярита.",
    "Это черновик для проверки тренером — не пиши, что сообщение уже отправлено.",
    "Используй только факты из контекста и сообщения ученика. Не выдумывай метрики.",
    "Не упоминай laps, splits, фактические интервалы, ровность отрезков, «каждый повтор по плану».",
    "Не упоминай недоступные данные и внутренние служебные поля.",
    "Не ставь медицинских диагнозов и не давай медицинской уверенности.",
    "Если есть сигнал боли/самочувствия — сначала коротко отметь это, без «отлично/молодец» в начале, предложи наблюдать и не форсировать.",
    "Соблюдай allowed/forbidden claims из контекста.",
    "Formality (ты/вы) бери только из resolved communication profile.",
  ].join("\n");
}

async function defaultGenerateDraft(input: {
  studentMessage: string;
  promptContext: string;
  formalityInstruction: string;
}): Promise<GenerateTrainingPeaksReplyDraftResult> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return { ok: false, reason: "missing_api_key" };
  }

  const model = getTrainingPeaksReplyDraftModel();
  const systemPrompt = buildGroupWorkoutReportSystemPrompt(input.formalityInstruction);
  const userPrompt = [
    "Сообщение ученика:",
    input.studentMessage.trim(),
    "",
    "Контекст для черновика:",
    input.promptContext.trim(),
    "",
    "Сформируй короткий черновик публичного ответа в групповом чате.",
  ].join("\n");

  try {
    const response = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.4,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!response.ok) {
      return { ok: false, reason: "request_failed" };
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const draftText = payload.choices?.[0]?.message?.content?.trim();
    if (!draftText) {
      return { ok: false, reason: "empty_response" };
    }

    return { ok: true, draftText };
  } catch {
    return { ok: false, reason: "request_failed" };
  }
}

export async function generateGroupWorkoutReportReplyDraft(
  input: GenerateGroupWorkoutReportReplyDraftInput
): Promise<GroupWorkoutReportReplyDraftGenerationResult> {
  const gate = evaluateGroupWorkoutReportReplyDraftGenerationGate({
    context: input.context,
  });
  if (gate) {
    return gate;
  }

  const warnings: string[] = [];
  if (input.context.analysis.riskFlags.includes("pain_or_health_signal_in_report")) {
    warnings.push("health/pain signal: cautious tone applied");
  }

  const generateDraft = input.generateDraft ?? defaultGenerateDraft;
  const draftResult = await generateDraft({
    studentMessage: input.context.source.messageText,
    promptContext: input.context.promptContext,
    formalityInstruction: input.context.communication.instruction,
  });

  if (!draftResult.ok) {
    return {
      status: "blocked",
      reason: "generator_unavailable",
      warnings: [`generator failed: ${draftResult.reason}`],
    };
  }

  return {
    status: "generated",
    draftText: draftResult.draftText,
    model: getTrainingPeaksReplyDraftModel(),
    warnings,
  };
}
