import { ALL_PRO, ALL_CON, coveredThesis } from "./theses";
import type {
  Durability,
  Feel,
  Firmness,
  HeelHold,
  Purpose,
  Verdicts,
  Width,
  WinterGrip,
} from "./verdict-types";

/**
 * Чтение обзоров моделью — и проверка прочитанного кодом.
 *
 * Разделение ролей здесь главное. Модель читает обзор и предлагает вердикт с
 * дословной цитатой. Код НЕ верит ей на слово: цитата обязана найтись в
 * сохранённой странице точной подстрокой, иначе вердикт отбрасывается и поле
 * остаётся пустым. Модель может ошибиться, пересказать, придумать — всё это
 * отсекается здесь, а не её добросовестностью.
 *
 * Модель участвует только на этапе сборки базы. В рантайме подбора её нет:
 * движок читает готовые вердикты.
 */

/* ------------------------------- Ответ читателя ------------------------------ */

export type Claim<T> = { value: T; quote: string };

/** Что читатель возвращает по ОДНОЙ странице обзора. */
export type ReaderAnswer = {
  key: string;
  source: string;
  url: string;
  /** Страница действительно обзор этой модели, а не подборка или сравнение. */
  about_model: boolean;
  purpose: Claim<Purpose>[];
  feel: Claim<Feel> | null;
  firmness: Claim<Firmness> | null;
  width: Claim<Width> | null;
  durability: Claim<Durability> | null;
  heel_hold: Claim<HeelHold> | null;
  winter_grip: Claim<WinterGrip> | null;
  best_for: { thesis: string; quote: string }[];
  not_for: { thesis: string; quote: string }[];
  release: { year: number; quote: string } | null;
  /** Название модели со страницы, с версией, без бренда: «Pegasus 41». */
  model_name?: string | null;
  /** false — страница про НЕ беговую обувь (лайфстайл, хайкинг, баскетбол). */
  running_shoe?: boolean;
  /**
   * Дословный запрет из условий, если он стоит на самой странице (подвал,
   * плашка): «копирование запрещено», «no scraping». Код сверит его с полной
   * страницей, и источник уйдёт на закрытие.
   */
  terms_notice?: string | null;
};

export const FEEL_ORDER: Feel[] = ["firm_responsive", "balanced", "soft_stable", "bouncy_soft", "plush"];
const PURPOSES: Purpose[] = ["daily", "tempo", "race", "max", "stability", "trail", "winter"];
const WIDTHS: Width[] = ["narrow", "standard", "wide"];
const DURABILITIES: Durability[] = ["low", "average", "high"];
const HEEL_HOLDS: HeelHold[] = ["loose", "good", "stiff"];
const WINTER: WinterGrip[] = ["poor", "fair", "good"];

/* ------------------------------ Проверка цитаты ------------------------------ */

/**
 * Нормализация, одинаковая для страницы и для цитаты. Только то, что не меняет
 * слов: пробелы, типографские кавычки и тире. Регистр НЕ сводится: «точная
 * подстрока» значит точная.
 */
