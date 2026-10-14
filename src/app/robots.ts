import type { MetadataRoute } from "next";

import { siteUrl } from "@/lib/site";

// Закрыто ровно то, что не должно попадать в выдачу:
//   /api/    — ручки, среди них OAuth-callback и вебхуки;
//   /m/      — мини-аппы Telegram, там личные данные учениц (у /m/* уже стоит
//              noindex в layout — это второй рубеж, на случай прямой ссылки);
//   /admin/  — админка целиком;
//   /wish/   — личный виш-лист по секретной ссылке (у страницы ещё и noindex);
//   /        — корень редиректит в /admin, индексировать нечего.
// Всё остальное открыто: лендинг, интенсив, /start, калькуляторы, политика.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/m/", "/admin/", "/wish/"],
      },
    ],
    sitemap: siteUrl("/sitemap.xml"),
    host: siteUrl(""),
  };
}
