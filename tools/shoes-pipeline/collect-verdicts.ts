/**
 * Разбор моделей в вердикты — ядро базы по наряду «версия 2».
 *
 * Читает обзоры, сводит их в качественные вердикты и складывает доказательства:
 * ссылка, источник, дата, цитата. Вердикт без двух источников не ставится, а
 * расхождение между обзорами уходит в отчёт и НЕ усредняется: если один назвал
 * модель мягкой, а второй плотной, среднее дало бы оценку, которой не говорил
 * никто.
 *
 *   npx tsx tools/shoes-pipeline/collect-verdicts.ts --limit 20
 *   npx tsx tools/shoes-pipeline/collect-verdicts.ts --limit 3 --show
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { fetchPage } from "./lib/fetch";
import { looksLikeShoe, parseReviewUrl } from "./lib/review-url";
import { sitemapsFromRobots, walkSitemaps } from "./lib/sitemap";
import { SOURCES, type SourceId } from "./lib/sources";
import { thesesFrom } from "./lib/theses";
import {
  durabilityFrom,
  feelFrom,
  firmnessFrom,
  heelHoldFrom,
  plainText,
  prosConsFrom,
  mentionsWinter,
  publishedFrom,
  purposeFrom,
  releaseYearFrom,
  summaryFrom,
  widthFrom,
  winterGripFrom,
  type Extracted,
} from "./lib/verdict-extract";
import {
  EMPTY_VERDICTS,
  TWO_SOURCE_FIELDS,
  type Evidence,
  type VerdictRecord,
  type Verdicts,
} from "./lib/verdict-types";

const args = process.argv.slice(2);
const limitArg = args.indexOf("--limit");
const LIMIT = limitArg > -1 ? Number(args[limitArg + 1]) : 20;
const SHOW = args.includes("--show");
const chArg = args.indexOf("--chinese");
const EXTRA_CHINESE = chArg > -1 ? Number(args[chArg + 1]) : 0;

const REPORTS = resolve("tools/shoes-pipeline/reports");
mkdirSync(REPORTS, { recursive: true });

/** Китайские бренды: им разрешён один обзор с пометкой confidence low. */
const CHINESE = new Set(["lining", "anta", "xtep", "361", "peak", "kailas", "bmai"]);

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

type Link = { source: SourceId; url: string };
type Candidate = { key: string; brandId: string | null; brand: string; model: string; links: Link[] };

const LINKS_PATH = resolve(REPORTS, "model-links.json");

async function buildLinks(): Promise<Candidate[]> {
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
  const list = [...byModel.values()];
  writeFileSync(LINKS_PATH, JSON.stringify(list, null, 2) + "\n");
  return list;
}

/* ------------------------------- Сведение полей ------------------------------ */

type Observed<T> = { value: T; quote: string; source: string; url: string; date: string | null };

/**
 * Сводит наблюдения по одному полю.
 *
 * Согласие двух и более источников — вердикт принят. Разные значения —
 * расхождение, поле остаётся пустым и уходит в отчёт человеку. Молча взять
 * частое или первое нельзя: обзоры субъективны, и расхождение между ними это
 * информация, а не шум.
 */
function settle<T>(
  obs: Observed<T>[],
  allowSingle: boolean
): { value: T | null; evidence: Observed<T>[]; disputed: boolean; single: boolean } {
  if (obs.length === 0) return { value: null, evidence: [], disputed: false, single: false };
  const groups = new Map<string, Observed<T>[]>();
  for (const o of obs) {
    const k = JSON.stringify(o.value);
    groups.set(k, [...(groups.get(k) ?? []), o]);
  }
  if (groups.size === 1) {
    const only = [...groups.values()][0];
    /**
     * ДВА ИСТОЧНИКА, А НЕ ДВА НАБЛЮДЕНИЯ. Прежняя версия принимала вердикт,
     * если все наблюдения согласны, — в том числе когда наблюдение одно. Так
     * поле от единственного обзора проходило в базу под видом подтверждённого,
     * и правило «вердикт без двух ссылок не попадает» не выполнялось вовсе.
     * Исключение — модели с confidence low (китайские с одним обзором): там
     * один источник это заявленное состояние, а не тихое нарушение.
     */
    const sources = new Set(only.map((o) => o.source)).size;
    if (sources < 2 && !allowSingle) {
      return { value: null, evidence: only, disputed: false, single: true };
    }
    return { value: only[0].value, evidence: only, disputed: false, single: false };
  }
  return { value: null, evidence: obs, disputed: true, single: false };
}

/* --------------------------------- Разбор ---------------------------------- */

