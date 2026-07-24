// Batch generation of the top-N most significant «Новые» drafts ("Сгенерить свежие").
// Coach-only. Each draft is a paid API call, so the batch is HARD-CAPPED (MAX_BATCH) and
// runs sequentially — a deliberate guard so a hundred generations can't fire by accident.
// The client gates this behind a two-step confirm; the server caps regardless.

import type { NextRequest } from "next/server";

import { resolveMiniAppCoach } from "@/features/telegram/miniapp-coach-resolver";
import { generateTopPendingFeedbackJobs, MAX_BATCH } from "@/features/trainingpeaks/feedback/feedback-generate";

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
  let limit = 5;
  try {
    const body = (await request.json()) as { initData?: unknown; limit?: unknown };
    initData = typeof body.initData === "string" ? body.initData : "";
    if (typeof body.limit === "number" && Number.isFinite(body.limit)) limit = Math.floor(body.limit);
  } catch {
    return jsonResponse(400, { ok: false, error: "Неверный запрос." });
  }

  const coach = resolveMiniAppCoach({ initData });
  if (!coach.ok) {
    return jsonResponse(coach.httpStatus, { ok: false, error: coach.message });
  }

  // Clamp to [1, MAX_BATCH] — the cap is the whole point of this route.
  const capped = Math.max(1, Math.min(limit, MAX_BATCH));

  try {
    const summary = await generateTopPendingFeedbackJobs(capped);
    if (summary.refused > 0 && summary.done === 0) {
      return jsonResponse(409, {
        ok: false,
        outcome: "refused",
        error: "Активен режим Cowork — генерация идёт из десктопа. Переключи режим на API.",
      });
    }
    return jsonResponse(200, {
      ok: true,
      requested: summary.requested,
      done: summary.done,
      failed: summary.failed,
      errored: summary.errored,
    });
  } catch (error) {
    console.error("[miniapp.desk.reports.generate-batch] failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonResponse(500, { ok: false, error: "Не удалось сгенерировать пакет." });
  }
}
