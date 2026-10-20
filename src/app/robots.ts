import type { MetadataRoute } from "next";

import { AI_ASSISTANT_BOTS, AI_TRAINING_BOTS } from "@/features/race-guard/ai-bots";
import { siteUrl } from "@/lib/site";

// Закрыто ровно то, что не должно попадать в выдачу:
//   /api/    — ручки, среди них OAuth-callback и вебхуки;
//   /m/      — мини-аппы Telegram, там личные данные учениц (у /m/* уже стоит
//              noindex в layout — это второй рубеж, на случай прямой ссылки);
//   /admin/  — админка целиком;
//   /wish/   — личный виш-лист по секретной ссылке (у страницы ещё и noindex);
//   /        — корень редиректит в /admin, индексировать нечего.
// Всё остальное открыто: лендинг, интенсив, /start, калькуляторы, политика.
//
// ИИ-сборщики (20.10.2026): обучающим закрыт весь сайт, ассистентам и ИИ-поиску — календарь
// забегов. Списки с источниками — src/features/race-guard/ai-bots.ts. Поисковики и превью ссылок
// (Googlebot, YandexBot, bingbot, TelegramBot, facebookexternalhit, Twitterbot) идут по «*».
const COMMON_DISALLOW = ["/api/", "/m/", "/admin/", "/wish/"];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: COMMON_DISALLOW,
      },
      { userAgent: AI_TRAINING_BOTS, disallow: "/" },
      { userAgent: AI_ASSISTANT_BOTS, disallow: [...COMMON_DISALLOW, "/races"] },
    ],
    sitemap: siteUrl("/sitemap.xml"),
    host: siteUrl(""),
  };
}
