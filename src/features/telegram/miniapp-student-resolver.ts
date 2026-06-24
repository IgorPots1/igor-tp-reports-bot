import {
  parseTelegramInitDataUser,
  parseTelegramInitDataStartParam,
} from "@/features/telegram/validate-init-data";
import { sendTelegramMessage } from "@/features/telegram/telegram-client";
import { getTrainingPeaksCoachChatIds } from "@/features/trainingpeaks/attention-telegram";
import type {
  SupabaseServerClientLike,
  TrainingPeaksStudent,
} from "@/features/trainingpeaks/repository";
import {
  getTrainingPeaksStudentByTelegramUserId,
  linkTelegramUserIdToStudent,
} from "@/features/trainingpeaks/repository";

/**
 * Resolves which student is using the nutrition mini app, auto-linking the
 * student's Telegram user.id on first open.
 *
 * Resolution order:
 *  1. If the user.id is already linked to a student → return it (idempotent).
 *  2. Otherwise use the `start_param` from the t.me direct link (the student
 *     ROW id Igor's "Open form" button carries) to identify the target student
 *     and auto-link the user.id.
 *
 * SECURITY: start_param is taken from the HMAC-signed initData (it is covered by
 * validateTelegramInitData's hash check), so it cannot be forged — no separate
 * signature is needed. The caller MUST have validated initData first.
 *
 * Failures are never silent: a binding collision returns an explicit error and
 * notifies the coach.
 */

export type MiniAppResolveErrorCode =
  | "no_user"
  | "student_not_found"
  | "collision"
  | "needs_link"
  // The opener's Telegram account is a coach account — never bind it to / show it a
  // student's data (a coach testing the broadcast must not occupy a student's slot).
  | "coach_account"
  // The opened link names a DIFFERENT student than this account is already bound to —
  // refuse instead of silently showing the bound student's (foreign) data.
  | "wrong_target";

export type MiniAppResolveResult =
  | { ok: true; student: TrainingPeaksStudent; justLinked: boolean }
  | { ok: false; httpStatus: number; code: MiniAppResolveErrorCode; message: string };

const GENERIC_COLLISION_MESSAGE =
  "Не удалось привязать аккаунт. Обратись к тренеру — он разберётся.";

async function defaultNotifyCoachLinkFailure(detail: string): Promise<void> {
  const coachChatIds = getTrainingPeaksCoachChatIds();
  const text = `⚠️ Mini app: сбой привязки ученика.\n${detail}`;
  await Promise.allSettled(
    coachChatIds.map((chatId) =>
      sendTelegramMessage(chatId, text).catch((err) => {
        console.warn("[miniapp.resolve] coach notify failed", { chatId, error: String(err) });
      })
    )
  );
}

/** Injectable seams so the resolver can be unit-tested without a live DB. */
export type ResolveMiniAppStudentDeps = {
  client?: SupabaseServerClientLike;
  notifyCoach?: (detail: string) => Promise<void>;
};

