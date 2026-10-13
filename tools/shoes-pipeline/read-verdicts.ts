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
 *   verify-pack  собирает прошедшие проверку кодом цитаты в пакет на
 *           смысловую проверку; (проверка) отдельный короткий вызов по
 *           read/VERIFIER.md отвечает, подтверждает ли цитата значение;
 *   settle  проверяет каждую цитату в сохранённой странице и сводит поля по
 *           правилам наряда. Проверку делает код, а не модель.
 *
 * Читаются ТОЛЬКО источники, прошедшие гейт (lib/allowed-models.ts), по волнам.
 * Результат — черновики тренерского каталога (status: "draft"), не подбор:
 * подтверждает Игорь.
 *
 *   npx tsx tools/shoes-pipeline/read-verdicts.ts queue --wave 1 --limit 20
 *   npx tsx tools/shoes-pipeline/read-verdicts.ts verify-pack
 *   npx tsx tools/shoes-pipeline/read-verdicts.ts settle
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { fetchPage } from "./lib/fetch";
import { CHINESE, WAVES, loadAllowedModels, type AllowedModel } from "./lib/allowed-models";
import { SOURCES, type SourceId } from "./lib/sources";
import { OPPOSITE, THESIS_FIELD } from "./lib/theses";
import { mentionsWinter, plainText, publishedFrom, reviewBody } from "./lib/verdict-extract";
import {
  FEEL_ORDINAL,
  FIRMNESS_ORDINAL,
  gateBySense,
  settleField,
  thesisDuplicates,
  vetAnswer,
  type Obs,
  type ReaderAnswer,
  type Rejected,
  type SenseVerdict,
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
/**
 * Отдельный каталог для чтения разрешённых источников. В прежнем .cache/read
 * лежат тексты и ответы по Doctors of Running и Believe in the Run (удаление —
 * за Игорем); в общих папках моделей их старые смысловые проверки смешались бы
 * с новыми, и settle принял бы чужую проверку за свою.
 */
const READ_DIR = resolve("tools/shoes-pipeline/.cache/read-allowed");
const QUEUE_PATH = resolve(READ_DIR, "queue.json");
mkdirSync(READ_DIR, { recursive: true });
mkdirSync(REPORTS, { recursive: true });

/**
 * Черновики — модели 2024 года и новее (решение Игоря, 14.10.2026: «до 2024»
 * в черновики не идут). Обзор старше — модель отмечается и не читается.
 */
const MIN_YEAR = 2024;

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

/** Название площадки для блока «на чём основано». */
const titleOf = (id: string) => SOURCES.find((s) => s.id === id)?.title ?? id;

/* ---------------------------------- queue ---------------------------------- */

async function queue() {
  const wave = num("--wave", 1);
  const limit = num("--limit", 20);
  const models = loadAllowedModels(WAVES[wave]);
  const nSrc = (m: AllowedModel) => new Set(m.links.map((l) => l.source)).size;
  const recent = (m: AllowedModel) => m.links.some((l) => (l.lastmod ?? "").slice(0, 4) >= String(MIN_YEAR));
  /**
   * Порядок: сначала модели на двух источниках волны и больше (есть с чем
   * сверять), потом со свежей датой в карте, потом остальные. Китайская
   * модель, если есть в волне, ставится в пилот обязательно — наряд просит
   * показать и её.
   */
  const ranked = [...models].sort((a, b) => nSrc(b) - nSrc(a) || Number(recent(b)) - Number(recent(a)));
  const chineseFirst = ranked.find((m) => CHINESE.has(m.brandId));
  const targets = [...new Set([...(chineseFirst ? [chineseFirst] : []), ...ranked])].slice(0, limit);
  console.log(`Волна ${wave}: моделей ${models.length}, на двух источниках и больше ${models.filter((m) => nSrc(m) >= 2).length}`);
  const tasks: Task[] = [];
  const tooOld: { key: string; newestReview: string }[] = [];
  for (const c of targets) {
    const pages: Page[] = [];
    // Площадки качаются параллельно, страницы ОДНОЙ площадки — по очереди:
    // пауза между запросами держится на хост, и два одновременных запроса к
    // одному хосту её бы обошли.
    const bySource = new Map<SourceId, typeof c.links>();
    for (const l of c.links) bySource.set(l.source, [...(bySource.get(l.source) ?? []), l]);
    await Promise.all(
      [...bySource.values()].map(async (links) => {
        for (const l of links) {
          const t = await pageText(l.source, l.url);
          if (!t) continue;
          mkdirSync(dirFor(c.key), { recursive: true });
          // По предложению на строку: длинная строка обрезается инструментом чтения,
          // и читатель не увидел бы часть обзора. Проверка цитаты схлопывает пробелы,
          // так что перенос строки на неё не влияет.
          writeFileSync(textPath(c.key, l.source), t.text.replace(/([.!?])\s+(?=[A-Z0-9"'(])/g, "$1\n"));
          pages.push({ source: l.source, url: l.url, date: t.date, chars: t.text.length });
        }
      })
    );
    // Порядок страниц — как в карте ссылок, а не как пришли ответы: очередь
    // должна быть одинаковой от прогона к прогону.
    pages.sort((x, y) => c.links.findIndex((l) => l.url === x.url) - c.links.findIndex((l) => l.url === y.url));
    /**
     * Одна страница на источник — самая свежая. Файл ответа читателя назван по
     * источнику, и вторая страница того же источника молча затёрла бы первую.
     *
     * Модель без номера версии в названии («air-zoom-pegasus») — одна страница
     * вообще: два обзора без номера могут быть про разные поколения, и свести
     * их значило бы смешать модели.
     */
    const newestFirst = (a: Page, b: Page) => (b.date ?? "").localeCompare(a.date ?? "");
    const perSource = new Map<string, Page>();
    for (const p of [...pages].sort(newestFirst)) if (!perSource.has(p.source)) perSource.set(p.source, p);
    let kept = [...perSource.values()];
    if (!/\d/.test(c.model)) kept = kept.sort(newestFirst).slice(0, 1);
    pages.splice(0, pages.length, ...kept);
    const chinese = CHINESE.has(c.brandId);
    // Фильтр года — до чтения: дата публикации есть в разметке страницы, и
    // модель, о которой последний обзор вышел до 2024 года, читать незачем —
    // в черновики она не попадёт.
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

/* --------------------------------- settle ---------------------------------- */

/**
 * Имена других моделей каталога — для отсева цитат-сравнений.
 *
 * Первая версия брала первое слово названия из карты ссылок без учёта
 * регистра — и выбросила 281 честную цитату: в карте есть мусорные «модели»
 * на shoe-, heel-, running-, а «shoe» стоит почти в каждой фразе обзора.
 * Теперь имя — это первое слово названия модели из разрешённых источников,
 * оно не бренд и не обычное английское
 * слово (системный словарь), и в цитате ищется С ЗАГЛАВНОЙ буквы: «Clifton»,
 * «Pegasus», «Novablast». Ghost и Rincon из-за этого не ловятся по имени — их
 * держит отсев сравнительных оборотов.
 */
const DICT_PATH = "/usr/share/dict/words";
const ENGLISH: Set<string> = existsSync(DICT_PATH)
  ? new Set(readFileSync(DICT_PATH, "utf8").split("\n").filter((w) => /^[a-z]+$/.test(w)))
  : new Set();
function modelNames(candidates: AllowedModel[]): string[] {
  const brands = new Set(
    candidates.flatMap((c) => [c.brandId ?? "", ...c.brand.toLowerCase().split(/\s+/)]).filter(Boolean)
  );
  const names = new Set<string>();
  for (const c of candidates) {
    const first = c.model.split("-")[0].toLowerCase();
    if (first.length < 4 || !/^[a-z]+$/.test(first) || brands.has(first) || ENGLISH.has(first)) continue;
    names.add(first[0].toUpperCase() + first.slice(1));
  }
  return [...names];
}

/**
 * Проверка кодом всех ответов по модели. Одна функция для verify-pack и
 * settle: номер пункта (id) должен совпадать у обоих, иначе ответ смысловой
 * проверки ляжет не на ту цитату.
 */
type Item = Obs<unknown> & { field: string; id: string };
async function vetTask(t: Task, names: string[]) {
  const own = t.model.split("-")[0].toLowerCase();
  const others = names.filter((n) => n.toLowerCase() !== own);
  const version = t.model.match(/-v?(\d+)(?:-|$)/)?.[1];
  const ownName = { name: own, version: version ? Number(version) : null };
  const accepted: Item[] = [];
  const rejected: (Rejected & { source: string })[] = [];
  const bodies: string[] = [];
  const readSources = new Set<string>();
  const notRunning: string[] = [];
  const termsNotices: { source: string; quote: string }[] = [];
  let unread = 0;
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
    /**
     * Запрет в условиях, встреченный на самой странице (подвал, плашка), —
     * сигнал закрыть источник (наряд, п.6). Цитата сверяется с ПОЛНЫМ текстом
     * страницы, а не с телом обзора: подвал из тела вырезан.
     */
    if (answer.terms_notice) {
      const r = await fetchPage(p.source, p.url);
      const full = r.ok ? plainText(r.body) : "";
      if (full.replace(/\s+/g, " ").includes(answer.terms_notice.replace(/\s+/g, " ").trim())) {
        termsNotices.push({ source: p.source, quote: answer.terms_notice });
      }
    }
    if (answer.running_shoe === false) {
      notRunning.push(p.source);
      continue;
    }
    const v = vetAnswer(answer, page.text, others, ownName);
    rejected.push(...v.rejected.map((r) => ({ ...r, source: p.source })));
    if (answer.about_model) readSources.add(p.source);
    v.accepted.forEach((a, i) =>
      accepted.push({ id: `${p.source}#${i}`, field: a.field, value: a.value, quote: a.quote, source: p.source, url: p.url, date: p.date })
    );
  }
  return { accepted, rejected, bodies, readSources, unread, notRunning, termsNotices };
}

const verifyRequestPath = (key: string) => resolve(dirFor(key), "verify-request.json");
const verifyPath = (key: string) => resolve(dirFor(key), "verify.json");

/**
 * Пакет на смысловую проверку: только пункты, прошедшие проверку кодом.
 * Проверяющий видит поле, значение и цитату — и не видит ни страницы, ни
 * ответа читателя целиком: он судит, говорит ли эта фраза то, что ей
 * приписано, а не читает обзор заново.
 */
async function verifyPack() {
  const names = modelNames(loadAllowedModels());
  const tasks: Task[] = JSON.parse(readFileSync(QUEUE_PATH, "utf8"));
  let packed = 0;
  let waiting = 0;
  for (const t of tasks) {
    const v = await vetTask(t, names);
    if (v.unread > 0) {
      waiting++;
      continue;
    }
    const items = v.accepted.map((a) => ({ id: a.id, field: a.field, value: a.value, quote: a.quote }));
    writeFileSync(
      verifyRequestPath(t.key),
      JSON.stringify({ key: t.key, brand: t.brand, model: t.model, items }, null, 2) + "\n"
    );
    packed++;
  }
  console.log(`Пакетов на смысловую проверку: ${packed}; моделей ещё не дочитано: ${waiting}`);
}

type ModelReport = {
  key: string;
  fields: Record<string, string>;
  rejected: (Rejected & { source: string })[];
};

async function settle() {
  const names = modelNames(loadAllowedModels());
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
  let unverified = 0;
  const yearNotes: string[] = [];
  const excluded: { key: string; why: string }[] = [];
  const termsNotices: { key: string; source: string; quote: string }[] = [];

  for (const t of tasks) {
    const vt = await vetTask(t, names);
    unread += vt.unread;
    termsNotices.push(...vt.termsNotices.map((n) => ({ key: t.key, ...n })));
    const rejected = vt.rejected;
    const bodies = vt.bodies;
    const readSources = vt.readSources;

    /**
     * Смысловая проверка (правка Игоря, 14.10.2026). Подстрока доказывает, что
     * фраза есть на странице, но не то, что она про это поле: «balanced
     * cushioning» прошла как доказательство жёсткости. Пункт засчитывается,
     * только если отдельный проверяющий подтвердил смысл. Нет файла проверки —
     * не засчитывается ничего: непроверенное не равно подтверждённому.
     */
    const sense: SenseVerdict[] | null = existsSync(verifyPath(t.key))
      ? JSON.parse(readFileSync(verifyPath(t.key), "utf8"))
      : null;
    if (!sense && vt.unread === 0) unverified++;
    const gate = gateBySense(vt.accepted, sense);
    const accepted: Item[] = gate.passed;
    for (const f of gate.failed) {
      rejected.push({ field: f.field, value: f.value, quote: f.quote, source: f.source, reason: f.reason });
    }

    const verdicts: Verdicts = { ...EMPTY_VERDICTS, purpose: [], best_for: [], not_for: [] };
    const evidence: Evidence[] = [];
    const disputed: string[] = [];
    const fields: Record<string, string> = {};
    // Черновику хватает одного источника (решение Игоря, 14.10.2026): последнее
    // слово всё равно за ним. Расхождение двух источников по-прежнему спор.
    const allowSingle = true;
    const of = (f: string) => accepted.filter((a) => a.field === f);
    const ev = (field: keyof Verdicts, o: Obs<unknown>) =>
      evidence.push({ field, url: o.url, source: o.source, source_title: titleOf(o.source), date: o.date, quote: o.quote });

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
    // Тезис спорного поля не ставится, противоположные пары снимаются обе.
    const contested = new Set<string>();
    for (const [a, b] of OPPOSITE) {
      const has = (t: string) => of("best_for").some((o) => o.value === t) || of("not_for").some((o) => o.value === t);
      if (has(a) && has(b)) [a, b].forEach((t) => contested.add(t));
    }
    for (const field of ["best_for", "not_for"] as const) {
      for (const o of of(field)) {
        const thesis = o.value as string;
        if (contested.has(thesis)) continue;
        const tied = THESIS_FIELD[thesis];
        if (tied && disputed.includes(tied)) continue;
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
      excluded.push({ key: t.key, why: `до ${MIN_YEAR}: год ${year}` });
      console.log(`  ${t.brand} ${t.model} — год ${year}, до ${MIN_YEAR}: в черновики не идёт`);
      continue;
    }
    // Отметка читателя «не беговая» — модель не идёт в черновики (наряд: вторая
    // волна читается с такими отметками прямо при чтении).
    // Ни одна страница не оказалась обзором этой модели (сравнение «X vs Y»,
    // подборка) — черновика нет: пустая запись выглядела бы как модель без
    // данных, а это модель без обзора.
    if (vt.unread === 0 && readSources.size === 0 && vt.notRunning.length === 0) {
      excluded.push({ key: t.key, why: "страницы — не обзор этой модели (сравнение или подборка)" });
      console.log(`  ${t.brand} ${t.model} — обзора модели нет: в черновики не идёт`);
      continue;
    }
    // Исключается, только если НИ ОДИН источник не признал модель беговой.
    if (vt.notRunning.length > 0 && readSources.size === 0) {
      excluded.push({ key: t.key, why: `не беговая: ${vt.notRunning.join(", ")}` });
      console.log(`  ${t.brand} ${t.model} — не беговая обувь: в черновики не идёт`);
      continue;
    }

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
      confidence: readSources.size >= 2 ? "normal" : "low",
      disputed,
      decided_by,
      status: "draft",
    });
    reports.push({ key: t.key, fields, rejected });
    const filled = TWO_SOURCE_FIELDS.filter((f) => verdicts[f] !== null).length;
    console.log(
      `  ${t.brand} ${t.model} — прочитано ${readSources.size}/${t.pages.length}, полей ${filled}/${TWO_SOURCE_FIELDS.length}` +
        `${disputed.length ? `, спор: ${disputed.join(", ")}` : ""}, отброшено цитат ${rejected.length}`
    );
  }

  // Черновики тренерского каталога: в подбор не идут, пока Игорь не подтвердит.
  writeFileSync(resolve(REPORTS, "coach-drafts.json"), JSON.stringify(records, null, 2) + "\n");
  writeFileSync(resolve(REPORTS, "coach-drafts-excluded.json"), JSON.stringify(excluded, null, 2) + "\n");
  if (termsNotices.length > 0) {
    writeFileSync(resolve(REPORTS, "terms-notices.json"), JSON.stringify(termsNotices, null, 2) + "\n");
    console.log(`\n!!! На страницах найден запрет в условиях — источники к закрытию: ${[...new Set(termsNotices.map((n) => n.source))].join(", ")}`);
    console.log("    Закрыть и удалить всё полученное: npx tsx tools/shoes-pipeline/close-source.ts <id> \"причина\"");
  }
  writeFileSync(resolve(REPORTS, "verdict-for-igor.json"), JSON.stringify(forIgor, null, 2) + "\n");
  writeFileSync(
    resolve(REPORTS, "verdict-read-report.json"),
    JSON.stringify({ tally, models: reports, yearNotes }, null, 2) + "\n"
  );

  console.log(`\n${"═".repeat(70)}`);
  console.log(
    `Записей: ${records.length}; страниц без ответа: ${unread}; моделей без смысловой проверки: ${unverified}; спорных полей Игорю: ${forIgor.length}`
  );
  console.log("Сводка по полям (agreed — согласие, agreed_adjacent — соседние деления, медиана):");
  for (const [f, k] of Object.entries(tally)) console.log(`  ${f.padEnd(12)} ${JSON.stringify(k)}`);
  const why: Record<string, number> = {};
  for (const r of reports) for (const x of r.rejected) why[x.reason.split(":")[0]] = (why[x.reason.split(":")[0]] ?? 0) + 1;
  console.log(`Отброшено цитат: ${JSON.stringify(why)}`);
}

/* ---------------------------------- status --------------------------------- */

/**
 * Сколько осталось. Чтение идёт на подписке порциями и может остановиться на
 * лимите — продолжение начинается отсюда: недочитанные модели раскладываются
 * на порции по 5, дочитанные без смысловой проверки — отдельным списком.
 */
function status() {
  const tasks: Task[] = JSON.parse(readFileSync(QUEUE_PATH, "utf8"));
  const unread = tasks.filter((t) => t.pages.some((p) => !existsSync(answerPath(t.key, p.source))));
  const unverified = tasks.filter(
    (t) => !unread.includes(t) && !existsSync(verifyPath(t.key))
  );
  const portions: { key: string; sources: string[] }[][] = [];
  for (let i = 0; i < unread.length; i += 5) {
    portions.push(
      unread.slice(i, i + 5).map((t) => ({
        key: t.key,
        sources: t.pages.filter((p) => !existsSync(answerPath(t.key, p.source))).map((p) => p.source),
      }))
    );
  }
  writeFileSync(resolve(READ_DIR, "portions.json"), JSON.stringify({ portions, unverified: unverified.map((t) => t.key) }, null, 2) + "\n");
  console.log(
    `Моделей в очереди: ${tasks.length}; не дочитано: ${unread.length} (порций по 5: ${portions.length}); ` +
      `дочитано без смысловой проверки: ${unverified.length}`
  );
}

if (cmd === "queue") await queue();
else if (cmd === "verify-pack") await verifyPack();
else if (cmd === "status") status();
else if (cmd === "settle") await settle();
else {
  console.error("Команда: queue | status | verify-pack | settle");
  process.exit(1);
}
