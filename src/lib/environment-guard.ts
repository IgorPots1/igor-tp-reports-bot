/**
 * Blocks a real mutation (DB write, Telegram send) when running on a Vercel
 * Preview deployment. Confirmed 2026-07-23 (`vercel env ls`): SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY, TELEGRAM_BOT_TOKEN, ADMIN_ACCESS_TOKEN are all
 * assigned to "Preview, Production" — a stale branch's preview build has full
 * access to the real database and the real Telegram bot. This traced back to
 * 8 real nutrition_weekly_analyses rows (2026-07-21/22) missing target/
 * items_notable, most likely written by vo2-progression-selector-v1's preview
 * (base commit 2026-06-06, before those fields existed in the generator).
 *
 * Gate on VERCEL_ENV, not NODE_ENV: VERCEL_ENV is unset in local dev (this
 * guard is a no-op there, so `npm run dev` keeps writing normally) and Vercel
 * sets it to exactly one of "production" | "preview" | "development" on every
 * deployed build - so this only ever fires on an actually-deployed non-prod URL.
 */
export class PreviewEnvironmentBlockedError extends Error {
  constructor(actionLabel: string) {
    super(
      `Заблокировано: это Preview-деплой (VERCEL_ENV=${process.env.VERCEL_ENV ?? "unset"}), не Production. ` +
        `Действие «${actionLabel}» не может писать в боевую базу или отправлять сообщения отсюда. ` +
        `Открой продовый URL, чтобы сделать это по-настоящему.`
    );
    this.name = "PreviewEnvironmentBlockedError";
  }
}

/** Throws PreviewEnvironmentBlockedError if this process is a Vercel deploy AND not Production. No-op locally (VERCEL_ENV unset) and on Production. */
export function assertNotPreviewEnvironment(actionLabel: string): void {
  const vercelEnv = process.env.VERCEL_ENV;
  if (vercelEnv && vercelEnv !== "production") {
    throw new PreviewEnvironmentBlockedError(actionLabel);
  }
}
