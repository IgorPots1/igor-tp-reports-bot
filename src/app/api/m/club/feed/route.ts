import type { NextRequest } from "next/server";

import { getClubFeed } from "@/features/club/service";
import { isClubEnabled, jsonResponse, resolveClubStudent } from "@/features/club/miniapp-guard";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<Response> {
  if (!isClubEnabled()) {
    return jsonResponse(503, { ok: false, error: "Клуб пока не активен." });
  }

  let initData: unknown = "";
  let cursor: string | null = null;
  try {
    const body = (await request.json()) as { initData?: unknown; cursor?: unknown };
    initData = body.initData;
    cursor = typeof body.cursor === "string" ? body.cursor : null;
  } catch {
    return jsonResponse(400, { ok: false, error: "Неверный запрос." });
  }

  const auth = await resolveClubStudent(initData);
  if (!auth.ok) {
    return jsonResponse(auth.httpStatus, { ok: false, error: auth.error, code: auth.code, candidate: auth.candidate });
  }

  try {
    const view = await getClubFeed({ cursor, currentStudentId: auth.student.id });
    return jsonResponse(200, { ok: true, view });
  } catch (error) {
    console.error("[m.club.feed] failed", error);
    return jsonResponse(500, { ok: false, error: "Не удалось загрузить ленту." });
  }
}
