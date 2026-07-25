import type { NextRequest } from "next/server";

import { getClubPublicProfile } from "@/features/club/service";
import { isClubEnabled, jsonResponse, resolveClubStudent } from "@/features/club/miniapp-guard";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<Response> {
  if (!isClubEnabled()) {
    return jsonResponse(503, { ok: false, error: "Клуб пока не активен." });
  }

  let initData: unknown = "";
  let targetStudentId = "";
  try {
    const body = (await request.json()) as { initData?: unknown; studentId?: unknown };
    initData = body.initData;
    targetStudentId = typeof body.studentId === "string" ? body.studentId : "";
  } catch {
    return jsonResponse(400, { ok: false, error: "Неверный запрос." });
  }

  if (!targetStudentId) {
    return jsonResponse(400, { ok: false, error: "Не указан ученик." });
  }

  const auth = await resolveClubStudent(initData);
  if (!auth.ok) {
    return jsonResponse(auth.httpStatus, { ok: false, error: auth.error });
  }

  try {
    const view = await getClubPublicProfile({
      currentStudentId: auth.student.id,
      targetStudentId,
    });
    return jsonResponse(200, { ok: true, view });
  } catch (error) {
    console.error("[m.club.public-profile] failed", error);
    return jsonResponse(500, { ok: false, error: "Не удалось загрузить профиль." });
  }
}
