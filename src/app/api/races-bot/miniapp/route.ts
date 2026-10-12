/* Мини-апп бота «Забеги России» (страница /races внутри Telegram): список сохранённых и
 * звёздочка «Следить / Не следить». Кто это — только из initData, подпись которой проверяется
 * токеном бота; initDataUnsafe и любые id из тела запроса не принимаются. */

import { parseTelegramInitDataUser, validateTelegramInitDataWithToken } from "@/features/telegram/validate-init-data";
import { botToken, productionBot } from "@/features/races-bot/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_AGE_S = 24 * 3600;

export async function POST(request: Request) {
  let body: { initData?: unknown; action?: unknown; raceId?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
  const initData = typeof body.initData === "string" ? body.initData : "";
  const action = body.action === "follow" || body.action === "unfollow" ? body.action : "list";
  const raceId = typeof body.raceId === "string" && body.raceId.length <= 200 ? body.raceId : undefined;
  let token: string;
  try {
    token = botToken();
  } catch {
    return Response.json({ ok: false, error: "misconfigured" }, { status: 500 });
  }
  if (!initData || !validateTelegramInitDataWithToken(initData, token)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const authDate = Number(new URLSearchParams(initData).get("auth_date") || 0);
  if (!authDate || Date.now() / 1000 - authDate > MAX_AGE_S) {
    return Response.json({ ok: false, error: "expired" }, { status: 401 });
  }
  const user = parseTelegramInitDataUser(initData);
  if (!user) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  try {
    const follows = await productionBot().miniapp(
      { id: user.id, first_name: user.firstName ?? undefined, username: user.username ?? undefined },
      action,
      raceId,
    );
    return Response.json({ ok: true, follows });
  } catch (e) {
    console.error(`[races-bot] miniapp: ${e instanceof Error ? e.message : String(e)}`);
    return Response.json({ ok: false, error: "server" }, { status: 500 });
  }
}
