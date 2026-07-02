import type { NextRequest } from "next/server";

import { resolveMiniAppCoach } from "@/features/telegram/miniapp-coach-resolver";
import {
  closeHealthSignalByAdminUi,
  closeHealthSignalsByRecoveryConfirmation,
  listActiveTrainingPeaksOperationalSignalsByStudent,
} from "@/features/trainingpeaks/repository";
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

// "Снять" on a Today card. Two close paths, both server-side + coach-authenticated (client never
// touches the DB), both idempotent (re-closing an already-closed signal is a no-op):
//   • illness  → recovery close (closeHealthSignalsByRecoveryConfirmation): closes the whole active
//                episode for the student (resolved_reason=coach_confirmed_recovery). Same path as the бот.
//   • injury   → admin close (Слой 1 closeHealthSignalByAdminUi) per active pain_injury signal
//                (status=expired, resolved_reason=coach_ui_closed_recovered, coach_ui_close metadata —
//                history kept, no delete). A completed run never auto-clears an injury, so it's manual.
export async function POST(request: NextRequest): Promise<Response> {
  if (!isMiniAppEnabled()) {
    return jsonResponse(503, { ok: false, error: "Рабочий стол пока не активен." });
  }

  let initData = "";
  let studentId = "";
  let kind: "illness" | "injury" = "illness";
  try {
    const body = (await request.json()) as { initData?: unknown; studentId?: unknown; kind?: unknown };
    initData = typeof body.initData === "string" ? body.initData : "";
    studentId = typeof body.studentId === "string" ? body.studentId.trim() : "";
    kind = body.kind === "injury" ? "injury" : "illness";
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
    if (kind === "injury") {
      // Admin close every active pain_injury signal for this student (the desk shows one card per
      // student). Reuses the exact Слой-1 admin-close function per signal.
      const active = await listActiveTrainingPeaksOperationalSignalsByStudent(studentId);
      const injuries = active.filter((signal) => signal.signalType === "pain_injury");
      let closed = 0;
      for (const injury of injuries) {
        const result = await closeHealthSignalByAdminUi({
          signalId: injury.id,
          studentId,
          closeReason: "recovered",
        });
        if (result.updated) {
          closed += 1;
        }
      }
      return jsonResponse(200, { ok: true, closed });
    }

    const result = await closeHealthSignalsByRecoveryConfirmation({
      studentId,
      signalTypes: [...RECOVERY_CLOSABLE_SIGNAL_TYPES],
      decidedByUserId: coach.coachTelegramId,
    });
    return jsonResponse(200, { ok: true, closed: result.closed });
  } catch (error) {
    console.error("[miniapp.desk.close] failed", {
      kind,
      studentIdPrefix: studentId.slice(0, 8),
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonResponse(500, { ok: false, error: "Не удалось снять сигнал." });
  }
}
