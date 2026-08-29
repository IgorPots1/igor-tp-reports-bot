import type { CriterionId } from "./types";

/**
 * Веса критериев подбора — раздел 6.3 ТЗ, одним объектом.
 *
 * Числа держатся здесь и только здесь: этап 2 (калибровка на реальных
 * атлетах Игоря) правит именно этот объект, и разъезд копий по коду сделал бы
 * калибровку бессмысленной. До калибровки значения НЕ меняются.
 *
 * `weather` работает ТОЛЬКО в зимнем слоте; в остальных возвращает постоянные
 * 0.7 и на ранжирование не влияет (постоянная одинакова у всех кандидатов).
 *
 * Пронация сидит в `stability` с весом 4 намеренно и повышению не подлежит:
 * подбор по типу пронации травмы не снижает (в отличие от подбора по комфорту,
 * который снижает, — отсюда вес 20 у `softness`).
 */
export const CRITERION_WEIGHTS: Record<CriterionId, number> = {
  softness: 20,
  runnerWeight: 18,
  antiPattern: 16,
  width: 12,
  slotFit: 12,
  injury: 10,
  durability: 8,
  tier: 7,
  recency: 5,
  brand: 5,
  stability: 4,
  weather: 10,
};

export const CRITERION_TITLES: Record<CriterionId, string> = {
  softness: "Мягкость под предпочтение",
  runnerWeight: "Вес бегуна и пена",
  antiPattern: "Опыт прошлых пар",
  width: "Ширина колодки",
  slotFit: "Соответствие задаче",
  injury: "История травм",
  durability: "Ресурс под объём",
  tier: "Уровень",
  recency: "Актуальность версии",
  brand: "Знакомый бренд",
  stability: "Стабилизация",
  weather: "Защита от погоды",
};

export const TOTAL_WEIGHT = Object.values(CRITERION_WEIGHTS).reduce(
  (sum, w) => sum + w,
  0
);
