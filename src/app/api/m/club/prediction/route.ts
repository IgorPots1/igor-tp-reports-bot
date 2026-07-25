import type { NextRequest } from "next/server";

import { isClubEnabled, jsonResponse, resolveClubStudent } from "@/features/club/miniapp-guard";
import { isPredictionEnabled } from "@/features/club/constants";
import { getClubPrediction } from "@/features/club/service";

export const runtime = "nodejs";

// Прогноз результата (Block 7.3). Gated by CLUB_PREDICTION_ENABLED (OFF → 503).
// Shows a RANGE only when the student has a declared/approved upcoming race, for
// that race's distance. No false precision.
export async function POST(request: NextRequest): Promise<Response> {
  if (!isClubEnabled() || !isPredictionEnabled()) {
    return jsonResponse(503, { ok: false, error: "Прогноз пока не активен." });
  }

  let initData: unknown = "";
  try {
    initData = ((await request.json()) as { initData?: unknown }).initData;
  } catch {
    return jsonResponse(400, { ok: false, error: "Неверный запрос." });
  }

  const auth = await resolveClubStudent(initData);
  if (!auth.ok) {
    return jsonResponse(auth.httpStatus, { ok: false, error: auth.error, code: auth.code, candidate: auth.candidate });
  }

  try {
    const view = await getClubPrediction({ currentStudentId: auth.student.id });
    return jsonResponse(200, { ok: true, view });
  } catch (error) {
    console.error("[m.club.prediction] failed", error);
    return jsonResponse(500, { ok: false, error: "Не удалось загрузить прогноз." });
  }
}
