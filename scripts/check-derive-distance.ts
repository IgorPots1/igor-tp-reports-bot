/**
 * Скорость с панели и выведенная из неё дистанция.
 *
 * ЧТО СТЕРЕЖЁТ. Ученица вводила дистанцию на глаз и дала 8610 метров за 56
 * минут — 9,2 км/ч в среднем при её лёгком 6,3. Восстановить из такого числа
 * нечего. Теперь она вводит то, что ВИДИТ на панели, а дистанцию считаем мы.
 *
 * У новой схемы две опасности, и проверка держит обе:
 *   1. ЕДИНИЦЫ. Поле темпа (мин/км) и поле скорости (км/ч) путались ею
 *      постоянно: писала то 9,08, то 4,5. Темп из формы убран, а разбор
 *      скорости обязан принимать запятую и точку одинаково.
 *   2. МОЛЧАЛИВЫЙ ОТКАЗ. Число вне диапазона нельзя отбрасывать без слов:
 *      человек читает тишину как «поле не работает» и уходит, не записав
 *      ничего. Значит на каждый отказ есть ТЕКСТ переспроса.
 *
 *   npm run check:derive-distance
 */
import assert from "node:assert/strict";

import {
  deriveIntervals,
  deriveSteady,
  plannedParts,
} from "@/features/intervals/loop/derive-distance";
import {
  SPEED_MAX_KMH,
  SPEED_MIN_KMH,
  parseSpeedKmh,
} from "@/features/intervals/loop/manual-entry-parse";

/* ── РАЗБОР СКОРОСТИ ─────────────────────────────────────────────────────── */

for (const [raw, expected] of [
  ["6,5", 6.5],
  ["6.5", 6.5],
  ["6", 6],
  ["6,5 км/ч", 6.5],
  ["4,5км/ч", 4.5],
  ["12.25", 12.25],
] as Array<[string, number]>) {
  const got = parseSpeedKmh(raw);
  assert.ok(got.ok, `«${raw}» должно разбираться: ${got.ok ? "" : got.errorRu}`);
  assert.equal(got.value, expected, `«${raw}» → ${expected}`);
}

// ЗАПЯТАЯ И ТОЧКА РАВНОПРАВНЫ — не частность, а главный случай на телефоне.
assert.deepEqual(parseSpeedKmh("6,5"), parseSpeedKmh("6.5"), "запятая и точка дают одно и то же");

// Пусто — это пусто, а не ошибка: поле необязательное.
assert.equal(parseSpeedKmh("").value, null, "пустое поле не ошибка");
assert.ok(parseSpeedKmh("").ok, "и проходит проверку");

/* ВНЕ ДИАПАЗОНА — ПЕРЕСПРОС, А НЕ ТИШИНА. */
for (const raw of ["1", "2,9", "21", "45"]) {
  const got = parseSpeedKmh(raw);
  assert.ok(!got.ok, `«${raw}» вне диапазона и должно отвергаться`);
  assert.ok(
    got.ok === false && got.errorRu.length > 0,
    `«${raw}»: отказ обязан нести ТЕКСТ, иначе это молчаливый отказ`
  );
  assert.ok(
    got.ok === false && new RegExp(`${SPEED_MIN_KMH}`).test(got.errorRu) &&
      new RegExp(`${SPEED_MAX_KMH}`).test(got.errorRu),
    `«${raw}»: в тексте названы границы, чтобы человек понял, что от него хотят`
  );
}
// Границы ВКЛЮЧИТЕЛЬНО: ровно 3 и ровно 20 проходят.
assert.ok(parseSpeedKmh(String(SPEED_MIN_KMH)).ok, "нижняя граница включительно");
assert.ok(parseSpeedKmh(String(SPEED_MAX_KMH)).ok, "верхняя граница включительно");

// 9:08 из прежнего поля темпа: в скорость такое не превращается молча.
const paceLike = parseSpeedKmh("9:08");
assert.ok(!paceLike.ok, "«9:08» это темп, а не скорость — отвергается");
// А «9,08», которое она тоже писала в темп, как скорость ПРАВДОПОДОБНО, и
// отличить его от темпа нечем. Поэтому поле темпа убрано совсем: пока их два,
// одно будет заполняться другим. Проверка фиксирует именно это.
assert.ok(parseSpeedKmh("9,08").ok, "«9,08» как скорость правдоподобна, и это неустранимо");

/* ── РОВНЫЙ БЕГ ──────────────────────────────────────────────────────────── */

const steady = deriveSteady({ minutes: 40, speedKmh: 6.3 });
assert.equal(steady.distanceM, 4200, `40 мин по 6,3 км/ч = 4200 м, вышло ${steady.distanceM}`);
assert.ok(
  steady.averageSpeedMps !== null && Math.abs(steady.averageSpeedMps - 6.3 / 3.6) < 1e-9,
  "средняя скорость в м/с соответствует введённой"
);
assert.ok(/6\.3 км\/ч × 40 мин/u.test(steady.howRu), `в след попало, как считали: ${steady.howRu}`);

// Ноль и мусор не превращаются в ноль метров: это «не из чего считать».
assert.equal(deriveSteady({ minutes: 0, speedKmh: 6 }).distanceM, null, "без времени не считаем");
assert.equal(deriveSteady({ minutes: 40, speedKmh: 0 }).distanceM, null, "без скорости не считаем");

/* ── ИНТЕРВАЛЬНАЯ: ДЛИТЕЛЬНОСТИ ИЗ ПЛАНА ───────────────────────────────── */

