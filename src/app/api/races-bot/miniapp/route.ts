/* Мини-апп бота «Забеги России» (страница /races внутри Telegram): список сохранённых и
 * звёздочка «Следить / Не следить». Кто это — только из initData, подпись которой проверяется
 * токеном бота; initDataUnsafe и любые id из тела запроса не принимаются. */

import { parseTelegramInitDataUser, validateTelegramInitDataWithToken } from "@/features/telegram/validate-init-data";
import { MINIAPP_ACTIONS, type MiniappAction } from "@/features/races-bot/bot";
import { botToken, productionBot } from "@/features/races-bot/runtime";
import { clientIp, logRefusal } from "@/features/race-guard/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Регион функции — Дублин, рядом с базой (Supabase eu-west-1) и серверами Telegram (18.10.2026):
// было iad1 (Вашингтон), каждый запрос к базе пересекал Атлантику.
export const preferredRegion = "dub1";

const MAX_AGE_S = 24 * 3600;

export async function POST(request: Request) {
  let body: { initData?: unknown; action?: unknown; raceId?: unknown; from?: unknown; a?: unknown; v?: unknown; appVersion?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
  const initData = typeof body.initData === "string" ? body.initData : "";
  const action = body.action === "follow" || body.action === "unfollow" || body.action === "event" ? body.action : "list";
  // Действие внутри календаря для статистики (наряд 13.10.2026): только из белого списка.
  const ev =
    action === "event" && typeof body.a === "string" && (MINIAPP_ACTIONS as readonly string[]).includes(body.a)
      ? { a: body.a as MiniappAction, v: typeof body.v === "string" ? body.v.slice(0, 60) : null }
      : undefined;
  if (action === "event" && !ev) return Response.json({ ok: false, error: "bad_request" }, { status: 400 });
  const raceId = typeof body.raceId === "string" && body.raceId.length <= 200 ? body.raceId : undefined;
  // Откуда открыт календарь (from в ссылке web_app из бота) — только для статистики.
  const from = typeof body.from === "string" && /^[a-z_]{1,20}$/.test(body.from) ? body.from : null;
  // WebApp.version (версия Bot API в приложении): ниже 10.1 — rich-сообщения бот не шлёт (18.10.2026)
  const appVersion = typeof body.appVersion === "string" && /^\d{1,3}(\.\d{1,3}){0,2}$/.test(body.appVersion) ? body.appVersion : null;
  let token: string;
  try {
    token = botToken();
  } catch {
    return Response.json({ ok: false, error: "misconfigured" }, { status: 500 });
  }
  // Отказы — в журнал защиты (наряд 20.10.2026), в недельный итог.
  const refuse = async (kind: "no_init_data" | "bad_init_data", error: string) => {
    await logRefusal(kind, clientIp(request.headers), request.headers.get("user-agent") ?? "", "/api/races-bot/miniapp");
    return Response.json({ ok: false, error }, { status: 401 });
  };
  if (!initData) return refuse("no_init_data", "unauthorized");
  if (!validateTelegramInitDataWithToken(initData, token)) return refuse("bad_init_data", "unauthorized");
  const authDate = Number(new URLSearchParams(initData).get("auth_date") || 0);
  if (!authDate || Date.now() / 1000 - authDate > MAX_AGE_S) return refuse("bad_init_data", "expired");
  const user = parseTelegramInitDataUser(initData);
  if (!user) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  try {
    const follows = await productionBot().miniapp(
      { id: user.id, first_name: user.firstName ?? undefined, username: user.username ?? undefined },
      action,
      raceId,
      from,
      ev,
      appVersion,
    );
    return Response.json({ ok: true, follows });
  } catch (e) {
    console.error(`[races-bot] miniapp: ${e instanceof Error ? e.message : String(e)}`);
    return Response.json({ ok: false, error: "server" }, { status: 500 });
  }
}
