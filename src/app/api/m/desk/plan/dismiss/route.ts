import type { NextRequest } from "next/server";

import { resolveMiniAppCoach } from "@/features/telegram/miniapp-coach-resolver";
import {
  dismissTrainingPeaksPlanSignalByCoach,
  rejectTrainingPeaksAction,
} from "@/features/trainingpeaks/repository";

export const runtime = "nodejs";

function isMiniAppEnabled(): boolean {
  return process.env.MINIAPP_ENABLED === "true";
}

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// "Снять" on a hanging plan row (move candidate / pending request that stuck after a manual TP move).
// Two Supabase-ONLY paths, NO TrainingPeaks call (only an explicit execute ever touches TP):
//   • action → rejectTrainingPeaksAction: the pending move action becomes "rejected" — clears both the
//              request AND its mirror candidate.
//   • signal → dismissTrainingPeaksPlanSignalByCoach: expires the orphan move-candidate signal.
// Coach-authenticated, server-side only, idempotent (re-dismissing a resolved row is a no-op).
export async function POST(request: NextRequest): Promise<Response> {
  if (!isMiniAppEnabled()) {
    return jsonResponse(503, { ok: false, error: "Рабочий стол пока не активен." });
  }

  let initData = "";
  let kind: "action" | "signal" | null = null;
  let actionId = "";
  let signalId = "";
  let studentId = "";
  try {
    const body = (await request.json()) as {
      initData?: unknown;
      kind?: unknown;
      actionId?: unknown;
      signalId?: unknown;
      studentId?: unknown;
    };
    initData = typeof body.initData === "string" ? body.initData : "";
    kind = body.kind === "action" ? "action" : body.kind === "signal" ? "signal" : null;
    actionId = typeof body.actionId === "string" ? body.actionId.trim() : "";
    signalId = typeof body.signalId === "string" ? body.signalId.trim() : "";
    studentId = typeof body.studentId === "string" ? body.studentId.trim() : "";
  } catch {
    return jsonResponse(400, { ok: false, error: "Неверный запрос." });
  }

  const coach = resolveMiniAppCoach({ initData });
  if (!coach.ok) {
    return jsonResponse(coach.httpStatus, { ok: false, error: coach.message });
  }

  try {
    if (kind === "action") {
      if (!actionId) {
        return jsonResponse(400, { ok: false, error: "Не указана заявка." });
      }
      // Reject = status write only. Does NOT touch TrainingPeaks (execute is the only TP mutation).
      const result = await rejectTrainingPeaksAction({
        actionId,
        decidedByChatId: coach.coachTelegramId,
        decidedByUserId: coach.coachTelegramId,
      });
      // Idempotent: already-rejected / not-pending returns a non-"updated" kind — still ok for the desk.
      return jsonResponse(200, { ok: true, dismissed: result.kind === "updated" });
    }

    if (kind === "signal") {
      if (!signalId || !studentId) {
        return jsonResponse(400, { ok: false, error: "Не указан сигнал." });
      }
      const result = await dismissTrainingPeaksPlanSignalByCoach({
        signalId,
        studentId,
        decidedByUserId: coach.coachTelegramId,
      });
      return jsonResponse(200, { ok: true, dismissed: result.updated });
    }

    return jsonResponse(400, { ok: false, error: "Неизвестный тип." });
  } catch (error) {
    console.error("[miniapp.desk.plan.dismiss] failed", {
      kind,
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonResponse(500, { ok: false, error: "Не удалось снять." });
  }
}
