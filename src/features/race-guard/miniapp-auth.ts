/* Адреса только для мини-приложения (выжимка, список «Важное», события): подписанный initData
 * Telegram в заголовке X-Telegram-Init-Data, подпись — токеном бота «Забеги России», срок — сутки
 * (наряд 20.10.2026). Нет подписи, плохая или старая — 401 и строка в журнал отказов; такие
 * запросы ещё и считаются в лимит IP, иначе подделкой заголовка можно обойти middleware.
 * С верной подписью лимит — по пользователю Telegram (LIMITS.miniapp), не по IP. */

import { parseTelegramInitDataUser, validateTelegramInitDataWithToken } from "@/features/telegram/validate-init-data";
import { botToken } from "@/features/races-bot/runtime";

import { COPYRIGHT_HEADERS, clientIp, hit, hitBucket, logRefusal, tooManyRequests, type RefusalKind } from "./guard";

export const INIT_DATA_HEADER = "x-telegram-init-data";
export const INIT_DATA_MAX_AGE_S = 24 * 3600;

export type InitDataCheck = { ok: true; userId: number } | { ok: false; kind: Exclude<RefusalKind, "rate_limit" | "forbidden"> };

/** Проверка без сети и базы: подпись, срок, пользователь. */
export function checkInitData(initData: string, token: string, nowS: number = Date.now() / 1000): InitDataCheck {
  if (!initData) return { ok: false, kind: "no_init_data" };
  if (!validateTelegramInitDataWithToken(initData, token)) return { ok: false, kind: "bad_init_data" };
  const authDate = Number(new URLSearchParams(initData).get("auth_date") || 0);
  if (!authDate || nowS - authDate > INIT_DATA_MAX_AGE_S) return { ok: false, kind: "bad_init_data" };
  const user = parseTelegramInitDataUser(initData);
  if (!user) return { ok: false, kind: "bad_init_data" };
  return { ok: true, userId: user.id };
}

function unauthorized(error: string): Response {
  return Response.json({ ok: false, error }, { status: 401, headers: { "Cache-Control": "no-store", ...COPYRIGHT_HEADERS } });
}

/** Пользователь мини-приложения или готовый ответ-отказ. */
export async function requireMiniapp(request: Request, initDataFromBody?: string): Promise<{ userId: number } | Response> {
  let token: string;
  try {
    token = botToken();
  } catch {
    return Response.json({ ok: false, error: "misconfigured" }, { status: 500 });
  }
  const initData = request.headers.get(INIT_DATA_HEADER) || initDataFromBody || "";
  const c = checkInitData(initData, token);
  const ip = clientIp(request.headers);
  const ua = request.headers.get("user-agent") ?? "";
  if (!c.ok) {
    const path = new URL(request.url).pathname;
    const [d] = await Promise.all([hit(ip, ua), logRefusal(c.kind, ip, ua, path)]);
    if (!d.allowed) return tooManyRequests(d);
    return unauthorized(c.kind === "no_init_data" ? "unauthorized" : "bad_init_data");
  }
  const d = await hitBucket(`tg:${c.userId}`, "miniapp");
  if (!d.allowed) {
    await logRefusal("rate_limit", ip, ua, new URL(request.url).pathname);
    return tooManyRequests(d);
  }
  return { userId: c.userId };
}
