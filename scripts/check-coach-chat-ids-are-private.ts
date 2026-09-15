/**
 * Verifies TELEGRAM_COACH_CHAT_IDS contains only private (1:1) chats. isCoachChat() is reused
 * across this repo as the sole "is this Igor" check — for the manual voice-transcription
 * allowlist (webhook.ts), for excluding the coach from student-facing observer paths, and for
 * coach-only command gating. If a group or supergroup id ever ended up in that list, ANY member
 * of that group would pass every one of those checks — including the manual voice-transcription
 * trigger, which would let them run (paid-compute) transcription jobs at Igor's expense on his
 * own Mac.
 *
 * Fails loudly (non-zero exit) if any id resolves to type 'group' or 'supergroup', or if getChat
 * fails outright for an id (a dead/invalid id is also worth knowing about, not silently ignored).
 *
 *   node --experimental-strip-types --loader ./scripts/_alias-loader.mjs \
 *     --env-file=.env.local scripts/check-coach-chat-ids-are-private.ts
 */
import { getTrainingPeaksCoachChatIds } from "@/features/trainingpeaks/attention-telegram";
import { getTelegramChatType } from "@/features/telegram/telegram-client";

async function main(): Promise<void> {
  const coachChatIds = getTrainingPeaksCoachChatIds();

  if (coachChatIds.length === 0) {
    console.log("TELEGRAM_COACH_CHAT_IDS is empty — nothing to check (coach-only flows are unreachable).");
    return;
  }

  let failed = false;

  for (const chatId of coachChatIds) {
    try {
      const chatType = await getTelegramChatType(chatId);
      if (chatType === "group" || chatType === "supergroup") {
        failed = true;
        console.error(`FAIL: ${chatId} is a ${chatType} chat — must be 'private'.`);
      } else {
        console.log(`ok   ${chatId} -- ${chatType}`);
      }
    } catch (error) {
      failed = true;
      console.error(`FAIL: could not resolve ${chatId}: ${error instanceof Error ? error.message : error}`);
    }
  }

  if (failed) {
    console.error("\nИТОГ: TELEGRAM_COACH_CHAT_IDS содержит группу/недоступный id — почини до деплоя.");
    process.exit(1);
  }

  console.log("\nИТОГ: все id в TELEGRAM_COACH_CHAT_IDS — приватные чаты.");
}

main().catch((error) => {
  console.error("check-coach-chat-ids-are-private failed", error);
  process.exit(1);
});
