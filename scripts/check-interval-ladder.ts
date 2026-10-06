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
assert.equal(R("int_walk_6x5"), 5, "6x5 стоит ПЕРЕД 8x4: длина отрезка — новое умение, число — нет");
assert.equal(R("int_walk_8x4"), 6);
assert.equal(rungByCode("thr_5x4"), null, "чужой формат — не наша лестница");
assert.equal(rungByCode(null), null);

/**
 * ПОРЯДОК ПРИБИТ СПИСКОМ, А НЕ ВЫВЕДЕН. Сейчас он случайно совпал с
 * возрастанием минут работы, и на это совпадение полагаться нельзя: «тяжелее»
 * и «больше по сумме» не одно и то же. Любая перестановка обязана упереться в
 * этот тест, чтобы её приняли глазами, а не молча отсортировали.
 */
assert.deepEqual(
  WALK_INTERVAL_LADDER.map((r) => r.code),
  ["int_walk_3x3", "int_walk_4x3", "int_walk_5x3", "int_walk_6x4", "int_walk_7x4", "int_walk_6x5", "int_walk_8x4"],
  "порядок ступеней — решение тренера, менять только вместе с этим тестом"
);

// ── Ступень по минутам: так узнаётся рукописная неделя ───────────────────────
assert.equal(rungByWorkMinutes(28), 4, "28 минут работы — это 7 x 4, как у тренера рукой");
assert.equal(rungByWorkMinutes(30), 5, "30 минут — это 6 x 5");
assert.equal(rungByWorkMinutes(32), 6, "32 минуты — это 8 x 4, последняя ступень");
assert.equal(rungByWorkMinutes(9), 0);
assert.equal(rungByWorkMinutes(27), null, "почти совпало — значит не совпало, лестница молчит");
assert.equal(rungByWorkMinutes(0), null);
assert.equal(rungByWorkMinutes(null), null);

// ── Шаг вперёд по умолчанию ──────────────────────────────────────────────────
const forward = decideLadderStep({ fromRung: R("int_walk_7x4"), isDeload: false, hasPain: false, rpeBand: "calm" });
assert.equal(forward.code, "int_walk_6x5", "после 7x4 идёт 6x5, а не 8x4");
assert.equal(forward.heldBy, null);
assert.equal(forward.noteRu, "Ступень: 7 x 4 мин → 6 x 5 мин.");

