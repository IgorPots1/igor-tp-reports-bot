/**
 * Потолок каталога подбора: сколько моделей вообще обозрено.
 *
 * Главное число всего этапа. Каталог подбора не может быть больше, чем число
 * моделей, по которым существуют обзоры, — сколько бы их ни выпустили бренды.
 * Наряд велит назвать это число фактом и не подгонять под желаемые 400.
 *
 * Считается по картам сайта обзорных площадок, уже лежащим в кэше: повторный
 * проход бесплатен и не трогает чужие сайты.
 *
 *   npx tsx tools/shoes-pipeline/ceiling-report.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { looksLikeShoe, parseReviewUrl, type ReviewModel } from "./lib/review-url";
import { sitemapsFromRobots, walkSitemaps } from "./lib/sitemap";
import { SOURCES } from "./lib/sources";

/** Китайские бренды — наряд требует их числа отдельной строкой. */
const CHINESE = new Set(["lining", "anta", "xtep", "361", "peak", "kailas", "bmai"]);

const REPORTS = resolve("tools/shoes-pipeline/reports");
mkdirSync(REPORTS, { recursive: true });

/**
 * Что считать обзором беговой модели у каждой площадки.
 *
 * Правила свои у каждой: у RTINGS обзоры лежат отдельным разделом, у блогов —
 * вперемешку с подкастами, видео и новостями, и отличаются только словом в
 * адресе. Поэтому фильтр пишется ПО УВИДЕННОЙ структуре, а не общий на всех.
 */
const REVIEW_URL: Record<string, (path: string) => boolean> = {
  rtings: (p) => /^\/running-shoes\/reviews\/[^/]+\/[^/]+$/.test(p) && !p.includes("/reviews/best/"),
  // У блогов обзор отличается от раздела только тем, что слово «review» стоит
  // в ПОСЛЕДНЕМ сегменте и перед ним есть имя модели. Фильтр «есть слово
  // review где угодно в пути» ловит и витрины разделов — /shoe-reviews/ и
  // /gear-reviews/ попали в счёт и завысили его на пару сотен.
  doctorsofrunning: (p) => {
    const seg = p.split("/").filter(Boolean);
    return seg.length >= 1 && /review/i.test(seg[seg.length - 1]) && seg[seg.length - 1].length > 12;
  },
  believeintherun: (p) => {
    const seg = p.split("/").filter(Boolean);
    if (seg.length < 2) return false;
    if (/^(videos|podcasts|category|tag|author|page)$/i.test(seg[0])) return false;
    return /review/i.test(seg[seg.length - 1]) && seg[seg.length - 1].length > 12;
  },
};

type Row = { id: string; title: string; total: number; reviews: number };
const rows: Row[] = [];
const all: ReviewModel[] = [];

for (const source of SOURCES.filter((s) => s.kind === "review" && REVIEW_URL[s.id])) {
  const declared = await sitemapsFromRobots(source.id, source.origin);
  const roots = declared.length > 0 ? declared : [`${source.origin}/sitemap.xml`];
  const walk = await walkSitemaps(source.id, roots, { maxMaps: 25 });

  const isReview = REVIEW_URL[source.id];
  let kept = 0;
  for (const e of walk.entries) {
    let path: string;
    try {
      path = new URL(e.url).pathname;
    } catch {
      continue;
    }
    if (!isReview(path)) continue;
    const parsed = parseReviewUrl(source.id, e.url, e.lastmod);
    if (!parsed) continue;
    // Обзор не про кроссовки — не модель. Иначе потолок завышается одеждой,
    // очками и средствами восстановления.
    if (!looksLikeShoe(`${parsed.model} ${parsed.brandTitle ?? ""}`)) continue;
    all.push(parsed);
    kept += 1;
  }

  rows.push({ id: source.id, title: source.title, total: walk.urls.length, reviews: kept });
  console.log(`${source.title.padEnd(22)} адресов ${String(walk.urls.length).padStart(6)}, разобрано обзоров ${String(kept).padStart(5)}`);
}

