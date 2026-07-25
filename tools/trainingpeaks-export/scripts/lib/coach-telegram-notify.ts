// Shared coach-Telegram sender for the Mac pipeline scripts (ops alerts, feedback safety-net
// digest). Direct Bot API call, TELEGRAM_BOT_TOKEN → TELEGRAM_COACH_CHAT_IDS. Never throws — a
// message that can't send must not break the caller's exit code. Expects env already loaded
// (loadLocalEnv) by the caller.

function coachChatIds(): string[] {
  const value = process.env.TELEGRAM_COACH_CHAT_IDS?.trim();
  if (!value) return [];
  return value.split(",").map((id) => id.trim()).filter(Boolean);
}

export async function sendCoachTelegramMessage(message: string): Promise<void> {
  const text = message.trim();
  if (!text) {
    console.error("[coach-telegram-notify] no message given");
    return;
  }
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatIds = coachChatIds();
  if (!token) {
    console.error("[coach-telegram-notify] TELEGRAM_BOT_TOKEN not set — cannot send:", text);
    return;
  }
  if (chatIds.length === 0) {
    console.error("[coach-telegram-notify] TELEGRAM_COACH_CHAT_IDS not set — cannot send:", text);
    return;
  }
  for (const chatId of chatIds) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text }),
      });
      if (!res.ok) console.error(`[coach-telegram-notify] send to ${chatId} failed: HTTP ${res.status}`);
    } catch (error) {
      console.error(`[coach-telegram-notify] send to ${chatId} error:`, error instanceof Error ? error.message : String(error));
    }
  }
}