const candidates = await buildLinks();
const multi = candidates.filter((c) => new Set(c.links.map((l) => l.source)).size >= 2);
const chineseSingles = candidates.filter(
  (c) => c.brandId && CHINESE.has(c.brandId) && new Set(c.links.map((l) => l.source)).size === 1
);
console.log(`Моделей с двумя и более обзорами: ${multi.length}`);
console.log(`Китайских с одним обзором (идут с confidence low): ${chineseSingles.length}`);

// Китайские добавляются ПОВЕРХ лимита, а не вытесняют модели из него: проверочный
// прогон обязан повторить те же самые модели, иначе сравнивать не с чем.
const targets = [
  ...[...multi, ...chineseSingles].slice(0, LIMIT),
  ...chineseSingles.slice(0, EXTRA_CHINESE),
];
console.log(`Берём в разбор: ${targets.length}\n`);

const records: VerdictRecord[] = [];
const disputes: string[] = [];
const singles: string[] = [];
const unmappedAll: string[] = [];
const yearConflicts: string[] = [];

for (const [i, c] of targets.entries()) {
  const texts: { source: string; url: string; text: string; date: string | null }[] = [];
  for (const l of c.links) {
    const r = await fetchPage(l.source, l.url);
    if (!r.ok) continue;
    texts.push({ source: l.source, url: l.url, text: plainText(r.body), date: publishedFrom(r.body) });
  }
  if (texts.length === 0) {
    console.log(`  [${i + 1}/${targets.length}] ✗ ${c.key} — ни одна страница не открылась`);
    continue;
  }

  const verdicts: Verdicts = { ...EMPTY_VERDICTS, purpose: [], best_for: [], not_for: [] };
  const evidence: Evidence[] = [];
  const disputed: string[] = [];
  const sourceCount = new Set(texts.map((t) => t.source)).size;
  const allowSingle = sourceCount < 2;

  const run = <T>(field: keyof Verdicts, fn: (t: string, s: string) => Extracted<T>) => {
    const obs: Observed<T>[] = [];
    for (const t of texts) {
      const got = fn(t.text, t.source);
      if (got) obs.push({ value: got.value, quote: got.quote, source: t.source, url: t.url, date: t.date });
    }
    const s = settle(obs, allowSingle);
    if (s.single) {
      singles.push(`${c.key}.${field}: только ${s.evidence[0].source}`);
      return null;
    }
    if (s.disputed) {
      disputed.push(field);
      disputes.push(
        `${c.key}.${field}: ${s.evidence.map((e) => `${e.source}=${JSON.stringify(e.value)}`).join(" против ")}`
      );
      return null;
    }
    for (const e of s.evidence) {
      evidence.push({ field, url: e.url, source: e.source, date: e.date, quote: e.quote.slice(0, 200) });
    }
    return s.value;
  };

  verdicts.feel = run("feel", (t) => feelFrom(t));
  verdicts.firmness = run("firmness", (t) => firmnessFrom(t));
  verdicts.width = run("width", (t) => widthFrom(t));
  verdicts.durability = run("durability", (t, s) => durabilityFrom(t, s));
  verdicts.heel_hold = run("heel_hold", (t) => heelHoldFrom(t));
  // winter_grip решается ПОСЛЕ назначения: ниже, когда purpose уже известен.

  // Сводка — одна фраза из обзора, а не сочинённая: в базе не должно быть слов,
  // которых не говорил ни один источник.
  for (const t of texts) {
    const sm = summaryFrom(t.text, t.source);
    if (sm && !verdicts.summary) {
      verdicts.summary = sm.value;
      evidence.push({ field: "summary", url: t.url, source: t.source, date: t.date, quote: sm.quote.slice(0, 200) });
      break;
    }
  }

  // Назначение объединяется, а не сверяется: площадки смотрят на модель с
  // разных сторон, и «ещё одно назначение» — это дополнение, а не спор.
  const purposes = new Set<string>();
  for (const t of texts) {
    const p = purposeFrom(t.text, t.source);
    if (!p) continue;
    p.value.forEach((x) => purposes.add(x));
    evidence.push({ field: "purpose", url: t.url, source: t.source, date: t.date, quote: p.quote.slice(0, 200) });
  }
  verdicts.purpose = [...purposes] as Verdicts["purpose"];

  /**
   * Зимнее сцепление — только для трейла и зимы или при явном упоминании
   * снега, льда, зимы в обзоре. У Clifton 11 стоял «good» по фразе «traction
   * has been great on both wet and dry roads»: мокрый асфальт — не наледь, и
   * зимний вердикт дорожной модели был советом, которого не давал ни один обзор.
   */
  const winterRelevant =
    verdicts.purpose.includes("trail") ||
    verdicts.purpose.includes("winter") ||
    texts.some((t) => mentionsWinter(t.text));
  verdicts.winter_grip = winterRelevant ? run("winter_grip", (t) => winterGripFrom(t)) : null;

  // Плюсы и минусы обзоров не копируются: они переводятся в тезисы из словаря
  // своими словами. Исходная фраза остаётся только в evidence.
  const prosAll: { phrase: string; t: (typeof texts)[number] }[] = [];
  const consAll: { phrase: string; t: (typeof texts)[number] }[] = [];
  for (const t of texts) {
    const { pros, cons } = prosConsFrom(t.text, t.source);
    pros.forEach((phrase) => prosAll.push({ phrase, t }));
    cons.forEach((phrase) => consAll.push({ phrase, t }));
  }
  const th = thesesFrom(
    prosAll.map((x) => x.phrase),
    consAll.map((x) => x.phrase),
    verdicts
  );
  unmappedAll.push(...th.unmapped.map((u) => `${c.key}: ${u}`));
  const origin = (phrase: string, list: typeof prosAll) => list.find((x) => x.phrase === phrase)?.t;
  for (const b of th.best_for) {
    verdicts.best_for.push(b.text);
    const t = origin(b.from, prosAll);
    if (t) evidence.push({ field: "best_for", url: t.url, source: t.source, date: t.date, quote: b.from.slice(0, 200) });
  }
  for (const n of th.not_for) {
    verdicts.not_for.push(n.text);
    const t = origin(n.from, consAll);
    if (t) evidence.push({ field: "not_for", url: t.url, source: t.source, date: t.date, quote: n.from.slice(0, 200) });
  }

  // Год: самая ранняя дата публикации обзора. На этапе разбора сверяется с
  // сайтом бренда — пока это вход, а не окончательное значение.
  /**
   * Год — два сигнала из обзоров. Страница бренда тут не помогает: у Saucony
   * на странице модели структурного поля года нет, а в тексте вперемешку 2024,
   * 2025 и 2026 из подвала и соседних товаров; у HOKA страница товара не
   * открылась вовсе. Год по случайной цифре со страницы был бы догадкой.
   *
   * Явное «available July 2025» в тексте прямее даты публикации — обзор могут
   * выпустить через полгода после выхода, — поэтому при наличии берётся оно.
   * Расхождение двух сигналов уходит в отчёт.
   */
  const dates = texts.map((t) => t.date).filter((d): d is string => Boolean(d)).sort();
  const dateYear = dates.length > 0 ? Number(dates[0].slice(0, 4)) : null;
  const stated = texts.map((t) => releaseYearFrom(t.text)).find((x) => x !== null) ?? null;
  let year: number | null = dateYear;
  let year_source: VerdictRecord["year_source"] = dateYear !== null ? "review_date" : null;
  let year_conflict: string | null = null;
  if (stated) {
    year = stated.value;
    year_source = "review_text";
    if (dateYear !== null && dateYear !== stated.value) {
      year_conflict = `обзор вышел в ${dateYear}, в тексте указан ${stated.value}: «${stated.quote.slice(0, 90)}»`;
      yearConflicts.push(`${c.key}: ${year_conflict}`);
    }
  }
  records.push({
    id: c.key,
    brand: c.brand,
    model: c.model,
    year,
    year_source,
    year_conflict,
    verdicts,
    evidence,
    confidence: sourceCount >= 2 ? "normal" : "low",
    disputed,
  });

  const filled = TWO_SOURCE_FIELDS.filter((f) => verdicts[f] !== null).length;
  console.log(
    `  [${i + 1}/${targets.length}] ${c.brand} ${c.model} — источников ${sourceCount}, полей ${filled}/${TWO_SOURCE_FIELDS.length}${disputed.length ? `, спорных ${disputed.length}` : ""}`
  );
}

writeFileSync(resolve(REPORTS, "verdicts.json"), JSON.stringify(records, null, 2) + "\n");
writeFileSync(resolve(REPORTS, "verdict-disputes.json"), JSON.stringify(disputes, null, 2) + "\n");
writeFileSync(
  resolve(REPORTS, "verdict-gaps.json"),
  JSON.stringify({ singleSource: singles, unmappedPhrases: unmappedAll, yearConflicts }, null, 2) + "\n"
);

console.log(`\n${"═".repeat(70)}`);
console.log(`Записей: ${records.length}, расхождений в отчёт: ${disputes.length}`);
console.log(`Полей отклонено как одиночные: ${singles.length}`);
console.log(`Фраз без темы в словаре: ${unmappedAll.length}`);
console.log(`Расхождений по году: ${yearConflicts.length}`);
if (SHOW) {
  for (const r of records.slice(0, 3)) {
    console.log(`\n${"─".repeat(70)}\n${JSON.stringify(r, null, 2)}`);
  }
}
console.log(`\nОтчёты: ${REPORTS}`);
