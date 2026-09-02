import type { ClientShoe, Recommendation, Tier } from "./types";

/**
 * Перевод характеристик в человеческий язык.
 *
 * Миллиметры и термины на первом экране карточки не показываются: «мягкая,
 * широкая колодка, без пластины» человек читает сразу, а «41/33, дроп 8» —
 * только если сам раскроет разбор. Уровень называется словом и никогда ценой:
 * цен в интерфейсе нет вообще.
 */

export const TIER_WORDS: Record<Tier, string> = {
  low: "доступные",
  mid: "средние",
  top: "топовые",
};

export function softnessWord(softness: number): string {
  if (softness < 3.5) return "жёсткая";
  if (softness < 5) return "плотная";
  if (softness < 6.5) return "средняя";
  if (softness < 8) return "мягкая";
  return "очень мягкая";
}

export function weightWord(weightG: number): string {
  if (weightG < 200) return "очень лёгкие";
  if (weightG < 240) return "лёгкие";
  if (weightG < 285) return "средние по весу";
  return "тяжёлые";
}

export function widthWord(shoe: ClientShoe): string {
  if (shoe.last_width === "narrow") return "узкая колодка";
  if (shoe.last_width === "wide") return "широкая колодка";
  return "обычная колодка";
}

export function plateWord(shoe: ClientShoe): string | null {
  if (shoe.plate === "carbon") return "карбон";
  if (shoe.plate === "nylon") return "нейлоновая пластина";
  return null;
}

export function supportWord(shoe: ClientShoe): string | null {
  if (shoe.stability === 2) return "стабилизация";
  if (shoe.stability === 1) return "лёгкая опора";
  return null;
}

export function membraneWord(shoe: ClientShoe): string | null {
  if (shoe.membrane === "gtx") return "мембрана Gore-Tex";
  if (shoe.membrane === "shield") return "защита от воды";
  return null;
}

/** Ярлыки первого экрана карточки. */
export function shoeLabels(rec: Recommendation): string[] {
  const s = rec.shoe;
  return [
    softnessWord(rec.variant.softnessShown),
    weightWord(rec.variant.weight_g),
    widthWord(s),
    plateWord(s),
    supportWord(s),
    membraneWord(s),
    s.lug_depth_mm >= 4 ? "глубокий протектор" : null,
  ].filter((x): x is string => x !== null);
}

/* --------------------------- Ответы человеческим языком --------------------------- */

/**
 * Расшифровка ответов опросника словами.
 *
 * Нужна калибровке: Игорь смотрит пару «ответы → что выдали» и отмечает, где
 * подбор разошёлся с тем, что он посоветовал бы сам. Читать сырой jsonb для
 * этого невозможно, а держать словарь в скрипте — значит развести его с
 * формулировками страницы на первой же правке вопроса.
 */
const ANSWER_WORDS: Record<string, Record<string, string>> = {
  weeklyVolume: {
    lt20: "до 20 км/нед",
    "20-40": "20–40 км/нед",
    "40-60": "40–60 км/нед",
    "60-80": "60–80 км/нед",
    "80plus": "80+ км/нед",
  },
  surface: { road: "асфальт", mixed: "асфальт и грунт", trail: "трейл" },
  goal: {
    just_run: "просто бегает",
    "5_10": "5–10 км",
    half: "полумарафон",
    marathon: "марафон",
    trail_ultra: "трейл и ультра",
  },
  winter: { none: "зимой не бегает", slush: "дождь и слякоть", snow: "снег и лёд" },
  gender: { m: "мужские", w: "женские", any: "любые" },
  footWidth: { narrow: "узкая стопа", std: "обычная стопа", wide: "широкая стопа", unknown: "ширина неизвестна" },
  pronation: { neutral: "нейтральная", over: "заваливает внутрь", unknown: "пронация неизвестна" },
  issues: {
    shin: "голени",
    achilles: "ахилл",
    knee: "колено",
    foot: "стопа",
    none: "травм не было",
  },
  dislikes: {
    harsh: "было жёстко",
    unstable: "нога гуляла",
    narrow: "было узко",
    heavy: "были тяжёлые",
    wear: "быстро изнашивались",
    heel_rub: "натирало пятку",
    none: "всё устраивало",
  },
  feel: { "1": "жёстко и отзывчиво", "2": "скорее плотно", "3": "посередине", "4": "скорее мягко", "5": "максимум мягкости" },
  tier: { low: "доступные", mid: "средние", top: "топовые", any: "уровень не важен" },
  market: { ru: "Россия", eu: "Европа", any: "откуда угодно" },
};

const word = (field: string, value: unknown): string =>
  ANSWER_WORDS[field]?.[String(value)] ?? String(value);

export function describeAnswers(a: Record<string, unknown>): string[] {
  const list = (field: string): string =>
    Array.isArray(a[field]) ? (a[field] as unknown[]).map((v) => word(field, v)).join(", ") : "—";

  return [
    `${word("weeklyVolume", a.weeklyVolume)}, ${word("surface", a.surface)}, ${word("goal", a.goal)}`,
    `скоростные: ${a.speedwork ? "да" : "нет"}, пар в ротации: ${a.pairs}, ${word("winter", a.winter)}`,
    `${a.bodyWeightKg} кг, ${word("gender", a.gender)}, ${word("footWidth", a.footWidth)}, ${word("pronation", a.pronation)}`,
    `беспокоило: ${list("issues")}`,
    `не устраивало: ${list("dislikes")}`,
    `ощущение: ${word("feel", a.feel)}, ${word("tier", a.tier)}, ${word("market", a.market)}`,
  ];
}
