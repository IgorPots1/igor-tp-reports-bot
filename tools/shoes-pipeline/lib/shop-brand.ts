import { SOURCES } from "./sources";

/**
 * Можно ли записывать цену этого магазина для этого бренда.
 *
 * Пришло на смену правилу «маркетплейс только китайским брендам». То правило
 * охраняло две площадки; это охраняет ВСЕ магазины, и потому строже: цена
 * пишется, только если бренд сам назвал этот магазин своим продавцом.
 *
 * ОТСУТСТВИЕ ДОКАЗАТЕЛЬСТВА — ЗАПРЕТ, А НЕ РАЗРЕШЕНИЕ. Магазин без списка
 * officialFor не получает ни одной цены. Это главное свойство правила: молчание
 * источника нельзя прочитать как «наверное, можно», иначе защита от подделок
 * держится на том, успел ли кто-то заполнить таблицу.
 *
 * Признак оригинальности — только опубликованный брендом список продавцов, со
 * ссылкой в officialProof. Отзывы, возраст сайта и вид витрины признаками не
 * считаются: подделку продают и с хорошим дизайном.
 */

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export function officialBrandsOf(shopId: string): string[] {
  const s = SOURCES.find((x) => x.id === shopId);
  return s?.officialFor ?? [];
}

export function isShopOfficialForBrand(shopId: string, brand: string): boolean {
  return officialBrandsOf(shopId).some((b) => norm(b) === norm(brand));
}

/** Причина отказа текстом — чтобы попала в отчёт, а не потерялась молча. */
export function priceRejectReason(shopId: string, brand: string): string | null {
  if (isShopOfficialForBrand(shopId, brand)) return null;
  const known = officialBrandsOf(shopId);
  if (known.length === 0) {
    return `${shopId}: нет подтверждения, что магазин официальный продавец хоть какого-то бренда — цены не берём`;
  }
  return `${shopId}: бренд ${brand} не в списке официальных для этого магазина (есть: ${known.join(", ")})`;
}
