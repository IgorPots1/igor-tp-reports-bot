import type { NextRequest } from "next/server";

import { createSupabaseServerClient } from "@/features/supabase/server";
import { isClubEnabled, jsonResponse, resolveClubStudent } from "@/features/club/miniapp-guard";
import { logClubDbError, CLUB_DB_ERROR_STUDENT_MESSAGE } from "@/features/club/db-errors";

export const runtime = "nodejs";

// Phase 3.2 — the student edits their OWN club display name. Writes only the
// caller's own trainingpeaks_students.club_display_name (migration 20260802000000).
// An empty value clears the override -> falls back to the real first+last name.
// Inert (503) until the column exists. Nothing outside the club reads this value.
const MAX_LEN = 40;

export async function POST(request: NextRequest): Promise<Response> {
  if (!isClubEnabled()) {
    return jsonResponse(503, { ok: false, error: "Клуб недоступен." });
  }

  let initData: unknown = "";
  let name: unknown = "";
  try {
    const body = (await request.json()) as { initData?: unknown; name?: unknown };
    initData = body.initData;
    name = body.name;
  } catch {
    return jsonResponse(400, { ok: false, error: "Неверный запрос." });
  }

  const auth = await resolveClubStudent(initData);
  if (!auth.ok) {
    return jsonResponse(auth.httpStatus, { ok: false, error: auth.error, code: auth.code, candidate: auth.candidate });
  }

  // Normalise via an ALLOWLIST (letters/marks, spaces, and . ' -): drops control
  // chars, emoji and punctuation without any control-char literals. Collapse
  // whitespace, cap length. Empty => clear the override.
  const raw = typeof name === "string" ? name : "";
  const cleaned = raw
    .replace(/[^\p{L}\p{M}\s.'-]/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, MAX_LEN);
  const value = cleaned.length > 0 ? cleaned : null;

  try {
    const supabase = createSupabaseServerClient();
    const { error } = await supabase
      .from("trainingpeaks_students")
      .update({ club_display_name: value })
      .eq("id", auth.student.id);
    if (error) {
      logClubDbError("displayName.update", error);
      return jsonResponse(500, { ok: false, error: CLUB_DB_ERROR_STUDENT_MESSAGE });
    }
    return jsonResponse(200, { ok: true, name: value });
  } catch (error) {
    console.error("[m.club.display-name] failed", error);
    return jsonResponse(500, { ok: false, error: "Не удалось сохранить имя." });
  }
}
