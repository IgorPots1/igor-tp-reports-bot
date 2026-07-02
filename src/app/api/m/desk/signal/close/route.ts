import type { NextRequest } from "next/server";

import { resolveMiniAppCoach } from "@/features/telegram/miniapp-coach-resolver";
import { closeHealthSignalsByRecoveryConfirmation } from "@/features/trainingpeaks/repository";
import { RECOVERY_CLOSABLE_SIGNAL_TYPES } from "@/features/trainingpeaks/signal-recovery-bridge";

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

// "Снять" on a health card → close ALL active illness signals for that student (the desk shows one
// collapsed card per student, so this clears the whole episode). Same close path as the recovery
// bridge: status=expired, lifecycle_state=resolved, resolved_reason=coach_confirmed_recovery.
// Coach-authenticated + server-side mutation only; the client never touches the DB.
export async function POST(request: NextRequest): Promise<Response> {
  if (!isMiniAppEnabled()) {
    return jsonResponse(503, { ok: false, error: "Рабочий стол пока не активен." });
  }

  let initData = "";
  let studentId = "";
  try {
    const body = (await request.json()) as { initData?: unknown; studentId?: unknown };
    initData = typeof body.initData === "string" ? body.initData : "";
    studentId = typeof body.studentId === "string" ? body.studentId.trim() : "";
  } catch {
    return jsonResponse(400, { ok: false, error: "Неверный запрос." });
  }

  const coach = resolveMiniAppCoach({ initData });
  if (!coach.ok) {
    return jsonResponse(coach.httpStatus, { ok: false, error: coach.message });
  }

  if (!studentId) {
    return jsonResponse(400, { ok: false, error: "Не указан ученик." });
  }

  try {
    const result = await closeHealthSignalsByRecoveryConfirmation({
      studentId,
      signalTypes: [...RECOVERY_CLOSABLE_SIGNAL_TYPES],
      decidedByUserId: coach.coachTelegramId,
    });
    return jsonResponse(200, { ok: true, closed: result.closed });
  } catch (error) {
    console.error("[miniapp.desk.close] failed", {
      studentIdPrefix: studentId.slice(0, 8),
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonResponse(500, { ok: false, error: "Не удалось снять сигнал." });
  }
}
