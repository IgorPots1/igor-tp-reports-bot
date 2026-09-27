/**
 * Лестница коротких форматов: шаг вперёд и причины повтора.
 *
 * ЧТО СТЕРЕЖЁТ. 27.09.2026 на 30.09 встало ровно то же 7 × 4, что тренер дал
 * рукой на 23.09: пол не давал шагнуть назад, но и вперёд не вёл. Проверка
 * держит обе границы — что шаг есть по умолчанию и что он НЕ делается, когда
 * есть причина.
 *
 *   npm run check:interval-ladder
 */

import assert from "node:assert/strict";

import {
  WALK_INTERVAL_LADDER,
  decideLadderStep,
  rungByCode,
  rungByWorkMinutes,
} from "../tools/trainingpeaks-export/scripts/lib/interval-ladder.ts";

const R = (code: string) => rungByCode(code)!;

// ── Порядок ступеней ─────────────────────────────────────────────────────────
assert.equal(WALK_INTERVAL_LADDER.length, 7);
assert.equal(R("int_walk_3x3"), 0);
assert.equal(R("int_walk_7x4"), 4);
assert.equal(R("int_walk_8x4"), 5);
assert.equal(R("int_walk_6x5"), 6, "6x5 стоит ПОСЛЕ 8x4, хотя работы в нём меньше");
assert.equal(rungByCode("thr_5x4"), null, "чужой формат — не наша лестница");
assert.equal(rungByCode(null), null);

/**
 * ПОРЯДОК НЕ СОВПАДАЕТ С СОРТИРОВКОЙ ПО МИНУТАМ, И ЭТО НАМЕРЕННО. Если однажды
 * лестницу начнут строить сортировкой, этот тест упадёт первым.
 */
const byMinutes = [...WALK_INTERVAL_LADDER].sort((a, b) => a.workMinutes - b.workMinutes);
assert.notDeepEqual(
  byMinutes.map((r) => r.code),
  WALK_INTERVAL_LADDER.map((r) => r.code),
  "лестница задана списком, а не сортировкой по объёму работы"
);

// ── Ступень по минутам: так узнаётся рукописная неделя ───────────────────────
assert.equal(rungByWorkMinutes(28), 4, "28 минут работы — это 7 x 4, как у тренера рукой");
assert.equal(rungByWorkMinutes(32), 5);
assert.equal(rungByWorkMinutes(9), 0);
assert.equal(rungByWorkMinutes(27), null, "почти совпало — значит не совпало, лестница молчит");
assert.equal(rungByWorkMinutes(0), null);
assert.equal(rungByWorkMinutes(null), null);

// ── Шаг вперёд по умолчанию ──────────────────────────────────────────────────
const forward = decideLadderStep({ fromRung: R("int_walk_7x4"), isDeload: false, hasPain: false, rpeBand: "calm" });
assert.equal(forward.code, "int_walk_8x4", "после 7x4 идёт 8x4");
assert.equal(forward.heldBy, null);
assert.equal(forward.noteRu, "Ступень: 7 x 4 мин → 8 x 4 мин.");

// Спокойная полоса и «держим» шагу не мешают: повтор нужен только на тяжёлой.
assert.equal(
  decideLadderStep({ fromRung: R("int_walk_7x4"), isDeload: false, hasPain: false, rpeBand: "hold" }).code,
  "int_walk_8x4",
  "полоса «держим» про ОБЪЁМ недели, а не про ступень"
);

// ── Три причины повтора ──────────────────────────────────────────────────────
const deload = decideLadderStep({ fromRung: R("int_walk_7x4"), isDeload: true, hasPain: false, rpeBand: "calm" });
assert.equal(deload.code, "int_walk_7x4", "разгрузочная ступень не двигает");
assert.equal(deload.heldBy, "deload");
assert.ok(deload.noteRu?.includes("разгрузочная"), "в заметке написано почему");

const pain = decideLadderStep({ fromRung: R("int_walk_7x4"), isDeload: false, hasPain: true, rpeBand: "calm" });
assert.equal(pain.heldBy, "pain");
assert.ok(pain.noteRu?.includes("боль"));

const hard = decideLadderStep({ fromRung: R("int_walk_7x4"), isDeload: false, hasPain: false, rpeBand: "cut" });
assert.equal(hard.heldBy, "hard_week");
assert.ok(hard.noteRu?.includes("тяжело"));

// Разгрузка сильнее боли и тяжёлой недели: причина в заметке должна быть ОДНА.
const both = decideLadderStep({ fromRung: R("int_walk_7x4"), isDeload: true, hasPain: true, rpeBand: "cut" });
assert.equal(both.heldBy, "deload", "у разгрузки приоритет, чтобы причина была одна");

// Повтор НИКОГДА не уводит вниз.
for (const held of [deload, pain, hard, both]) {
  assert.equal(held.toRung, held.fromRung, "повтор — это повтор, а не шаг назад");
}

// ── Верх лестницы ────────────────────────────────────────────────────────────
const top = decideLadderStep({ fromRung: R("int_walk_6x5"), isDeload: false, hasPain: false, rpeBand: "calm" });
assert.equal(top.code, "int_walk_6x5", "с последней ступени шагать некуда");
assert.equal(top.heldBy, null, "это не повтор по причине, это конец лестницы");
assert.ok(top.noteRu?.startsWith("✋"), "конец лестницы — повод позвать тренера, а не тихий плато");

// ── Ступень неизвестна — лестница молчит ─────────────────────────────────────
const unknown = decideLadderStep({ fromRung: null, isDeload: false, hasPain: false, rpeBand: "calm" });
assert.equal(unknown.code, null, "не знаем, где человек стоит — не двигаем");
assert.equal(unknown.noteRu, null, "и не пишем заметок про то, чего не решали");

console.log("check:interval-ladder — все проверки пройдены");
