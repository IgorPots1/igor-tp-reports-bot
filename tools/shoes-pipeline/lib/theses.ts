import type { Verdicts } from "./verdict-types";

/**
 * Тезисы «кому подойдёт» и «кому нет» — своими словами, а не цитатой.
 *
 * Почему словарь, а не пересказ каждой фразы. Тезис должен быть одинаковым для
 * одинакового смысла: если у двух моделей обзоры хвалят стабильность на длинных,
 * человек должен увидеть одну и ту же строку, а не две разные формулировки,
 * которые выглядят как разные свойства. Словарь это гарантирует, и он же
 * гарантирует остальное: русский, 3–7 слов, без оценок и чисел из обзора.
 *
 * Исходная фраза обзора уходит в evidence и наружу не показывается.
 *
 * Фраза, не попавшая ни в одну тему, не превращается в тезис — она пишется в
 * отчёт непокрытых, по которому словарь пополняется. Лучше без тезиса, чем с
 * придуманным.
 */

type Theme = {
  /** Ключ темы — по нему снимаются дубли. */
  key: string;
  re: RegExp;
  thesis: string;
  /** Тема дублирует поле вердикта — тогда тезис не нужен, движок выведет сам. */
  coveredBy?: (v: Verdicts) => boolean;
};

/* Порядок ВАЖЕН: частное раньше общего. «heavier runners» должно поймать тему
 * веса бегуна раньше, чем «heav» поймает «тяжеловата». */

const PRO: Theme[] = [
  { key: "heavy-ok", re: /\b(heavier|bigger|larger) runners?\b/i, thesis: "держит и тяжёлого бегуна" },
  { key: "trail", re: /\b(trail|technical|rocky|mud|rugged)\b/i, thesis: "уверенная на грунте и камнях" },
  { key: "stable-long", re: /\bstab\w*\b.*\b(long|mile|fatigue|distance)\b|\b(long|mile|fatigue|distance)\b.*\bstab\w*/i, thesis: "стабильная на длинных пробежках" },
  { key: "stable", re: /\bstab\w*|\bplanted\b|\bsecure\b/i, thesis: "стабильная и предсказуемая" },
  { key: "soft-long", re: /\b(soft|plush|cushion\w*)\b.*\b(long|mile|distance)\b|\b(long|mile|distance)\b.*\b(soft|plush|cushion\w*)\b/i, thesis: "мягкая на длинных пробежках" },
  { key: "soft", re: /\b(soft|plush|cushion\w*|pillow\w*)\b/i, thesis: "мягкая амортизация под стопой" },
  { key: "fast", re: /\b(responsive|snappy|propulsi\w*|faster paces?|speed|racing|race|tempo|pop)\b/i, thesis: "оживает на быстром темпе" },
  { key: "light", re: /\blight\w*\b/i, thesis: "лёгкая на ноге" },
  { key: "versatile", re: /\bversatil\w*/i, thesis: "универсальная под разные задачи" },
  { key: "roomy", re: /\b(toe ?box|roomy|spacious|wide)\b/i, thesis: "просторная в носке" },
  { key: "smooth", re: /\b(smooth|transition|rocker|roll\w*)\b/i, thesis: "плавный перекат с пятки на носок" },
  { key: "starter", re: /\b(starter|beginner|new runners?)\b/i, thesis: "подойдёт для начала занятий бегом" },
  { key: "walk", re: /\bwalk\w*/i, thesis: "годится и для ходьбы" },
  { key: "breathable", re: /\bbreath\w*/i, thesis: "верх хорошо дышит в жару" },
  { key: "grip", re: /\b(grip|traction)\b/i, thesis: "цепкая подошва на асфальте" },
  { key: "fit", re: /\b(upper|fit|comfort\w*|lockdown)\b/i, thesis: "удобная посадка по стопе" },
  { key: "durable", re: /\b(durab\w*|holds? up|lasts?)\b/i, thesis: "подошва долго не стирается", coveredBy: (v) => v.durability !== null },
];