// Спокойная полоса и «держим» шагу не мешают: повтор нужен только на тяжёлой.
assert.equal(
  decideLadderStep({ fromRung: R("int_walk_7x4"), isDeload: false, hasPain: false, rpeBand: "hold" }).code,
  "int_walk_6x5",
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
const top = decideLadderStep({ fromRung: R("int_walk_8x4"), isDeload: false, hasPain: false, rpeBand: "calm" });
assert.equal(top.code, "int_walk_8x4", "с последней ступени шагать некуда");
assert.equal(top.heldBy, null, "это не повтор по причине, это конец лестницы");
assert.ok(top.noteRu?.startsWith("✋"), "конец лестницы — повод позвать тренера, а не тихий плато");

// ── Ступень неизвестна — лестница молчит ─────────────────────────────────────
const unknown = decideLadderStep({ fromRung: null, isDeload: false, hasPain: false, rpeBand: "calm" });
assert.equal(unknown.code, null, "не знаем, где человек стоит — не двигаем");
assert.equal(unknown.noteRu, null, "и не пишем заметок про то, чего не решали");

/* ── ПЕРЕРЫВ [пороги утверждены Игорем 06.10.2026] ──────────────────────────
 *
 * ЧТО СТЕРЕЖЁТ ПЕРВОЕ УТВЕРЖДЕНИЕ. Правило чуть не сделали в ДНЯХ, а настоящие
 * промежутки между пробежками у живой ученицы 3, 3 и 4 дня: порог «четыре дня»
 * срабатывал бы на её обычном ритме. Единица — пропущенная ПЛАНОВАЯ, и ноль
 * пропусков обязан шагать вперёд, сколько бы дней между пробежками ни прошло.
 */
const from5 = R("int_walk_6x5");
const noBreak = decideLadderStep({ fromRung: from5, isDeload: false, hasPain: false, rpeBand: "calm", missedStreak: 0 });
assert.equal(noBreak.toRung, from5 + 1, "без пропусков шаг вперёд, как и раньше");

const oneMissed = decideLadderStep({ fromRung: from5, isDeload: false, hasPain: false, rpeBand: "calm", missedStreak: 1 });
assert.equal(oneMissed.toRung, from5 + 1, "одна невышедшая тренировка ступень не трогает: план и так с запасом");
assert.equal(oneMissed.heldBy, null, "и причиной постоять не считается");

for (const missed of [2, 3]) {
  const held = decideLadderStep({ fromRung: from5, isDeload: false, hasPain: false, rpeBand: "calm", missedStreak: missed });
  assert.equal(held.toRung, from5, `пропущено ${missed} — ступень держим`);
  assert.equal(held.heldBy, "break", "и причина названа перерывом, а не болью или тяжестью");
  assert.ok(held.noteRu?.includes(String(missed)), "в заметке стоит само число пропусков");
}

for (const missed of [4, 6, 9]) {
  const back = decideLadderStep({ fromRung: from5, isDeload: false, hasPain: false, rpeBand: "calm", missedStreak: missed });
  assert.equal(back.toRung, from5 - 1, `пропущено ${missed} — ступень назад`);
  assert.equal(back.heldBy, "break", "откат помечен перерывом");
  assert.ok(back.codesPreferred.includes(WALK_INTERVAL_LADDER[from5 - 1].code), "и формат просим именно нижний");
}

/* ОТКАТ СИЛЬНЕЕ ЛЮБОГО УДЕРЖАНИЯ. Боль и тяжёлая неделя оставляют человека
 * там, где он стоял; перерыв говорит, что он там больше не стоит. */
const breakWithPain = decideLadderStep({ fromRung: from5, isDeload: false, hasPain: true, rpeBand: "cut", missedStreak: 5 });
assert.equal(breakWithPain.toRung, from5 - 1, "перерыв откатывает даже вместе с болью и тяжёлой неделей");

/* НО РАЗГРУЗКА ИСКЛЮЧЕНИЕ: на ней формат и так падает по бюджету, и откат
 * вычел бы перерыв дважды. */
const breakOnDeload = decideLadderStep({ fromRung: from5, isDeload: true, hasPain: false, rpeBand: "calm", missedStreak: 6 });
assert.equal(breakOnDeload.toRung, from5, "на разгрузке перерыв ступень не откатывает");
assert.equal(breakOnDeload.heldBy, "deload", "и держит её именно разгрузка");

/* С НИЖНЕЙ СТУПЕНИ ОТКАТЫВАТЬ НЕКУДА — зовём тренера, а не уходим в минус. */
const bottom = decideLadderStep({ fromRung: 0, isDeload: false, hasPain: false, rpeBand: "calm", missedStreak: 8 });
assert.equal(bottom.toRung, 0, "ниже первой ступени лестницы нет");
assert.ok(bottom.noteRu?.includes("взгляд тренера"), "и об этом сказано прямо");

/* НЕ ПЕРЕДАЛИ ПЕРЕРЫВ — ПОВЕДЕНИЕ ПРЕЖНЕЕ. Вызовы, которые о нём не знают,
 * ломаться не должны. */
const silent = decideLadderStep({ fromRung: from5, isDeload: false, hasPain: false, rpeBand: "calm" });
assert.equal(silent.toRung, from5 + 1, "без поля missedStreak всё как было: шаг вперёд");

console.log("check:interval-ladder — все проверки пройдены");
