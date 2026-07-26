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

import { resolveClubLinkToken } from "./link-tokens";
import { isClubLinkTokensEnabled } from "./constants";
import { recordClubAccessRequest } from "./access-requests";

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
      /** Machine code so the client can branch (e.g. show the confirm/waiting screen). */
      code: "unauthorized" | "coach_account" | "needs_confirm" | "needs_link" | "wrong_target" | "invalid_link" | "needs_request";
      /** Present with needs_confirm: who the link says this account is. */
      candidate?: { studentId: string; displayName: string };
    };

/** The club link's start_param is a one-time TOKEN (not the student row id). */
function startParamToken(initData: string): string | null {
  const raw = parseTelegramInitDataStartParam(initData);
  return raw ? raw.trim() : null;
}

/**
 * NON-binding resolution for club data routes. Never writes. Returns the bound
 * student when one exists, else a needs_confirm/needs_link/invalid_link signal.
 *
 * The entry link carries a one-time token (see link-tokens.ts): it resolves to a
 * candidate (name only) for confirmation. An already-bound account opens the club
 * with the GENERAL link (no token) and gets straight through.
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

  const token = startParamToken(initData);
  const tokensOn = isClubLinkTokensEnabled();
  const existing = await getTrainingPeaksStudentByTelegramUserId(user.id).catch(() => null);
  if (existing) {
    // Already bound → own data only. Under the token flow, a token naming a DIFFERENT
    // student on a bound account is a forwarded/wrong link → wrong_target.
    if (token && tokensOn) {
      const resolved = await resolveClubLinkToken(token);
      if (resolved.ok && resolved.studentId !== existing.id) {
        return {
          ok: false,
          httpStatus: 403,
          error: "Эта ссылка для другого аккаунта. Открой клуб своей ссылкой.",
          code: "wrong_target",
        };
      }
    }
    return { ok: true, student: existing };
  }

  // Token flow (only when CLUB_LINK_TOKENS_ENABLED): personal one-time link → confirm.
  if (token && tokensOn) {
    const resolved = await resolveClubLinkToken(token);
    if (!resolved.ok) {
      return {
        ok: false,
        httpStatus: 403,
        error: "Ссылка недействительна, обратись к тренеру.",
        code: "invalid_link",
      };
    }
    return {
      ok: false,
      httpStatus: 409,
      error: "Подтверди, что это твой аккаунт.",
      code: "needs_confirm",
      candidate: { studentId: resolved.studentId, displayName: resolved.displayName },
    };
  }

  // Default flow: general link → record an access request, show the waiting screen.
  // No club data is exposed; the coach matches the request to a student in the admin.
  await recordClubAccessRequest({
    id: user.id,
    username: user.username,
    first_name: user.firstName,
    last_name: user.lastName,
  });
  return {
    ok: false,
    httpStatus: 403,
    error: "Заявка отправлена — тренер подтвердит доступ.",
    code: "needs_request",
  };
}
