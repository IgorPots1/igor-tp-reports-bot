import type { NextRequest } from "next/server";

import { createSupabaseServerClient } from "@/features/supabase/server";
import { isClubEnabled, jsonResponse, resolveClubStudent } from "@/features/club/miniapp-guard";
import { isCommentsEnabled } from "@/features/club/constants";
import { logClubDbError, CLUB_DB_ERROR_STUDENT_MESSAGE } from "@/features/club/db-errors";
import {
  countRecentComments,
  getCommentOwner,
  isStudentClubVisible,
  isWorkoutCommentable,
  loadWorkoutComments,
} from "@/features/club/service";

export const runtime = "nodejs";

// Coarse rate limit: max comment writes (create/edit) a student may do in the window.
const RATE_WINDOW_SECONDS = 30;
const RATE_MAX = 8;
const BODY_MAX = 500;

// Comments on club workouts. Gated by CLUB_COMMENTS_ENABLED (OFF by default -> 503).
// Auth STRICTLY by initData; student_id comes from the RESOLVER, never the client body.
// One route, four actions: list | create | edit | delete. Never notifies or messages
// anyone. A student edits/deletes only their own comment; coach moderation lives in the
// admin, not here.
export async function POST(request: NextRequest): Promise<Response> {
  if (!isClubEnabled() || !isCommentsEnabled()) {
    return jsonResponse(503, { ok: false, error: "Комментарии пока не активны." });
  }

  let body: { initData?: unknown; action?: unknown; workoutId?: unknown; commentId?: unknown; body?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonResponse(400, { ok: false, error: "Неверный запрос." });
  }
  const action = typeof body.action === "string" ? body.action : "";
  const workoutId = typeof body.workoutId === "string" ? body.workoutId : "";
  const commentId = typeof body.commentId === "string" ? body.commentId : "";
  const text = typeof body.body === "string" ? body.body.trim() : "";

  const auth = await resolveClubStudent(body.initData);
  if (!auth.ok) {
    return jsonResponse(auth.httpStatus, { ok: false, error: auth.error, code: auth.code, candidate: auth.candidate });
  }
  const studentId = auth.student.id; // authoritative — client-supplied ids are ignored

  const supabase = createSupabaseServerClient();

  // ── list ──────────────────────────────────────────────────────────────────
  if (action === "list") {
    if (!workoutId) {
      return jsonResponse(400, { ok: false, error: "Не указана тренировка." });
    }
    try {
      const comments = await loadWorkoutComments(workoutId, studentId);
      return jsonResponse(200, { ok: true, comments });
    } catch (error) {
      console.error("[m.club.comments.list] failed", error);
      return jsonResponse(500, { ok: false, error: "Не удалось загрузить комментарии." });
    }
  }

  // ── create ────────────────────────────────────────────────────────────────
  if (action === "create") {
    if (!workoutId) {
      return jsonResponse(400, { ok: false, error: "Не указана тренировка." });
    }
    if (!text) {
      return jsonResponse(400, { ok: false, error: "Пустой комментарий." });
    }
    if (text.length > BODY_MAX) {
      return jsonResponse(400, { ok: false, error: `Слишком длинно (макс. ${BODY_MAX}).` });
    }
    // Hidden students (and hidden workouts) are not commentable; a hidden commenter
    // may not write either.
    if (!(await isStudentClubVisible(studentId)) || !(await isWorkoutCommentable(workoutId))) {
      return jsonResponse(403, { ok: false, error: "Недоступно." });
    }
    if ((await countRecentComments(studentId, RATE_WINDOW_SECONDS)) >= RATE_MAX) {
      return jsonResponse(429, { ok: false, error: "Слишком часто. Подожди немного." });
    }
    try {
      const { error } = await supabase
        .from("club_comments")
        .insert({ workout_cache_id: workoutId, student_id: studentId, body: text });
      if (error) {
        logClubDbError("comments.write", error);
        return jsonResponse(500, { ok: false, error: CLUB_DB_ERROR_STUDENT_MESSAGE });
      }
      const comments = await loadWorkoutComments(workoutId, studentId);
      return jsonResponse(200, { ok: true, comments });
    } catch (error) {
      console.error("[m.club.comments.create] failed", error);
      return jsonResponse(500, { ok: false, error: "Не удалось отправить комментарий." });
    }
  }

  // ── edit ──────────────────────────────────────────────────────────────────
  if (action === "edit") {
    if (!commentId || !text) {
      return jsonResponse(400, { ok: false, error: "Нечего сохранять." });
    }
    if (text.length > BODY_MAX) {
      return jsonResponse(400, { ok: false, error: `Слишком длинно (макс. ${BODY_MAX}).` });
    }
    const owner = await getCommentOwner(commentId);
    if (!owner) {
      return jsonResponse(404, { ok: false, error: "Комментарий не найден." });
    }
    if (owner.studentId !== studentId) {
      return jsonResponse(403, { ok: false, error: "Можно править только своё." });
    }
    if ((await countRecentComments(studentId, RATE_WINDOW_SECONDS)) >= RATE_MAX) {
      return jsonResponse(429, { ok: false, error: "Слишком часто. Подожди немного." });
    }
    try {
      const { error } = await supabase
        .from("club_comments")
        .update({ body: text, updated_at: new Date().toISOString() })
        .eq("id", commentId)
        .eq("student_id", studentId); // belt-and-braces ownership scope
      if (error) {
        logClubDbError("comments.write", error);
        return jsonResponse(500, { ok: false, error: CLUB_DB_ERROR_STUDENT_MESSAGE });
      }
      const comments = await loadWorkoutComments(owner.workoutId, studentId);
      return jsonResponse(200, { ok: true, comments });
    } catch (error) {
      console.error("[m.club.comments.edit] failed", error);
      return jsonResponse(500, { ok: false, error: "Не удалось изменить комментарий." });
    }
  }

  // ── delete ────────────────────────────────────────────────────────────────
  if (action === "delete") {
    if (!commentId) {
      return jsonResponse(400, { ok: false, error: "Не указан комментарий." });
    }
    const owner = await getCommentOwner(commentId);
    if (!owner) {
      return jsonResponse(200, { ok: true, comments: [] }); // already gone — idempotent
    }
    if (owner.studentId !== studentId) {
      return jsonResponse(403, { ok: false, error: "Можно удалять только своё." });
    }
    try {
      const { error } = await supabase
        .from("club_comments")
        .delete()
        .eq("id", commentId)
        .eq("student_id", studentId);
      if (error) {
        logClubDbError("comments.write", error);
        return jsonResponse(500, { ok: false, error: CLUB_DB_ERROR_STUDENT_MESSAGE });
      }
      const comments = await loadWorkoutComments(owner.workoutId, studentId);
      return jsonResponse(200, { ok: true, comments });
    } catch (error) {
      console.error("[m.club.comments.delete] failed", error);
      return jsonResponse(500, { ok: false, error: "Не удалось удалить комментарий." });
    }
  }

  return jsonResponse(400, { ok: false, error: "Неизвестное действие." });
}
