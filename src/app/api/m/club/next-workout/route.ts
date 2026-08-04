import type { NextRequest } from "next/server";

import { isClubPlanEnabled } from "@/features/club/constants";
import { isClubEnabled, jsonResponse, resolveClubStudent } from "@/features/club/miniapp-guard";
import { getClubNextWorkout } from "@/features/club/service";

export const runtime = "nodejs";

// Ближайшая плановая тренировка ученика (экран входа). Gated by CLUB_PLAN_ENABLED (OFF → 503).
// Read-only: ничего не пишет, TP не трогает.
export async function POST(request: NextRequest): Promise<Response> {
  if (!isClubEnabled() || !isClubPlanEnabled()) {
    return jsonResponse(503, { ok: false, error: "План пока не активен." });
  }
  let body: { initData?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonResponse(400, { ok: false, error: "Неверный запрос." });
  }
  const auth = await resolveClubStudent(body.initData);
  if (!auth.ok) {
    return jsonResponse(auth.httpStatus, { ok: false, error: auth.error, code: auth.code, candidate: auth.candidate });
  }
  try {
    const view = await getClubNextWorkout({ currentStudentId: auth.student.id });
    return jsonResponse(200, { ok: true, view });
  } catch (error) {
    console.error("[m.club.next-workout] failed", error);
    return jsonResponse(500, { ok: false, error: "Не удалось загрузить план." });
  }
}
