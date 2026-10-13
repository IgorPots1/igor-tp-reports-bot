/**
 * Какой магазин для какого бренда допустим.
 *
 * Правило живёт КОДОМ, а не комментарием, и проверяется валидатором: запись
 * цены с запрещённой парой «магазин + бренд» отбраковывается. Комментарий через
 * месяц не читают, а цена с маркетплейса на кроссовки за двадцать тысяч уедет
 * человеку в лицо.
 *
 * Суть ограничения: на Ozon и Wildberries встречаются подделки. Для китайских
 * брендов это приемлемо — там маркетплейсы часто единственный легальный канал.
 * Для Nike, ASICS, Hoka и прочих — нет: отправить туда человека значит
 * разделить с площадкой ответственность за подделку.
 */

/** Площадки, где торгуют и подделками. */
export const MARKETPLACES = new Set(["ozon", "wildberries"]);

/**
 * Бренды, которым маркетплейс разрешён. Список по НАЗВАНИЮ бренда в нижнем
 * регистре — id источника тут не годится: бренд в каталоге и источник-магазин
 * это разные сущности.
 */
export const MARKETPLACE_ALLOWED_BRANDS = new Set([
  "li-ning",
  "lining",
  "anta",
  "xtep",
  "361",
  "361 degrees",
  "361°",
  "peak",
  "kailas",
]);

const norm = (brand: string) => brand.trim().toLowerCase().replace(/\s+/g, " ");

/** true — цену из этого магазина для этого бренда записывать можно. */
export function isShopAllowedForBrand(shop: string, brand: string): boolean {
  if (!MARKETPLACES.has(shop.toLowerCase())) return true;
  return MARKETPLACE_ALLOWED_BRANDS.has(norm(brand));
}

/** Причина отказа — текстом, чтобы попала в отчёт, а не потерялась. */
export function rejectReason(shop: string, brand: string): string | null {
  if (isShopAllowedForBrand(shop, brand)) return null;
  return `${shop}: маркетплейс разрешён только китайским брендам, а это ${brand} — риск подделки`;
}
