import type { NextRequest } from "next/server";

import { createSupabaseServerClient } from "@/features/supabase/server";
import { isClubEnabled, jsonResponse, resolveClubStudent } from "@/features/club/miniapp-guard";
import { isReactionsEnabled } from "@/features/club/constants";
import { logClubDbError, CLUB_DB_ERROR_STUDENT_MESSAGE } from "@/features/club/db-errors";
import { countRecentReactions, isWorkoutReactable } from "@/features/club/service";

export const runtime = "nodejs";

// Coarse rate limit: max reactions a student may create in the window.
const RATE_WINDOW_SECONDS = 10;
const RATE_MAX = 12;

// Reactions on club workouts. Gated by CLUB_REACTIONS_ENABLED (OFF by default →
// 503). Auth strictly by initData; student_id is taken from the RESOLVER, never
// from the client body. Idempotent toggle. Never notifies or messages anyone.
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
    return jsonResponse(auth.httpStatus, { ok: false, error: auth.error, code: auth.code, candidate: auth.candidate });
  }
  const studentId = auth.student.id; // authoritative — client-supplied ids are ignored

  // Cannot react to a workout whose owner is hidden (opted out / inactive / service).
  const reactable = await isWorkoutReactable(workoutId);
  if (!reactable) {
    return jsonResponse(403, { ok: false, error: "Недоступно." });
  }

  // Rate limit.
  const recent = await countRecentReactions(studentId, RATE_WINDOW_SECONDS);
  if (recent >= RATE_MAX) {
    return jsonResponse(429, { ok: false, error: "Слишком часто. Подожди немного." });
  }

  try {
    const supabase = createSupabaseServerClient();
    // Idempotent toggle: remove if present, else insert. Unique (workout,student,kind).
    const { data: existing } = await supabase
      .from("club_reactions")
      .select("id")
      .eq("workout_cache_id", workoutId)
      .eq("student_id", studentId)
      .eq("kind", kind)
      .maybeSingle();

    if (existing) {
      const { error } = await supabase.from("club_reactions").delete().eq("id", (existing as { id: string }).id);
      if (error) {
        logClubDbError("react.delete", error);
        return jsonResponse(500, { ok: false, error: CLUB_DB_ERROR_STUDENT_MESSAGE });
      }
      return jsonResponse(200, { ok: true, active: false });
    }

    const { error } = await supabase
      .from("club_reactions")
      .insert({ workout_cache_id: workoutId, student_id: studentId, kind });
    if (error) {
      logClubDbError("react.insert", error);
      return jsonResponse(500, { ok: false, error: CLUB_DB_ERROR_STUDENT_MESSAGE });
    }
    return jsonResponse(200, { ok: true, active: true });
  } catch (error) {
    console.error("[m.club.react] failed", error);
    return jsonResponse(500, { ok: false, error: "Не удалось поставить реакцию." });
  }
}
