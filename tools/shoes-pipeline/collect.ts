/**
 * Конвейер сбора базы кроссовок. Проходы 1–4 из наряда.
 *
 * Порядок: обнаружение моделей по карте сайта → загрузка (только у источников
 * со статусом allowed, с паузами и кэшем) → разбор → нормализация →
 * происхождение каждого поля → отчёты → валидация валидатором ПРИЛОЖЕНИЯ.
 *
 * Конвейер НЕ имеет права дописать поле, которого нет в источнике. Пустое поле
 * уезжает в отчёт о пропусках, запись отбраковывается валидатором. Это и есть
 * рабочий режим до тех пор, пока лабораторные источники не открыты: лучше
 * честно не выдать базу, чем выдать с придуманными числами.
 *
 *   npx tsx tools/shoes-pipeline/collect.ts            — 80 моделей (проба)
 *   npx tsx tools/shoes-pipeline/collect.ts --all      — все найденные
 *   npx tsx tools/shoes-pipeline/collect.ts --limit 20
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { fetchPage } from "./lib/fetch";
import { parseRtings, type RtingsShoe } from "./lib/parsers/rtings";
import { SCHEMA_FIELDS } from "./lib/schema-map";

const args = process.argv.slice(2);
const all = args.includes("--all");
const limitArg = args.indexOf("--limit");
const LIMIT = all ? Infinity : limitArg > -1 ? Number(args[limitArg + 1]) : 80;

const REPORTS = resolve("tools/shoes-pipeline/reports");
mkdirSync(REPORTS, { recursive: true });

/* ---------------------- Проход 1: обнаружение моделей ---------------------- */

console.log("Обнаружение моделей по карте сайта RTINGS…");
const sitemap = await fetchPage("rtings", "https://www.rtings.com/sitemap.xml");
if (!sitemap.ok) {
  console.error("Карта сайта недоступна:", sitemap.reason);
  process.exit(1);
}
const allUrls = [...sitemap.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
const reviewUrls = allUrls.filter(
  (u) => /\/running-shoes\/reviews\/[^/]+\/[^/]+$/.test(u) && !u.includes("/reviews/best/")
);
console.log(`  найдено страниц обзоров: ${reviewUrls.length}`);

// Китайские бренды (проход 3) берём первыми: по ним источников меньше всего,
// и если их не хватит, знать об этом надо раньше, а не после ста западных.
const CHINESE = ["li-ning", "anta", "xtep", "361", "kiprun", "peak", "kailas"];
const isChinese = (u: string) => CHINESE.some((b) => u.includes(`/reviews/${b}/`));
const ordered = [...reviewUrls.filter(isChinese), ...reviewUrls.filter((u) => !isChinese(u))];
const targets = ordered.slice(0, Math.min(LIMIT, ordered.length));
console.log(`  берём в работу: ${targets.length} (китайских: ${targets.filter(isChinese).length})`);

/* ------------------------- Проходы 1–3: загрузка --------------------------- */

const parsed: RtingsShoe[] = [];
const failures: { url: string; reason: string }[] = [];

for (const [i, url] of targets.entries()) {
  const res = await fetchPage("rtings", url);
  if (!res.ok) {
    failures.push({ url, reason: res.reason });
    console.log(`  [${i + 1}/${targets.length}] ✗ ${url.split("/reviews/")[1]} — ${res.reason}`);
    continue;
  }
  const shoe = parseRtings(res.body, url);
  parsed.push(shoe);
  const filled = Object.values(shoe.specs).filter((s) => s.value !== null).length;
  const mark = res.fromCache ? "кэш" : "сеть";
  console.log(
    `  [${i + 1}/${targets.length}] ${mark} ${shoe.brandSlug}/${shoe.modelSlug} — полей ${filled}/${Object.keys(shoe.specs).length}`
  );
}

writeFileSync(resolve(REPORTS, "raw-rtings.json"), JSON.stringify({ parsed, failures }, null, 2) + "\n");

/* --------------------------- Отчёт о пропусках ----------------------------- */

const gapsByField = new Map<string, string[]>();
for (const shoe of parsed) {
  for (const [field, spec] of Object.entries(shoe.specs)) {
    if (spec.value === null) {
      gapsByField.set(field, [...(gapsByField.get(field) ?? []), `${shoe.brandSlug}/${shoe.modelSlug}`]);
    }
  }
}

/* ------------- Покрытие схемы: главный ответ этапа, по факту ---------------- */

const gotFromRtings = new Set(
  Object.keys(parsed[0]?.specs ?? {}).filter((f) =>
    parsed.some((s) => s.specs[f]?.value !== null)
  )
);
// Поля схемы, закрытые собранным; производные считаются закрытыми, если
// закрыто то, из чего они выводятся.
const DERIVABLE: Record<string, string[]> = {
  stack_fore_mm: ["stack_heel_mm", "drop_mm"],
  id: ["brand", "model"],
  brand: [],
  model: [],
};
const covered = (f: string): boolean => {
  if (gotFromRtings.has(f)) return true;
  const deps = DERIVABLE[f];
  if (!deps) return false;
  return deps.every((d) => covered(d) || d === "brand" || d === "model");
};

const requiredFields = SCHEMA_FIELDS.filter((f) => f.required);
const closed = requiredFields.filter((f) => covered(f.field));
const open = requiredFields.filter((f) => !covered(f.field));

const coverage = {
  собрано_моделей: parsed.length,
  источники_в_работе: ["rtings"],
  обязательных_полей: requiredFields.length,
  закрыто: closed.map((f) => f.field),
  не_закрыто: open.map((f) => ({ поле: f.field, кем_закрывается: f.sources, примечание: f.note ?? null })),
};
writeFileSync(resolve(REPORTS, "schema-coverage.json"), JSON.stringify(coverage, null, 2) + "\n");

/* ------------------------------- Итог -------------------------------------- */

console.log(`\n${"═".repeat(72)}`);
console.log(`Разобрано моделей: ${parsed.length}, отказов: ${failures.length}`);

console.log(`\nПропуски по полям (из тех, что RTINGS в принципе отдаёт):`);
for (const [field, ids] of [...gapsByField].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${field.padEnd(26)} пусто у ${ids.length} из ${parsed.length}`);
}

console.log(`\nПокрытие схемы разрешёнными источниками:`);
console.log(`  закрыто обязательных полей: ${closed.length} из ${requiredFields.length}`);
console.log(`  закрыты: ${closed.map((f) => f.field).join(", ")}`);
console.log(`\n  НЕ закрыты:`);
for (const f of open) {
  console.log(`    ${f.field.padEnd(26)} нужен: ${f.sources.join(", ")}${f.note ? ` — ${f.note}` : ""}`);
}

console.log(`\nОтчёты: ${REPORTS}`);
console.log(
  `\nВЫВОД: запись не может пройти валидацию, пока не закрыты ${open.length} обязательных полей.\n` +
    `Базу подставлять нельзя — конвейер намеренно не выдаёт каталог с пустыми обязательными полями.`
);
