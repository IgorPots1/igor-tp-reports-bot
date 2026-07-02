import {
  parseTelegramInitDataUser,
  validateTelegramInitData,
} from "@/features/telegram/validate-init-data";
import { getTrainingPeaksCoachChatIds } from "@/features/trainingpeaks/attention-telegram";

// Coach-desk auth: the MIRROR of the student mini-app resolver. There, a coach Telegram id is
// REJECTED (a coach must not bind to student data). Here it's the only id allowed — the coach desk
// is coach-only, students must never see it. Same signed-initData trust model as /m/n, no new auth.
export type ResolveMiniAppCoachResult =
  | { ok: true; coachTelegramId: string }
  | { ok: false; httpStatus: number; code: string; message: string };

export function resolveMiniAppCoach(input: { initData: string }): ResolveMiniAppCoachResult {
  const initData = input.initData?.trim() ?? "";
  if (!initData || !validateTelegramInitData(initData)) {
    return { ok: false, httpStatus: 401, code: "unauthorized", message: "Не авторизован." };
  }

  const user = parseTelegramInitDataUser(initData);
  if (!user) {
    return { ok: false, httpStatus: 401, code: "no_user", message: "Не авторизован." };
  }

  const coachIds = getTrainingPeaksCoachChatIds();
  if (!coachIds.includes(String(user.id))) {
    // Not a coach — this surface is coach-only. Students hitting the link get a clean refusal.
    return { ok: false, httpStatus: 403, code: "not_coach", message: "Доступ только для тренера." };
  }

  return { ok: true, coachTelegramId: String(user.id) };
}
