import {
  initDataDiag,
  mainBotId,
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
  if (!initData) {
    // FACT, not guess: empty initData = Telegram didn't pass launch data (client/redirect),
    // NOT a signature problem. Distinct from bad_signature so the log names the real cause.
    console.warn("[desk.resolve] no_init_data (пустой initData от клиента)");
    return { ok: false, httpStatus: 401, code: "no_init_data", message: "Не авторизован." };
  }
  if (!validateTelegramInitData(initData)) {
    // Validation failed with a present initData = HMAC mismatch. botId shows WHICH bot the
    // deployed TELEGRAM_BOT_TOKEN belongs to — if it changed on Vercel, /m/desk AND /m/n break.
    const diag = initDataDiag(initData);
    console.warn(
      `[desk.resolve] bad_signature botId=${mainBotId()} keys=[${diag.keys.join(",")}] hashLen=${diag.hashLen}`
    );
    return { ok: false, httpStatus: 401, code: "bad_signature", message: "Не авторизован." };
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
