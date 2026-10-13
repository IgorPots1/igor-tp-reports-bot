import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { looksLikeShoe, parseReviewUrl } from "./review-url";
import { sitemapsFromRobots, walkSitemaps } from "./sitemap";
import { SOURCES, type SourceId } from "./sources";

/**
 * Карта «модель → ссылки на обзоры» по картам сайтов открытых обзорных
 * площадок. Вынесена из прежнего разборщика по ключевым словам, когда тот был
 * снят: карта нужна и чтению моделью.
 */

const REPORTS = resolve("tools/shoes-pipeline/reports");

/** Китайские бренды: им разрешён один обзор с пометкой confidence low. */
export const CHINESE = new Set(["lining", "anta", "xtep", "361", "peak", "kailas", "bmai"]);

const REVIEW_URL: Record<string, (p: string) => boolean> = {
  rtings: (p) => /^\/running-shoes\/reviews\/[^/]+\/[^/]+$/.test(p) && !p.includes("/reviews/best/"),
  doctorsofrunning: (p) => {
    const s = p.split("/").filter(Boolean);
    return s.length >= 1 && /review/i.test(s[s.length - 1]) && s[s.length - 1].length > 12;
  },
  believeintherun: (p) => {
    const s = p.split("/").filter(Boolean);
    if (s.length < 2) return false;
    if (/^(videos|podcasts|category|tag|author|page)$/i.test(s[0])) return false;
    return /review/i.test(s[s.length - 1]) && s[s.length - 1].length > 12;
  },
};

/* --------------------- Карта «модель → ссылки на обзоры» --------------------- */

export type Link = { source: SourceId; url: string };
export type Candidate = { key: string; brandId: string | null; brand: string; model: string; links: Link[] };

const LINKS_PATH = resolve(REPORTS, "model-links.json");

export async function buildLinks(): Promise<Candidate[]> {
  if (existsSync(LINKS_PATH)) {
    // Кэш проверяется на ФОРМУ, а не на существование. Файл от другого шага
    // (временного зонда) был объектом вместо массива и ронял прогон на первой
    // же строке разбора. Чужая форма — повод пересобрать, а не упасть.
    try {
      const raw = JSON.parse(readFileSync(LINKS_PATH, "utf8"));
      if (Array.isArray(raw) && raw.every((x) => x && Array.isArray(x.links))) {
        return raw as Candidate[];
      }
      console.log("  (кэш ссылок не той формы — пересобираю)");
    } catch {
      console.log("  (кэш ссылок не читается — пересобираю)");
    }
  }
  const byModel = new Map<string, Candidate>();
  for (const src of SOURCES.filter((s) => s.kind === "review" && REVIEW_URL[s.id])) {
    const declared = await sitemapsFromRobots(src.id, src.origin);
    const walk = await walkSitemaps(src.id, declared.length ? declared : [`${src.origin}/sitemap.xml`], {
      maxMaps: 25,
    });
    for (const e of walk.entries) {
      let path: string;
      try {
        path = new URL(e.url).pathname;
      } catch {
        continue;
      }
      if (!REVIEW_URL[src.id](path)) continue;
      const p = parseReviewUrl(src.id, e.url, e.lastmod);
      if (!p || !looksLikeShoe(`${p.model} ${p.brandTitle ?? ""}`)) continue;
      const c =
        byModel.get(p.key) ??
        ({ key: p.key, brandId: p.brandId, brand: p.brandTitle ?? "?", model: p.model, links: [] } as Candidate);
      if (!c.links.some((l) => l.url === e.url)) c.links.push({ source: src.id, url: e.url });
      byModel.set(p.key, c);
    }
  }
  mkdirSync(REPORTS, { recursive: true });
  const list = [...byModel.values()];
  writeFileSync(LINKS_PATH, JSON.stringify(list, null, 2) + "\n");
  return list;
}


/**
 * Модели в разбор. Китайские с одним обзором добавляются ПОВЕРХ лимита, а не
 * вытесняют модели из него: проверочный прогон обязан повторить те же самые
 * модели, иначе сравнивать не с чем.
 */
export function pickTargets(candidates: Candidate[], limit: number, extraChinese: number) {
  const multi = candidates.filter((c) => new Set(c.links.map((l) => l.source)).size >= 2);
  const chineseSingles = candidates.filter(
    (c) => c.brandId && CHINESE.has(c.brandId) && new Set(c.links.map((l) => l.source)).size === 1
  );
  const targets = [...[...multi, ...chineseSingles].slice(0, limit), ...chineseSingles.slice(0, extraChinese)];
  return { multi, chineseSingles, targets };
}
