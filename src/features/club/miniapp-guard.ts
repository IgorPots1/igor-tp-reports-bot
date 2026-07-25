// Shared gate + auth for /api/m/club/* routes. Keeps each route thin and keeps
// the club surface isolated from /m/desk and /m/n.
//
// REGISTRATION MODEL (Stage v3, commit 3):
// The shared resolveMiniAppStudent auto-binds a Telegram user to a student on
// first open (trust-on-first-use). /m/n relies on that and is NOT touched here.
// The CLUB instead requires EXPLICIT confirmation: data routes use a NON-binding
// peek (resolveClubStudent) that never writes; the actual bind happens only in
// POST /api/m/club/confirm-link after the student taps "Это я". This prevents a
// silent wrong-account bind on a forwarded/shared link within the club surface.

import { createSupabaseServerClient } from "@/features/supabase/server";
import {
  parseTelegramInitDataStartParam,
  parseTelegramInitDataUser,
  validateTelegramInitData,
} from "@/features/telegram/validate-init-data";
import { getTrainingPeaksCoachChatIds } from "@/features/trainingpeaks/attention-telegram";
import {
  getTrainingPeaksStudentByTelegramUserId,
  type TrainingPeaksStudent,
} from "@/features/trainingpeaks/repository";

/** Outer mini-app gate + club feature flag. Both must be on. */
export function isClubEnabled(): boolean {
  return process.env.MINIAPP_ENABLED === "true" && process.env.CLUB_ENABLED === "true";
}

export function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export type ClubStudentResolution =
  | { ok: true; student: TrainingPeaksStudent }
  | {
      ok: false;
      httpStatus: number;
      error: string;
      /** Machine code so the client can branch (e.g. show the confirm screen). */
      code: "unauthorized" | "coach_account" | "needs_confirm" | "needs_link" | "wrong_target";
      /** Present with needs_confirm: who the link says this account is. */
      candidate?: { studentId: string; displayName: string };
    };

function startParamRowId(initData: string): string | null {
  const raw = parseTelegramInitDataStartParam(initData);
  if (!raw) {
    return null;
  }
  return raw.startsWith("r_") ? raw.slice(2) : raw;
}

function firstName(name: string | null | undefined): string {
  const t = (name ?? "").trim();
  return t ? t.split(/\s+/u)[0] : "Участник клуба";
}

/**
 * NON-binding resolution for club data routes. Never writes. Returns the bound
 * student when one exists, else a needs_confirm/needs_link signal for the client.
 */
export async function resolveClubStudent(initDataRaw: unknown): Promise<ClubStudentResolution> {
  const initData = typeof initDataRaw === "string" ? initDataRaw.trim() : "";
  if (!initData || !validateTelegramInitData(initData)) {
    return { ok: false, httpStatus: 401, error: "Не авторизован.", code: "unauthorized" };
  }
  const user = parseTelegramInitDataUser(initData);
  if (!user) {
    return { ok: false, httpStatus: 401, error: "Не авторизован.", code: "unauthorized" };
  }

  // Coach's personal account must never bind to / view a student's club data.
  if (getTrainingPeaksCoachChatIds().includes(String(user.id))) {
    return {
      ok: false,
      httpStatus: 403,
      error: "Это тренерский аккаунт. Клуб открывается из аккаунта ученика.",
      code: "coach_account",
    };
  }

  const rowId = startParamRowId(initData);
  const existing = await getTrainingPeaksStudentByTelegramUserId(user.id).catch(() => null);
  if (existing) {
    // Bound already, but a link naming a DIFFERENT student reached this account.
    if (rowId && rowId !== existing.id) {
      return {
        ok: false,
        httpStatus: 403,
        error: "Эта ссылка для другого аккаунта. Открой свою ссылку от тренера.",
        code: "wrong_target",
      };
    }
    return { ok: true, student: existing };
  }

  // Not bound yet → require explicit confirmation. No write happens here.
  if (!rowId) {
    return {
      ok: false,
      httpStatus: 403,
      error: "Открой клуб через кнопку от тренера — иначе мы не знаем, кто ты.",
      code: "needs_link",
    };
  }

  // Read the candidate's display name (read-only) so the client can ask "Это ты?".
  let displayName = "Участник клуба";
  try {
    const supabase = createSupabaseServerClient();
    const { data } = await supabase
      .from("trainingpeaks_students")
      .select("student_name")
      .eq("id", rowId)
      .maybeSingle();
    displayName = firstName((data as { student_name: string } | null)?.student_name);
  } catch {
    /* keep default */
  }

  return {
    ok: false,
    httpStatus: 409,
    error: "Подтверди, что это твой аккаунт.",
    code: "needs_confirm",
    candidate: { studentId: rowId, displayName },
  };
}
