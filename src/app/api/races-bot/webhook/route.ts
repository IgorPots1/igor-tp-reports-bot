/* Webhook бота «Забеги России» (@ruruns_bot). Telegram шлёт сюда каждое обновление; Мак для
 * бота не нужен. Подлинность — заголовок X-Telegram-Bot-Api-Secret-Token, он выставлен в
 * setWebhook (scripts/races-bot-setup.ts) и выводится из токена бота. */

import { productionBot, webhookSecret } from "@/features/races-bot/runtime";
import type { TgUpdate } from "@/features/races-bot/bot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Регион функции — Дублин, рядом с базой (Supabase eu-west-1) и серверами Telegram (18.10.2026):
// было iad1 (Вашингтон), каждый запрос к базе пересекал Атлантику.
export const preferredRegion = "dub1";
export const maxDuration = 60;

export async function POST(request: Request) {
  const t0 = Date.now(); // для замера скорости: от получения вебхука до экрана
  let secret: string;
  try {
    secret = webhookSecret();
  } catch {
    return new Response("misconfigured", { status: 500 });
  }
  if (request.headers.get("x-telegram-bot-api-secret-token") !== secret) {
    return new Response("forbidden", { status: 403 });
  }
  let update: TgUpdate;
  try {
    update = (await request.json()) as TgUpdate;
  } catch {
    return new Response("bad request", { status: 400 });
  }
  try {
    await productionBot().handleUpdate(update, { t0 });
  } catch (e) {
    // 200 и запись в лог: при 5xx Telegram повторял бы то же обновление снова и снова.
    console.error(`[races-bot] update ${update.update_id ?? "?"}: ${e instanceof Error ? e.message : String(e)}`);
  }
  return new Response("ok");
}
