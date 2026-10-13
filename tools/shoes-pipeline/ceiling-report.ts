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

import { sitemapsFromRobots, walkSitemaps } from "./lib/sitemap";
import { SOURCES } from "./lib/sources";

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

type Row = { id: string; title: string; total: number; reviews: number; sample: string[] };
const rows: Row[] = [];

for (const source of SOURCES.filter((s) => s.kind === "review" && REVIEW_URL[s.id])) {
  const declared = await sitemapsFromRobots(source.id, source.origin);
  const roots = declared.length > 0 ? declared : [`${source.origin}/sitemap.xml`];
  const walk = await walkSitemaps(source.id, roots, { maxMaps: 25 });

  const isReview = REVIEW_URL[source.id];
  const reviews = walk.urls.filter((u) => {
    try {
      return isReview(new URL(u).pathname);
    } catch {
      return false;
    }
  });

  rows.push({
    id: source.id,
    title: source.title,
    total: walk.urls.length,
    reviews: reviews.length,
    sample: reviews.slice(0, 3),
  });
  console.log(`${source.title.padEnd(22)} адресов ${String(walk.urls.length).padStart(6)}, похожих на обзор модели ${String(reviews.length).padStart(5)}`);
  for (const s of reviews.slice(0, 2)) console.log(`    ${s}`);
}

writeFileSync(resolve(REPORTS, "ceiling.json"), JSON.stringify(rows, null, 2) + "\n");

const sum = rows.reduce((a, r) => a + r.reviews, 0);
console.log(`\n${"═".repeat(70)}`);
console.log(`Страниц обзоров суммарно по площадкам: ${sum}`);
console.log(
  `Это НЕ число моделей: одну модель обозревают несколько площадок, и пересечение\n` +
    `здесь не снято — для этого нужно сопоставить названия. Верхняя граница сверху.`
);
console.log(`\nОтчёт: ${resolve(REPORTS, "ceiling.json")}`);
