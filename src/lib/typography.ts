/* Неразрывные пробелы (U+00A0) в текстах бота, мини-приложения и сайта (наряд 18.10.2026): чтобы
 * Telegram и браузер не переносили строку посреди «21 км», «7 дней», «25 окт, вс», не начинали строку
 * с «·» и не отрывали «№» от номера. Одна функция для всех шаблонов; проверка races-bot-screens
 * требует, чтобы каждый текст бота был её неподвижной точкой (nbsp(x) === x). */

export const NBSP = " ";

const NOT_LETTER = "(?![A-Za-zА-Яа-яЁё])";
// единицы и слова, которые не отрываются от числа перед ними
const UNITS = [
  "км", "м", "мм", "см", "мин", "минут[а-я]*", "ч", "час[а-я]*", "сек", "с", "дн[а-я]*", "день", "недел[а-я]*",
  "мес[а-я]*", "лет", "год[а-я]*", "раз[а]?", "мест[а-я]*", "чел[а-я]*\\.?", "участник[а-я]*", "забег[а-я]*",
  "старт[а-я]*", "дистанци[а-я]*", "ккал", "кг", "г", "₽", "руб[а-я]*\\.?", "%", "°", "шт",
  "янв[а-я]*", "фев[а-я]*", "мар[а-я]*", "апр[а-я]*", "ма[йя]", "июн[а-я]*", "июл[а-я]*", "авг[а-я]*",
  "сен[а-я]*", "окт[а-я]*", "ноя[а-я]*", "дек[а-я]*",
].join("|");
const NUM_UNIT = new RegExp(`(\\d)[ \\t]+(?=(?:${UNITS})${NOT_LETTER})`, "gu");
const WEEKDAY = new RegExp(`,[ \\t]+(?=(?:пн|вт|ср|чт|пт|сб|вс)${NOT_LETTER})`, "gu");

/** Простой текст: неразрывные пробелы по правилам выше. Повторный вызов ничего не меняет. */
export function nbsp(text: string): string {
  return text
    .replace(NUM_UNIT, `$1${NBSP}`)
    .replace(WEEKDAY, `,${NBSP}`)
    .replace(/[ \t]+·/g, `${NBSP}·`) // «·» держится за слово слева, строка с неё не начнётся
    .replace(/№[ \t]+(?=\d)/g, `№${NBSP}`);
}

/** HTML Telegram/сайта: только текст между тегами, теги и адреса в них не трогаем. */
export function nbspHtml(html: string): string {
  return html.replace(/(^|>)([^<]+)/g, (_m, open: string, text: string) => open + nbsp(text));
}

/** Поля с адресами и идентификаторами внутри rich-сообщений и кнопок — их не трогаем. */
const SKIP_KEYS = new Set(["url", "callback_data", "custom_emoji_id", "type", "align", "valign", "style", "switch_inline_query", "data"]);

/** Любая структура (rich_message, клавиатура): nbsp во всех строковых значениях, кроме адресов и служебных полей. */
export function nbspDeep<T>(value: T, key = ""): T {
  if (typeof value === "string") return (SKIP_KEYS.has(key) ? value : nbsp(value)) as T;
  if (Array.isArray(value)) return value.map((v) => nbspDeep(v, key)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = k === "web_app" || k === "login_url" ? v : nbspDeep(v, k);
    return out as T;
  }
  return value;
}