export function normalizeForQuote(s: string): string {
  return s
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Короче этого цитата не доказывает ничего: «soft» найдётся на любой странице. */
export const QUOTE_MIN = 20;
/** Длиннее — уже не цитата, а перепечатка куска обзора. */
export const QUOTE_MAX = 300;

/**
 * Сравнение с ДРУГОЙ моделью. «Firmer than the Clifton» — вердикт о паре, а не
 * о предмете обзора, и для поля не засчитывается.
 *
 * «than» само по себе сравнением с моделью не считается: «the heel absorbs
 * more than the forefoot», «other than the heel counter» — это о самой модели,
 * и первая версия фильтра выбросила такие цитаты на пилоте. Сравнение — когда
 * после «than» стоит имя (с заглавной), прошлая версия или «многие/другие».
 */
// «than» — с учётом регистра: заглавная после него и есть признак имени модели.
const COMPARATIVE_THAN =
  /\bthan (?:the |its |my |a |an )?(?:[A-Z][a-z]|previous|last|original|older|newer|most|many|other|any|some)/;
const COMPARATIVE =
  /\b(compared (to|with)|in comparison|unlike|versus|vs\.?|predecessor|previous (version|model|iteration)|last (year's|version|model))\b/i;

/** Сравнения по-русски: первая волна наполовину русскоязычная. */
const COMPARATIVE_RU =
  /(чем у|чем в|по сравнению с|в сравнении с|в отличие от|предшественни|предыдущ[а-яё]* (верси|модел)|прошл[а-яё]* (верси|модел))/i;

export type QuoteVerdict = { ok: true } | { ok: false; reason: string };

/**
 * Слова и шкала не должны спорить (инвариант Игоря, 14.10.2026). Шкала
 * firmness: 1 жёстко … 5 очень мягко. Цитата со словами плотности не может
 * дать 4–5, со словами мягкости — 1–2. Обе группы в одной цитате («firm but
 * soft underfoot») оставляют только середину, 3.
 *
 * Правило буквальное и нарочно грубое: «not too firm» тоже содержит «firm» и
 * не даст 4–5. Потерять честную цитату дешевле, чем записать мягкой модель,
 * про которую обзор сказал «firm».
 */
const FIRM_WORDS = /\b(firm\w*|stiff\w*|harsh\w*|hard|harder|dense\w*|rigid\w*)\b|плотн|жёстк|жестк|твёрд|твердь|твердая|твёрдая/i;
const SOFT_WORDS = /\b(soft\w*|plush\w*|squish\w*|pillow\w*|cushy|mushy|marshmallow\w*)\b|мягк/i;

/**
 * Основание для durability (правило Игоря, 14.10.2026): только пробег от
 * 150 км или прямое утверждение о ресурсе подошвы. «After several runs,
 * minimal wear» — не основание: несколько пробежек ничего не говорят о
 * ресурсе, сколько бы слов «durability» ни стояло рядом.
 *
 * Названный пробег меньше 150 км — тоже не основание, даже с прогнозом
 * «should last a long time»: прогноз по 100 км остаётся догадкой.
 */
const MILEAGE = /(\d{2,4})\s*(km|км|kilomet\w*|километр[а-яё]*|miles?|mi\b|мил[ьи]\w*)/gi;
const SHORT_USE = /\b(after|in) (a few|several|a couple of|two|three|my first|the first) (runs?|outings|sessions|miles)|\bfirst (few )?runs?\b|после (нескольких|пары|первых) (пробеж|трениров)|несколько пробежек/i;
const RESOURCE_CLAIM = /durab\w*|lifespan|long[- ]?lasting|\blast(s|ed)? (a long time|for (many|hundreds))|wear(s|ing)? (out|down|through) (quickly|fast|early)|chew(ed|ing)? through|ресурс|долговечн|износостойк|быстро (стира|изна)|стёрл|стерл/i;

export function durabilityBasis(quote: string): string | null {
  let mileage: number | null = null;
  for (const m of quote.matchAll(MILEAGE)) {
    const n = Number(m[1]);
    const km = /mi/i.test(m[2]) ? n * 1.609 : n;
    mileage = Math.max(mileage ?? 0, km);
  }
  if (mileage !== null) return mileage >= 150 ? null : `пробег ${Math.round(mileage)} км — меньше 150`;
  if (SHORT_USE.test(quote)) return "несколько пробежек — не основание для ресурса";
  if (!RESOURCE_CLAIM.test(quote)) return "нет пробега от 150 км и прямого утверждения о ресурсе";
  return null;
}

/**
 * «Не для тяжёлых бегунов» — только по прямой цитате про вес бегуна (правило
 * Игоря): цитата называет тяжёлых бегунов И говорит, что им не подходит.
 * «Долговечность вызывает вопросы, особенно для тяжёлых бегунов» — про износ,
 * а не про пригодность, и тезиса не даёт.
 */
export const NOT_FOR_HEAVY_THESIS = "не для тяжёлых бегунов";
const HEAVY = /\b(heav(y|ier)|bigger|larger) runners?\b|\bover \d+\s?(kg|lbs?)\b|тяжёл[а-яё]* бегун|тяжел[а-яё]* бегун|крупн[а-яё]* бегун|бегун[а-яё]* с (большим|высоким) весом/i;
const UNSUITABLE = /\bnot\b|n't\b|\bavoid\b|\bstruggl\w*|bottom(s|ed)? out|не (подойд|подход|рекоменд|для|стоит|выдерж)|лучше (выбрать|взять|посмотреть)/i;

export function heavyThesisBasis(quote: string): string | null {
  return HEAVY.test(quote) && UNSUITABLE.test(quote) ? null : "нет прямой цитаты о том, что модель не подходит тяжёлым бегунам";
}

export function firmnessConflict(value: number, quote: string): string | null {
  const firm = FIRM_WORDS.test(quote);
  const soft = SOFT_WORDS.test(quote);
  if (firm && value >= 4) return "цитата про плотность не даёт 4–5";
  if (soft && value <= 2) return "цитата про мягкость не даёт 1–2";
  return null;
}

/**
 * Цитата засчитывается, если:
 *   1) нашлась в тексте сохранённой страницы точной подстрокой;
 *   2) не короче QUOTE_MIN и не длиннее QUOTE_MAX;
 *   3) не сравнивает с другой моделью — ни оборотом, ни названием чужой модели.
 *
 * `otherModels` — имена других моделей каталога с заглавной буквы; своё имя
 * сюда не передаётся.
 */
export type Own = { name: string; version: number | null };

export function checkQuote(page: string, quote: string, otherModels: string[], own?: Own): QuoteVerdict {
  const q = normalizeForQuote(quote ?? "");
  if (q.length < QUOTE_MIN) return { ok: false, reason: `короче ${QUOTE_MIN} знаков` };
  if (q.length > QUOTE_MAX) return { ok: false, reason: `длиннее ${QUOTE_MAX} знаков` };
  if (!normalizeForQuote(page).includes(q)) return { ok: false, reason: "нет на странице" };
  if (COMPARATIVE.test(q) || COMPARATIVE_THAN.test(q) || COMPARATIVE_RU.test(q)) return { ok: false, reason: "сравнение с другой моделью" };
  const lower = q.toLowerCase();
  // Имя модели — с заглавной: «Clifton», а не «clifton» внутри обычной фразы.
  const other = otherModels.find((m) => new RegExp(`\\b${escapeRe(m)}\\b`).test(q));
  if (other) return { ok: false, reason: `названа другая модель: ${other}` };
  // Та же линейка, другой номер: «the Clifton 10 felt softer» в обзоре Clifton 11.
  if (own && own.version !== null) {
    for (const m of lower.matchAll(new RegExp(`\\b${escapeRe(own.name)}\\s*(?:v)?(\\d+)\\b`, "g"))) {
      if (Number(m[1]) !== own.version) return { ok: false, reason: `прошлая версия: ${m[0]}` };
    }
  }
  return { ok: true };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* ------------------------------ Проверка ответа ------------------------------ */

export type Accepted = {
  field: keyof Verdicts | "release";
  value: unknown;
  quote: string;
};
export type Rejected = { field: string; value: unknown; quote: string; reason: string };

const SINGLE_FIELDS = ["feel", "firmness", "width", "durability", "heel_hold", "winter_grip"] as const;
type SingleField = (typeof SINGLE_FIELDS)[number];

function valueOk(field: SingleField, v: unknown): boolean {
  switch (field) {
    case "feel":
      return FEEL_ORDER.includes(v as Feel);
    case "firmness":
      return v === 1 || v === 2 || v === 3 || v === 4 || v === 5;
    case "width":
      return WIDTHS.includes(v as Width);
    case "durability":
      return DURABILITIES.includes(v as Durability);
    case "heel_hold":
      return HEEL_HOLDS.includes(v as HeelHold);
    case "winter_grip":
      return WINTER.includes(v as WinterGrip);
  }
}

/**
 * Проверяет ответ читателя по одной странице. Всё, что не прошло, уходит в
 * rejected с причиной — для отчёта, а не молча.
 */
export function vetAnswer(
  a: ReaderAnswer,
  page: string,
  otherModels: string[],
  own?: Own
): { accepted: Accepted[]; rejected: Rejected[] } {
  const accepted: Accepted[] = [];
  const rejected: Rejected[] = [];
  if (!a.about_model) {
    rejected.push({ field: "*", value: null, quote: "", reason: "страница не обзор этой модели" });
    return { accepted, rejected };
  }
  const take = (field: Accepted["field"], value: unknown, quote: string) => {
    const q = checkQuote(page, quote, otherModels, own);
    if (q.ok) accepted.push({ field, value, quote: normalizeForQuote(quote) });
    else rejected.push({ field, value, quote, reason: q.reason });
  };

  for (const f of SINGLE_FIELDS) {
    const c = a[f];
    if (!c) continue;
    if (!valueOk(f, c.value)) {
      rejected.push({ field: f, value: c.value, quote: c.quote, reason: "значение вне шкалы" });
      continue;
    }
    if (f === "firmness") {
      const conflict = firmnessConflict(c.value as number, c.quote ?? "");
      if (conflict) {
        rejected.push({ field: f, value: c.value, quote: c.quote, reason: conflict });
        continue;
      }
    }
    if (f === "durability") {
      const why = durabilityBasis(c.quote ?? "");
      if (why) {
        rejected.push({ field: f, value: c.value, quote: c.quote, reason: why });
        continue;
      }
    }
    take(f, c.value, c.quote);
  }
  for (const p of a.purpose ?? []) {
    if (!PURPOSES.includes(p.value)) {
      rejected.push({ field: "purpose", value: p.value, quote: p.quote, reason: "значение вне шкалы" });
      continue;
    }
    take("purpose", p.value, p.quote);
  }
  // Тезис принимается только ДОСЛОВНО из словаря: модель выбирает, а не пишет.
  for (const [field, dict] of [
    ["best_for", ALL_PRO],
    ["not_for", ALL_CON],
  ] as const) {
    for (const t of a[field] ?? []) {
      if (!dict.includes(t.thesis)) {
        rejected.push({ field, value: t.thesis, quote: t.quote, reason: "тезиса нет в словаре" });
        continue;
      }
      if (t.thesis === NOT_FOR_HEAVY_THESIS) {
        const why = heavyThesisBasis(t.quote ?? "");
        if (why) {
          rejected.push({ field, value: t.thesis, quote: t.quote, reason: why });
          continue;
        }
      }
      take(field, t.thesis, t.quote);
    }
  }
  if (a.release) {
    // Первая версия инструкции не показывала формат года, и читатель писал
    // «value» вместо «year». Значение то же, цитата проверяется так же.
    const legacy = a.release as { year?: number; value?: number; quote: string };
    a.release = { year: legacy.year ?? (legacy.value as number), quote: legacy.quote };
    if (Number.isInteger(a.release.year) && a.release.year >= 2015 && a.release.year <= 2030) {
      take("release", a.release.year, a.release.quote);
    } else {
      rejected.push({ field: "release", value: a.release.year, quote: a.release.quote, reason: "год вне диапазона" });
    }
  }
  return { accepted, rejected };
}

/* --------------------------------- Сведение --------------------------------- */

export type Obs<T> = { value: T; quote: string; source: string; url: string; date: string | null };

export type Settled<T> =
  | { kind: "empty" }
  | { kind: "single"; obs: Obs<T>[] }
  | { kind: "agreed"; value: T; obs: Obs<T>[]; merged: boolean }
  | { kind: "disputed"; obs: Obs<T>[] };

/**
 * Одно значение от источника. Если один обзор сам себе противоречит (дал два
 * разных значения), его голос по полю не засчитывается — спорить с собой не
 * повод спорить с другими.
 */
function perSource<T>(obs: Obs<T>[]): Map<string, Obs<T>[]> {
  const m = new Map<string, Obs<T>[]>();
  for (const o of obs) m.set(o.source, [...(m.get(o.source) ?? []), o]);
  return m;
}

/**
 * Медиана порядковых значений. Для чётного числа голосов, когда середина
 * между двумя делениями, берётся деление БЛИЖЕ К ЦЕНТРУ шкалы: 2 и 3 дают 3,
 * 4 и 5 дают 4. Сдвиг к середине — меньшая из ошибок: крайнее значение шкалы
 * ставится, только когда на нём сошлись.
 */
export function medianTowardCenter(positions: number[], center: number): number {
  const s = [...positions].sort((a, b) => a - b);
  const mid = s.length / 2;
  if (s.length % 2 === 1) return s[Math.floor(mid)];
  const lo = s[mid - 1];
  const hi = s[mid];
  if (lo === hi) return lo;
  return Math.abs(lo - center) <= Math.abs(hi - center) ? lo : hi;
}

/**
 * Сведение поля по источникам.
 *
 * Порядковые поля (firmness, feel) — разброс в одно деление не спор: обзоры
 * пишут словами, и «balanced» у одного и «soft_stable» у другого описывают
 * одну и ту же пену. Берётся медиана. Разброс от двух делений — спор, поле
 * пустое, модель в отчёт человеку. Среднее не берётся никогда.
 *
 * Остальные поля (width, durability, heel_hold, winter_grip) — только полное
 * согласие. Для них Игорь соседства не разрешал, и «узкая» против «обычной» —
 * разные советы по примерке.
 *
 * Два источника, не два наблюдения: allowSingle только для моделей с
 * confidence low.
 */
export function settleField<T>(
  obs: Obs<T>[],
  allowSingle: boolean,
  ordinal: { order: T[]; center: number } | null
): Settled<T> {
  if (obs.length === 0) return { kind: "empty" };
  const bySrc = perSource(obs);
  const votes: Obs<T>[] = [];
  for (const list of bySrc.values()) {
    const distinct = new Set(list.map((o) => JSON.stringify(o.value)));
    if (distinct.size === 1) votes.push(list[0]);
  }
  if (votes.length === 0) return { kind: "disputed", obs };
  if (votes.length === 1) {
    return allowSingle ? { kind: "agreed", value: votes[0].value, obs: votes, merged: false } : { kind: "single", obs: votes };
  }
  const keys = new Set(votes.map((v) => JSON.stringify(v.value)));
  if (keys.size === 1) return { kind: "agreed", value: votes[0].value, obs: votes, merged: false };
  if (!ordinal) return { kind: "disputed", obs: votes };
  const pos = votes.map((v) => ordinal.order.indexOf(v.value));
  if (Math.max(...pos) - Math.min(...pos) >= 2) return { kind: "disputed", obs: votes };
  const m = medianTowardCenter(pos, ordinal.center);
  return { kind: "agreed", value: ordinal.order[m], obs: votes, merged: true };
}

export const FIRMNESS_ORDINAL = { order: [1, 2, 3, 4, 5] as Firmness[], center: 2 };
export const FEEL_ORDINAL = { order: FEEL_ORDER, center: 2 };

/** Тезис, который дублирует уже поставленное поле, не нужен — движок выведет сам. */
export function thesisDuplicates(thesis: string, v: Verdicts): boolean {
  return coveredThesis(thesis, v);
}

/* ----------------------------- Смысловой шлюз ------------------------------ */

export type SenseVerdict = { id: string; ok: boolean; why?: string };

/**
 * Пропускает только пункты, смысл которых подтвердил отдельный проверяющий.
 * Нет ответа по пункту (или нет файла проверки вовсе) — пункт не засчитан:
 * непроверенное не равно подтверждённому.
 */
export function gateBySense<T extends { id: string }>(
  items: T[],
  verdicts: SenseVerdict[] | null
): { passed: T[]; failed: (T & { reason: string })[] } {
  const byId = new Map((verdicts ?? []).map((v) => [v.id, v]));
  const passed: T[] = [];
  const failed: (T & { reason: string })[] = [];
  for (const it of items) {
    const v = byId.get(it.id);
    if (v?.ok === true) passed.push(it);
    else failed.push({ ...it, reason: v ? `смысл: ${v.why ?? "цитата не подтверждает значение"}` : "смысл не проверен" });
  }
  return { passed, failed };
}
