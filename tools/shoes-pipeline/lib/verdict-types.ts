/**
 * Схема вердиктов — раздел 2 наряда «Сбор базы кроссовок, версия 2».
 *
 * База строится не из измерений, а из свода обзоров. Это не хуже и не лучше
 * измерения, это другое: обзор субъективен, но покрывает то, чего не меряет ни
 * один прибор — как модель ведёт себя на длинной, кому натирает, насколько
 * живучая.
 *
 * Отсюда главное свойство схемы: у КАЖДОГО вердикта должно быть не меньше двух
 * прочитанных обзоров со ссылками. Утраченную объективность измерений заменяет
 * проверяемость: человек видит, на чём основан вывод.
 */

export type Purpose = "daily" | "tempo" | "race" | "max" | "stability" | "trail" | "winter";
export type Feel = "firm_responsive" | "balanced" | "soft_stable" | "bouncy_soft" | "plush";
export type Width = "narrow" | "standard" | "wide";
export type Durability = "low" | "average" | "high";
export type HeelHold = "loose" | "good" | "stiff";
export type WeightClass = "light" | "medium" | "heavy";
export type WinterGrip = "poor" | "fair" | "good";

/**
 * Жёсткость 1–5, а НЕ 1–10, и это решение, а не упрощение: обзоры не дают
 * точности, которой хватило бы на десять делений, а видимость точности хуже её
 * отсутствия.
 */
export type Firmness = 1 | 2 | 3 | 4 | 5;

export type Verdicts = {
  purpose: Purpose[];
  feel: Feel | null;
  firmness: Firmness | null;
  width: Width | null;
  durability: Durability | null;
  heel_hold: HeelHold | null;
  best_for: string[];
  not_for: string[];
  weight_class: WeightClass | null;
  winter_grip: WinterGrip | null;
  summary: string | null;
};

/** Доказательство: какой вердикт, из какого обзора, когда вышел. */
export type Evidence = {
  field: keyof Verdicts;
  url: string;
  source: string;
  /** Дата публикации обзора. Нужна и как год модели на этапе разбора. */
  date: string | null;
  /** Кусок текста, по которому вердикт поставлен, — чтобы можно было проверить. */
  quote: string | null;
};

/**
 * Уверенность. "low" — вердикт стоит на ОДНОМ обзоре; такая модель не
 * показывается первой позицией в слоте. Для китайских брендов это ожидаемое
 * состояние, а не дефект: обзоров по ним мало.
 */
export type Confidence = "normal" | "low";

export type VerdictRecord = {
  id: string;
  brand: string;
  model: string;
  /** Год модели. Берётся при разборе: дата обзора, сверенная с сайтом бренда. */
  year: number | null;
  verdicts: Verdicts;
  evidence: Evidence[];
  confidence: Confidence;
  /** Поля, где обзоры разошлись: в отчёт человеку, а не усреднять. */
  disputed: string[];
};

export const EMPTY_VERDICTS: Verdicts = {
  purpose: [],
  feel: null,
  firmness: null,
  width: null,
  durability: null,
  heel_hold: null,
  best_for: [],
  not_for: [],
  weight_class: null,
  winter_grip: null,
  summary: null,
};

/** Поля, которые обязаны опираться на два источника (раздел 5 версии 2). */
export const TWO_SOURCE_FIELDS: (keyof Verdicts)[] = [
  "feel",
  "firmness",
  "width",
  "durability",
  "heel_hold",
  "weight_class",
  "winter_grip",
];
