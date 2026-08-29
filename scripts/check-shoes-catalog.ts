/**
 * Проверка базы обуви подборщика: схема, сходимости, отчёт о пропусках.
 *
 * Гоняется на сборке и руками после каждой подмены JSON. Падает, если хоть
 * одна запись отбракована: молча уменьшившаяся база выглядит как «просто мало
 * подходящих моделей», и подмена битого файла прошла бы незамеченной.
 *
 *   npm run check:shoes-catalog
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { validateCatalog } from "../src/features/shoes/schema";

const path = resolve(process.argv[2] ?? "data/shoes/catalog.demo.json");
const raw = JSON.parse(readFileSync(path, "utf8"));
const result = validateCatalog(raw);

console.log(`Каталог: ${path}`);
console.log(`Тип: ${result.catalog_kind}`);
console.log(`Принято моделей: ${result.shoes.length}`);
console.log(`Отбраковано: ${result.rejected.length}`);

if (result.catalog_kind === "demo") {
  console.log(
    "\n⚠  Это ДЕМО-база: числа не сверены по источникам и не годятся для выдачи людям.\n" +
      "   Заменяется настоящей базой этапа 1 (каждое поле — из загруженной страницы источника)."
  );
}

for (const r of result.rejected) {
  console.log(`\n✗ ${r.id}`);
  for (const p of r.problems) console.log(`    ${p}`);
}

// Отчёт о пропусках: незаполненные необязательные поля. Не ошибка, но именно
// этот список — вход для второго прохода по источникам.
const byField = new Map<string, string[]>();
for (const g of result.gaps) {
  byField.set(g.field, [...(byField.get(g.field) ?? []), g.id]);
}
if (byField.size > 0) {
  console.log("\nПропуски (не ошибка, но требует прохода по источникам):");
  for (const [field, ids] of byField) {
    console.log(`  ${field}: ${ids.length} моделей`);
  }
}

// Покрытие по слотам: пустая категория означает, что слот выдачи будет пуст.
const counts = new Map<string, number>();
for (const s of result.shoes) {
  for (const c of s.categories) counts.set(c, (counts.get(c) ?? 0) + 1);
}
console.log("\nПокрытие по категориям:");
for (const [c, n] of [...counts].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${c}: ${n}`);
}

if (result.rejected.length > 0) {
  console.error("\nПРОВАЛ: в базе есть отбракованные записи.");
  process.exit(1);
}
console.log("\nОК");