export async function resolveMiniAppStudent(
  input: {
    /** The validated initData string (must already pass validateTelegramInitData). */
    initData: string;
  },
  deps: ResolveMiniAppStudentDeps = {}
): Promise<MiniAppResolveResult> {
  const notifyCoach = deps.notifyCoach ?? defaultNotifyCoachLinkFailure;

  const tgUser = parseTelegramInitDataUser(input.initData);
  if (!tgUser) {
    return { ok: false, httpStatus: 401, code: "no_user", message: "Пользователь не определён." };
  }

  // The start_param (student ROW id) the link carries. Review links prefix it with
  // "r_" (form uses the bare id) — strip it. Parsed up front: it is now needed both
  // for the target check (step 1) and the auto-link (step 2). It is covered by the
  // HMAC of initData (validated by the caller), so it cannot be forged.
  const rawStartParam = parseTelegramInitDataStartParam(input.initData);
  const studentRowId = rawStartParam
    ? rawStartParam.startsWith("r_")
      ? rawStartParam.slice(2)
      : rawStartParam
    : null;

  // 0. Coach guard: a coach's PERSONAL Telegram account must never bind to or view a
  //    student's nutrition data. Without this, a coach testing the broadcast taps a
  //    student link, gets auto-linked (trust-on-first-use), and then sees that one
  //    student's review for every link (the "чужой отчёт" leak). Refuse outright —
  //    even if a stale wrong binding already exists, this stops the coach reading it.
  if (getTrainingPeaksCoachChatIds().includes(String(tgUser.id))) {
    return {
      ok: false,
      httpStatus: 403,
      code: "coach_account",
      message: "Это тренерский аккаунт. Ученический разбор открывается из аккаунта ученицы.",
    };
  }

  // 1. Already linked → resolve directly (idempotent re-open) — BUT only if the link
  //    doesn't name a DIFFERENT student. If it does, the wrong link reached this
  //    account (forward / wrong chat / shared device): refuse, never show foreign data.
  const existing = await getTrainingPeaksStudentByTelegramUserId(tgUser.id, deps.client).catch(
    () => null
  );
  if (existing) {
    if (studentRowId && studentRowId !== existing.id) {
      console.warn("[miniapp.resolve] link target mismatch — refused", {
        telegramUserId: tgUser.id,
        boundStudentId: existing.studentId,
        linkStudentRowId: studentRowId,
      });
      return {
        ok: false,
        httpStatus: 403,
        code: "wrong_target",
        message: "Эта ссылка для другого аккаунта. Открой свою ссылку от тренера.",
      };
    }
    return { ok: true, student: existing, justLinked: false };
  }

  // 2. Not linked yet → use the start_param (student row id) from the signed
  //    initData to auto-link (trust-on-first-use for a genuine first open of one's
  //    OWN link). A collision (this student already bound elsewhere) is rejected below.
  if (!studentRowId) {
    return {
      ok: false,
      httpStatus: 403,
      code: "needs_link",
      message: "Открой форму через кнопку от тренера — иначе мы не знаем, кто ты.",
    };
  }

  const linkResult = await linkTelegramUserIdToStudent(studentRowId, tgUser.id, deps.client);

  switch (linkResult.status) {
    case "linked":
      console.info("[miniapp.resolve] auto-linked", {
        studentId: linkResult.student.studentId,
        telegramUserId: tgUser.id,
      });
      return { ok: true, student: linkResult.student, justLinked: true };

    case "already_linked_same":
      return { ok: true, student: linkResult.student, justLinked: false };

    case "student_not_found":
      return {
        ok: false,
        httpStatus: 404,
        code: "student_not_found",
        message: "Ученик не найден. Обратись к тренеру.",
      };

    case "collision_user_taken":
      await notifyCoach(
        `user.id=${tgUser.id} уже привязан к ученику ` +
          `«${linkResult.conflictingStudent.studentName}» (studentId=${linkResult.conflictingStudent.studentId}). ` +
          `Кнопка была адресована row id=${studentRowId}. Привязка НЕ перезаписана.`
      );
      return {
        ok: false,
        httpStatus: 409,
        code: "collision",
        message: GENERIC_COLLISION_MESSAGE,
      };

    case "collision_student_taken":
      await notifyCoach(
        `Ученик «${linkResult.student.studentName}» (row id=${studentRowId}) уже привязан к ` +
          `user.id=${linkResult.existingUserId}, а форму открыл user.id=${tgUser.id}. ` +
          `Привязка НЕ перезаписана.`
      );
      return {
        ok: false,
        httpStatus: 409,
        code: "collision",
        message: GENERIC_COLLISION_MESSAGE,
      };

    default: {
      const _exhaustive: never = linkResult;
      void _exhaustive;
      return {
        ok: false,
        httpStatus: 500,
        code: "collision",
        message: GENERIC_COLLISION_MESSAGE,
      };
    }
  }
}
