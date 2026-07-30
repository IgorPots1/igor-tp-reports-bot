import type { NextRequest } from "next/server";

import { purgeStudentAvatar } from "@/features/club/avatars";
import { CLUB_DB_ERROR_STUDENT_MESSAGE, logClubDbError } from "@/features/club/db-errors";
import { isClubEnabled, jsonResponse, resolveClubStudent } from "@/features/club/miniapp-guard";
import { createSupabaseServerClient } from "@/features/supabase/server";

export const runtime = "nodejs";

// Self-service avatar opt-out. Writes only the caller's OWN club_avatar_visible. Turning it OFF
// means REMOVED, not hidden: the student's cached avatar image is deleted from Storage right away
// (purgeStudentAvatar), so "off" can never be a straggler served by a stale link; the UI falls back
// to the monogram. The column ships as a migration; until applied the update errors → a 500, not 503.
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
      .update({ club_avatar_visible: visible })
      .eq("id", auth.student.id);
    if (error) {
      logClubDbError("avatar-visibility.update", error);
      return jsonResponse(500, { ok: false, error: CLUB_DB_ERROR_STUDENT_MESSAGE });
    }
    // Opt-out = removed: purge the cached image now. Best-effort — never fail the toggle on a
    // Storage hiccup (the live club_avatar_visible=false already blocks the route).
    if (visible === false) {
      try {
        await purgeStudentAvatar(auth.student.id);
      } catch (purgeError) {
        console.error("[m.club.avatar-visibility] image purge failed", purgeError);
      }
    }
    return jsonResponse(200, { ok: true, visible });
  } catch (error) {
    console.error("[m.club.avatar-visibility] failed", error);
    return jsonResponse(500, { ok: false, error: "Не удалось сохранить настройку." });
  }
}
