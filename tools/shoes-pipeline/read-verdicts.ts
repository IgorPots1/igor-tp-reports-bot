/**
 * Вердикты чтением обзоров — сборка базы по наряду «версия 2», путь первый.
 *
 * Три шага, и только первый и третий — код:
 *
 *   queue   готовит задания: текст каждой страницы обзора, вырезанный из
 *           сохранённой копии, — ровно то, что увидит читатель и в чём потом
 *           будет искаться цитата;
 *   (чтение) модель по read/READER.md отвечает JSON-ом на каждую страницу —
 *           на подписке порциями или через API, это не код конвейера;
 *   settle  проверяет каждую цитату в сохранённой странице и сводит поля по
 *           правилам наряда. Проверку делает код, а не модель.
 *
 *   npx tsx tools/shoes-pipeline/read-verdicts.ts queue --limit 20 --chinese 5
 *   npx tsx tools/shoes-pipeline/read-verdicts.ts cost
 *   npx tsx tools/shoes-pipeline/read-verdicts.ts settle
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { fetchPage } from "./lib/fetch";
import { buildLinks, pickTargets, type Candidate } from "./lib/model-links";
import type { SourceId } from "./lib/sources";
import { mentionsWinter, plainText, publishedFrom, reviewBody } from "./lib/verdict-extract";
import {
  FEEL_ORDINAL,
  FIRMNESS_ORDINAL,
  settleField,
  thesisDuplicates,
  vetAnswer,
  type Obs,
  type ReaderAnswer,
  type Rejected,
} from "./lib/verdict-read";
import {
  EMPTY_VERDICTS,
  TWO_SOURCE_FIELDS,
  type Evidence,
  type Purpose,
  type VerdictRecord,
  type Verdicts,
} from "./lib/verdict-types";

const args = process.argv.slice(2);
const cmd = args[0];
const num = (flag: string, dflt: number) => {
  const i = args.indexOf(flag);
  return i > -1 ? Number(args[i + 1]) : dflt;
};

const REPORTS = resolve("tools/shoes-pipeline/reports");
const READ_DIR = resolve("tools/shoes-pipeline/.cache/read");
const QUEUE_PATH = resolve(READ_DIR, "queue.json");
mkdirSync(READ_DIR, { recursive: true });
mkdirSync(REPORTS, { recursive: true });

/**
 * Каталог — модели 2024 года и новее плюс 2023-й, если он ещё в продаже
 * (решение Игоря). Наличие в продаже проверяется контуром цен, а он отложен,
 * поэтому 2023-й пока проходит с пометкой в отчёте, а не отсеивается молча.
 */
const MIN_YEAR = 2023;

type Page = { source: SourceId; url: string; date: string | null; chars: number };
type Task = { key: string; brand: string; model: string; chinese: boolean; pages: Page[] };

const dirFor = (key: string) => resolve(READ_DIR, key.replace(/[^a-z0-9._-]/gi, "_"));
export const textPath = (key: string, source: string) => resolve(dirFor(key), `${source}.txt`);
export const answerPath = (key: string, source: string) => resolve(dirFor(key), `${source}.answer.json`);

/** Текст обзора из сохранённой страницы. Один и тот же для читателя и для проверки. */
async function pageText(source: SourceId, url: string): Promise<{ text: string; date: string | null } | null> {
  const r = await fetchPage(source, url);
  if (!r.ok) return null;
  return { text: reviewBody(plainText(r.body)), date: publishedFrom(r.body) };
}

/* ---------------------------------- queue ---------------------------------- */

