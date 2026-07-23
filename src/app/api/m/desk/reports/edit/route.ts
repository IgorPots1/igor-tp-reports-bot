import type { NextRequest } from "next/server";

import { resolveMiniAppCoach } from "@/features/telegram/miniapp-coach-resolver";
import { saveFeedbackDraftCoachEdit } from "@/features/trainingpeaks/feedback/feedback-queue";

export const runtime = "nodejs";

// Guard the free-text edit: non-empty, and not absurdly long for one Telegram message.
const MAX_EDIT_LEN = 4000;

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
  let text = "";
  try {
    const body = (await request.json()) as { initData?: unknown; jobId?: unknown; text?: unknown };
    initData = typeof body.initData === "string" ? body.initData : "";
    jobId = typeof body.jobId === "string" ? body.jobId : "";
    text = typeof body.text === "string" ? body.text : "";
  } catch {
    return jsonResponse(400, { ok: false, error: "Неверный запрос." });
  }

  const coach = resolveMiniAppCoach({ initData });
  if (!coach.ok) {
    return jsonResponse(coach.httpStatus, { ok: false, error: coach.message });
  }

  const trimmed = text.trim();
  if (!jobId || !trimmed) {
    return jsonResponse(400, { ok: false, error: "Нужен текст черновика." });
  }
  if (trimmed.length > MAX_EDIT_LEN) {
    return jsonResponse(400, { ok: false, error: "Слишком длинный текст." });
  }

  try {
    const updated = await saveFeedbackDraftCoachEdit({ jobId, coachEditedText: trimmed, actorChatId: coach.coachTelegramId });
    if (!updated) {
      // CAS on status='done' missed — already sent / dismissed / not found.
      return jsonResponse(409, { ok: false, error: "Черновик уже обработан — правка не сохранена." });
    }
    return jsonResponse(200, { ok: true, text: updated.coachEditedText });
  } catch (error) {
    console.error("[miniapp.desk.reports.edit] failed", {
      jobId,
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonResponse(500, { ok: false, error: "Не удалось сохранить правку." });
  }
}
