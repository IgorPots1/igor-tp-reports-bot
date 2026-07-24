// Operational Telegram alert for the Mac pipeline — used to tell Igor a run needs a
// human (today: "TP session died, re-login"). Same mechanism cache-scan already uses
// (direct Bot API call, TELEGRAM_BOT_TOKEN → TELEGRAM_COACH_CHAT_IDS); factored out so
// the fit-ingest wrapper can fire it too instead of failing silently.
//
// Usage: tsx scripts/tp-ops-notify.ts "текст сообщения"
// Never throws — an alert that can't send must not break the caller's exit code.

import { loadLocalEnv } from "./lib/local-env.ts";

loadLocalEnv();

function coachChatIds(): string[] {
  const value = process.env.TELEGRAM_COACH_CHAT_IDS?.trim();
  if (!value) return [];
  return value.split(",").map((id) => id.trim()).filter(Boolean);
}

async function main(): Promise<void> {
  const message = process.argv.slice(2).join(" ").trim();
  if (!message) {
    console.error("[tp-ops-notify] no message given");
    return;
  }
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatIds = coachChatIds();
  if (!token) {
    console.error("[tp-ops-notify] TELEGRAM_BOT_TOKEN not set — cannot alert:", message);
    return;
  }
  if (chatIds.length === 0) {
    console.error("[tp-ops-notify] TELEGRAM_COACH_CHAT_IDS not set — cannot alert:", message);
    return;
  }
  for (const chatId of chatIds) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: message }),
      });
      if (!res.ok) console.error(`[tp-ops-notify] alert to ${chatId} failed: HTTP ${res.status}`);
    } catch (error) {
      console.error(`[tp-ops-notify] alert to ${chatId} error:`, error instanceof Error ? error.message : String(error));
    }
  }
}

main().catch(() => {});
