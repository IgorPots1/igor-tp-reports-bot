/**
 * Сколько моделей покрывают обзорные источники, прошедшие гейт (14.10.2026).
 *
 * Считается по картам сайтов: только адреса, ничего из страниц не читается.
 * Загрузчик пускает лишь источники со статусом allowed, robots.txt и пауза
 * соблюдаются им же.
 *
 * Модель узнаётся по адресу: бренд из известного списка где угодно в
 * последнем сегменте («obzor-krossovok-hoka-mach-6», «hoka-mach-6-review»),
 * модель — до трёх слов после бренда без служебных. Это оценка сверху вниз:
 * подборки «топ-10» без бренда в адресе в счёт не попадают, и это занижение,
 * а не завышение.
 *
 *   npx tsx tools/shoes-pipeline/coverage-allowed.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { sitemapsFromRobots, walkSitemaps } from "./lib/sitemap";
import { SOURCES } from "./lib/sources";

const REPORTS = resolve("tools/shoes-pipeline/reports");
mkdirSync(REPORTS, { recursive: true });
const terms = JSON.parse(readFileSync(resolve(REPORTS, "source-terms.json"), "utf8")) as {
  sources: { id: string; status: string }[];
};
const allowed = new Set(terms.sources.filter((s) => s.status === "allowed").map((s) => s.id));
const reviewSources = SOURCES.filter((s) => s.kind === "review" && allowed.has(s.id));

const BRANDS: [string, string][] = [
  ["new-balance", "newbalance"], ["newbalance", "newbalance"], ["nb-fuelcell", "newbalance"], ["li-ning", "lining"], ["lining", "lining"],
  ["la-sportiva", "lasportiva"], ["under-armour", "underarmour"], ["inov-8", "inov8"], ["inov8", "inov8"], ["topo-athletic", "topo"],
  ["mount-to-coast", "mounttocoast"], ["361", "361"], ["adidas", "adidas"], ["nike", "nike"], ["asics", "asics"], ["hoka", "hoka"],
  ["saucony", "saucony"], ["brooks", "brooks"], ["puma", "puma"], ["mizuno", "mizuno"], ["on-cloud", "on"], ["salomon", "salomon"],
  ["scott", "scott"], ["altra", "altra"], ["topo", "topo"], ["merrell", "merrell"], ["craft", "craft"], ["dynafit", "dynafit"],
  ["nnormal", "nnormal"], ["kiprun", "decathlon"], ["reebok", "reebok"], ["skechers", "skechers"], ["diadora", "diadora"],
  ["anta", "anta"], ["xtep", "xtep"], ["peak", "peak"], ["kailas", "kailas"], ["norda", "norda"], ["karhu", "karhu"],
  ["arcteryx", "arcteryx"], ["arc-teryx", "arcteryx"], ["the-north-face", "tnf"], ["hoka-one-one", "hoka"],
].sort((a, b) => b[0].length - a[0].length) as [string, string][];

const STOP = new Set(
  "review reviews obzor obzory test tested testing krossovok krossovki krossovka begovyh begovye dlya bega first look impressions long term after km miles vs versus mens womens men women trail running shoe shoes running-shoe the a and i".split(" ")
);
const NOT_SHOE = /apparel|shorts|jacket|tights|socks|glasses|watch|headphones|backpack|vest|bottle|gel|insole|gaiter|cap|gloves/;

function modelFrom(url: string): string | null {
  let seg: string;
  try {
    seg = new URL(url).pathname.split("/").filter(Boolean).pop() ?? "";
  } catch {
    return null;
  }
  const s = `-${seg.toLowerCase().replace(/\.html?$/, "").replace(/[^a-z0-9]+/g, "-")}-`;
  if (NOT_SHOE.test(s)) return null;
  for (const [slug, id] of BRANDS) {
    const i = s.indexOf(`-${slug}-`);
    if (i === -1) continue;
    const rest = s.slice(i + slug.length + 2).split("-").filter((w) => w && !STOP.has(w) && !/^20\d\d$/.test(w));
    const model = rest.slice(0, 3).join("-");
    if (!model) return null;
    return `${id}:${model}`;
  }
  return null;
}

type Hit = { source: string; url: string; lastmod: string | null };
const byModel = new Map<string, Hit[]>();
const perSource: { id: string; urls: number; models: number; models2024: number; mapsRead: number; skipped: number }[] = [];

for (const src of reviewSources) {
  const declared = await sitemapsFromRobots(src.id, src.origin);
  const walk = await walkSitemaps(src.id, declared.length ? declared : [`${src.origin}/sitemap.xml`], { maxMaps: 30 });
  const models = new Set<string>();
  const models2024 = new Set<string>();
  for (const e of walk.entries) {
    const m = modelFrom(e.url);
    if (!m) continue;
    models.add(m);
    if (e.lastmod && e.lastmod.slice(0, 4) >= "2024") models2024.add(m);
    byModel.set(m, [...(byModel.get(m) ?? []), { source: src.id, url: e.url, lastmod: e.lastmod }]);
  }
  perSource.push({ id: src.id, urls: walk.entries.length, models: models.size, models2024: models2024.size, mapsRead: walk.mapsRead, skipped: walk.skipped.length });
  console.log(`  ${src.id.padEnd(22)} адресов ${String(walk.entries.length).padStart(6)}, моделей ${String(models.size).padStart(4)}, из них с обзором 2024+ ${models2024.size}`);
}

const all = [...byModel.entries()];
const recent = all.filter(([, h]) => h.some((x) => x.lastmod && x.lastmod.slice(0, 4) >= "2024"));
const multi = all.filter(([, h]) => new Set(h.map((x) => x.source)).size >= 2);
const recentMulti = recent.filter(([, h]) => new Set(h.map((x) => x.source)).size >= 2);
writeFileSync(
  resolve(REPORTS, "coverage-allowed.json"),
  JSON.stringify({ perSource, models: Object.fromEntries(all) }, null, 2) + "\n"
);
console.log(`\nМоделей всего: ${all.length}; с обзором 2024+: ${recent.length}`);
console.log(`Из них на двух источниках и больше: ${multi.length}; 2024+ и два источника: ${recentMulti.length}`);
