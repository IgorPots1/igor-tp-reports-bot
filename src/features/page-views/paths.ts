/* Какие страницы считаем в аналитике просмотров igorp.run. Один модуль на оба счётчика
 * (Vercel Analytics и свой page_views), чтобы правила не разошлись.
 *
 * Сравнение — по сегментам пути, а не голым startsWith: "/m" не должен задевать "/media",
 * "/start" — "/startup". */

function underPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** Служебные зоны: админка, мини-апп, API. Ни в один счётчик не попадают. */
const EXCLUDED_PREFIXES = ["/admin", "/m", "/api"];

export function isExcludedPath(pathname: string): boolean {
  return EXCLUDED_PREFIXES.some((p) => underPrefix(pathname, p));
}

/** Публичные разделы, которые пишем в page_views. Главная — только ровно "/". */
const TRACKED_PREFIXES = ["/tools", "/races", "/camp", "/club", "/start"];

export function isTrackedPath(pathname: string): boolean {
  if (pathname === "/") return true;
  return TRACKED_PREFIXES.some((p) => underPrefix(pathname, p));
}

const BOT_UA_RE = /bot|crawler|spider|preview|telegrambot|facebookexternalhit|vercel/i;

/** Боты и превью-сборщики ссылок (Telegram, Facebook, Vercel-скриншоты). Пустой UA — тоже бот. */
export function isBotUserAgent(userAgent: string | null | undefined): boolean {
  if (!userAgent) return true;
  return BOT_UA_RE.test(userAgent);
}
