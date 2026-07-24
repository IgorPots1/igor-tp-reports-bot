// Mark a reviewed draft as SHARED to a group (Mini App «Отчёты» → «Отправить в чат»).
// A group can't be reached by the Business API, so the client opens Telegram's share sheet
// from Igor's own account; there is NO delivery confirmation. This endpoint only RECORDS
// that Igor handed it off — status 'shared' (unverified), distinct from 'sent' (confirmed
// DM). It never delivers anything itself.
//
// Kill-switch honoured the same as DM: while FEEDBACK_SEND_ENABLED is off, this is
// prepare-only — it does NOT mark 'shared' (nothing leaves the review cycle) so Igor can
// dry-run first. Once he flips the switch on, a share tap records 'shared'.

import type { NextRequest } from "next/server";

import { resolveMiniAppCoach } from "@/features/telegram/miniapp-coach-resolver";
import { getTrainingPeaksFeedbackJobById, markFeedbackJobShared } from "@/features/trainingpeaks/feedback/feedback-queue";
import { isFeedbackSendEnabled } from "@/features/trainingpeaks/feedback/feedback-send";

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
    if (job.status !== "done") {
      return jsonResponse(409, { ok: false, error: "Черновик уже обработан." });
    }
    const finalText = (job.coachEditedText ?? job.draftText ?? "").trim();
    if (!finalText) {
      return jsonResponse(422, { ok: false, error: "Пустой текст черновика." });
    }

    // Kill-switch off → prepare-only: don't record 'shared', keep the card in review.
    if (!isFeedbackSendEnabled()) {
      return jsonResponse(200, {
        ok: true,
        outcome: "prepared",
        note: "Режим подготовки: шаринг открыт, но статус не меняю. Включить: FEEDBACK_SEND_ENABLED=true + передеплой.",
      });
    }

    const shared = await markFeedbackJobShared({ jobId, sharedText: finalText, actorChatId: coach.coachTelegramId });
    if (!shared) {
      return jsonResponse(409, { ok: false, error: "Черновик уже обработан." });
    }
    return jsonResponse(200, { ok: true, outcome: "shared" });
  } catch (error) {
    console.error("[miniapp.desk.reports.shared] failed", {
      jobId,
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonResponse(500, { ok: false, error: "Не удалось отметить как переданный." });
  }
}
