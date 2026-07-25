import type { NextRequest } from "next/server";

import { validateTelegramInitData } from "@/features/telegram/validate-init-data";
import { resolveMiniAppStudent } from "@/features/telegram/miniapp-student-resolver";
import { isClubEnabled, jsonResponse } from "@/features/club/miniapp-guard";

export const runtime = "nodejs";

// The ONLY place the club binds a Telegram account to a student. Called after the
// student explicitly taps "Это я" on the confirm screen (the data routes only
// peek, they never bind). Delegates the actual bind + all its guards (coach
// account, collision, wrong target) to the shared resolveMiniAppStudent, which
// auto-links from the signed start_param. Nothing is sent to anyone.
export async function POST(request: NextRequest): Promise<Response> {
  if (!isClubEnabled()) {
    return jsonResponse(503, { ok: false, error: "Клуб пока не активен." });
  }

  let initData = "";
  try {
    const body = (await request.json()) as { initData?: unknown };
    initData = typeof body.initData === "string" ? body.initData.trim() : "";
  } catch {
    return jsonResponse(400, { ok: false, error: "Неверный запрос." });
  }
  if (!initData || !validateTelegramInitData(initData)) {
    return jsonResponse(401, { ok: false, error: "Не авторизован." });
  }

  const resolved = await resolveMiniAppStudent({ initData });
  if (!resolved.ok) {
    return jsonResponse(resolved.httpStatus, { ok: false, error: resolved.message, code: resolved.code });
  }
  return jsonResponse(200, {
    ok: true,
    justLinked: resolved.justLinked,
    student: { displayName: (resolved.student.studentName ?? "").split(/\s+/u)[0] || "Участник клуба" },
  });
}
