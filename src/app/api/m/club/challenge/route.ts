import type { NextRequest } from "next/server";

import { getClubChallenge } from "@/features/club/service";
import { isClubEnabled, jsonResponse, resolveClubStudent } from "@/features/club/miniapp-guard";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<Response> {
  if (!isClubEnabled()) {
    return jsonResponse(503, { ok: false, error: "Клуб пока не активен." });
  }

  let initData: unknown = "";
  let period: "week" | "month" = "week";
  try {
    const body = (await request.json()) as { initData?: unknown; period?: unknown };
    initData = body.initData;
    if (body.period === "month") period = "month";
  } catch {
    return jsonResponse(400, { ok: false, error: "Неверный запрос." });
  }

  const auth = await resolveClubStudent(initData);
  if (!auth.ok) {
    return jsonResponse(auth.httpStatus, { ok: false, error: auth.error, code: auth.code, candidate: auth.candidate });
  }

  try {
    const view = await getClubChallenge({ currentStudentId: auth.student.id, period });
    return jsonResponse(200, { ok: true, view });
  } catch (error) {
    console.error("[m.club.challenge] failed", error);
    return jsonResponse(500, { ok: false, error: "Не удалось загрузить челлендж." });
  }
}
