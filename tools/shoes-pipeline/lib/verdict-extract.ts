/**
 * Текст страницы обзора: что видит читатель-модель и в чём код ищет цитату.
 *
 * Здесь были и извлечения вердиктов подсчётом ключевых слов (firmnessFrom,
 * feelFrom и соседи). Они сняты 14.10.2026: метод не давал вердиктов (на 20
 * моделях почти по каждому полю спор), а firmnessFrom к тому же держал старое
 * направление шкалы — 1 мягко, — обратное опроснику. Вердикты ставит чтение
 * моделью с проверкой цитаты кодом (read-verdicts.ts, lib/verdict-read.ts).
 */

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
  // С УЧЁТОМ регистра: заголовки хвоста пишутся с заглавной («Comments»,
  // «Related Posts»), а строчное «comments» стоит в тексте самих обзоров
  // («from the comments I've already seen») — без учёта регистра оно резало
  // обзор на полуслове, на одной площадке так обрезалось 25 страниц из 252.
  const re = new RegExp(TAIL.source, "g");
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
