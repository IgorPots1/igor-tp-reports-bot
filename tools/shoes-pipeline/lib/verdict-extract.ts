import type { Durability, Feel, Firmness, HeelHold, Purpose, Width, WinterGrip } from "./verdict-types";

/**
 * Извлечение вердиктов из текста обзора.
 *
 * Правила СВОИ у каждой площадки и написаны по увиденной структуре, а не по
 * догадке о ней: у Doctors of Running есть поля «Shoe Purpose» и «Durability
 * Expectation», у Believe in the Run — «Best For», у RTINGS — числовые оценки
 * по назначениям. Общий фильтр на всех троих терял бы две трети.
 *
 * У каждого вердикта сохраняется ЦИТАТА — кусок текста, по которому он
 * поставлен. Это и есть замена утраченной объективности измерений: вывод можно
 * проверить глазами, а не поверить на слово.
 */

export type Extracted<T> = { value: T; quote: string } | null;

/**
 * Хвост страницы, который к обзору не относится: комментарии, «читайте также»,
 * подписка, подборки. Там полно слов «soft» и «firm» про ДРУГИЕ модели, и
 * счёт по всей странице ловил именно их.
 */
const TAIL = /\b(Comments?|You May Also Like|Related Posts?|Newsletter|Subscribe|More Reviews|Recent Posts|Popular Comparisons|Shop this|Older Post|Newer Post)\b/i;

/**
 * Предложение сравнивает ЭТУ модель с ДРУГОЙ — для вердикта о ней самой не
 * годится. «Firmer than the Clifton» говорит о Clifton столько же, сколько о
 * предмете обзора, и счёт слов принимал это за свойство модели.
 */
const COMPARATIVE = /\b(than the|than its|compared to|unlike the|versus|vs\.?|predecessor|previous version)\b/i;

/**
 * Обрезает страницу до конца собственно обзора.
 *
 * Маркер конца засчитывается, только если стоит во ВТОРОЙ половине страницы.
 * Прежняя версия резала по первому вхождению — а «Comment» стоит в меню
 * Believe in the Run, «Popular Comparisons» в оглавлении RTINGS, оба наверху.
 * От этих площадок оставалось 8–14 % страницы, они молчали по всем полям, и
 * расхождения между обзорами «исчезали» не от чистоты, а потому что спорить
 * становилось некому. Ошибка была невидимой: число расхождений выглядело как
 * успех.
 */
export function reviewBody(text: string): string {
  const half = text.length / 2;
  const re = new RegExp(TAIL.source, "gi");
  for (const m of text.matchAll(re)) {
    if (m.index !== undefined && m.index >= half) return text.slice(0, m.index);
  }
  return text;
}

/** Какая доля страницы считается текстом обзора — для проверки, а не для разбора. */
export function bodyShare(text: string): number {
  return text.length === 0 ? 0 : reviewBody(text).length / text.length;
}

/** Предложения обзора без сравнительных — на них и ставятся вердикты. */
export function ownSentences(text: string): string {
  return reviewBody(text)
    .split(/(?<=\.)\s+/)
    .filter((s) => !COMPARATIVE.test(s))
    .join(" ");
}

const NAMED: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  quot: '"',
  apos: "'",
  lt: "<",
  gt: ">",
  rsquo: "\u2019",
  lsquo: "\u2018",
  rdquo: "\u201D",
  ldquo: "\u201C",
  ndash: "\u2013",
  mdash: "\u2014",
  hellip: "\u2026",
  deg: "\u00B0",
  bull: "\u2022",
  middot: "\u00B7",
  trade: "\u2122",
  reg: "\u00AE",
  copy: "\u00A9",
  times: "\u00D7",
};

export function plainText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ")
    // Сущности раскрываются ВСЕ, а не две-три: читатель-модель цитирует то, что
    // видит, и «&#8220;» в тексте страницы не совпало бы ни с одной цитатой.
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-z]+);/gi, (m, name: string) => NAMED[name.toLowerCase()] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}

/** Кусок текста вокруг подписи — он же цитата-доказательство. */
function after(text: string, label: string, len = 160): string | null {
  const i = text.indexOf(label);
  return i > -1 ? text.slice(i, i + len).trim() : null;
}

/* ------------------------------- Назначение ------------------------------- */

const PURPOSE_WORDS: [RegExp, Purpose][] = [
  [/\btrail\b/i, "trail"],
  [/\bstability|support\b/i, "stability"],
  [/\bracing|race day|marathon racing|5k\/10k racing\b/i, "race"],
  [/\btempo|uptempo|speed work\b/i, "tempo"],
  [/\bmax(imal)?( cushion)?\b/i, "max"],
  [/\bwinter|gore-?tex|gtx\b/i, "winter"],
  [/\bdaily (trainer|training)|easy (run|mileage)|long run\b/i, "daily"],
];

