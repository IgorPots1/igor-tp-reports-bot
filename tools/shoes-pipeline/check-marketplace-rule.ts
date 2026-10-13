/**
 * Проверка правила «маркетплейс только китайским брендам».
 *
 * Правило стережёт деньги и доверие: цена с Ozon на ASICS за двадцать тысяч —
 * это приглашение купить подделку. Поэтому у него есть чек, а не только код.
 *
 *   npx tsx tools/shoes-pipeline/check-marketplace-rule.ts
 */
import { isShopAllowedForBrand, rejectReason } from "./lib/marketplace-rule";

let failures = 0;
const check = (cond: boolean, msg: string) => {
  console.log(`  ${cond ? "✓" : "✗"} ${msg}`);
  if (!cond) failures += 1;
};

console.log("=== маркетплейсы ===");
for (const shop of ["ozon", "wildberries"]) {
  check(!isShopAllowedForBrand(shop, "Nike"), `${shop}: Nike запрещён`);
  check(!isShopAllowedForBrand(shop, "ASICS"), `${shop}: ASICS запрещён`);
  check(!isShopAllowedForBrand(shop, "HOKA"), `${shop}: HOKA запрещён`);
  check(isShopAllowedForBrand(shop, "Li-Ning"), `${shop}: Li-Ning разрешён`);
  check(isShopAllowedForBrand(shop, "Xtep"), `${shop}: Xtep разрешён`);
  check(isShopAllowedForBrand(shop, "ANTA"), `${shop}: ANTA разрешён`);
}

console.log("\n=== обычные магазины ===");
for (const shop of ["kant", "sportmaster", "sportmarafon", "lamoda"]) {
  check(isShopAllowedForBrand(shop, "Nike"), `${shop}: Nike разрешён`);
  check(isShopAllowedForBrand(shop, "Li-Ning"), `${shop}: Li-Ning разрешён`);
}

console.log("\n=== мелочи, на которых правило ломается ===");
check(!isShopAllowedForBrand("OZON", "Nike"), "регистр магазина не обходит правило");
check(isShopAllowedForBrand("ozon", " li-ning "), "пробелы в имени бренда не обходят правило");
check(isShopAllowedForBrand("ozon", "LI-NING"), "регистр бренда не ломает разрешение");
check(
  (rejectReason("ozon", "Nike") ?? "").includes("подделк"),
  "причина отказа называет риск подделки, а не просто «нельзя»"
);
check(rejectReason("kant", "Nike") === null, "у разрешённой пары причины отказа нет");

console.log(failures ? `\nПРОВАЛ: ${failures}` : "\nОК");
process.exit(failures ? 1 : 0);
