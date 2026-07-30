import type { NextRequest } from "next/server";

import { CLUB_DB_ERROR_STUDENT_MESSAGE, logClubDbError } from "@/features/club/db-errors";
import { isClubEnabled, jsonResponse, resolveClubStudent } from "@/features/club/miniapp-guard";
import { purgeStudentRouteImages } from "@/features/club/track-maps";
import { createSupabaseServerClient } from "@/features/supabase/server";

export const runtime = "nodejs";

// Self-service route/map opt-out. Writes only the caller's OWN club_routes_visible. Turning it
// OFF means REMOVED, not hidden: we delete the student's cached route images from Storage right
// away (purgeStudentRouteImages), so "off" can never be a straggler served by a stale link. The
// column ships as a migration file; until applied the update errors → a distinct 500 (not 503).
export async function POST(request: NextRequest): Promise<Response> {
  if (!isClubEnabled()) {
    return jsonResponse(503, { ok: false, error: "Настройка пока не активна." });
  }

  let initData: unknown = "";
  let visible: boolean | null = null;
  try {
    const body = (await request.json()) as { initData?: unknown; visible?: unknown };
    initData = body.initData;
    visible = typeof body.visible === "boolean" ? body.visible : null;
  } catch {
    return jsonResponse(400, { ok: false, error: "Неверный запрос." });
  }
  if (visible === null) {
    return jsonResponse(400, { ok: false, error: "Не указано значение." });
  }

  const auth = await resolveClubStudent(initData);
  if (!auth.ok) {
    return jsonResponse(auth.httpStatus, { ok: false, error: auth.error, code: auth.code, candidate: auth.candidate });
  }

  try {
    const supabase = createSupabaseServerClient();
    const { error } = await supabase
      .from("trainingpeaks_students")
      .update({ club_routes_visible: visible })
      .eq("id", auth.student.id);
    if (error) {
      logClubDbError("routes-visibility.update", error);
      return jsonResponse(500, { ok: false, error: CLUB_DB_ERROR_STUDENT_MESSAGE });
    }
    // Opt-out = removed: purge cached images now. Best-effort — never fail the toggle on a
    // Storage hiccup (the live club_routes_visible=false already blocks the route).
    if (visible === false) {
      try {
        await purgeStudentRouteImages(auth.student.id);
      } catch (purgeError) {
        console.error("[m.club.routes-visibility] image purge failed", purgeError);
      }
    }
    return jsonResponse(200, { ok: true, visible });
  } catch (error) {
    console.error("[m.club.routes-visibility] failed", error);
    return jsonResponse(500, { ok: false, error: "Не удалось сохранить настройку." });
  }
}
