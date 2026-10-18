/* Почасовой тик бота «Забеги России»: pg_cron в Supabase (public.race_bot_tick) зовёт этот
 * маршрут раз в час с ключом x-cron-key. Здесь — дайджест по понедельникам, сообщения за
 * 12 недель, неделю, накануне и после финиша, отмены. Мак не нужен. */

import { cronKey, productionBot } from "@/features/races-bot/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Регион функции — Дублин, рядом с базой (Supabase eu-west-1) и серверами Telegram (18.10.2026):
// было iad1 (Вашингтон), каждый запрос к базе пересекал Атлантику.
export const preferredRegion = "dub1";
export const maxDuration = 300;

export async function POST(request: Request) {
  let key: string;
  try {
    key = cronKey();
  } catch {
    return new Response("misconfigured", { status: 500 });
  }
  if (request.headers.get("x-cron-key") !== key) return new Response("forbidden", { status: 403 });
  // {"only":"nudge"} — частый тик (раз в 10 минут, race_bot_nudge_tick): только напоминание
  // после /start без действий. Пустое тело — почасовой тик целиком.
  const body = (await request.json().catch(() => null)) as { only?: unknown } | null;
  try {
    if (body?.only === "nudge") return Response.json({ ok: true, nudged: await productionBot().runNudge() });
    const counts = await productionBot().runTick();
    return Response.json({ ok: true, ...counts });
  } catch (e) {
    console.error(`[races-bot] tick: ${e instanceof Error ? e.message : String(e)}`);
    return Response.json({ ok: false }, { status: 500 });
  }
}
