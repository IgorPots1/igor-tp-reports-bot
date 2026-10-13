import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { SOURCES, type SourceId } from "./sources";

/**
 * Модели и ссылки на обзоры — ТОЛЬКО из источников, прошедших гейт.
 *
 * Заменяет прежнюю карту «модель → ссылки» (lib/model-links.ts), собранную по
 * картам сайтов Doctors of Running, Believe in the Run и RTINGS: первые два
 * запретили автоматический доступ условиями, у третьего условия не читаются.
 * Источник тут — reports/coverage-allowed.json (coverage-allowed.ts), а он
 * обходит только источники со статусом allowed.
 */

export type AllowedLink = { source: SourceId; url: string; lastmod: string | null };
export type AllowedModel = { key: string; brandId: string; brand: string; model: string; links: AllowedLink[] };

/** Китайские бренды — для пилота нужна хотя бы одна китайская модель, если есть. */
export const CHINESE = new Set(["lining", "anta", "xtep", "361", "peak", "kailas", "bmai"]);

/**
 * Волны чтения (решение Игоря, 14.10.2026). Первая — источники, где обзоры
 * точно беговые и свежие; вторая — с отметкой «не беговая» / «до 2024» прямо
 * при чтении.
 */
export const WAVES: Record<number, SourceId[]> = {
  1: ["mountainrace", "kinash", "therunningchannel", "irishrunner", "activegearreview"],
  2: [
    "krossobzor",
    "trailandkale",
    "outdoorgearzine",
    "alexandrasports-blog",
    "4beg",
    "iancorless",
    "thebigoutside",
    "marathonec",
    "runflagstaff",
    "marathons",
    "impactmagazine",
    "sportmarafon-blog",
    "bps",
    "sportmail",
  ],
};

const COVERAGE = resolve("tools/shoes-pipeline/reports/coverage-allowed.json");

/** Бренды, которых нет в реестре источников (сайт бренда не источник). */
const EXTRA_BRANDS: Record<string, string> = {
  mounttocoast: "Mount to Coast",
  norda: "Norda",
  karhu: "Karhu",
  arcteryx: "Arc'teryx",
  tnf: "The North Face",
};
const brandTitle = (id: string) => SOURCES.find((s) => s.id === id)?.title ?? EXTRA_BRANDS[id] ?? id;

export function loadAllowedModels(sources?: SourceId[]): AllowedModel[] {
  if (!existsSync(COVERAGE)) {
    throw new Error("Нет reports/coverage-allowed.json. Сначала: npx tsx tools/shoes-pipeline/coverage-allowed.ts");
  }
  const raw = JSON.parse(readFileSync(COVERAGE, "utf8")) as {
    models: Record<string, AllowedLink[]>;
  };
  const only = sources ? new Set(sources) : null;
  const out: AllowedModel[] = [];
  for (const [k, hits] of Object.entries(raw.models)) {
    const links = hits.filter((h) => !only || only.has(h.source));
    if (links.length === 0) continue;
    const [brandId, model] = k.split(":");
    out.push({ key: `${brandId}-${model}`, brandId, brand: brandTitle(brandId), model, links });
  }
  return out;
}
