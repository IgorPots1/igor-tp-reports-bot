/**
 * Отчёт о покрытии — раздел 7 наряда.
 *
 * Отвечает на вопрос «где база тонкая», причём не в среднем, а по конкретным
 * связкам: если у «доступные + Россия + стартовые» осталось три модели, это
 * надо знать ДО запуска, а не по жалобам.
 *
 * Считается не пересказом фильтров, а прогоном настоящего подбора: сюда
 * импортируется тот же recommend, что стоит на странице. Своя копия правил
 * разошлась бы с боевой на первой же правке фильтра и врала бы спокойным
 * голосом.
 *
 *   npx tsx tools/shoes-pipeline/coverage-report.ts data/shoes/catalog.demo.json
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { recommend } from "../../src/features/shoes/recommend";
import { validateCatalog } from "../../src/features/shoes/schema";
import type { Answers, ClientCatalog, ClientShoe } from "../../src/features/shoes/types";

const path = resolve(process.argv[2] ?? "data/shoes/catalog.demo.json");
const validated = validateCatalog(JSON.parse(readFileSync(path, "utf8")));
const catalog: ClientCatalog = {
  catalog_kind: validated.catalog_kind,
  shoes: validated.shoes.map(({ price: _p, ...rest }): ClientShoe => rest),
};

console.log(`Каталог: ${path}`);
console.log(`Принято записей: ${validated.shoes.length}, отбраковано: ${validated.rejected.length}\n`);

if (validated.shoes.length === 0) {
  console.log("Считать покрытие не на чем: валидацию не прошла ни одна запись.");
  process.exit(0);
}

/* ------------------------- Сырые срезы по полям ---------------------------- */

const tally = (get: (s: ClientShoe) => string[] | string) => {
  const out = new Map<string, number>();
  for (const s of catalog.shoes) {
    const k = get(s);
    for (const v of Array.isArray(k) ? k : [k]) out.set(v, (out.get(v) ?? 0) + 1);
  }
  return [...out].sort((a, b) => b[1] - a[1]);
};

console.log("По категориям:", Object.fromEntries(tally((s) => s.categories)));
console.log("По рынкам:    ", Object.fromEntries(tally((s) => s.available)));
console.log("Уровень (RU): ", Object.fromEntries(tally((s) => s.tier.ru)));
console.log("Уровень (EU): ", Object.fromEntries(tally((s) => s.tier.eu)));

/* ------------- Тонкие связки: прогоном настоящего подбора ------------------ */

const base: Answers = {
  weeklyVolume: "40-60", surface: "road", goal: "half", winter: "none", speedwork: true,
  gender: "any", bodyWeightKg: 75, footWidth: "std", pronation: "neutral", issues: ["none"],
  ownedShoeIds: [], dislikes: ["none"], feel: 3, tier: "any", market: "any", pairs: 3,
};

type Row = { combo: string; slot: string; picks: number };
const rows: Row[] = [];

for (const tier of ["low", "mid", "top", "any"] as const)
  for (const market of ["ru", "eu", "any"] as const)
    for (const gender of ["m", "w", "any"] as const)
      for (const [label, extra] of [
        ["дорога", { surface: "road", goal: "half" }],
        ["трейл", { surface: "trail", goal: "trail_ultra" }],
        ["зима-снег", { winter: "snow" }],
        ["зима-слякоть", { winter: "slush" }],
      ] as const) {
        const a = { ...base, tier, market, gender, ...extra } as Answers;
        for (const r of recommend(catalog, a)) {
          rows.push({
            combo: `${tier} · ${market} · ${gender} · ${label}`,
            slot: r.slot.title,
            picks: r.picks.length,
          });
        }
      }

const empty = rows.filter((r) => r.picks === 0);
const thin = rows.filter((r) => r.picks > 0 && r.picks < 3);

console.log(`\nПроверено связок ответов: ${rows.length}`);
console.log(`Слот пустой:  ${empty.length}`);
console.log(`Слот тонкий (меньше трёх моделей): ${thin.length}`);

const group = (list: Row[]) => {
  const m = new Map<string, string[]>();
  for (const r of list) m.set(`${r.slot}`, [...(m.get(r.slot) ?? []), r.combo]);
  return m;
};

if (empty.length) {
  console.log(`\nПУСТЫЕ СЛОТЫ — человек увидит сообщение вместо выдачи:`);
  for (const [slot, combos] of group(empty)) {
    console.log(`  ${slot} (${combos.length}): ${combos.slice(0, 4).join(" | ")}${combos.length > 4 ? " …" : ""}`);
  }
}
if (thin.length) {
  console.log(`\nТОНКИЕ СЛОТЫ — выдача меньше трёх моделей:`);
  for (const [slot, combos] of group(thin)) {
    console.log(`  ${slot} (${combos.length}): ${combos.slice(0, 4).join(" | ")}${combos.length > 4 ? " …" : ""}`);
  }
}
if (!empty.length && !thin.length) {
  console.log("\nПерекосов нет: во всех проверенных связках слоты полные.");
}
