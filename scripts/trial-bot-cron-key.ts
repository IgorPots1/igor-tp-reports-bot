/**
 * Пробная неделя: записать ключ тика в public.trial_bot_config (его читает public.trial_bot_tick).
 * Ключ выводится из TELEGRAM_BOT_TOKEN и наружу не печатается.
 *
 *   npx tsx --env-file=.env.local scripts/trial-bot-cron-key.ts
 *
 * Запускать один раз после миграции 20261114000000_trial_bot.sql (и снова, если сменится токен бота).
 */

import { createSupabaseServerClient } from "@/features/supabase/server";
import { trialCronKey } from "@/features/trial-bot/runtime";

async function main() {
  const { error } = await createSupabaseServerClient()
    .from("trial_bot_config")
    .upsert({ key: "cron_key", value: trialCronKey(), updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw new Error(error.message);
  console.log("cron_key записан в trial_bot_config");
}

main().catch((e) => {
  console.error("trial-bot-cron-key FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
