import type { NextRequest } from "next/server";

import { isClubEnabled, jsonResponse, resolveClubStudent } from "@/features/club/miniapp-guard";
import { isDayoffEnabled } from "@/features/club/constants";
import { createDayoffRequest, listDayoffRequests } from "@/features/club/cabinet";

export const runtime = "nodejs";

// Выходные (Block 8). Gated by CLUB_DAYOFF_ENABLED (OFF → 503). Student REQUESTS a
// day off → coach-approval queue. No TP write, no auto-apply, no notifications.
export async function POST(request: NextRequest): Promise<Response> {
  if (!isClubEnabled() || !isDayoffEnabled()) {
    return jsonResponse(503, { ok: false, error: "Выходные пока не активны." });
  }

  let body: { initData?: unknown; action?: unknown; request?: Record<string, unknown> } = {};
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
    if (body.action === "create") {
      const res = await createDayoffRequest(auth.student.id, body.request ?? {});
      if (!res.ok) {
        return jsonResponse(400, { ok: false, error: res.error });
      }
      const requests = await listDayoffRequests(auth.student.id);
      return jsonResponse(200, { ok: true, view: { requests } });
    }
    const requests = await listDayoffRequests(auth.student.id);
    return jsonResponse(200, { ok: true, view: { requests } });
  } catch (error) {
    console.error("[m.club.dayoff] failed", error);
    return jsonResponse(500, { ok: false, error: "Не удалось загрузить выходные." });
  }
}
