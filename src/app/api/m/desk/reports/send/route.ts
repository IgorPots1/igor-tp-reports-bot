import type { NextRequest } from "next/server";

import { resolveMiniAppCoach } from "@/features/telegram/miniapp-coach-resolver";
import { isFeedbackSendEnabled, sendFeedbackDraftToStudent } from "@/features/trainingpeaks/feedback/feedback-send";

export const runtime = "nodejs";

function isMiniAppEnabled(): boolean {
  return process.env.MINIAPP_ENABLED === "true";
}

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

// Refusal kind → HTTP status. sent/prepared are the two success outcomes (200).
const REFUSAL_STATUS: Record<string, number> = {
  not_found: 404,
  blocked: 409,
  not_reviewable: 409,
  state_conflict: 409,
  missing_draft_text: 422,
  student_missing: 422,
  student_inactive: 422,
  telegram_not_linked: 422,
  delivery_disabled: 422,
  missing_business_connection: 422,
  peer_usage_missing: 422,
  delivery_failed: 422,
};

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
    const result = await sendFeedbackDraftToStudent({ jobId, actorTelegramChatId: coach.coachTelegramId });

    if (result.kind === "sent") {
      return jsonResponse(200, { ok: true, outcome: "sent", studentName: result.studentName, deliveredChunks: result.deliveredChunks });
    }
    if (result.kind === "prepared") {
      // Kill-switch off: validated & ready, but not delivered. A success outcome the UI toasts calmly.
      return jsonResponse(200, {
        ok: true,
        outcome: "prepared",
        studentName: result.studentName,
        note: "Отправка выключена (prepare-only) — черновик готов, но НЕ отправлен.",
      });
    }
    return jsonResponse(REFUSAL_STATUS[result.kind] ?? 422, {
      ok: false,
      outcome: result.kind,
      error: result.message,
      sendEnabled: isFeedbackSendEnabled(),
    });
  } catch (error) {
    console.error("[miniapp.desk.reports.send] failed", {
      jobId,
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonResponse(500, { ok: false, error: "Не удалось отправить черновик." });
  }
}
