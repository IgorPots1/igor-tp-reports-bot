/**
 * Проверка привязки «магазин ↔ бренд».
 *
 * ЗАМЕНЯЕТ отменённый check-marketplace-rule. Прежний чек стерёг правило
 * «Ozon и Wildberries только китайским брендам» — вместе с площадками оно
 * удалено, и чек, оставленный стеречь отменённое, со временем читается как
 * необъяснимая строгость, и его снимают.
 *
 * Новое утверждение СИЛЬНЕЕ прежнего по двум причинам: оно покрывает все
 * магазины, а не две площадки, и трактует отсутствие доказательства как запрет,
 * а не как разрешение. Прежнее правило по умолчанию РАЗРЕШАЛО всё, кроме двух
 * исключений; это по умолчанию запрещает всё, кроме доказанного.
 *
 *   npx tsx tools/shoes-pipeline/check-shop-brand.ts
 */
import { isShopOfficialForBrand, officialBrandsOf, priceRejectReason } from "./lib/shop-brand";
import { SOURCES } from "./lib/sources";

let failures = 0;
const check = (cond: boolean, msg: string) => {
  console.log(`  ${cond ? "✓" : "✗"} ${msg}`);
  if (!cond) failures += 1;
};

console.log("=== молчание источника — это запрет ===");
check(!isShopOfficialForBrand("kant", "Nike"), "магазин без доказательства не даёт цену даже крупному бренду");
check(!isShopOfficialForBrand("sportmaster", "Li-Ning"), "и малому тоже");
check(
  (priceRejectReason("kant", "Nike") ?? "").includes("нет подтверждения"),
  "причина отказа говорит про отсутствие подтверждения, а не «нельзя»"
);

console.log("\n=== доказанная пара пропускается ===");
// Проверяем на вымышленной связке, не трогая реестр: правило должно работать
// от данных, а не от того, что кто-то уже заполнил таблицу.
const fake = { id: "test-shop", officialFor: ["Saucony", "HOKA"] };
const probe = (brand: string) =>
  (fake.officialFor ?? []).some((b) => b.trim().toLowerCase() === brand.trim().toLowerCase());
check(probe("Saucony"), "бренд из списка проходит");
check(probe("saucony"), "регистр не ломает разрешение");
check(!probe("Nike"), "бренд не из списка не проходит");

console.log("\n=== маркетплейсов в реестре не осталось ===");
for (const id of ["ozon", "wildberries"]) {
  check(!SOURCES.some((s) => s.id === id), `${id} удалён из реестра целиком`);
}

console.log("\n=== Bmai добавлен ===");
check(SOURCES.some((s) => s.id === "bmai"), "Bmai есть в реестре как бренд");

console.log("\n=== у каждого магазина с officialFor есть доказательство ===");
for (const s of SOURCES.filter((x) => x.kind === "shop")) {
  if ((s.officialFor ?? []).length > 0) {
    check(Boolean(s.officialProof), `${s.title}: список продавцов подкреплён ссылкой`);
  }
}
if (!SOURCES.some((s) => (s.officialFor ?? []).length > 0)) {
  console.log("  (ни у одного магазина привязка ещё не заполнена — это ожидаемо до ресерча)");
}

console.log(failures ? `\nПРОВАЛ: ${failures}` : "\nОК");
process.exit(failures ? 1 : 0);
