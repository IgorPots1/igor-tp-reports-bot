import rawCatalog from "../../../data/shoes/catalog.demo.json";
import { validateCatalog } from "./schema";
import type { ClientCatalog, ClientShoe } from "./types";

/**
 * Загрузка базы обуви. Валидация идёт на импорте модуля, то есть при сборке:
 * битая или противоречивая запись не доезжает до страницы вообще.
 *
 * Наружу отдаётся каталог БЕЗ цен. Это не украшательство, а гарантия: цены
 * нельзя показывать нигде в интерфейсе, и надёжнее всего это обеспечить тем,
 * что их физически нет в том объекте, который уходит в браузер. Уровень
 * («доступные / средние / топовые») вычислен заранее и цену не выдаёт.
 */
const validated = validateCatalog(rawCatalog);

if (validated.rejected.length > 0) {
  console.warn(
    `[shoes] отбраковано записей: ${validated.rejected.length}. ` +
      `Проверить: npm run check:shoes-catalog`
  );
}

export const CATALOG_KIND = validated.catalog_kind;

export const clientCatalog: ClientCatalog = {
  catalog_kind: validated.catalog_kind,
  shoes: validated.shoes.map((shoe): ClientShoe => {
    const { price: _price, ...rest } = shoe;
    void _price;
    return rest;
  }),
};
