import type { NextRequest } from "next/server";

import { isClubEnabled, jsonResponse, resolveClubStudent } from "@/features/club/miniapp-guard";
import { isCalendarEnabled } from "@/features/club/constants";
import { getClubCalendar, createCalendarEntry, deleteCalendarEntry } from "@/features/club/calendar";

export const runtime = "nodejs";

// Phase 5 — unified 45-day calendar. Gated by CLUB_CALENDAR_ENABLED (OFF → 503).
// The student marks day-off / preference / note / race on future days; every entry is
// a coach-inbox request (status=pending). No TP write, no auto-apply, no notifications.
export async function POST(request: NextRequest): Promise<Response> {
  if (!isClubEnabled() || !isCalendarEnabled()) {
    return jsonResponse(503, { ok: false, error: "Календарь пока не активен." });
  }

  let body: { initData?: unknown; action?: unknown; entry?: Record<string, unknown>; entryId?: unknown } = {};
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
      const res = await createCalendarEntry(auth.student.id, body.entry ?? {});
      if (!res.ok) {
        return jsonResponse(400, { ok: false, error: res.error });
      }
    } else if (body.action === "delete") {
      const res = await deleteCalendarEntry(auth.student.id, typeof body.entryId === "string" ? body.entryId : "");
      if (!res.ok) {
        return jsonResponse(400, { ok: false, error: res.error });
      }
    }
    const view = await getClubCalendar(auth.student.id);
    return jsonResponse(200, { ok: true, view });
  } catch (error) {
    console.error("[m.club.calendar] failed", error);
    return jsonResponse(500, { ok: false, error: "Не удалось загрузить календарь." });
  }
}
