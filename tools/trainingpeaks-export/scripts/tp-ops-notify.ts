// Operational Telegram alert for the Mac pipeline — used to tell Igor a run needs a
// human (today: "TP session died, re-login"). Same mechanism cache-scan already uses
// (direct Bot API call, TELEGRAM_BOT_TOKEN → TELEGRAM_COACH_CHAT_IDS); the send itself lives in
// lib/coach-telegram-notify so the fit-ingest wrapper and the feedback safety-net can reuse it.
//
// Usage: tsx scripts/tp-ops-notify.ts "текст сообщения"
// Never throws — an alert that can't send must not break the caller's exit code.

import { loadLocalEnv } from "./lib/local-env.ts";

loadLocalEnv();

import { sendCoachTelegramMessage } from "./lib/coach-telegram-notify.ts";

async function main(): Promise<void> {
  const message = process.argv.slice(2).join(" ").trim();
  if (!message) {
    console.error("[tp-ops-notify] no message given");
    return;
  }
  await sendCoachTelegramMessage(message);
}

main().catch(() => {});
