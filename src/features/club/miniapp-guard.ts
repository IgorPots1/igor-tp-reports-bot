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
  validateClubInitDataVerbose,
  clubInitDataTokenInfo,
  clubSignatureProbe,
  initDataDiag,
} from "@/features/telegram/validate-init-data";
import { getTrainingPeaksCoachChatIds } from "@/features/trainingpeaks/attention-telegram";
import {
  getTrainingPeaksStudentByTelegramUserId,
  type TrainingPeaksStudent,
} from "@/features/trainingpeaks/repository";

import { resolveClubLinkToken } from "./link-tokens";
import { isClubLinkTokensEnabled, clubCoachParticipantStudentId } from "./constants";
import { recordClubAccessRequest } from "./access-requests";
import { recordClubOpen, deriveOpenSection } from "./club-open";
import { getTrainingPeaksStudentById } from "@/features/trainingpeaks/repository";
import { describeSupabaseError } from "@/features/supabase/server";

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
      /** Machine code so the client can branch + the reason lands in Vercel logs. */
      code:
        | "no_init_data"
        | "bad_signature"
        | "unauthorized"
        | "coach_account"
        | "needs_confirm"
        | "needs_link"
        | "wrong_target"
        | "invalid_link"
        | "needs_request"
        // Infrastructure said "I don't know", not "you may not". Kept separate from every code
        // above it so the student is never told they lack access because the DB blinked.
        | "unavailable";
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
  // Distinguish «Telegram didn't pass initData» from «signature invalid» — different fixes.
  if (!initData) {
    console.warn("[club.resolve] no_init_data (пустой initData от клиента)");
    return {
      ok: false,
      httpStatus: 401,
      error: "Telegram не передал данные входа. Открой клуб ссылкой XOclub ВНУТРИ Telegram, не в браузере.",
      code: "no_init_data",
    };
  }
  const clubValid = validateClubInitDataVerbose(initData);
  if (!clubValid.ok) {
    const { varName } = clubInitDataTokenInfo();
    const diag = initDataDiag(initData);
    // FACTS only: botId (which bot the deployed token belongs to — compare @igorp_coach_bot),
    // and the 4-way probe. Both club variants already failed here, so if the probe is all-false
    // the token is wrong; the probe columns pin code-bug vs token vs the signature field.
    const probe = clubSignatureProbe(initData);
    console.warn(
      `[club.resolve] bad_signature botId=${clubValid.botId} tokenVar=${varName} keys=[${diag.keys.join(",")}] hashLen=${diag.hashLen} ` +
        `probe: current=${probe.current} currentWithSig=${probe.currentWithSig} refDropHashSig=${probe.refDropHashSig} refDropHashOnly=${probe.refDropHashOnly}`
    );
    return {
      ok: false,
      httpStatus: 401,
      error: "Подпись Telegram не сошлась. Переоткрой клуб; если повторяется - сообщи тренеру.",
      code: "bad_signature",
    };
  }
  // Signature OK — record WHICH variant matched, so the open question is closed by fact.
  console.info(`[club.resolve] ok_signature variant=${clubValid.variant} botId=${clubValid.botId}`);
  const user = parseTelegramInitDataUser(initData);
  if (!user) {
    console.warn("[club.resolve] unauthorized (initData без user)");
    return { ok: false, httpStatus: 401, error: "Не авторизован.", code: "unauthorized" };
  }

  // Coach's personal account must never bind to / view a student's club data...
  if (getTrainingPeaksCoachChatIds().includes(String(user.id))) {
    // ...EXCEPT the coach may ALSO participate in the club as themselves (Phase 3.1).
    // When CLUB_COACH_PARTICIPANT_STUDENT_ID is configured, the coach account maps
    // straight to that explicit participant row — no auto-bind, no confirm, and no
    // change to the guard for any other account. Without the env, the 403 stands.
    const participantId = clubCoachParticipantStudentId();
    if (participantId) {
      // Same rule as below: a failed lookup must not silently degrade into "no such participant",
      // which would show the coach the coach_account 403 for a row that exists and is fine.
      let participant: TrainingPeaksStudent | null = null;
      try {
        participant = await getTrainingPeaksStudentById(participantId);
      } catch (error) {
        console.error("[club.resolve] coach participant lookup unavailable", {
          event: "club_resolve_participant_unavailable",
          error: describeSupabaseError(error),
        });
        return {
          ok: false,
          httpStatus: 503,
          error: "Клуб временно недоступен, попробуй через пару минут.",
          code: "unavailable",
        };
      }
      if (participant) {
        console.info(`[club.resolve] coach_participant user=${user.id} student=${participant.id}`);
        await recordClubOpen(participant.id, user.id, deriveOpenSection(startParamToken(initData)));
        return { ok: true, student: participant };
      }
      console.warn(`[club.resolve] coach_participant configured id=${participantId} but no such student`);
    }
    console.warn(`[club.resolve] coach_account user=${user.id} (id в TELEGRAM_COACH_CHAT_IDS)`);
    return {
      ok: false,
      httpStatus: 403,
      error: "Это тренерский аккаунт. Клуб открывается из аккаунта ученика.",
      code: "coach_account",
    };
  }

  const token = startParamToken(initData);
  const tokensOn = isClubLinkTokensEnabled();

  // A failed lookup is NOT "this account is unbound". Until 2026-08-03 the error was swallowed to
  // null, so during the Supabase outage a properly bound student fell through to the bottom of this
  // function, had a bogus access request written for them, and was told "Заявка отправлена — тренер
  // подтвердит доступ" (403) — a member locked out of their own club by a database blip, with a
  // spurious row in club_access_requests for the coach to sort out. Report the outage as an outage.
  let existing: TrainingPeaksStudent | null = null;
  try {
    existing = await getTrainingPeaksStudentByTelegramUserId(user.id);
  } catch (error) {
    console.error("[club.resolve] student lookup unavailable", {
      event: "club_resolve_lookup_unavailable",
      telegramUserId: user.id,
      error: describeSupabaseError(error),
    });
    return {
      ok: false,
      httpStatus: 503,
      error: "Клуб временно недоступен, попробуй через пару минут.",
      code: "unavailable",
    };
  }

  if (existing) {
    console.info(`[club.resolve] ok user=${user.id} student=${existing.id}`);
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
    await recordClubOpen(existing.id, user.id, deriveOpenSection(token));
    return { ok: true, student: existing };
  }

  // Token flow (only when CLUB_LINK_TOKENS_ENABLED): personal one-time link → confirm.
  if (token && tokensOn) {
    const resolved = await resolveClubLinkToken(token);
    if (!resolved.ok && resolved.reason === "unavailable") {
      return {
        ok: false,
        httpStatus: 503,
        error: "Клуб временно недоступен, попробуй через пару минут.",
        code: "unavailable",
      };
    }
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
  const requestRecorded = await recordClubAccessRequest({
    id: user.id,
    username: user.username,
    first_name: user.firstName,
    last_name: user.lastName,
  });

  // If the request could not even be written, telling the student "заявка отправлена" is a lie —
  // the coach will never see it and the student will wait forever. Infrastructure failure, say so.
  if (requestRecorded === "unavailable") {
    console.error("[club.resolve] access request could not be recorded", {
      event: "club_access_request_unavailable",
      telegramUserId: user.id,
    });
    return {
      ok: false,
      httpStatus: 503,
      error: "Клуб временно недоступен, попробуй через пару минут.",
      code: "unavailable",
    };
  }

  return {
    ok: false,
    httpStatus: 403,
    error: "Заявка отправлена - тренер подтвердит доступ.",
    code: "needs_request",
  };
}