async function queue() {
  const candidates = await buildLinks();
  const { multi, chineseSingles, targets } = pickTargets(candidates, num("--limit", 20), num("--chinese", 0));
  console.log(`Моделей с двумя и более обзорами: ${multi.length}; китайских с одним: ${chineseSingles.length}`);
  const tasks: Task[] = [];
  const tooOld: { key: string; newestReview: string }[] = [];
  for (const c of targets) {
    const pages: Page[] = [];
    for (const l of c.links) {
      const t = await pageText(l.source, l.url);
      if (!t) continue;
      mkdirSync(dirFor(c.key), { recursive: true });
      // По предложению на строку: длинная строка обрезается инструментом чтения,
      // и читатель не увидел бы часть обзора. Проверка цитаты схлопывает пробелы,
      // так что перенос строки на неё не влияет.
      writeFileSync(textPath(c.key, l.source), t.text.replace(/([.!?])\s+(?=[A-Z0-9"'(])/g, "$1\n"));
      pages.push({ source: l.source, url: l.url, date: t.date, chars: t.text.length });
    }
    const chinese = chineseSingles.includes(c);
    // Фильтр года — до чтения: дата публикации есть в разметке страницы, и
    // модель, о которой последний обзор вышел до 2023 года, читать незачем —
    // в базу она не попадёт, а чтение стоит денег.
    const newest = pages.map((p) => p.date).filter((d): d is string => Boolean(d)).sort().pop();
    if (newest && Number(newest.slice(0, 4)) < MIN_YEAR) {
      tooOld.push({ key: c.key, newestReview: newest });
      console.log(`  ${c.key}: последний обзор ${newest} — старше ${MIN_YEAR}, не читаем`);
      continue;
    }
    tasks.push({ key: c.key, brand: c.brand, model: c.model, chinese, pages });
    console.log(`  ${c.key}: страниц ${pages.length}, знаков ${pages.reduce((s, p) => s + p.chars, 0)}`);
  }
  writeFileSync(QUEUE_PATH, JSON.stringify(tasks, null, 2) + "\n");
  writeFileSync(resolve(REPORTS, "verdict-too-old.json"), JSON.stringify(tooOld, null, 2) + "\n");
  console.log(`Отсеяно по году (обзоры до ${MIN_YEAR}): ${tooOld.length}`);
  console.log(`\nЗаданий: ${tasks.length}, страниц: ${tasks.reduce((s, t) => s + t.pages.length, 0)}`);
  console.log(`Очередь: ${QUEUE_PATH}`);
}

/* ---------------------------------- cost ----------------------------------- */

/**
 * Смета на весь каталог. Размер страниц, которые уже скачаны, — фактический;
 * для остальных — средний по той же площадке из скачанных. Перекачивать 800
 * страниц ради сметы — лишняя нагрузка на чужие сайты.
 */
async function cost() {
  const candidates = await buildLinks();
  const { multi, chineseSingles } = pickTargets(candidates, 0, 0);
  const all = [...multi, ...chineseSingles];
  const sizes = new Map<string, number[]>();
  const tasks: Task[] = existsSync(QUEUE_PATH) ? JSON.parse(readFileSync(QUEUE_PATH, "utf8")) : [];
  for (const t of tasks) for (const p of t.pages) sizes.set(p.source, [...(sizes.get(p.source) ?? []), p.chars]);
  const avg = (s: string) => {
    const v = sizes.get(s) ?? [];
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN;
  };
  let pages = 0;
  let chars = 0;
  for (const c of all as Candidate[]) {
    for (const l of c.links) {
      pages++;
      chars += avg(l.source);
    }
  }
  const instructions = readFileSync(resolve("tools/shoes-pipeline/read/READER.md"), "utf8").length;
  console.log(JSON.stringify({ models: all.length, pages, reviewChars: Math.round(chars), instructionChars: instructions,
    perSourceAvgChars: Object.fromEntries([...sizes.keys()].map((s) => [s, Math.round(avg(s))])),
    sampledPages: [...sizes.values()].reduce((a, v) => a + v.length, 0) }, null, 2));
}

/* --------------------------------- settle ---------------------------------- */

/**
 * Имена других моделей каталога — для отсева цитат-сравнений.
 *
 * Первая версия брала первое слово названия из карты ссылок без учёта
 * регистра — и выбросила 281 честную цитату: в карте есть мусорные «модели»
 * на shoe-, heel-, running-, а «shoe» стоит почти в каждой фразе обзора.
 * Теперь имя — это первое слово названия модели, у которой есть ДВА источника
 * (настоящая модель, а не обрывок адреса), оно не бренд и не обычное английское
 * слово (системный словарь), и в цитате ищется С ЗАГЛАВНОЙ буквы: «Clifton»,
 * «Pegasus», «Novablast». Ghost и Rincon из-за этого не ловятся по имени — их
 * держит отсев сравнительных оборотов.
 */
const DICT_PATH = "/usr/share/dict/words";
const ENGLISH: Set<string> = existsSync(DICT_PATH)
  ? new Set(readFileSync(DICT_PATH, "utf8").split("\n").filter((w) => /^[a-z]+$/.test(w)))
  : new Set();
function modelNames(candidates: Candidate[]): string[] {
  const brands = new Set(
    candidates.flatMap((c) => [c.brandId ?? "", ...c.brand.toLowerCase().split(/\s+/)]).filter(Boolean)
  );
  const names = new Set<string>();
  for (const c of candidates) {
    if (new Set(c.links.map((l) => l.source)).size < 2) continue;
    const first = c.model.split("-")[0].toLowerCase();
    if (first.length < 4 || !/^[a-z]+$/.test(first) || brands.has(first) || ENGLISH.has(first)) continue;
    names.add(first[0].toUpperCase() + first.slice(1));
  }
  return [...names];
}

type ModelReport = {
  key: string;
  fields: Record<string, string>;
  rejected: (Rejected & { source: string })[];
};

async function settle() {
  const candidates = await buildLinks();
  const names = modelNames(candidates);
  const tasks: Task[] = JSON.parse(readFileSync(QUEUE_PATH, "utf8"));
  const decisionsPath = resolve(REPORTS, "verdict-decisions.json");
  const decisions: { id: string; field: keyof Verdicts; value: unknown }[] = existsSync(decisionsPath)
    ? JSON.parse(readFileSync(decisionsPath, "utf8"))
    : [];

  const records: VerdictRecord[] = [];
  const forIgor: { id: string; field: string; votes: { source: string; value: unknown; quote: string; url: string }[] }[] = [];
  const reports: ModelReport[] = [];
  const tally: Record<string, Record<string, number>> = {};
  const count = (field: string, kind: string) => {
    tally[field] ??= {};
    tally[field][kind] = (tally[field][kind] ?? 0) + 1;
  };
  let unread = 0;
  const yearNotes: string[] = [];

  for (const t of tasks) {
    const own = t.model.split("-")[0].toLowerCase();
    const others = names.filter((n) => n.toLowerCase() !== own);
    const version = t.model.match(/-v?(\d+)(?:-|$)/)?.[1];
    const ownName = { name: own, version: version ? Number(version) : null };
    const accepted: (Obs<unknown> & { field: string })[] = [];
    const rejected: ModelReport["rejected"] = [];
    const bodies: string[] = [];
    const readSources = new Set<string>();

    for (const p of t.pages) {
      if (!existsSync(answerPath(t.key, p.source))) {
        unread++;
        continue;
      }
      const answer = JSON.parse(readFileSync(answerPath(t.key, p.source), "utf8")) as ReaderAnswer;
      // Проверка — по сохранённой странице, заново вырезанной из кэша, а не по
      // файлу, который видел читатель: доказательство это страница, а не наша копия.
      const page = await pageText(p.source, p.url);
      if (!page) continue;
      bodies.push(page.text);
      const v = vetAnswer(answer, page.text, others, ownName);
      rejected.push(...v.rejected.map((r) => ({ ...r, source: p.source })));
      if (answer.about_model) readSources.add(p.source);
      for (const a of v.accepted) {
        accepted.push({ field: a.field, value: a.value, quote: a.quote, source: p.source, url: p.url, date: p.date });
      }
    }

    const verdicts: Verdicts = { ...EMPTY_VERDICTS, purpose: [], best_for: [], not_for: [] };
    const evidence: Evidence[] = [];
    const disputed: string[] = [];
    const fields: Record<string, string> = {};
    const allowSingle = t.chinese;
    const of = (f: string) => accepted.filter((a) => a.field === f);
    const ev = (field: keyof Verdicts, o: Obs<unknown>) =>
      evidence.push({ field, url: o.url, source: o.source, date: o.date, quote: o.quote });

    const one = (field: keyof Verdicts, ordinal: { order: unknown[]; center: number } | null) => {
      const s = settleField(of(field), allowSingle, ordinal);
      count(field, s.kind === "agreed" && s.merged ? "agreed_adjacent" : s.kind);
      fields[field] = s.kind;
      if (s.kind === "agreed") {
        s.obs.forEach((o) => ev(field, o));
        return s.value;
      }
      if (s.kind === "disputed") {
        disputed.push(field);
        forIgor.push({
          id: t.key,
          field,
          votes: s.obs.map((o) => ({ source: o.source, value: o.value, quote: o.quote, url: o.url })),
        });
      }
      return null;
    };

    verdicts.feel = one("feel", FEEL_ORDINAL) as Verdicts["feel"];
    verdicts.firmness = one("firmness", FIRMNESS_ORDINAL) as Verdicts["firmness"];
    verdicts.width = one("width", null) as Verdicts["width"];
    verdicts.durability = one("durability", null) as Verdicts["durability"];
    verdicts.heel_hold = one("heel_hold", null) as Verdicts["heel_hold"];

    // Назначение объединяется, а не сверяется: площадки смотрят на модель с
    // разных сторон. Но каждое назначение — со своей проверенной цитатой.
    const purposes = new Set<Purpose>();
    for (const o of of("purpose")) {
      if (!purposes.has(o.value as Purpose)) ev("purpose", o);
      purposes.add(o.value as Purpose);
    }
    verdicts.purpose = [...purposes];

    // Зима — только для трейла/зимы или при явном снеге, льде, зиме в обзоре.
    const winterRelevant =
      purposes.has("trail") || purposes.has("winter") || bodies.some((b) => mentionsWinter(b));
    if (winterRelevant) verdicts.winter_grip = one("winter_grip", null) as Verdicts["winter_grip"];
    else {
      fields.winter_grip = of("winter_grip").length ? "not_relevant" : "empty";
      count("winter_grip", fields.winter_grip);
    }

    // Тезисы — из словаря, по одному на тему, без дублей с полями. Не больше 4.
    for (const field of ["best_for", "not_for"] as const) {
      for (const o of of(field)) {
        const thesis = o.value as string;
        if (verdicts[field].includes(thesis) || thesisDuplicates(thesis, verdicts)) continue;
        if (verdicts[field].length >= 4) break;
        verdicts[field].push(thesis);
        ev(field, o);
      }
    }

    // Год: явное заявление в тексте обзора прямее даты публикации.
    const dates = t.pages.map((p) => p.date).filter((d): d is string => Boolean(d)).sort();
    const dateYear = dates.length ? Number(dates[0].slice(0, 4)) : null;
    const stated = of("release")[0];
    let year = dateYear;
    let year_source: VerdictRecord["year_source"] = dateYear !== null ? "review_date" : null;
    let year_conflict: string | null = null;
    if (stated) {
      year = stated.value as number;
      year_source = "review_text";
      if (dateYear !== null && dateYear !== year) {
        year_conflict = `обзор вышел в ${dateYear}, в тексте указан ${year}: «${stated.quote.slice(0, 90)}»`;
      }
    }

    // Второй рубеж: год из текста обзора тоже может оказаться старым.
    if (year !== null && year < MIN_YEAR) {
      console.log(`  ${t.brand} ${t.model} — год ${year}, старше ${MIN_YEAR}: в базу не идёт`);
      continue;
    }
    if (year === 2023) yearNotes.push(`${t.key}: 2023 — в продаже ли, проверит контур цен`);

    // Решения Игоря по спорным полям.
    const decided_by: VerdictRecord["decided_by"] = {};
    for (const d of decisions.filter((x) => x.id === t.key)) {
      (verdicts as Record<string, unknown>)[d.field] = d.value;
      decided_by[d.field] = "igor";
      const i = disputed.indexOf(d.field);
      if (i > -1) disputed.splice(i, 1);
    }

    records.push({
      id: t.key,
      brand: t.brand,
      model: t.model,
      year,
      year_source,
      year_conflict,
      verdicts,
      evidence,
      confidence: t.chinese ? "low" : "normal",
      disputed,
      decided_by,
    });
    reports.push({ key: t.key, fields, rejected });
    const filled = TWO_SOURCE_FIELDS.filter((f) => verdicts[f] !== null).length;
    console.log(
      `  ${t.brand} ${t.model} — прочитано ${readSources.size}/${t.pages.length}, полей ${filled}/${TWO_SOURCE_FIELDS.length}` +
        `${disputed.length ? `, спор: ${disputed.join(", ")}` : ""}, отброшено цитат ${rejected.length}`
    );
  }

  writeFileSync(resolve(REPORTS, "verdicts.json"), JSON.stringify(records, null, 2) + "\n");
  writeFileSync(resolve(REPORTS, "verdict-for-igor.json"), JSON.stringify(forIgor, null, 2) + "\n");
  writeFileSync(
    resolve(REPORTS, "verdict-read-report.json"),
    JSON.stringify({ tally, models: reports, yearNotes }, null, 2) + "\n"
  );

  console.log(`\n${"═".repeat(70)}`);
  console.log(`Записей: ${records.length}; страниц без ответа: ${unread}; спорных полей Игорю: ${forIgor.length}`);
  console.log("Сводка по полям (agreed — согласие, agreed_adjacent — соседние деления, медиана):");
  for (const [f, k] of Object.entries(tally)) console.log(`  ${f.padEnd(12)} ${JSON.stringify(k)}`);
  const why: Record<string, number> = {};
  for (const r of reports) for (const x of r.rejected) why[x.reason.split(":")[0]] = (why[x.reason.split(":")[0]] ?? 0) + 1;
  console.log(`Отброшено цитат: ${JSON.stringify(why)}`);
}

if (cmd === "queue") await queue();
else if (cmd === "cost") await cost();
else if (cmd === "settle") await settle();
else {
  console.error("Команда: queue | cost | settle");
  process.exit(1);
}
