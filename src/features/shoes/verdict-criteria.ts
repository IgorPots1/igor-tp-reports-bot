import type { Dislike } from "./types";
import type { Verdicts } from "./verdict-types";

/**
 * Критерии подбора на ВЕРДИКТАХ из обзоров — замена критериев на замерах.
 *
 * ГЛАВНОЕ ПРАВИЛО: null значит «нет данных», а не «стандарт». Пустое поле не
 * штрафуется и не поощряется — у всех моделей без данных по полю один и тот же
 * нейтральный балл, и между собой они от этого поля не различаются. Иначе
 * модель, о которой обзорщик просто не написал, проигрывала бы той, о которой
 * написал «средне», — то есть наказывалась бы за молчание источника.
 *
 * ПРО ПЕРЕХОД. Живой движок (scoring.ts) пока работает на старой схеме и
 * демо-базе с замерами. Эти критерии подключаются, когда каталог переедет на
 * вердикты. В тот же момент check-shoes-picker обязан потерять утверждение
 * «тяжёлому не дают стек ниже 30 мм» — оно стережёт критерий на стеке,
 * которого в новой базе нет (правило 6a: переписать в том же коммите).
 */

export type CriterionOutcome = { score: number; note: { text: string; tone: "plus" | "minus" } | null };

/** Балл для «данных нет». Один на всех — поэтому на ранжирование не влияет. */
export const NEUTRAL = 0.6;

/** Порог «тяжёлого бегуна» — тот же, что в прежнем критерии. */
export const HEAVY_RUNNER_KG = 85;

/** Тезис словаря, по которому видно явное «не для тяжёлых». */
export const NOT_FOR_HEAVY = "не для тяжёлых бегунов";

/**
 * Вес бегуна (решение Игоря, 13.10.2026).
 *
 * Прежний критерий требовал стек от 34 мм — стека в новой базе нет. Теперь:
 * от 85 кг плюс за живучую подошву у модели под объём (daily или max), минус —
 * если обзоры прямо сказали «не для тяжёлых». Всё остальное нейтрально: ни
 * мягкость, ни отсутствие данных не делают модель «тяжёлой» или «лёгкой».
 */
export function runnerWeightFromVerdicts(bodyWeightKg: number, v: Verdicts): CriterionOutcome {
  if (bodyWeightKg < HEAVY_RUNNER_KG) return { score: NEUTRAL, note: null };

  if (v.not_for.includes(NOT_FOR_HEAVY)) {
    return { score: 0.15, note: { text: "обзоры прямо пишут: не для тяжёлых бегунов", tone: "minus" } };
  }
  const forVolume = v.purpose.includes("daily") || v.purpose.includes("max");
  if (v.durability === "high" && forVolume) {
    return { score: 1, note: { text: "живучая подошва под большой объём", tone: "plus" } };
  }
  return { score: NEUTRAL, note: null };
}

/**
 * Строка-предупреждение о посадке, когда жалоба есть, а данных нет.
 *
 * Человек сказал «давило в носке» или «натирало пятку», а обзоры об этой
 * модели в этом месте молчат. Промолчать — значит позволить подумать, что
 * модель проверена и подходит. Штрафовать — значит наказать за молчание
 * источника. Честный путь — сказать, что данных нет, и отправить на примерку.
 */
export const FIT_UNKNOWN = "посадку этой модели обзоры не описывают, проверь примеркой";

export function fitWarnings(dislikes: Dislike[], v: Verdicts): string[] {
  const narrowComplaint = dislikes.includes("narrow") && v.width === null;
  const heelComplaint = dislikes.includes("heel_rub") && v.heel_hold === null;
  // Одна строка, даже если пусто оба поля: два одинаковых предупреждения
  // подряд читаются как сбой, а не как забота.
  return narrowComplaint || heelComplaint ? [FIT_UNKNOWN] : [];
}

/**
 * Ощущение под стопой: ответ опросника против firmness из обзоров.
 *
 * Шкалы ОДНОГО направления (решение Игоря, 14.10.2026): в опроснике «1 жёстко
 * и отзывчиво … 5 максимум мягкости», в вердикте firmness 1 жёстко … 5 очень
 * мягко. Поэтому сравнение прямое — расстояние между ответом и вердиктом, без
 * переворота. Переворот в коде — ровно то место, где шкалы однажды
 * разъезжаются молча; его здесь нет нарочно.
 *
 * firmness неизвестен — нейтрально, как любое пустое поле.
 */
export function feelFromVerdicts(answerFeel: 1 | 2 | 3 | 4 | 5, v: Verdicts): CriterionOutcome {
  if (v.firmness === null) return { score: NEUTRAL, note: null };
  const diff = v.firmness - answerFeel;
  const score = Math.max(0, 1 - Math.abs(diff) / 4);
  if (diff === 0) return { score, note: { text: "ощущение под ногой ровно то, что просил", tone: "plus" } };
  if (diff >= 2) return { score, note: { text: "заметно мягче, чем ты просил", tone: "minus" } };
  if (diff <= -2) return { score, note: { text: "заметно жёстче, чем ты просил", tone: "minus" } };
  return { score, note: null };
}
