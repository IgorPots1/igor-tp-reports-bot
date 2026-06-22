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
 * Greeting + formality-aware body + the Mini App deep link as an HTML link.
 *
 * The link lives in the MESSAGE TEXT (parse_mode=HTML), not an inline button:
 * named Mini App links require a web_app button, which Telegram rejects in
 * business messages (BUTTON_TYPE_INVALID). An HTML <a> link renders as a tappable
 * label (the long URL hidden) and is allowed in business text. The tapped link
 * opens the Mini App with the same signed start_param, so auto-linking works.
 */
function buildLinkMessage(input: {
  formality: TrainingPeaksTelegramFormality;
  deepLink: string;
  request: string;
  linkLabel: string;
  /** Greeting is dropped for the review (it almost always follows the form msg). */
  includeGreeting?: boolean;
}): string {
  const link = `<a href="${escapeHtml(input.deepLink)}">${escapeHtml(input.linkLabel)}</a>`;
  const body = `${escapeHtml(input.request)}\n👉 ${link}`;
  if (input.includeGreeting === false) {
    return body;
  }
  const greeting = resolveGreeting(input.formality);
  return `${escapeHtml(greeting)}\n\n${body}`;
}

/**
 * Builds the t.me Mini App direct link. The student's row id (UUID) is passed as
 * `startapp` — UUID chars [0-9a-f-] are startapp-safe and Telegram folds
 * start_param into the signed initData, so it needs no extra signature. The
 * review screen uses an `r_` prefix; the form uses the bare id.
 */
async function buildMiniAppDeepLink(studentRowId: string, mode: "form" | "review"): Promise<string> {
  const shortName = process.env.TELEGRAM_MINIAPP_SHORT_NAME?.trim();
  if (!shortName) {
    throw new Error("TELEGRAM_MINIAPP_SHORT_NAME is not set (BotFather /newapp short name).");
  }
  const username = await getTelegramBotUsername();
  const startParam = mode === "review" ? `r_${studentRowId}` : studentRowId;
  return `https://t.me/${username}/${shortName}?startapp=${startParam}`;
}

/**
 * Shared delivery for the mini-app links (form upload + review). Resolves the
 * student UUID-first (admin UI passes student.id) then by slug (curl), gates on
 * MINIAPP_ENABLED, builds the deep link, and sends it as business text (HTML,
 * link preview off). Every failure is logged (lesson #4), not just returned.
 *
 * `identifier` may be the student ROW id (UUID) or the public text slug.
 */
async function sendMiniAppLinkToStudent(
  identifier: string,
  mode: "form" | "review"
): Promise<SendNutritionFormResult> {
  const logTag = mode === "review" ? "[nutrition.send-review]" : "[nutrition.send-form]";
  const fail = (reason: string): SendNutritionFormResult => {
    console.error(`${logTag} failed`, { identifier, reason });
    return { ok: false, reason };
  };

  if (!isMiniAppEnabled()) {
    return fail("MINIAPP_ENABLED не включён.");
  }

  const student =
    (await getTrainingPeaksStudentById(identifier).catch(() => null)) ??
    (await getTrainingPeaksStudentByStudentId(identifier).catch(() => null));
  if (!student) {
    return fail("Ученик не найден.");
  }
  if (!student.telegramChatId) {
    return fail(`У «${student.studentName}» нет Telegram-чата.`);
  }

  let deepLink: string;
  try {
    deepLink = await buildMiniAppDeepLink(student.id, mode);
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Не настроена ссылка mini app.");
  }

  const message =
    mode === "review"
      ? buildLinkMessage({
          formality: student.telegramFormality,
          deepLink,
          request: "Разбор за неделю готов:",
          linkLabel: "Открыть разбор",
          // No greeting — the review almost always follows the form message.
          includeGreeting: false,
        })
      : buildLinkMessage({
          formality: student.telegramFormality,
          deepLink,
          request:
            student.telegramFormality === "vy"
              ? "Загрузите отчёт о питании за прошедшую неделю:"
              : "Загрузи отчёт о питании за прошедшую неделю:",
          linkLabel: "Открыть форму",
        });

  try {
    await sendTelegramMessageStrict(student.telegramChatId, message, {
      businessConnectionId: getRequiredTrainingPeaksBusinessConnectionId(),
      parseMode: "HTML",
      disableLinkPreview: true,
    });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Не удалось отправить сообщение.");
  }

  console.info(`${logTag} sent`, {
    studentId: student.studentId,
    studentName: student.studentName,
    chatId: student.telegramChatId,
  });

  return { ok: true, studentName: student.studentName };
}

/** Sends the nutrition upload-form link to a student's Business DM. */
export async function sendNutritionFormButtonToStudent(
  identifier: string
): Promise<SendNutritionFormResult> {
  return sendMiniAppLinkToStudent(identifier, "form");
}

/** Sends the "review ready" link (r_ deep link) to a student's Business DM. */
export async function sendNutritionReviewLinkToStudent(
  identifier: string
): Promise<SendNutritionFormResult> {
  return sendMiniAppLinkToStudent(identifier, "review");
}
