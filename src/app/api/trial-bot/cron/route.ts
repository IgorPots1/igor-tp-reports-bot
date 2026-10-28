/* Тик пробной недели (утро, вечер, день 4, итог, дожимы, напоминание в тесте).
 *
 * Зовёт pg_cron в Supabase каждые 30 минут (public.trial_bot_tick, ключ x-cron-key из
 * trial_bot_config) — как у бота «Забеги России». Не vercel.json: на тарифе Vercel Hobby
 * кроны только раз в сутки, расписание «каждые 30 минут» сломало бы деплой. Для ручного
 * прогона подходит и Authorization: Bearer CRON_SECRET.
 *
 * Повторный вызов безопасен: каждая отправка захватывает ключ в trial_bot_sends.
 * При TRIAL_BOT_ENABLED выключенном маршрут ничего не читает и не шлёт. */

import { isAuthorizedTrialCron, isTrialEnabled, productionTrialBot } from "@/features/trial-bot/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const preferredRegion = "dub1";
export const maxDuration = 300;

async function handle(request: Request): Promise<Response> {
  if (!isAuthorizedTrialCron(request)) return new Response("forbidden", { status: 403 });
  if (!isTrialEnabled()) return Response.json({ ok: true, skipped: "TRIAL_BOT_ENABLED off" });
  try {
    const counts = await productionTrialBot().runTick();
    return Response.json({ ok: true, ...counts });
  } catch (e) {
    console.error(`[trial-bot] tick: ${e instanceof Error ? e.message : String(e)}`);
    return Response.json({ ok: false }, { status: 500 });
  }
}

export async function POST(request: Request) {
  return handle(request);
}

export async function GET(request: Request) {
  return handle(request);
}
