import type { NextRequest } from "next/server";

import {
  parseTelegramInitDataStartParam,
  parseTelegramInitDataUser,
  validateTelegramInitData,
} from "@/features/telegram/validate-init-data";
import { getTrainingPeaksCoachChatIds } from "@/features/trainingpeaks/attention-telegram";
import {
  getTrainingPeaksStudentByTelegramUserId,
  linkTelegramUserIdToStudent,
} from "@/features/trainingpeaks/repository";
import { isClubEnabled, jsonResponse } from "@/features/club/miniapp-guard";
import { resolveClubLinkToken, burnClubLinkToken } from "@/features/club/link-tokens";
import { logClubLinkEvent } from "@/features/club/service";

export const runtime = "nodejs";

// The ONLY place the club binds a Telegram account to a student — after the student
// taps «Да, это я» (spec v3 block 2.1). The start_param is a ONE-TIME TOKEN (not a
// student row id): it is resolved to a student, the bind is done via the shared
// low-level linkTelegramUserIdToStudent (collision-safe), and the token BURNS on
// success. Binding is one-time; unbind/rebind is coach-only. Nothing is sent to students.
export async function POST(request: NextRequest): Promise<Response> {
  if (!isClubEnabled()) {
    return jsonResponse(503, { ok: false, error: "Клуб пока не активен." });
  }

  let initData = "";
  try {
    const body = (await request.json()) as { initData?: unknown };
    initData = typeof body.initData === "string" ? body.initData.trim() : "";
  } catch {
    return jsonResponse(400, { ok: false, error: "Неверный запрос." });
  }
  if (!initData || !validateTelegramInitData(initData)) {
    return jsonResponse(401, { ok: false, error: "Не авторизован." });
  }

  const tgUser = parseTelegramInitDataUser(initData);
  if (!tgUser) {
    return jsonResponse(401, { ok: false, error: "Не авторизован." });
  }

  // Coach's personal account must never bind to a student's club data.
  if (getTrainingPeaksCoachChatIds().includes(String(tgUser.id))) {
    return jsonResponse(403, {
      ok: false,
      error: "Это тренерский аккаунт. Клуб открывается из аккаунта ученика.",
      code: "coach_account",
    });
  }

  const rawToken = parseTelegramInitDataStartParam(initData);
  const token = rawToken ? rawToken.trim() : "";

  // Already bound → idempotent success (double-tap); a token for a DIFFERENT student
  // is refused (forwarded link), never switches accounts.
  const existing = await getTrainingPeaksStudentByTelegramUserId(tgUser.id).catch(() => null);
  if (existing) {
    if (token) {
      const r = await resolveClubLinkToken(token);
      if (r.ok && r.studentId !== existing.id) {
        return jsonResponse(403, { ok: false, error: "Эта ссылка для другого аккаунта.", code: "wrong_target" });
      }
    }
    return jsonResponse(200, { ok: true, justLinked: false });
  }

  // Not bound → a VALID token is required.
  const resolved = await resolveClubLinkToken(token);
  if (!resolved.ok) {
    await logClubLinkEvent({
      telegramUserId: tgUser.id,
      telegramUsername: tgUser.username ?? null,
      studentId: null,
      result: "conflict",
      reason: `invalid_link:${resolved.reason}`,
    });
    return jsonResponse(403, { ok: false, error: "Ссылка недействительна, обратись к тренеру.", code: "invalid_link" });
  }

  const linkResult = await linkTelegramUserIdToStudent(resolved.studentId, tgUser.id);
  switch (linkResult.status) {
    case "linked":
    case "already_linked_same": {
      // Burn the one-time token so the link cannot be reused/forwarded.
      await burnClubLinkToken(token, tgUser.id);
      await logClubLinkEvent({
        telegramUserId: tgUser.id,
        telegramUsername: tgUser.username ?? null,
        studentId: linkResult.student.id,
        result: "confirmed",
        reason: linkResult.status === "linked" ? "token_first_open" : "token_already_linked",
      });
      return jsonResponse(200, { ok: true, justLinked: linkResult.status === "linked" });
    }
    case "collision_user_taken":
    case "collision_student_taken": {
      await logClubLinkEvent({
        telegramUserId: tgUser.id,
        telegramUsername: tgUser.username ?? null,
        studentId: resolved.studentId,
        result: "conflict",
        reason: linkResult.status,
      });
      return jsonResponse(409, {
        ok: false,
        error: "Не удалось привязать аккаунт. Обратись к тренеру — он разберётся.",
        code: "collision",
      });
    }
    default: {
      await logClubLinkEvent({
        telegramUserId: tgUser.id,
        telegramUsername: tgUser.username ?? null,
        studentId: resolved.studentId,
        result: "conflict",
        reason: "student_not_found",
      });
      return jsonResponse(404, { ok: false, error: "Ученик не найден. Обратись к тренеру.", code: "student_not_found" });
    }
  }
}
