import type { NextRequest } from "next/server";

import { getClubWorkoutDetail } from "@/features/club/service";
import { isClubEnabled, jsonResponse, resolveClubStudent } from "@/features/club/miniapp-guard";

export const runtime = "nodejs";

// Phase 3.8 — single-workout detail (metrics grid + laps + HR zones), read for
// ONE workout by id. The service authorizes: the owner must be visible in the club
// or it is the caller's own workout, else null (404).
export async function POST(request: NextRequest): Promise<Response> {
  if (!isClubEnabled()) {
    return jsonResponse(503, { ok: false, error: "Клуб пока не активен." });
  }

  let initData: unknown = "";
  let workoutId = "";
  try {
    const body = (await request.json()) as { initData?: unknown; workoutId?: unknown };
    initData = body.initData;
    workoutId = typeof body.workoutId === "string" ? body.workoutId : "";
  } catch {
    return jsonResponse(400, { ok: false, error: "Неверный запрос." });
  }

  if (!workoutId) {
    return jsonResponse(400, { ok: false, error: "Не указана тренировка." });
  }

  const auth = await resolveClubStudent(initData);
  if (!auth.ok) {
    return jsonResponse(auth.httpStatus, { ok: false, error: auth.error, code: auth.code, candidate: auth.candidate });
  }

  try {
    const view = await getClubWorkoutDetail({ currentStudentId: auth.student.id, workoutId });
    if (!view) {
      return jsonResponse(404, { ok: false, error: "Тренировка недоступна." });
    }
    return jsonResponse(200, { ok: true, view });
  } catch (error) {
    console.error("[m.club.workout] failed", error);
    return jsonResponse(500, { ok: false, error: "Не удалось загрузить тренировку." });
  }
}
