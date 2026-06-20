import { sendTelegramMessageStrict, getTelegramBotUsername } from "@/features/telegram/telegram-client";
import { resolveGreeting } from "@/features/nutrition/telegram-renderer";
import { getRequiredTrainingPeaksBusinessConnectionId } from "@/features/trainingpeaks/telegram-business";
import {
  getTrainingPeaksStudentById,
  getTrainingPeaksStudentByStudentId,
} from "@/features/trainingpeaks/repository";
import type { TrainingPeaksTelegramFormality } from "@/features/trainingpeaks/repository";

export type SendNutritionFormResult =
  | { ok: true; studentName: string }
  | { ok: false; reason: string };

function isMiniAppEnabled(): boolean {
  return process.env.MINIAPP_ENABLED === "true";
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Greeting + formality-aware request + the Mini App deep link as an HTML link.
 *
 * The link lives in the MESSAGE TEXT (parse_mode=HTML), not an inline button:
 * named Mini App links require a web_app button, which Telegram rejects in
 * business messages (BUTTON_TYPE_INVALID). An HTML <a> link renders as tappable
 * "Открыть форму" (the long URL hidden) and is allowed in business text. The
 * tapped link opens the Mini App with the same signed start_param, so
 * auto-linking still works. HTML is used (not MarkdownV2) — the bot client
 * already supports parse_mode HTML and escaping is simpler (&, <, > only).
 */
function buildFormMessage(formality: TrainingPeaksTelegramFormality, deepLink: string): string {
  const greeting = resolveGreeting(formality);
  const request =
    formality === "vy"
      ? "Загрузите отчёт о питании за прошедшую неделю:"
      : "Загрузи отчёт о питании за прошедшую неделю:";
  const link = `<a href="${escapeHtml(deepLink)}">Открыть форму</a>`;
  return `${escapeHtml(greeting)}\n\n${escapeHtml(request)}\n👉 ${link}`;
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
 * Sends the nutrition upload-form link to one student's Business DM.
 *
 * `identifier` may be the student ROW id (UUID) — what the admin UI passes
 * (row.studentId = student.id) — or the public text slug — what curl callers
 * use (?studentId=aleksandra-kasianenko). Resolve by UUID first, then fall back
 * to slug, so both paths work. Returns a structured result (never throws for
 * expected conditions) so callers surface a clear message instead of failing
 * silently.
 */
export async function sendNutritionFormButtonToStudent(
  identifier: string
): Promise<SendNutritionFormResult> {
  if (!isMiniAppEnabled()) {
    return { ok: false, reason: "MINIAPP_ENABLED не включён." };
  }

  const student =
    (await getTrainingPeaksStudentById(identifier).catch(() => null)) ??
    (await getTrainingPeaksStudentByStudentId(identifier).catch(() => null));
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
    // Plain text with the deep link — no reply_markup. Inline buttons for named
    // Mini Apps are not allowed in business messages; a text link is.
    await sendTelegramMessageStrict(
      student.telegramChatId,
      buildFormMessage(student.telegramFormality, miniAppUrl),
      {
        businessConnectionId: getRequiredTrainingPeaksBusinessConnectionId(),
        parseMode: "HTML",
        // No Mini App preview card under the link — Igor wants clean text.
        disableLinkPreview: true,
      }
    );
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
