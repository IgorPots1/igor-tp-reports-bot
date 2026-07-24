// Coach-only toggle for the feedback generator backend (api|cowork), DB-backed so Igor
// flips it from the Mini App WITHOUT a redeploy — the moment an API balance runs dry he
// switches to the Cowork subscription, or back. This only changes WHO writes the draft;
// it never sends and never bills a student, so it's safe to flip live. The dangerous
// switch — FEEDBACK_SEND_ENABLED (real delivery) — deliberately stays in env, not here.

import type { NextRequest } from "next/server";

import { resolveMiniAppCoach } from "@/features/telegram/miniapp-coach-resolver";
import { setRuntimeFlag } from "@/features/trainingpeaks/feedback/app-runtime-flags";
import { FEEDBACK_BACKEND_FLAG_KEY, getActiveFeedbackGeneratorBackend } from "@/features/trainingpeaks/feedback/feedback-backend-mode";

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
  let set: string | null = null;
  try {
    const body = (await request.json()) as { initData?: unknown; set?: unknown };
    initData = typeof body.initData === "string" ? body.initData : "";
    if (typeof body.set === "string") set = body.set.trim().toLowerCase();
  } catch {
    return jsonResponse(400, { ok: false, error: "Неверный запрос." });
  }

  const coach = resolveMiniAppCoach({ initData });
  if (!coach.ok) {
    return jsonResponse(coach.httpStatus, { ok: false, error: coach.message });
  }

  try {
    if (set !== null) {
      if (set !== "api" && set !== "cowork") {
        return jsonResponse(400, { ok: false, error: "Режим должен быть api или cowork." });
      }
      await setRuntimeFlag({ key: FEEDBACK_BACKEND_FLAG_KEY, value: set, actorChatId: coach.coachTelegramId });
    }
    const backend = await getActiveFeedbackGeneratorBackend();
    return jsonResponse(200, { ok: true, backend });
  } catch (error) {
    console.error("[miniapp.desk.reports.mode] failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonResponse(500, { ok: false, error: "Не удалось изменить режим." });
  }
}
