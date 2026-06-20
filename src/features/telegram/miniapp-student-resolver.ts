import { parseTelegramInitDataUser, verifyStudentLinkSig } from "@/features/telegram/validate-init-data";
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
 *  2. Otherwise use the signed sid+sig from the "Open form" button (which only
 *     Igor can mint) to identify the target student and auto-link the user.id.
 *
 * Failures are never silent: an invalid signature and a binding collision both
 * return an explicit error, and collisions additionally notify the coach.
 */

export type MiniAppResolveErrorCode =
  | "no_user"
  | "invalid_signature"
  | "student_not_found"
  | "collision"
  | "needs_link";

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
    initData: string;
    sid: string | null;
    sig: string | null;
  },
  deps: ResolveMiniAppStudentDeps = {}
): Promise<MiniAppResolveResult> {
  const notifyCoach = deps.notifyCoach ?? defaultNotifyCoachLinkFailure;

  const tgUser = parseTelegramInitDataUser(input.initData);
  if (!tgUser) {
    return { ok: false, httpStatus: 401, code: "no_user", message: "Пользователь не определён." };
  }

  // 1. Already linked → resolve directly (idempotent re-open).
  const existing = await getTrainingPeaksStudentByTelegramUserId(tgUser.id, deps.client).catch(
    () => null
  );
  if (existing) {
    return { ok: true, student: existing, justLinked: false };
  }

  // 2. Not linked yet → need the signed button context to auto-link.
  const sid = input.sid?.trim() ?? "";
  const sig = input.sig?.trim() ?? "";
  if (!sid || !sig) {
    return {
      ok: false,
      httpStatus: 403,
      code: "needs_link",
      message: "Открой форму через кнопку от тренера — иначе мы не знаем, кто ты.",
    };
  }

  if (!verifyStudentLinkSig(sid, sig)) {
    await notifyCoach(
      `Невалидная подпись ссылки. user.id=${tgUser.id}, sid=${sid}. ` +
        `Ученик пытался открыть форму с поддельным или устаревшим sid.`
    );
    return {
      ok: false,
      httpStatus: 403,
      code: "invalid_signature",
      message: "Ссылка недействительна. Попроси тренера прислать кнопку заново.",
    };
  }

  const linkResult = await linkTelegramUserIdToStudent(sid, tgUser.id, deps.client);

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
          `Кнопка была адресована studentId=${sid}. Привязка НЕ перезаписана.`
      );
      return {
        ok: false,
        httpStatus: 409,
        code: "collision",
        message: GENERIC_COLLISION_MESSAGE,
      };

    case "collision_student_taken":
      await notifyCoach(
        `Ученик «${linkResult.student.studentName}» (studentId=${sid}) уже привязан к ` +
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