/* ------------------- Сведение: одна модель у разных площадок ------------------- */

type Model = { key: string; brandId: string | null; brandTitle: string | null; model: string; sources: Set<string>; newest: string | null };
const models = new Map<string, Model>();
for (const r of all) {
  const m = models.get(r.key) ?? {
    key: r.key,
    brandId: r.brandId,
    brandTitle: r.brandTitle,
    model: r.model,
    sources: new Set<string>(),
    newest: null,
  };
  m.sources.add(r.source);
  if (r.lastmod && (!m.newest || r.lastmod > m.newest)) m.newest = r.lastmod;
  if (!m.brandId && r.brandId) { m.brandId = r.brandId; m.brandTitle = r.brandTitle; }
  models.set(r.key, m);
}

const list = [...models.values()];
/**
 * ДАТА ИЗ КАРТЫ САЙТА НЕ ГОДИТСЯ КАК ГОД МОДЕЛИ, и это измерено, а не
 * предположено: у моделей с двумя обзорами 346 из 348 помечены текущим годом.
 * lastmod — дата последнего ИЗМЕНЕНИЯ страницы, а популярные обзоры правят
 * постоянно. Поэтому год здесь НЕ фильтруется, и число «моделей 2024 и новее»
 * честно не выдаётся: для него нужен год из самой страницы обзора.
 */
const fresh = (m: Model) => (m.newest ? m.newest >= "2024-01-01" : false);

const withTwo = list.filter((m) => m.sources.size >= 2);
const withOne = list.filter((m) => m.sources.size === 1);
const freshTwo = withTwo.filter(fresh);
const freshOne = withOne.filter(fresh);
const chinese = list.filter((m) => m.brandId && CHINESE.has(m.brandId));
const unknownBrand = list.filter((m) => !m.brandId);

console.log(`\n${"═".repeat(70)}`);
console.log(`Уникальных моделей после снятия пересечений: ${list.length}`);
console.log(`  обзор на двух и более площадках: ${withTwo.length}  (из них свежие: ${freshTwo.length})`);
console.log(`  обзор на одной площадке:         ${withOne.length}  (из них свежие: ${freshOne.length})`);
console.log(`  бренд не распознан:              ${unknownBrand.length}`);
console.log(`\nКитайские бренды: ${chinese.length} моделей`);
const byChinese = new Map<string, number>();
for (const m of chinese) byChinese.set(m.brandTitle ?? "?", (byChinese.get(m.brandTitle ?? "?") ?? 0) + 1);
for (const [b, n] of [...byChinese].sort((a, b) => b[1] - a[1])) console.log(`  ${b}: ${n}`);

writeFileSync(
  resolve(REPORTS, "ceiling.json"),
  JSON.stringify(
    {
      perSource: rows,
      models: list.map((m) => ({ ...m, sources: [...m.sources] })),
      totals: {
        unique: list.length,
        twoPlus: withTwo.length,
        twoPlusFresh: freshTwo.length,
        one: withOne.length,
        oneFresh: freshOne.length,
        chinese: chinese.length,
        unknownBrand: unknownBrand.length,
      },
    },
    null,
    2
  ) + "\n"
);

console.log(`\nОтчёт: ${resolve(REPORTS, "ceiling.json")}`);

/* --------------------------------- Стоп-кран --------------------------------- */

const GATE = 150;
if (freshTwo.length < GATE) {
  console.log(`\n${"!".repeat(70)}`);
  console.log(`СТОП-КРАН: моделей с двумя обзорами и свежей датой — ${freshTwo.length}, порог ${GATE}.`);
  console.log(`Дальше по наряду идти нельзя, пока это не разобрано.`);
} else {
  console.log(`\nСтоп-кран не сработал: ${freshTwo.length} моделей с двумя обзорами при пороге ${GATE}.`);
}
