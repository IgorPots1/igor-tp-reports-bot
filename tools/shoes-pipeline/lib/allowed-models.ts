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

/**
 * Основные линейки — читаются первыми (решение Игоря, 14.10.2026), вместе с
 * их стартовыми версиями. Сравнение по словам слага модели, а не подстрокой:
 * «ride» как подстрока поймал бы «stride» и «hybrid».
 */
const PRIORITY_LINES = [
  "pegasus", "vomero", "novablast", "nimbus", "cumulus", "kayano", "gt-2000", "clifton", "bondi", "mach",
  "ride", "triumph", "endorphin", "1080", "880", "rebel", "ghost", "glycerin", "adrenaline", "boston",
  "adios-pro", "evo-sl", "supernova", "deviate", "velocity", "magnify", "cloudmonster", "wave-rider",
  "speedgoat", "peregrine", "cascadia",
  // стартовые версии этих линеек
  "alphafly", "vaporfly", "streakfly", "metaspeed", "sc-elite", "supercomp-elite", "rocket-x", "cielo-x",
  "hyperion", "nitro-elite", "fast-r", "pro-evo", "takumi",
];

export function isPriorityLine(model: string): boolean {
  const m = `-${model.toLowerCase().replace(/v(\d)/g, "-$1")}-`;
  return PRIORITY_LINES.some((line) => m.includes(`-${line}-`) || m.includes(`-${line.replace("-", "")}-`));
}

/**
 * Линейка и поколение из имени модели: «clifton-9» → clifton, 9;
 * «gel-nimbus-27» → gel-nimbus, 27; «1080v14» → 1080, 14; «pegasus-41-gore» →
 * pegasus, 41 (хвост после номера — исполнение, не линейка).
 */
export function lineAndVersion(model: string): { line: string; version: number } | null {
  const toks = model.toLowerCase().replace(/(\d)v(\d)/g, "$1-$2").replace(/v(\d+)\b/g, "$1").split(/[^a-z0-9]+/).filter(Boolean);
  for (let k = toks.length - 1; k > 0; k--) {
    if (/^\d{1,2}$/.test(toks[k])) {
      // Технологические приставки — не часть линейки: «gel-nimbus» и «nimbus»,
      // «fresh-foam-x-1080» и «1080» — одна линейка, иначе Nimbus 26 не видел 27.
      const line = toks
        .slice(0, k)
        .join("-")
        .replace(/^(gel|fresh-foam-x|fresh-foam|fuelcell|air-zoom|zoom|adizero|nitro)-/, "");
      return { line, version: Number(toks[k]) };
    }
  }
  return null;
}

/**
 * Есть ли в индексе более новое поколение той же линейки того же бренда
 * (решение Игоря, 14.10.2026): Clifton 9 при Clifton 10 или 11 в пачку не
 * ставится — читать старое поколение, когда в продаже новое, незачем.
 */
export function newerGeneration(m: AllowedModel, index: AllowedModel[]): string | null {
  const lv = lineAndVersion(m.model);
  if (!lv) return null;
  let best: { version: number; key: string } | null = null;
  for (const o of index) {
    if (o.brandId !== m.brandId) continue;
    const ov = lineAndVersion(o.model);
    if (!ov || ov.line !== lv.line || ov.version <= lv.version) continue;
    if (!best || ov.version > best.version) best = { version: ov.version, key: o.key };
  }
  return best ? best.key : null;
}
