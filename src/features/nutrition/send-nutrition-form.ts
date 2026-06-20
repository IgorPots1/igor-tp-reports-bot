import { sendTelegramUrlButton, getTelegramBotUsername } from "@/features/telegram/telegram-client";
import { resolveGreeting } from "@/features/nutrition/telegram-renderer";
import { getRequiredTrainingPeaksBusinessConnectionId } from "@/features/trainingpeaks/telegram-business";
import { getTrainingPeaksStudentByStudentId } from "@/features/trainingpeaks/repository";
import type { TrainingPeaksTelegramFormality } from "@/features/trainingpeaks/repository";

export type SendNutritionFormResult =
  | { ok: true; studentName: string }
  | { ok: false; reason: string };

function isMiniAppEnabled(): boolean {
  return process.env.MINIAPP_ENABLED === "true";
}

/** Greeting + formality-aware request, ты/вы from the student's profile. */
function buildButtonMessage(formality: TrainingPeaksTelegramFormality): string {
  const greeting = resolveGreeting(formality);
  const request =
    formality === "vy"
      ? "Загрузите отчёт о питании за прошедшую неделю:"
      : "Загрузи отчёт о питании за прошедшую неделю:";
  return `${greeting}\n\n${request}`;
}

/**
 * Builds the t.me Mini App direct link. The student's row id (UUID) is passed
 * as `startapp` — UUID chars [0-9a-f-] are startapp-safe and Telegram folds
 * start_param into the signed initData, so it needs no extra signature.
 */
async function buildMiniAppDeepLink(studentRowId: string): Promise<string> {
  const shortName = process.env.TELEGRAM_MINIAPP_SHORT_NAME?.trim();
  if (!shortName) {
    throw new Error("TELEGRAM_MINIAPP_SHORT_NAME is not set (BotFather /newapp short name).");
  }
  const username = await getTelegramBotUsername();
  return `https://t.me/${username}/${shortName}?startapp=${studentRowId}`;
}

/**
 * Sends the nutrition upload-form button to one student's Business DM.
 *
 * `studentId` is the public text slug; it is resolved to the student row, whose
 * UUID `id` carries the deep link. Returns a structured result (never throws for
 * expected conditions) so callers — the curl route and the admin server actions
 * — can surface a clear message instead of a silent failure.
 */
export async function sendNutritionFormButtonToStudent(
  studentId: string
): Promise<SendNutritionFormResult> {
  if (!isMiniAppEnabled()) {
    return { ok: false, reason: "MINIAPP_ENABLED не включён." };
  }

  const student = await getTrainingPeaksStudentByStudentId(studentId).catch(() => null);
  if (!student) {
    return { ok: false, reason: "Ученик не найден." };
  }
  if (!student.telegramChatId) {
    return { ok: false, reason: `У «${student.studentName}» нет Telegram-чата.` };
  }

  let miniAppUrl: string;
  try {
    miniAppUrl = await buildMiniAppDeepLink(student.id);
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Не настроена ссылка mini app.",
    };
  }

  try {
    await sendTelegramUrlButton({
      chatId: student.telegramChatId,
      text: buildButtonMessage(student.telegramFormality),
      buttonLabel: "Открыть форму",
      url: miniAppUrl,
      businessConnectionId: getRequiredTrainingPeaksBusinessConnectionId(),
    });
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Не удалось отправить сообщение.",
    };
  }

  console.info("[nutrition.send-form] sent", {
    studentId: student.studentId,
    studentName: student.studentName,
    chatId: student.telegramChatId,
  });

  return { ok: true, studentName: student.studentName };
}
