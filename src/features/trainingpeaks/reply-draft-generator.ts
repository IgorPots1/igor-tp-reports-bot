import type { TrainingPeaksReplyDraftContext } from "@/features/trainingpeaks/reply-draft-context";
import { getTrainingPeaksReplyDraftFormalityInstruction } from "@/features/trainingpeaks/telegram-context";
import type { TrainingPeaksTelegramFormality } from "@/features/trainingpeaks/repository";

const AI_MODEL = process.env.OPENAI_REPLY_DRAFT_MODEL?.trim() || "gpt-4o-mini";
const OPENAI_API_URL = process.env.OPENAI_API_URL?.trim() || "https://api.openai.com/v1/chat/completions";

export type GenerateTrainingPeaksReplyDraftResult =
  | { ok: true; draftText: string }
  | { ok: false; reason: "missing_api_key" | "request_failed" | "empty_response" };

export async function generateTrainingPeaksReplyDraft(input: {
  studentMessage: string;
  context: TrainingPeaksReplyDraftContext;
  telegramFormality?: TrainingPeaksTelegramFormality;
}): Promise<GenerateTrainingPeaksReplyDraftResult> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return { ok: false, reason: "missing_api_key" };
  }

  const formalityInstruction = getTrainingPeaksReplyDraftFormalityInstruction(
    input.telegramFormality ?? "unknown"
  );

  const systemPrompt = [
    "Ты помогаешь тренеру по бегу подготовить черновик ответа ученику в Telegram.",
    formalityInstruction,
    "Ответ короткий: 2–4 предложения, без списков и без markdown.",
    "Это только черновик для проверки тренером — не обещай, что сообщение уже отправлено ученику.",
    "Используй только факты из переданного контекста. Если данных не хватает — прямо скажи, что нужно уточнить.",
    "Не ставь медицинских диагнозов.",
    "Не используй слова и формулировки: «перетренированность», «болезнь», «HRV плохой/низкий/упал».",
    "Не делай уверенных выводов только по Garmin.",
    "Не меняй план автоматически; если корректировка возможна — мягко: «посмотрю план / при необходимости скорректируем».",
    "Не выдумывай тренировки, дистанции, пульс и самочувствие, которых нет в контексте или в сообщении ученика.",
  ].join("\n");

  const userPrompt = [
    "Сообщение ученика:",
    input.studentMessage.trim(),
    "",
    "Контекст из Supabase (только для ориентира):",
    input.context.promptContext,
    "",
    "Сформируй черновик ответа тренера ученику.",
  ].join("\n");

  try {
    const response = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: AI_MODEL,
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

export function formatTrainingPeaksReplyDraftTelegramMessage(input: {
  studentName: string;
  contextBullets: string[];
  draftText: string;
}): string {
  const bullets =
    input.contextBullets.length > 0
      ? input.contextBullets.map((bullet) => `• ${bullet}`).join("\n")
      : "• Контекст недоступен.";

  return [
    `Черновик ответа для ${input.studentName}`,
    "",
    "Контекст:",
    bullets,
    "",
    "Ответ:",
    input.draftText.trim(),
    "",
    "Проверь перед отправкой.",
  ].join("\n");
}
