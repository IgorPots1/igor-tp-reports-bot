import type { NextRequest } from "next/server";

import { createSupabaseServerClient } from "@/features/supabase/server";
import { isClubEnabled, jsonResponse, resolveClubStudent } from "@/features/club/miniapp-guard";
import { isPrivacyEnabled } from "@/features/club/constants";

export const runtime = "nodejs";

// STUB layer: self-service club visibility opt-out. Gated by CLUB_PRIVACY_ENABLED
// (OFF by default → 503). Writes only the caller's OWN trainingpeaks_students row.
// The club_visible column ships as a migration file NOT applied in prod, so this is
// inert until the schema exists. Default stays "участвует" (visible=true).
export async function POST(request: NextRequest): Promise<Response> {
  if (!isClubEnabled() || !isPrivacyEnabled()) {
    return jsonResponse(503, { ok: false, error: "Настройка видимости пока не активна." });
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
      .update({ club_visible: visible })
      .eq("id", auth.student.id);
    if (error) {
      return jsonResponse(503, { ok: false, error: "Настройка видимости пока не активна." });
    }
    return jsonResponse(200, { ok: true, visible });
  } catch (error) {
    console.error("[m.club.privacy] failed", error);
    return jsonResponse(500, { ok: false, error: "Не удалось сохранить настройку." });
  }
}
