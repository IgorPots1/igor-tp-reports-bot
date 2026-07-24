// On-demand generation of ONE feedback draft (Mini App «Отчёты» → «Сгенерить» on a
// «Новые» card). Generation is NO LONGER automatic: nothing drafts until Igor taps here.
// Coach-only. Routes through the API generator → the SHARED fact-check seam (submit), so a
// draft with a stray number or wrong gender can never reach the review surface looking done.
// This is a paid API call — one deliberate tap, one draft.

import type { NextRequest } from "next/server";

import { resolveMiniAppCoach } from "@/features/telegram/miniapp-coach-resolver";
import { generateOneFeedbackJobViaApi } from "@/features/trainingpeaks/feedback/feedback-generate";

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
    const outcome = await generateOneFeedbackJobViaApi(jobId);
    if (outcome.status === "done") {
      return jsonResponse(200, { ok: true, outcome: "done", draftText: outcome.draftText });
    }
    if (outcome.status === "failed") {
      // Draft produced but fact-check rejected it — the job is now 'failed' (attention).
      return jsonResponse(200, { ok: true, outcome: "failed", reason: outcome.reason });
    }
    if (outcome.status === "refused") {
      return jsonResponse(409, { ok: false, outcome: "refused", error: outcome.reason });
    }
    if (outcome.status === "skipped") {
      return jsonResponse(409, { ok: false, outcome: "skipped", error: outcome.reason });
    }
    // status === "error": API/transport failure, job reset to pending — retriable.
    return jsonResponse(502, { ok: false, outcome: "error", error: outcome.reason });
  } catch (error) {
    console.error("[miniapp.desk.reports.generate] failed", {
      jobId,
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonResponse(500, { ok: false, error: "Не удалось сгенерировать черновик." });
  }
}
