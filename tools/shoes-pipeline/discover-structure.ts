/**
 * Разведка структуры источников: где у каждого лежат карточки моделей.
 *
 * Отвечает на вопрос, с которого начинается весь поиск моделей, — и отвечает
 * ФАКТОМ, а не догадкой. Для каждого разрешённого источника читается карта
 * сайта, адреса группируются по форме пути, и наружу выходят самые
 * многочисленные формы с примерами.
 *
 * Зачем отдельным шагом. Прошлые попытки угадать адрес каталога стоили двух
 * впустую потраченных заходов: «/us/en-us/running-shoes/» и «/catalog/beg/»
 * отдали 404 и 302. Пока структура не увидена глазами, писать разборщик не по
 * чему.
 *
 * Отдельно это даёт и главное число наряда: сколько у обзорных площадок
 * страниц обзоров — то есть реальный ПОТОЛОК каталога подбора.
 *
 *   npx tsx tools/shoes-pipeline/discover-structure.ts            — все разрешённые
 *   npx tsx tools/shoes-pipeline/discover-structure.ts rtings nike
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { clusterByShape, sitemapsFromRobots, walkSitemaps } from "./lib/sitemap";
import { SOURCES } from "./lib/sources";

const REPORTS = resolve("tools/shoes-pipeline/reports");
mkdirSync(REPORTS, { recursive: true });

const terms = JSON.parse(
  readFileSync(resolve(REPORTS, "source-terms.json"), "utf8")
) as { sources: { id: string; status: string }[] };
const allowed = new Set(terms.sources.filter((s) => s.status === "allowed").map((s) => s.id));

const wanted = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const targets = SOURCES.filter(
  (s) => allowed.has(s.id) && (wanted.length === 0 || wanted.includes(s.id))
);

console.log(`Разрешённых источников: ${allowed.size}, в работе: ${targets.length}\n`);

type Finding = {
  id: string;
  title: string;
  kind: string;
  sitemapsDeclared: string[];
  mapsRead: number;
  urls: number;
  skipped: number;
  shapes: { shape: string; count: number; sample: string }[];
};

const findings: Finding[] = [];

for (const source of targets) {
  process.stdout.write(`${source.title} (${source.kind})… `);
  const declared = await sitemapsFromRobots(source.id, source.origin);
  const roots = declared.length > 0 ? declared : [`${source.origin}/sitemap.xml`];

  const walk = await walkSitemaps(source.id, roots, { maxMaps: 25 });
  const shapes = clusterByShape(walk.urls).slice(0, 6);

  findings.push({
    id: source.id,
    title: source.title,
    kind: source.kind,
    sitemapsDeclared: declared,
    mapsRead: walk.mapsRead,
    urls: walk.urls.length,
    skipped: walk.skipped.length,
    shapes,
  });

  console.log(
    `карт ${walk.mapsRead}${walk.skipped.length ? ` (+${walk.skipped.length} не дошли)` : ""}, адресов ${walk.urls.length}`
  );
  for (const s of shapes.slice(0, 3)) {
    console.log(`    ${String(s.count).padStart(6)}  ${s.shape.slice(0, 58)}`);
  }
}

writeFileSync(resolve(REPORTS, "source-structure.json"), JSON.stringify(findings, null, 2) + "\n");

console.log(`\n${"═".repeat(70)}`);
const byKind = (k: string) => findings.filter((f) => f.kind === k);
for (const k of ["brand", "shop", "review"]) {
  const list = byKind(k);
  const urls = list.reduce((a, f) => a + f.urls, 0);
  console.log(`${k.padEnd(7)} источников ${String(list.length).padStart(3)}, адресов в картах ${urls}`);
}
const dead = findings.filter((f) => f.urls === 0);
if (dead.length > 0) {
  console.log(`\nБез карты сайта (${dead.length}): ${dead.map((f) => f.title).join(", ")}`);
  console.log("Для них нужен другой проход — обход каталога постранично.");
}
console.log(`\nОтчёт: ${resolve(REPORTS, "source-structure.json")}`);
