import type { NextRequest } from "next/server";

import { resolveMiniAppCoach } from "@/features/telegram/miniapp-coach-resolver";
import { markFeedbackJobDismissed } from "@/features/trainingpeaks/feedback/feedback-queue";

export const runtime = "nodejs";

function isMiniAppEnabled(): boolean {
  return process.env.MINIAPP_ENABLED === "true";
}

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export async function POST(request: NextRequest): Promise<Response> {
  if (!isMiniAppEnabled()) {
    return jsonResponse(503, { ok: false, error: "Рабочий стол пока не активен." });
  }

  let initData = "";
  let jobId = "";
  try {
    const body = (await request.json()) as { initData?: unknown; jobId?: unknown };
    initData = typeof body.initData === "string" ? body.initData : "";
    jobId = typeof body.jobId === "string" ? body.jobId : "";
  } catch {
    return jsonResponse(400, { ok: false, error: "Неверный запрос." });
  }

  const coach = resolveMiniAppCoach({ initData });
  if (!coach.ok) {
    return jsonResponse(coach.httpStatus, { ok: false, error: coach.message });
  }
  if (!jobId) {
    return jsonResponse(400, { ok: false, error: "Не указан черновик." });
  }

  try {
    const dismissed = await markFeedbackJobDismissed({ jobId, actorChatId: coach.coachTelegramId });
    if (!dismissed) {
      return jsonResponse(409, { ok: false, error: "Черновик уже обработан." });
    }
    return jsonResponse(200, { ok: true });
  } catch (error) {
    console.error("[miniapp.desk.reports.dismiss] failed", {
      jobId,
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonResponse(500, { ok: false, error: "Не удалось пропустить черновик." });
  }
}
