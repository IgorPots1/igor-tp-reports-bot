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
  rungByLabel,
  rungByWorkMinutes,
  rungFromSession,
} from "../tools/trainingpeaks-export/scripts/lib/interval-ladder.ts";

const R = (code: string) => rungByCode(code)!;

// ── Порядок ступеней ─────────────────────────────────────────────────────────
/* ── ПЕРЕПИСАНО [ряд задан Игорем 12.10.2026] ───────────────────────────────
 *
 * Прежде проверка стерегла СЕМЬ ступеней с 8 x 4 на вершине и ступень,
 * выводимую из минут работы. Ряд сменился (5 x 6 → 5 x 7 → 4 x 8 → 4 x 10,
 * 8 x 4 убран), и главное — минуты перестали быть ключом: у 6 x 5 и 5 x 6
 * работы ровно по 30, и пока ступень выводилась из них, рукописная 5 x 6
 * читалась как 6 x 5, то есть как откат.
 *
 * Новые утверждения СИЛЬНЕЕ прежних: они требуют, чтобы два формата с
 * одинаковой работой РАЗЛИЧАЛИСЬ, а не просто чтобы длина списка совпала. */
assert.equal(WALK_INTERVAL_LADDER.length, 10);
assert.equal(R("int_walk_3x3"), 0);
assert.equal(R("int_walk_7x4"), 4);
assert.equal(R("int_walk_6x5"), 5, "6x5 стоит ПЕРЕД 8x4: длина отрезка — новое умение, число — нет");
assert.equal(R("int_walk_6x5"), 5);
assert.equal(R("int_walk_5x6"), 6, "5 x 6 стоит СРАЗУ ПОСЛЕ 6 x 5");
assert.equal(R("int_walk_5x7"), 7);
assert.equal(R("int_walk_4x8"), 8);
assert.equal(R("int_walk_4x10"), 9, "4 x 10 — вершина ряда");
assert.equal(R("int_walk_8x4"), null, "8 x 4 убран из прогрессии решением тренера");
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
  ["int_walk_3x3", "int_walk_4x3", "int_walk_5x3", "int_walk_6x4", "int_walk_7x4",
   "int_walk_6x5", "int_walk_5x6", "int_walk_5x7", "int_walk_4x8", "int_walk_4x10"],
  "порядок ступеней — решение тренера, менять только вместе с этим тестом"
);

// ── Ступень по минутам: так узнаётся рукописная неделя ───────────────────────
assert.equal(rungByWorkMinutes(28), 4, "28 минут работы — это 7 x 4, как у тренера рукой");
/* ГЛАВНОЕ УТВЕРЖДЕНИЕ ПРАВКИ: минуты больше НЕ определяют ступень там, где их
 * делят два формата. Прежде здесь стояло «30 минут это 6 x 5» — и ровно это
 * читало рукописную 5 x 6 как ступень ниже. */
assert.equal(
  rungByWorkMinutes(30),
  null,
  "30 минут у ДВУХ форматов (6 x 5 и 5 x 6) — лестница отказывается угадывать"
);
assert.equal(rungByWorkMinutes(32), 8, "32 минуты теперь однозначны: 4 x 8");
assert.equal(rungByWorkMinutes(35), 7, "35 минут — 5 x 7");
assert.equal(rungByWorkMinutes(40), 9, "40 минут — 4 x 10");
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

/* ── РАЗЛИЧИМОСТЬ 6 x 5 И 5 x 6 ────────────────────────────────────────────
 * Работы у них ровно по 30, и это единственная пара в ряду с таким
 * совпадением. Если лестница их спутает, человек, стоящий на 5 x 6, получит
 * 6 x 5 — молчаливый откат, который и случился у живой ученицы. */
assert.notEqual(R("int_walk_6x5"), R("int_walk_5x6"), "это РАЗНЫЕ ступени");
assert.equal(
  WALK_INTERVAL_LADDER[R("int_walk_6x5")!].workMinutes,
  WALK_INTERVAL_LADDER[R("int_walk_5x6")!].workMinutes,
  "и при этом работа у них одинаковая — именно поэтому минуты не ключ"
);
assert.equal(
  R("int_walk_5x6")! - R("int_walk_6x5")!,
  1,
  "5 x 6 ровно на одну ступень выше 6 x 5: шаг вперёд с 6 x 5 ведёт в 5 x 6"
);
/* РЯД НЕМОНОТОНЕН ПО РАБОТЕ, И ЭТО ЗАМЫСЕЛ: 4 x 8 (32) стоит ВЫШЕ 5 x 7 (35).
 * Утверждение стоит здесь, чтобы будущая «уборка» не отсортировала ряд. */
assert.ok(
  WALK_INTERVAL_LADDER[8].workMinutes < WALK_INTERVAL_LADDER[7].workMinutes,
  "4 x 8 выше 5 x 7 при меньшей работе — сортировать ряд по минутам нельзя"
);

/* ── ПОДПИСЬ ЧИТАЕТСЯ: РУКОПИСНАЯ НЕДЕЛЯ УЗНАЁТСЯ ──────────────────────────
 * Её неделя 12.10 записана рукой: preset_code = coach_hand_authored, формат
 * только в названии. Это тот самый случай, ради которого правка и делалась. */
assert.equal(
  rungByLabel("5 x 6 мин через 1:30 шагом"),
  R("int_walk_5x6"),
  "рукописная неделя 12.10 читается как ступень 5 x 6"
);
assert.equal(rungByLabel("6 x 5 мин через 1:30 шагом"), R("int_walk_6x5"), "и 6 x 5 читается как 6 x 5");
assert.equal(rungByLabel("4 x 10 мин через 1:30 шагом"), R("int_walk_4x10"), "двузначная длина тоже");
assert.equal(rungByLabel("Лёгкий бег"), null, "в подписи без «N x M» ступени нет");
assert.equal(rungByLabel(null), null, "и пусто это пусто");
assert.equal(rungByLabel("8 x 4 мин через 1:30 шагом"), null, "убранный из ряда формат не узнаётся, и это верно");

/* ── ПОРЯДОК ПОПЫТОК ЖЁСТКИЙ: КОД → ПОДПИСЬ → МИНУТЫ ──────────────────────── */
assert.equal(
  rungFromSession({ presetCode: "coach_hand_authored", title: "5 x 6 мин через 1:30 шагом", workMinutes: 30 }),
  R("int_walk_5x6"),
  "рукописная: код не помог, подпись решила — 30 минут не увели в 6 x 5"
);
assert.equal(
  rungFromSession({ presetCode: "int_walk_6x5", title: "5 x 6 мин через 1:30 шагом", workMinutes: 30 }),
  R("int_walk_6x5"),
  "код сильнее подписи: при расхождении верим машинному коду"
);
assert.equal(
  rungFromSession({ presetCode: null, title: null, workMinutes: 28 }),
  4,
  "минуты остаются запасным путём для старых записей без кода и подписи"
);
assert.equal(
  rungFromSession({ presetCode: null, title: null, workMinutes: 30 }),
  null,
  "но при неоднозначных минутах молчит, а не угадывает"
);

// ── Верх лестницы ────────────────────────────────────────────────────────────
const top = decideLadderStep({ fromRung: R("int_walk_4x10"), isDeload: false, hasPain: false, rpeBand: "calm" });
assert.equal(top.code, "int_walk_4x10", "с последней ступени шагать некуда");
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
