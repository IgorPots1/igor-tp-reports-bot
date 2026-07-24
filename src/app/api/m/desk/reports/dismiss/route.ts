import type { NextRequest } from "next/server";

import { resolveMiniAppCoach } from "@/features/telegram/miniapp-coach-resolver";
import { markFeedbackJobDismissed, markPendingFeedbackJobsDismissedOlderThan } from "@/features/trainingpeaks/feedback/feedback-queue";

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
  let olderThanDays: number | null = null;
  try {
    const body = (await request.json()) as { initData?: unknown; jobId?: unknown; olderThanDays?: unknown };
    initData = typeof body.initData === "string" ? body.initData : "";
    jobId = typeof body.jobId === "string" ? body.jobId : "";
    if (typeof body.olderThanDays === "number" && Number.isFinite(body.olderThanDays)) {
      olderThanDays = Math.floor(body.olderThanDays);
    }
  } catch {
    return jsonResponse(400, { ok: false, error: "Неверный запрос." });
  }

  const coach = resolveMiniAppCoach({ initData });
  if (!coach.ok) {
    return jsonResponse(coach.httpStatus, { ok: false, error: coach.message });
  }

  // Bulk mode: clear «Новые» older than N days (by workout date) in one tap.
  if (olderThanDays !== null) {
    const days = Math.max(1, Math.min(olderThanDays, 60));
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    try {
      const { dismissed } = await markPendingFeedbackJobsDismissedOlderThan({ workoutDateCutoff: cutoff, actorChatId: coach.coachTelegramId });
      return jsonResponse(200, { ok: true, dismissed });
    } catch (error) {
      console.error("[miniapp.desk.reports.dismiss] bulk failed", {
        olderThanDays: days,
        error: error instanceof Error ? error.message : String(error),
      });
      return jsonResponse(500, { ok: false, error: "Не удалось разобрать очередь." });
    }
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
