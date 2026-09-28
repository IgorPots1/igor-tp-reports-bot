/**
 * Форма тренировки на дорожке: разминка по шагам и обвязка.
 *
 * ЧТО СТЕРЕЖЁТ. Минуты обязаны сходиться: обвязка считается от бюджета сессии,
 * и потерянная минута уехала бы в расхождение с длительностью. Плюс арифметика
 * ускорений: 3 x 20 сек и две паузы по 40 это 2:20, в две минуты не лезет —
 * первая версия текста эту ошибку и содержала.
 *
 *   npm run check:treadmill-shape
 */
import assert from "node:assert/strict";
import {
  EASY_MIN, STRIDES_MIN, WALK_IN_MIN,
  treadmillAerobicParts, treadmillCooldown, treadmillWarmupParts,
} from "../tools/trainingpeaks-export/scripts/lib/treadmill-shape.ts";

const sum = (parts: Array<{ minutes: number }>) => parts.reduce((s, x) => s + x.minutes, 0);

// ── Арифметика ускорений ─────────────────────────────────────────────────────
assert.ok(STRIDES_MIN * 60 >= 3 * 20 + 2 * 40, "3 x 20 сек и две паузы по 40 обязаны влезать");

// ── Карточка тренера от 23.09: 21 минута ─────────────────────────────────────
const w21 = treadmillWarmupParts(21);
assert.equal(sum(w21), 21, "сумма шагов равна заданной разминке");
assert.deepEqual(w21.map((p) => [p.label, p.minutes]), [
  ["Ходьба", 5], ["Лёгкий бег", 10], ["Перед работой", 3], ["Спокойный бег", 3],
], "ровно карточка тренера, без масштабирования");

// ── Сумма сходится на всём разумном диапазоне ────────────────────────────────
for (let total = 5; total <= 40; total += 1) {
  assert.equal(sum(treadmillWarmupParts(total)), total, `разминка ${total}: сумма шагов разошлась`);
}

// ── Порядок уступок ──────────────────────────────────────────────────────────
assert.deepEqual(
  treadmillWarmupParts(24).map((p) => [p.label, p.minutes]),
  [["Ходьба", 5], ["Лёгкий бег", 13], ["Перед работой", 3], ["Спокойный бег", 3]],
  "лишние минуты уходят в лёгкий бег, а не в ускорения"
);
assert.deepEqual(
  treadmillWarmupParts(14).map((p) => p.label),
  ["Ходьба", "Лёгкий бег", "Перед работой"],
  "первым уходит спокойный бег"
);
assert.deepEqual(
  treadmillWarmupParts(11).map((p) => p.label),
  ["Ходьба", "Лёгкий бег"],
  "вторыми уходят ускорения"
);
assert.deepEqual(treadmillWarmupParts(8).map((p) => p.label), ["Разминка"], "делить нечего — один блок");
assert.equal(treadmillWarmupParts(9)[0].minutes + (treadmillWarmupParts(9)[1]?.minutes ?? 0), 9);

// НИ ОДИН ШАГ НЕ БЫВАЕТ НУЛЕВЫМ ИЛИ ОТРИЦАТЕЛЬНЫМ: пустая строка в плане хуже
// её отсутствия — человек ищет, что он пропустил.
for (let total = 5; total <= 40; total += 1) {
  for (const part of treadmillWarmupParts(total)) {
    assert.ok(part.minutes > 0, `разминка ${total}: шаг «${part.label}» вышел ${part.minutes} мин`);
    assert.ok(part.text.length > 0, `у шага «${part.label}» нет пояснения`);
  }
}

// ── Подписи без внутренних слов ──────────────────────────────────────────────
assert.equal(treadmillCooldown(5).label, "Заминка, спокойный бег или шаг");
for (const part of [...treadmillWarmupParts(21), treadmillCooldown(5)]) {
  assert.ok(!/, спокойно$|, свободно$/.test(part.label), `в подписи «${part.label}» остался внутренний ярлык`);
}

// ── Обвязка аэробной ─────────────────────────────────────────────────────────
const a55 = treadmillAerobicParts({ minutes: 55, label: "Ровный лёгкий бег", text: "по ощущению" });
assert.equal(sum(a55), 55);
assert.deepEqual(a55.map((p) => [p.label, p.minutes]), [
  ["Ходьба", 5], ["Ровный лёгкий бег", 47], ["Заминка, спокойный бег или шаг", 3],
]);
for (let total = 20; total <= 90; total += 1) {
  assert.equal(sum(treadmillAerobicParts({ minutes: total, label: "X", text: "y" })), total, `аэробная ${total}`);
}
// Короткую не делим: обвязка съела бы половину.
assert.deepEqual(treadmillAerobicParts({ minutes: 18, label: "X", text: "y" }).map((p) => p.label), ["X"]);

assert.ok(WALK_IN_MIN > 0 && EASY_MIN > 0);
console.log("check:treadmill-shape — все проверки пройдены");
