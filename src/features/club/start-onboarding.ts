// Club — /start club onboarding. A single link for the group chat (t.me/<bot>?start=club):
// the user taps Start → the bot now has a DM with them (so future form broadcasts CAN reach
// them) → this replies with a short greeting + an "Открыть клуб" button.
//
//   - Known user (telegram_user_id already on a student): just greet, no re-bind.
//   - Unknown user: record a club access request (so the coach can bind them in
//     /admin/club/requests) — then they go through the normal club confirm path on open.
//
// Sent as the BOT (no business connection). Gated by the club being live (isClubEnabled).

import { getTelegramBotUsername, sendTelegramUrlButton, sendTelegramMessageStrict } from "@/features/telegram/telegram-client";
import { getTrainingPeaksStudentByTelegramUserId } from "@/features/trainingpeaks/repository";

import { isClubEnabled } from "./miniapp-guard";
import { recordClubAccessRequest } from "./access-requests";

export type ClubStartFrom = { id: number; username?: string | null; first_name?: string | null; last_name?: string | null };

/** Editable via env CLUB_START_GREETING; else this default (ты-стиль, без тире/эмодзи). */
function greetingText(): string {
  const override = process.env.CLUB_START_GREETING?.trim();
  if (override) return override;
  return "Привет! Это клуб XO Runners. Здесь твои пробежки, челлендж, результаты и расписание. Жми кнопку ниже, чтобы открыть.";
}

async function clubMiniAppUrl(): Promise<string | null> {
  if (process.env.MINIAPP_ENABLED !== "true") return null;
  const shortName = process.env.TELEGRAM_MINIAPP_SHORT_NAME?.trim();
  if (!shortName) return null;
  const username = await getTelegramBotUsername();
  return `https://t.me/${username}/${shortName}`;
}

/**
 * Handle `/start club`. Returns true if it took over the message (so the webhook stops and
 * never reaches the coach-only /start path); false = not a club start / club not live, let the
 * normal /start handling run. Never throws.
 */
export async function handleClubStartCommand(input: { chatId: string | number; from: ClubStartFrom | null }): Promise<boolean> {
  if (!isClubEnabled()) return false;
  const from = input.from;
  if (!from?.id) return false;

  try {
    const student = await getTrainingPeaksStudentByTelegramUserId(from.id).catch(() => null);
    // Unknown Telegram user → record an access request so the coach can bind them later.
    if (!student) {
      await recordClubAccessRequest({ id: from.id, username: from.username ?? null, first_name: from.first_name ?? null, last_name: from.last_name ?? null });
    }
    const url = await clubMiniAppUrl();
    const text = greetingText();
    if (url) {
      await sendTelegramUrlButton({ chatId: input.chatId, text, buttonLabel: "Открыть клуб", url });
    } else {
      await sendTelegramMessageStrict(input.chatId, text);
    }
  } catch (err) {
    // A send failure must not leave the update unhandled loudly; log and still claim it.
    console.error("[club.start] onboarding failed", { userId: from.id, error: err instanceof Error ? err.message : err });
  }
  return true;
}
