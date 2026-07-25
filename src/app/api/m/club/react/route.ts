import type { NextRequest } from "next/server";

import { createSupabaseServerClient } from "@/features/supabase/server";
import { isClubEnabled, jsonResponse, resolveClubStudent } from "@/features/club/miniapp-guard";
import { isReactionsEnabled } from "@/features/club/constants";

export const runtime = "nodejs";

// STUB layer: reactions on workouts. Gated by CLUB_REACTIONS_ENABLED (OFF by
// default → 503). The club_reactions table ships as a migration file that is NOT
// applied in prod, so even under the flag this is inert until the schema exists.
export async function POST(request: NextRequest): Promise<Response> {
  if (!isClubEnabled() || !isReactionsEnabled()) {
    return jsonResponse(503, { ok: false, error: "Реакции пока не активны." });
  }

  let initData: unknown = "";
  let workoutId = "";
  let kind = "";
  try {
    const body = (await request.json()) as { initData?: unknown; workoutId?: unknown; kind?: unknown };
    initData = body.initData;
    workoutId = typeof body.workoutId === "string" ? body.workoutId : "";
    kind = typeof body.kind === "string" ? body.kind : "";
  } catch {
    return jsonResponse(400, { ok: false, error: "Неверный запрос." });
  }
  if (!workoutId || (kind !== "like" && kind !== "fire")) {
    return jsonResponse(400, { ok: false, error: "Неверная реакция." });
  }

  const auth = await resolveClubStudent(initData);
  if (!auth.ok) {
    return jsonResponse(auth.httpStatus, { ok: false, error: auth.error });
  }

  try {
    const supabase = createSupabaseServerClient();
    // Toggle-on upsert (student's OWN reaction only). No-op until the table exists.
    const { error } = await supabase
      .from("club_reactions")
      .upsert(
        { workout_cache_id: workoutId, student_id: auth.student.id, kind },
        { onConflict: "workout_cache_id,student_id,kind" }
      );
    if (error) {
      return jsonResponse(503, { ok: false, error: "Реакции пока не активны." });
    }
    return jsonResponse(200, { ok: true });
  } catch (error) {
    console.error("[m.club.react] failed", error);
    return jsonResponse(500, { ok: false, error: "Не удалось поставить реакцию." });
  }
}
