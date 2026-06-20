import type { NextRequest } from "next/server";

import { sendTelegramUrlButton, getTelegramBotUsername } from "@/features/telegram/telegram-client";
import { getRequiredTrainingPeaksBusinessConnectionId } from "@/features/trainingpeaks/telegram-business";
import { getTrainingPeaksStudentByStudentId } from "@/features/trainingpeaks/repository";
import { resolveGreeting } from "@/features/nutrition/telegram-renderer";
import type { TrainingPeaksTelegramFormality } from "@/features/trainingpeaks/repository";
import { isValidAdminAccessToken } from "@/lib/admin-auth";

export const runtime = "nodejs";

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

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function checkAdminAuth(request: NextRequest): boolean {
  const auth = request.headers.get("Authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  if (token && isValidAdminAccessToken(token)) return true;
  // Also accept the token as a query param (curl convenience).
  const qp = new URL(request.url).searchParams.get("admin_token");
  return Boolean(qp && isValidAdminAccessToken(qp));
}

export async function GET(request: NextRequest): Promise<Response> {
  if (!checkAdminAuth(request)) {
    return jsonResponse(401, { ok: false, error: "Unauthorized" });
  }

  if (!isMiniAppEnabled()) {
    return jsonResponse(503, { ok: false, error: "MINIAPP_ENABLED is not set to true." });
  }

  const url = new URL(request.url);
  const studentId = url.searchParams.get("studentId")?.trim();
  if (!studentId) {
    return jsonResponse(400, { ok: false, error: "studentId required" });
  }

  const student = await getTrainingPeaksStudentByStudentId(studentId).catch(() => null);
  if (!student) {
    return jsonResponse(404, { ok: false, error: "Student not found" });
  }
  if (!student.telegramChatId) {
    return jsonResponse(422, { ok: false, error: "Student has no telegramChatId" });
  }

  let miniAppUrl: string;
  try {
    miniAppUrl = await buildMiniAppDeepLink(student.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Mini app deep link not configured.";
    return jsonResponse(500, { ok: false, error: message });
  }

  await sendTelegramUrlButton({
    chatId: student.telegramChatId,
    text: buildButtonMessage(student.telegramFormality),
    buttonLabel: "Открыть форму",
    url: miniAppUrl,
    businessConnectionId: getRequiredTrainingPeaksBusinessConnectionId(),
  });

  console.info("[admin.send-nutrition-button] sent", {
    studentId: student.studentId,
    studentName: student.studentName,
    chatId: student.telegramChatId,
    miniAppUrl,
  });

  return jsonResponse(200, {
    ok: true,
    studentId: student.studentId,
    studentName: student.studentName,
    miniAppUrl,
  });
}
