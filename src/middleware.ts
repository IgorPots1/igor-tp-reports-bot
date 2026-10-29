/* Лимит частоты на календарь забегов (наряд 20.10.2026): /races, страницы стартов и разборов трасс,
 * /api/races/*. По IP: 60 в минуту и 600 в час, сверх — 429 и строка в журнал отказов. Поисковики
 * и превью мессенджеров (по User-Agent) — свой счётчик с запасом, см. LIMITS. Остальной сайт
 * middleware не трогает (matcher). Сбой счётчика — запрос пропускается. Запас поисковика — только
 * с подтверждённого адреса (verify-bot.ts); ИИ-сборщики по User-Agent — 403 (29.10.2026). */

import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";

import { COPYRIGHT_HEADERS, aiBot, clientIp, forbidden, hit, logRefusal, tooManyRequests } from "@/features/race-guard/guard";

export async function middleware(req: NextRequest, event: NextFetchEvent) {
  // ИИ-сборщики — 403 до всего остального (29.10.2026: правило Vercel «AI Bots» не включено).
  const ua = req.headers.get("user-agent") ?? "";
  if (aiBot(ua)) {
    event.waitUntil(logRefusal("forbidden", clientIp(req.headers), ua, req.nextUrl.pathname));
    return forbidden();
  }
  // Мини-приложение с подписью Telegram: лимит по пользователю считает сам маршрут после проверки
  // подписи (src/features/race-guard/miniapp-auth.ts). Подделанный заголовок там получит 401 и
  // посчитается в лимит IP.
  if (req.nextUrl.pathname.startsWith("/api/races/") && req.headers.get("x-telegram-init-data")) {
    const res = NextResponse.next();
    for (const [k, v] of Object.entries(COPYRIGHT_HEADERS)) res.headers.set(k, v);
    return res;
  }
  const ip = clientIp(req.headers);
  const d = await hit(ip, ua);
  if (!d.allowed) {
    event.waitUntil(logRefusal("rate_limit", ip, ua, req.nextUrl.pathname));
    return tooManyRequests(d);
  }
  const res = NextResponse.next();
  for (const [k, v] of Object.entries(COPYRIGHT_HEADERS)) res.headers.set(k, v);
  return res;
}

export const config = {
  matcher: ["/races", "/races/:path*", "/api/races/:path*"],
};