export function purposeFrom(text: string, source: string): Extracted<Purpose[]> {
  // Doctors of Running: «Shoe Purpose : Neutral Daily Trainer»
  // Believe in the Run: «Best For Daily training, walking…»
  // RTINGS: числовые оценки по назначениям, берём только сильные (от 7).
  let scope: string | null = null;
  if (source === "doctorsofrunning") scope = after(text, "Shoe Purpose", 90);
  if (source === "believeintherun") scope = after(text, "Best For", 140);
  if (source === "rtings") {
    const hits = [...text.matchAll(/([\d.]+)\s+(Daily Training|Long Run|Tempo|5K\/10K Racing|Half\/Full Marathon Racing|Trail)/g)]
      .filter((m) => Number(m[1]) >= 7)
      .map((m) => m[0]);
    scope = hits.length > 0 ? hits.join("; ") : null;
  }
  if (!scope) return null;

  const found = new Set<Purpose>();
  for (const [re, p] of PURPOSE_WORDS) if (re.test(scope)) found.add(p);
  return found.size > 0 ? { value: [...found], quote: scope } : null;
}

/* ------------------------------ Износостойкость ---------------------------- */

export function durabilityFrom(text: string, source: string): Extracted<Durability> {
  if (source === "doctorsofrunning") {
    const q = after(text, "Durability Expectation", 70);
    if (q) {
      if (/\bhigh|excellent|great\b/i.test(q)) return { value: "high", quote: q };
      if (/\blow\b/i.test(q)) return { value: "low", quote: q };
      if (/\bmoderate|average\b/i.test(q)) return { value: "average", quote: q };
    }
  }
  const m = text.match(/[^.]{0,80}\b(outsole|durability)\b[^.]{0,80}\./i);
  if (!m) return null;
  const q = m[0].trim();
  if (/\bpoor|wears? (quickly|fast)|shredd/i.test(q)) return { value: "low", quote: q };
  if (/\bexcellent|bulletproof|holds? up (well|great)|durable\b/i.test(q)) return { value: "high", quote: q };
  return null;
}

/* --------------------------- Жёсткость и ощущение -------------------------- */

const SOFT = /\b(soft|plush|pillowy|squish|cushy|marshmallow)\b/i;
const BOUNCY = /\b(bouncy|springy|poppy|energetic|trampoline)\b/i;
const FIRM = /\b(firm|stiff|harsh|dense|planted|stable platform)\b/i;
const RESPONSIVE = /\b(responsive|snappy|quick|propulsive)\b/i;

/**
 * Жёсткость 1 (жёстко) … 5 (очень мягко). Шкала намеренно грубая: обзоры не
 * дают точности на десять делений, а видимость точности хуже её отсутствия.
 */
export function firmnessFrom(raw: string): Extracted<Firmness> {
  const text = ownSentences(raw);
  const sent = text.match(/[^.]{0,100}\b(soft|plush|firm|stiff|cushion)[^.]{0,100}\./i);
  const quote = sent ? sent[0].trim() : null;
  if (!quote) return null;
  const soft = (text.match(SOFT) ?? []).length + (text.match(/\bplush\b/gi) ?? []).length;
  const firm = (text.match(FIRM) ?? []).length;
  if (soft === 0 && firm === 0) return null;
  const score = soft - firm;
  const value: Firmness = score >= 3 ? 5 : score >= 1 ? 4 : score === 0 ? 3 : score >= -2 ? 2 : 1;
  return { value, quote };
}

export function feelFrom(raw: string): Extracted<Feel> {
  const text = ownSentences(raw);
  const soft = SOFT.test(text);
  const bouncy = BOUNCY.test(text);
  const firm = FIRM.test(text);
  const resp = RESPONSIVE.test(text);
  const sent = text.match(/[^.]{0,100}\b(ride|feel|underfoot)\b[^.]{0,100}\./i);
  const quote = sent ? sent[0].trim() : null;
  if (!quote) return null;
  if (soft && bouncy) return { value: "bouncy_soft", quote };
  if (/\bplush\b/i.test(text) && !firm) return { value: "plush", quote };
  if (soft && firm) return { value: "soft_stable", quote };
  if (firm && resp) return { value: "firm_responsive", quote };
  if (soft || bouncy || firm) return { value: "balanced", quote };
  return null;
}

/* --------------------------- Колодка и посадка пятки ----------------------- */

export function widthFrom(raw: string): Extracted<Width> {
  const text = ownSentences(raw);
  const m = text.match(/[^.]{0,90}\b(toe ?box|fit|last|width)\b[^.]{0,90}\./i);
  if (!m) return null;
  const q = m[0].trim();
  if (/\b(narrow|snug|tight|cramped)\b/i.test(q)) return { value: "narrow", quote: q };
  if (/\b(wide|roomy|spacious|generous)\b/i.test(q)) return { value: "wide", quote: q };
  if (/\b(true to size|standard|average|accommodating)\b/i.test(q)) return { value: "standard", quote: q };
  return null;
}

