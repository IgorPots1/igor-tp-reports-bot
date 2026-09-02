/**
 * Сбор лабораторных замеров с RunRepeat.
 *
 * Источник закрывает четыре поля схемы, которых нет больше нигде: твёрдость
 * межподошвы по Шору, жёсткость задника, износостойкость и толщину подошвы.
 * Плюс даёт измеренные стек и дроп и вес обеих версий — то есть закрывает и
 * женские версии, на которых конвейер спотыкался.
 *
 * Обход только по разрешённым robots путям, с паузами и в кэш — как у всех
 * источников. Гейт тот же: без статуса allowed в отчёте аудита не поедет.
 *
 *   npx tsx tools/shoes-pipeline/collect-runrepeat.ts --limit 40
 *   npx tsx tools/shoes-pipeline/collect-runrepeat.ts --all
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { fetchPage } from "./lib/fetch";
import { parseRunRepeat, type RunRepeatShoe } from "./lib/parsers/runrepeat";

const args = process.argv.slice(2);
const all = args.includes("--all");
const limitArg = args.indexOf("--limit");
const LIMIT = all ? Infinity : limitArg > -1 ? Number(args[limitArg + 1]) : 40;

const REPORTS = resolve("tools/shoes-pipeline/reports");
mkdirSync(REPORTS, { recursive: true });

/* --------------------------- Обнаружение моделей --------------------------- */

// Карта сайта, объявленная в robots.txt, отдаёт 404 — обнаружение идёт по
// каталогу с пагинацией (она robots разрешена). Каталог сам сообщает, сколько
// всего моделей, поэтому число страниц не угадывается, а считается.
console.log("Каталог RunRepeat…");
const first = await fetchPage("runrepeat", "https://runrepeat.com/catalog/running-shoes");
if (!first.ok) {
  console.error("Каталог недоступен:", first.reason);
  process.exit(1);
}

const linksOn = (html: string): string[] => {
  const found = [...html.matchAll(/href="(\/[a-z0-9][a-z0-9-]{4,})"/g)].map((m) => m[1]);
  return [...new Set(found)].filter(
    (p) => !/^\/(catalog|guides|ranking|news|about|hiring|es|uk|privacy|legal|sitemaps)/.test(p)
  );
};

const totalMatch = first.body.match(/([\d,]+)\s+shoes/i);
const total = totalMatch ? Number(totalMatch[1].replace(/,/g, "")) : 0;
const perPage = linksOn(first.body).length;
const pages = perPage > 0 ? Math.ceil(total / perPage) : 1;
console.log(`  всего моделей по данным каталога: ${total}, на странице: ${perPage}, страниц: ${pages}`);

const modelUrls = new Set<string>(linksOn(first.body).map((p) => `https://runrepeat.com${p}`));

for (let page = 2; page <= pages; page++) {
  const res = await fetchPage("runrepeat", `https://runrepeat.com/catalog/running-shoes?page=${page}`);
  if (!res.ok) {
    console.log(`  ! страница ${page} — ${res.reason}`);
    continue;
  }
  const before = modelUrls.size;
  for (const p of linksOn(res.body)) modelUrls.add(`https://runrepeat.com${p}`);
  const added = modelUrls.size - before;
  console.log(`  страница ${page}: +${added} (всего ${modelUrls.size})`);
  // Пагинация, которую сервер игнорирует, выдаёт те же ссылки. Ноль новых
  // подряд означает, что дальше идти незачем, — иначе конвейер молча
  // отстучал бы полтора десятка запросов впустую.
  if (added === 0) {
    console.log("  новых моделей не прибавилось — обнаружение остановлено");
    break;
  }
}

const targets = [...modelUrls].slice(0, Math.min(LIMIT, modelUrls.size));
console.log(`  страниц моделей найдено: ${modelUrls.size}, берём: ${targets.length}`);

/* ------------------------------- Загрузка ---------------------------------- */

const parsed: RunRepeatShoe[] = [];
const failures: { url: string; reason: string }[] = [];

for (const [i, url] of targets.entries()) {
  const res = await fetchPage("runrepeat", url);
  if (!res.ok) {
    failures.push({ url, reason: res.reason });
    console.log(`  [${i + 1}/${targets.length}] ✗ ${new URL(url).pathname} — ${res.reason}`);
    continue;
  }
  const shoe = parseRunRepeat(res.body, url);
  parsed.push(shoe);
  const lab = ["midsole_softness_ac", "heel_counter_stiffness", "outsole_thickness_mm", "outsole_wear_mm"]
    .filter((f) => shoe.specs[f]?.value !== null).length;
  console.log(
    `  [${i + 1}/${targets.length}] ${res.fromCache ? "кэш" : "сеть"} ${shoe.slug.padEnd(34)} лаборатория ${lab}/4`
  );
}

writeFileSync(resolve(REPORTS, "raw-runrepeat.json"), JSON.stringify({ parsed, failures }, null, 2) + "\n");

/* -------------------------------- Итог ------------------------------------- */

// Поле, которого в разборе НЕТ, — это не заполненное поле. Первая версия
// считала `s.specs[field]?.value !== null`, и отсутствующее поле давало
// undefined !== null, то есть «заполнено». Сводка бодро рапортовала 12 из 12
// по полю, которого парсер вообще не отдавал.
const filled = (field: string) =>
  parsed.filter((s) => s.specs[field] !== undefined && s.specs[field].value !== null).length;
console.log(`\n${"═".repeat(72)}`);
console.log(`Разобрано: ${parsed.length}, отказов: ${failures.length}`);
console.log(`\nЗаполненность полей, которых нет больше нигде:`);
for (const f of [
  "midsole_softness_ac",
  "midsole_softness_old_ha",
  "midsole_softness_cold_old_ha",
  "heel_counter_stiffness",
  "outsole_thickness_mm",
  "outsole_wear_mm",
  "stack_heel_mm",
  "stack_fore_mm",
  "drop_mm",
  "drop_declared_mm",
  "weight_men_g",
  "weight_women_g",
  "widths_available",
  "midsole_softness_cold_pct",
]) {
  console.log(`  ${f.padEnd(28)} ${filled(f)}/${parsed.length}`);
}
console.log(`\nОтчёт: ${resolve(REPORTS, "raw-runrepeat.json")}`);