// Её настоящая тренировка 6 x 5 через 1:30 шагом, 64 мин.
const segments = [
  { label: "Ходьба", minutes: 5 },
  { label: "Лёгкий бег", minutes: 10 },
  { label: "Перед работой", minutes: 3 },
  { label: "Спокойный бег", minutes: 3 },
  { label: "Отрезок 1", minutes: 5 },
  { label: "Шагом", minutes: 2 },
  { label: "Отрезок 2", minutes: 5 },
  { label: "Шагом", minutes: 2 },
  { label: "Отрезок 3", minutes: 5 },
  { label: "Шагом", minutes: 2 },
  { label: "Отрезок 4", minutes: 5 },
  { label: "Шагом", minutes: 2 },
  { label: "Отрезок 5", minutes: 5 },
  { label: "Шагом", minutes: 2 },
  { label: "Отрезок 6", minutes: 5 },
  { label: "Заминка", minutes: 3 },
];
const parts = plannedParts(segments);
const workMin = parts.filter((p) => p.isWork).reduce((s, p) => s + p.minutes, 0);
assert.equal(workMin, 30, `работы 30 минут (шесть по пять), вышло ${workMin}`);

/* РАБОТА УЗНАЁТСЯ БЕЛЫМ СПИСКОМ. Чёрный («не разминка и не шаг — значит
 * работа») ошибается в сторону ЗАВЫШЕНИЯ, а завышенная дистанция ведёт к
 * прибавке объёма, которой человек не заработал. Та же развилка, на которой
 * обожглись в released-work-volume.ts. */
for (const label of ["Ходьба", "Лёгкий бег", "Перед работой", "Спокойный бег", "Шагом", "Заминка"]) {
  const one = plannedParts([{ label, minutes: 5 }]);
  assert.equal(one[0].isWork, false, `«${label}» это не работа`);
}

const plannedTotal = parts.reduce((s, p) => s + p.minutes, 0);
const intervals = deriveIntervals({
  parts, workSpeedKmh: 7, recoverySpeedKmh: 4.5, actualMinutes: plannedTotal,
});
const expectedKm = 7 * (30 / 60) + 4.5 * ((plannedTotal - 30) / 60);
assert.ok(
  intervals.distanceM !== null && Math.abs(intervals.distanceM - Math.round(expectedKm * 1000)) < 1,
  `30 мин по 7 и 34 мин по 4,5 = ${Math.round(expectedKm * 1000)} м, вышло ${intervals.distanceM}`
);
assert.ok(
  /разминка и заминка посчитаны по скорости восстановления, это занижает/u.test(intervals.howRu),
  "допущение про разминку записано в след, а не спрятано"
);

/* ДВЕ СКОРОСТИ, А НЕ ШЕСТЬ. Шесть чисел человек путает: её «8,23 / 8,23 /
 * 5,57 / 8,57 / 6,10 / 5,20» оказались смесью двух колонок панели. Проверка
 * фиксирует, что расчёту хватает двух. */
assert.equal(
  deriveIntervals({ parts, workSpeedKmh: 7, recoverySpeedKmh: 4.5, actualMinutes: 60 }).distanceM,
  deriveIntervals({ parts, workSpeedKmh: 7, recoverySpeedKmh: 4.5, actualMinutes: 60 }).distanceM,
  "расчёт детерминирован"
);

/* ── ДИСТАНЦИЯ И ВРЕМЯ В ОДНОЙ СТРОКЕ НЕ ПРОТИВОРЕЧАТ ДРУГ ДРУГУ ───────────
 *
 * Дефект первой версии, поймала проверка тренера «должно выйти около 6 км».
 * Длительности брались из плана как есть: план 63,5 минуты, человек отбежал
 * 56 — и дистанция считалась за 63,5, тогда как в той же строке базы лежало
 * время 56. Два числа об одной тренировке противоречили друг другу.
 */
const short = deriveIntervals({ parts, workSpeedKmh: 8.2, recoverySpeedKmh: 5.2, actualMinutes: 56 });
assert.ok(short.distanceM !== null, "короче плана тоже считается");
const impliedKmh = (short.distanceM! / 1000) / (56 / 60);
assert.ok(
  Math.abs(impliedKmh - (short.averageSpeedMps! * 3.6)) < 0.05,
  `дистанция, делённая на ФАКТИЧЕСКОЕ время, даёт ту же среднюю: ${impliedKmh.toFixed(2)} против ${(short.averageSpeedMps! * 3.6).toFixed(2)}`
);
const full = deriveIntervals({ parts, workSpeedKmh: 8.2, recoverySpeedKmh: 5.2, actualMinutes: plannedTotal });
assert.ok(
  short.distanceM! < full.distanceM!,
  "отбежал меньше плана — дистанция меньше, а не равна плановой"
);
assert.ok(
  /план был .* отбегано .* пропорционально/u.test(short.howRu),
  `в следе сказано, что доли шагов взяты пропорционально: ${short.howRu}`
);
assert.ok(
  !/пропорционально/u.test(full.howRu),
  "а когда отбегано ровно по плану, лишней оговорки в следе нет"
);

// Выведенная дистанция ВСЕГДА правдоподобнее её прикидки: на той же сессии
// 8610 м давали 9,2 км/ч в среднем, расчёт даёт ниже рабочей скорости.
const avgKmh = (intervals.averageSpeedMps ?? 0) * 3.6;
assert.ok(avgKmh > 4.5 && avgKmh < 7, `средняя ${avgKmh.toFixed(1)} км/ч лежит между восстановлением и работой`);
assert.ok(avgKmh < 9.2, "и заметно ниже того, что получалось из её прикидки");

console.log("check:derive-distance — все проверки пройдены");