export function heelHoldFrom(raw: string): Extracted<HeelHold> {
  const text = ownSentences(raw);
  const m = text.match(/[^.]{0,90}\b(heel (hold|lock|counter|collar|slip)|rearfoot)\b[^.]{0,90}\./i);
  if (!m) return null;
  const q = m[0].trim();
  if (/\b(slip|slipp|loose|sloppy|insecure)\b/i.test(q)) return { value: "loose", quote: q };
  if (/\b(stiff|rigid|aggressive|irritat|rub)\b/i.test(q)) return { value: "stiff", quote: q };
  if (/\b(secure|locked|good|solid|comfortable)\b/i.test(q)) return { value: "good", quote: q };
  return null;
}

/* ------------------------------- Зимнее сцепление -------------------------- */

export function winterGripFrom(raw: string): Extracted<WinterGrip> {
  const text = ownSentences(raw);
  const m = text.match(/[^.]{0,90}\b(wet|slip|traction|grip|ice|snow)\b[^.]{0,90}\./i);
  if (!m) return null;
  const q = m[0].trim();
  if (/\b(poor|slippery|struggl|lack)\b/i.test(q)) return { value: "poor", quote: q };
  if (/\b(excellent|great|confident|secure|tenacious)\b/i.test(q)) return { value: "good", quote: q };
  if (/\b(decent|adequate|fine|acceptable)\b/i.test(q)) return { value: "fair", quote: q };
  return null;
}

/* ------------------------------ Плюсы и минусы ----------------------------- */

/**
 * Списки «за» и «против». Есть у всех трёх площадок, названы по-разному.
 *
 * Список обрезается по СЛЕДУЮЩЕЙ подписи, а не по числу символов. Окно
 * фиксированной длины затекало из плюсов в минусы: в «за» попадало «plenty of
 * cushioning Cons : Poor outsole durability» — то есть минус, пришитый к
 * плюсу, — и резало слова посередине («Many shoes on the mar»).
 */
export function prosConsFrom(text: string, source: string): { pros: string[]; cons: string[] } {
  const STOP = /\b(Cons|Pros|The Bad|The Good|RUNNING SHOE SUMMARY|SPECIFICATIONS|Price|Verdict|Fit|Performance|Thoughts|Recommended for|Score)\b\s*:?/;
  const grab = (label: string): string[] => {
    const i = text.indexOf(label);
    if (i === -1) return [];
    let chunk = text.slice(i + label.length).replace(/^\s*:?\s*/, "");
    const stop = chunk.match(STOP);
    if (stop && stop.index !== undefined) chunk = chunk.slice(0, stop.index);
    return chunk
      .split(/,|;|\u2022|\.\s|\s-\s/)
      .map((x) => x.replace(/&#\d+;|&[a-z]+;/g, " ").replace(/\s+/g, " ").trim())
      // Обрывок без конца слова — не вердикт, а мусор разбора.
      .filter((x) => x.length > 8 && x.length < 90 && /[a-z][.!?]?$/i.test(x))
      .slice(0, 4);
  };
  if (source === "believeintherun") return { pros: grab("The Good"), cons: grab("The Bad") };
  return { pros: grab("Pros"), cons: grab("Cons") };
}

/** Одна фраза своими словами — берём вступление обзора, а не сочиняем. */
export function summaryFrom(raw: string, source: string): Extracted<string> {
  const body = reviewBody(raw);
  const anchor =
    source === "doctorsofrunning" ? "RUNNING SHOE SUMMARY" : source === "believeintherun" ? "The Good" : "Verdict";
  const i = body.indexOf(anchor);
  const chunk = i > -1 ? body.slice(i + anchor.length, i + anchor.length + 400) : body.slice(0, 400);
  const sent = chunk.match(/[A-Z][^.]{40,220}\./);
  return sent ? { value: sent[0].trim(), quote: sent[0].trim() } : null;
}

/**
 * Явное заявление о выходе модели в тексте обзора: «available July 2025»,
 * «released in March 2025», «the 2025 version». Это второй сигнал года, и он
 * прямее даты публикации — обзор могут выпустить через полгода после выхода.
 */
export function releaseYearFrom(raw: string): Extracted<number> {
  const text = reviewBody(raw);
  const m =
    text.match(/[^.]{0,60}\b(?:available|releas\w*|launch\w*|drops?|hits? (?:shelves|stores))\b[^.]{0,40}?\b(20[12]\d)\b[^.]{0,40}/i) ??
    text.match(/[^.]{0,40}\b(20[12]\d)\s+(?:version|model|edition|update)\b[^.]{0,40}/i);
  if (!m) return null;
  return { value: Number(m[1]), quote: m[0].trim() };
}

/** Зимние приметы в самом обзоре — без них winter_grip не ставится. */
export function mentionsWinter(raw: string): boolean {
  return /\b(snow\w*|ice|icy|winter|frozen|slush)\b/i.test(ownSentences(raw));
}

/** Дата публикации обзора — она же вход для года модели на этапе разбора. */
export function publishedFrom(html: string): string | null {
  const meta =
    html.match(/"datePublished"\s*:\s*"([^"]{8,30})"/)?.[1] ??
    html.match(/property="article:published_time"\s+content="([^"]{8,30})"/)?.[1] ??
    html.match(/<time[^>]+datetime="([^"]{8,30})"/)?.[1] ??
    null;
  return meta ? meta.slice(0, 10) : null;
}
