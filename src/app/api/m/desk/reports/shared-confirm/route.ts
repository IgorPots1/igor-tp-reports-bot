// Confirm a group share actually landed (Mini App «Отчёты» → shared card → «Готово»).
// A group share has no delivery confirmation, so 'shared' is not terminal — the card stays in
// review with «Отправить ещё раз» until Igor confirms it reached the right chat. This endpoint
// records that confirmation (shared→shared_confirmed) and moves the card to history. It delivers
// nothing, so it is NOT gated by the send kill-switch.

import type { NextRequest } from "next/server";

import { resolveMiniAppCoach } from "@/features/telegram/miniapp-coach-resolver";
import { getTrainingPeaksFeedbackJobById, markFeedbackJobSharedConfirmed } from "@/features/trainingpeaks/feedback/feedback-queue";

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
    const job = await getTrainingPeaksFeedbackJobById(jobId);
    if (!job) {
      return jsonResponse(404, { ok: false, error: "Черновик не найден." });
    }
    if (job.status !== "shared") {
      return jsonResponse(409, { ok: false, error: "Черновик не в статусе «передано в чат»." });
    }
    const confirmed = await markFeedbackJobSharedConfirmed({ jobId, actorChatId: coach.coachTelegramId });
    if (!confirmed) {
      return jsonResponse(409, { ok: false, error: "Черновик уже обработан." });
    }
    return jsonResponse(200, { ok: true, outcome: "shared_confirmed" });
  } catch (error) {
    console.error("[miniapp.desk.reports.shared-confirm] failed", {
      jobId,
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonResponse(500, { ok: false, error: "Не удалось отметить как готовое." });
  }
}