const CON: Theme[] = [
  { key: "heavy-no", re: /\b(heavier|bigger|larger|heavy) runners?\b/i, thesis: "не для тяжёлых бегунов" },
  { key: "narrow", re: /\bnarrow\w*/i, thesis: "узкая колодка, тесно в стопе", coveredBy: (v) => v.width === "narrow" },
  { key: "unstable", re: /\b(unstab\w*|instab\w*|wobbl\w*|tippy)\b/i, thesis: "может быть неустойчивой" },
  { key: "thin-cushion", re: /\bcushion\w*\b.*\b(barely|not enough|lack\w*|thin|adequate)\b|\b(barely|not enough|lack\w*)\b.*\bcushion\w*/i, thesis: "мало амортизации для длинных" },
  { key: "slow", re: /\b(propulsion|less efficient|not fast|faster paces?|speed|versatility into)\b/i, thesis: "не для быстрой работы" },
  { key: "flat", re: /\b(rebound|bounce|flat|dead|lifeless)\b/i, thesis: "мало отдачи от пены" },
  // firmness 1–2 — жёсткая и плотная (шкала опросника: 1 жёстко … 5 мягко).
  // До 14.10 шкала шла наоборот, и это условие снимало тезис у МЯГКИХ моделей.
  { key: "firm", re: /\b(firm\w*|harsh|stiff)\b/i, thesis: "ощутимо жёсткая под стопой", coveredBy: (v) => v.firmness !== null && v.firmness <= 2 },
  { key: "wear", re: /\b(outsole|durab\w*|wears?|shred\w*)\b/i, thesis: "подошва быстро стирается", coveredBy: (v) => v.durability === "low" },
  { key: "heel", re: /\bheel\b.*\b(slip\w*|rub\w*|irritat\w*)\b/i, thesis: "может натирать или болтаться в пятке", coveredBy: (v) => v.heel_hold === "loose" || v.heel_hold === "stiff" },
  { key: "low-volume", re: /\b(volume|tight|snug)\b/i, thesis: "низкий объём верха" },
  { key: "break-in", re: /\b(break[- ]?in|takes time)\b/i, thesis: "нужно время на разноску" },
  { key: "small", re: /\b(runs? small|size up)\b/i, thesis: "маломерит, лучше взять больше" },
  { key: "big", re: /\b(runs? (long|big)|size down)\b/i, thesis: "большемерит, лучше взять меньше" },
  { key: "slippery", re: /\b(grip|traction)\b.*\b(poor|lack\w*|slipp\w*)\b|\bslipp\w*/i, thesis: "скользит на мокром покрытии" },
  { key: "heavy", re: /\b(heav\w*|weight)\b/i, thesis: "тяжеловата для своего класса" },
];

/** Фразы, которые не про свойства обуви: цена, внешний вид, цвет. В тезисы не идут. */
const NOT_A_PROPERTY = /\b(price|pric\w*|expensive|cost|look|looks|bland|aesthetic\w*|colou?r\w*|ugly|style)\b/i;

/** Обрывки разбора: числовые оценки, хвосты таблиц. Не фраза, а мусор. */
const DEBRIS = /^\s*[\d.]+\s|\b\d+(\.\d+)?\s*(5K|10K|Racing|Long Run|Daily Training)\b/i;

export type Thesis = { text: string; from: string };

function map(phrases: string[], themes: Theme[], v: Verdicts, unmapped: string[]): Thesis[] {
  const out: Thesis[] = [];
  const seen = new Set<string>();
  for (const raw of phrases) {
    const phrase = raw.trim();
    if (!phrase || DEBRIS.test(phrase) || NOT_A_PROPERTY.test(phrase)) continue;
    const t = themes.find((x) => x.re.test(phrase));
    if (!t) {
      unmapped.push(phrase);
      continue;
    }
    if (t.coveredBy?.(v) || seen.has(t.key)) continue;
    seen.add(t.key);
    out.push({ text: t.thesis, from: phrase });
  }
  return out;
}

export function thesesFrom(
  pros: string[],
  cons: string[],
  v: Verdicts
): { best_for: Thesis[]; not_for: Thesis[]; unmapped: string[] } {
  const unmapped: string[] = [];
  const best_for = map(pros, PRO, v, unmapped).slice(0, 4);
  // Тема, которая уже есть в плюсах, не повторяется в минусах противоположно
  // по смыслу (стабильная / неустойчивая) — такой спор уходит в отчёт, а не
  // в карточку.
  const not_for = map(cons, CON, v, unmapped).slice(0, 4);
  return { best_for, not_for, unmapped };
}

/** Для проверки: все тезисы словаря 3–7 слов, без цифр. */
export const ALL_THESES = [...PRO, ...CON].map((t) => t.thesis);

/**
 * Словарь для читателя-модели: она выбирает тезис из этих списков дословно и
 * прикладывает цитату. Чужая формулировка не проходит проверку кодом.
 */
export const ALL_PRO = PRO.map((t) => t.thesis);
export const ALL_CON = CON.map((t) => t.thesis);

/** Тезис дублирует уже поставленное поле вердикта (тема coveredBy). */
export function coveredThesis(thesis: string, v: Verdicts): boolean {
  const t = [...PRO, ...CON].find((x) => x.thesis === thesis);
  return Boolean(t?.coveredBy?.(v));
}
