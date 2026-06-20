import type { NextRequest } from "next/server";

import { sendTelegramWebAppButton } from "@/features/telegram/telegram-client";
import { signStudentLink } from "@/features/telegram/validate-init-data";
import { getRequiredTrainingPeaksBusinessConnectionId } from "@/features/trainingpeaks/telegram-business";
import { getTrainingPeaksStudentByStudentId } from "@/features/trainingpeaks/repository";
import { isValidAdminAccessToken } from "@/lib/admin-auth";

export const runtime = "nodejs";

function isMiniAppEnabled(): boolean {
  return process.env.MINIAPP_ENABLED === "true";
}

function getMiniAppUrl(studentId: string): string {
  const base = process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, "") ?? "";
  const sig = signStudentLink(studentId);
  const query = new URLSearchParams({ sid: studentId, sig });
  return `${base}/m/n?${query.toString()}`;
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

  const miniAppUrl = getMiniAppUrl(student.studentId);

  await sendTelegramWebAppButton({
    chatId: student.telegramChatId,
    text: "Загрузи отчёт о питании за прошедшую неделю:",
    buttonLabel: "Открыть форму",
    webAppUrl: miniAppUrl,
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
