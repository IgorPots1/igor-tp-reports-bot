import type { MetadataRoute } from "next";

import { PUBLIC_PAGES, siteUrl } from "@/lib/site";

// Список страниц лежит в @/lib/site, а не здесь: тот же перечень нужен глазами
// при добавлении публичной страницы, и держать его рядом с адресом сайта
// честнее, чем прятать в служебном файле маршрута.
export default function sitemap(): MetadataRoute.Sitemap {
  // Время сборки, а не запроса: карта статическая, дата обязана быть
  // одинаковой во всех ответах, иначе поисковик видит вечное «изменилось».
  const lastModified = new Date();

  return PUBLIC_PAGES.map((page) => ({
    url: siteUrl(page.path),
    lastModified,
    changeFrequency: page.changeFrequency,
    priority: page.priority,
  }));
}
