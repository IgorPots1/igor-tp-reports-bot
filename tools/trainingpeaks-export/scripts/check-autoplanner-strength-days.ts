/**
 * Проверка: автопланировщик бега не ставит качественную в день тренерской силовой (наряд 19.10,
 * п.4). Чистые функции, без сети и базы.
 *
 *  - placeRolesByPractice без strengthDays — ровно прежняя раскладка;
 *  - со strengthDays качественная уходит со дня силовой на следующий свой день, инварианты
 *    смежности при этом сохраняются;
 *  - силовая накануне длительной — пометка тренеру, длительная не двигается;
 *  - strengthWeekdaysFromCacheRows берёт только строки сервиса силовых и только свою неделю.
 *
 * Запуск: npm --prefix tools/trainingpeaks-export run check:autoplanner-strength-days
 */
import assert from "node:assert/strict";

import { placeRolesByPractice, type DayHistograms } from "./lib/autoplanner-week.ts";
import { STRENGTH_CACHE_SOURCE, strengthWeekdaysFromCacheRows } from "./lib/strength-cache-rows.ts";

// Практика: длительная в Вс, качество чаще всего во Вт, потом Чт; бегает 4 дня.
const hist: DayHistograms = {
  all: [2, 10, 3, 8, 2, 6, 12],
  long: [0, 0, 0, 0, 0, 0, 12],
  quality: [0, 9, 1, 6, 0, 0, 0],
  easy: [2, 1, 2, 2, 2, 6, 0],
};
const counts = { quality: 1, long: 1 };
const qualityDays = (roles: Map<number, string>) => [...roles.entries()].filter(([, r]) => r === "quality").map(([d]) => d);

const base = placeRolesByPractice(4, counts, hist, null);
assert.deepEqual(qualityDays(base.roles), [1], "без силовых качество во Вт (как было)");
assert.equal(base.roles.get(6), "long");

const noStrength = placeRolesByPractice(4, counts, hist, null, new Set());
assert.deepEqual([...noStrength.roles], [...base.roles], "пустой набор силовых — раскладка та же");
assert.deepEqual(noStrength.conflicts, base.conflicts);
const nullStrength = placeRolesByPractice(4, counts, hist, null, null);
assert.deepEqual([...nullStrength.roles], [...base.roles], "null — раскладка та же");

const tuesdayStrength = placeRolesByPractice(4, counts, hist, null, new Set([1]));
assert.deepEqual(qualityDays(tuesdayStrength.roles), [3], "силовая во Вт → качество в Чт (следующий свой день)");
assert.notEqual(tuesdayStrength.roles.get(1), "quality", "в день силовой качественной нет ВООБЩЕ");
assert.equal(tuesdayStrength.roles.get(6), "long");

// Вт и Чт заняты силовыми → качество идёт в следующий допустимый день, но не смежный с Вс.
const twoStrength = placeRolesByPractice(4, { quality: 2, long: 1 }, hist, null, new Set([1, 3]));
for (const d of qualityDays(twoStrength.roles)) {
  assert.ok(d !== 1 && d !== 3, "качество не в дни силовых");
  assert.ok(d !== 0 && d !== 5, "качество не примыкает к длительной в Вс (инвариант жив)");
}

const satStrength = placeRolesByPractice(4, counts, hist, null, new Set([5]));
assert.equal(satStrength.roles.get(6), "long", "длительная не двигается из-за силовой накануне");
assert.ok(satStrength.conflicts.some((c) => /силовая в Сб — накануне длительной \(Вс\)/.test(c)), "пометка тренеру про силовую накануне длительной");
assert.ok(!base.conflicts.some((c) => /силовая/.test(c)), "без силовых пометки нет");

// Кэш → дни недели
const strengthRow = (date: string) => ({ workout_date: date, source_snapshot: { source: STRENGTH_CACHE_SOURCE } });
const days = strengthWeekdaysFromCacheRows([
  strengthRow("2026-10-20"), // Вт
  strengthRow("2026-10-25"), // Вс
  strengthRow("2026-10-26"), // следующая неделя
  { workout_date: "2026-10-22", source_snapshot: { rawTitle: "Силовая" } }, // tpapi — не наша
  { workoutDate: "2026-10-23", sourceSnapshot: { source: STRENGTH_CACHE_SOURCE } }, // camel из repository
], "2026-10-19");
assert.deepEqual([...days].sort(), [1, 4, 6]);

console.log("[check-autoplanner-strength-days] PASS");
