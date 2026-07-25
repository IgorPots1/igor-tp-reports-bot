import type { NextRequest } from "next/server";

import { getClubExtendedTops } from "@/features/club/service";
import { isClubEnabled, jsonResponse, resolveClubStudent } from "@/features/club/miniapp-guard";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<Response> {
  if (!isClubEnabled()) {
    return jsonResponse(503, { ok: false, error: "Клуб пока не активен." });
  }

  let initData: unknown = "";
  try {
    const body = (await request.json()) as { initData?: unknown };
    initData = body.initData;
  } catch {
    return jsonResponse(400, { ok: false, error: "Неверный запрос." });
  }

  const auth = await resolveClubStudent(initData);
  if (!auth.ok) {
    return jsonResponse(auth.httpStatus, { ok: false, error: auth.error });
  }

  try {
    const view = await getClubExtendedTops({ currentStudentId: auth.student.id });
    return jsonResponse(200, { ok: true, view });
  } catch (error) {
    console.error("[m.club.tops] failed", error);
    return jsonResponse(500, { ok: false, error: "Не удалось загрузить топы." });
  }
}
